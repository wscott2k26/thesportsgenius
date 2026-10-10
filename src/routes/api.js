// Public + user API routes.
import { Router } from 'express';
import { db, todayET, isPremium } from '../db.js';
import { stripeConfigured } from '../billing.js';
import { integrity } from '../ledger.js';
import { getScoreboard, fetchHistoricalScoreboard, getStandings, getTeams, fetchNews, LEAGUE_KEYS, LEAGUES } from '../providers/espn.js';
import { getPicks, trackRecord, DISCLAIMER } from '../picks.js';
import { handleChat, FREE_CHATS_PER_DAY } from '../chat.js';
import { getOdds, oddsAvailable, findOddsForPick, bestMoneyline, matchAffiliate, profitFor, getEventProps } from '../providers/odds.js';
import { getMovements, getLineHistory, movementSummary } from '../providers/movement.js';
import { getSplits, splitsAvailable, SPLITS_UNAVAILABLE_NOTE } from '../providers/splits.js';
import { isAdmin } from './auth.js';

export const router = Router();

const FREE_LEAGUES = ['nfl', 'nba'];

function filterLeagues(picks, premium) {
  return premium ? picks : picks.filter(p => FREE_LEAGUES.includes(p.league));
}

router.get('/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

router.get('/leagues', (req, res) => {
  res.json({ leagues: LEAGUE_KEYS.map(k => ({ key: k, ...LEAGUES[k], free: FREE_LEAGUES.includes(k) })) });
});


// Historical completed scores only; these are NOT retrospective predictions.
// Fetching one selected date keeps upstream data use bounded and honest.
const historicalCache = new Map();
router.get('/history', async (req, res) => {
  const league = String(req.query.league || 'nba').toLowerCase();
  const date = String(req.query.date || '');
  if (!LEAGUES[league]) return res.status(400).json({ error: 'unknown_league' });
  if (!/^\d{8}$/.test(date)) return res.status(400).json({ error: 'date_must_be_yyyymmdd' });
  const parsed = new Date(date.slice(0,4)+'-'+date.slice(4,6)+'-'+date.slice(6)+'T12:00:00Z');
  const day = parsed.toISOString().slice(0,10).replace(/-/g,'');
  const age = (Date.now()-parsed.getTime())/86400000;
  if (day !== date || age < 0 || age > 91) return res.status(400).json({ error: 'date_outside_last_90_days' });
  const key=league+':'+date;
  const old=historicalCache.get(key);
  if (old && Date.now()-old.time < 3600000) return res.json(old.data);
  try {
    const games = (await fetchHistoricalScoreboard(league,date)).filter(g => g.status.state === 'post');
    const data = { league, date, games, count:games.length, type:'historical_final_results', backtest:false, note:'These are completed games, not picks our model issued before kickoff.' };
    historicalCache.set(key,{time:Date.now(),data});
    if(historicalCache.size>100)historicalCache.delete(historicalCache.keys().next().value);
    res.json(data);
  } catch(e){res.status(502).json({error:'historical_scores_unavailable'});}
});


// Game Center: allowlisted league and event ID; no arbitrary upstream URLs.
router.get('/game', async (req,res) => {
 const league=String(req.query.league||'').toLowerCase(),id=String(req.query.id||'');
 if(!LEAGUES[league]||!/^[a-zA-Z0-9_-]{1,64}$/.test(id))return res.status(400).json({error:'invalid_game'});
 try{
  const {events,fetchedAt,delayed}=await getScoreboard(league);
  let game=events.find(e=>e.id===id);
  if(!game&&/^\d+$/.test(id)){
   // A match from the last 90 days can be resolved by its supplied YYYYMMDD date.
   const date=String(req.query.date||'');
   if(/^\d{8}$/.test(date)){
    const d=new Date(date.slice(0,4)+'-'+date.slice(4,6)+'-'+date.slice(6)+'T12:00:00Z');
    if(!Number.isNaN(d.getTime())&&Date.now()-d.getTime()>=0&&Date.now()-d.getTime()<=91*86400000)
      game=(await fetchHistoricalScoreboard(league,date)).find(e=>e.id===id);
   }
  }
  if(!game)return res.status(404).json({error:'game_not_in_current_feed'});
  const picks=db.prepare('SELECT pick_team,pick_type,confidence,status,issued_at,starts_at FROM picks WHERE league=? AND event_id=? ORDER BY id DESC LIMIT 4').all(league,id);
  let research={lastFiveGames:[],leaders:[],source:'ESPN game summary',available:false};
  try {
   const conf=LEAGUES[league];
   const url='https://site.api.espn.com/apis/site/v2/sports/'+conf.sport+'/'+conf.league+'/summary?event='+encodeURIComponent(id);
   const response=await fetch(url,{signal:AbortSignal.timeout(5500)});
   if(response.ok){
    const summary=await response.json();
    const last=(summary.lastFiveGames||[]);
    const leaders=(summary.leaders||[]);
    research={lastFiveGames:Array.isArray(last)?last.slice(0,2).map(x=>({team:x.team?.displayName||'',events:(x.events||[]).slice(0,5).map(a=>({name:a.name||'',result:a.result||'',score:a.score||''}))})):[],
      leaders:Array.isArray(leaders)?leaders.slice(0,2).map(x=>({team:x.team?.displayName||'',categories:(x.leaders||[]).slice(0,3).map(y=>({name:y.displayName||y.name||'',athlete:y.leaders?.[0]?.athlete?.displayName||'',value:y.leaders?.[0]?.displayValue||''}))})):[],
      source:'ESPN game summary',available:true};
   }
  }catch{/* research is optional; never block the game card */}

  res.json({game,picks,research,fetchedAt,delayed:!!delayed,coverage:{injuries:false,verifiedFreeStreams:false},note:'Broadcast listings are provider-supplied; free streams are not guaranteed.'});
 }catch{res.status(502).json({error:'game_data_unavailable'});}
});
router.get('/verified-picks.csv',(req,res)=>{
 const rows=db.prepare("SELECT date,league,event_id,home,away,pick_team,pick_type,line,confidence,status,issued_at,starts_at,graded_at FROM picks WHERE issued_at IS NOT NULL AND starts_at IS NOT NULL AND issued_at < starts_at ORDER BY issued_at DESC LIMIT 1000").all();
 const cols=['date','league','event_id','home','away','pick_team','pick_type','line','confidence','status','issued_at','starts_at','graded_at'];
 const safe=v=>{let x=String(v??'');if(/^[=+@-]/.test(x))x="'"+x;return '"'+x.replace(/"/g,'""')+'"';};
 res.setHeader('Content-Type','text/csv; charset=utf-8');res.setHeader('Content-Disposition','attachment; filename="sports-genius-verified-picks.csv"');
 res.send([cols.join(','),...rows.map(row=>cols.map(k=>safe(row[k])).join(','))].join('\r\n'));
});

router.get('/ledger-integrity',(req,res)=>res.json({...integrity(),notice:'Local SHA-256 hash chain; independent anchoring not yet configured.'}));

// ---- scores ----
router.get('/scores', async (req, res) => {
  const league = String(req.query.league || '').toLowerCase();
  const keys = league ? [league] : LEAGUE_KEYS;
  if (league && !LEAGUES[league]) return res.status(400).json({ error: 'unknown league' });
  try {
    const out = {};
    await Promise.all(keys.map(async (lg) => {
      try { out[lg] = await getScoreboard(lg); }
      catch (e) { out[lg] = { events: [], error: String(e.message || e) }; }
    }));
    res.json({ leagues: out, fetchedAt: new Date().toISOString() });
  } catch (e) { res.status(502).json({ error: 'upstream unavailable' }); }
});

router.get('/news', async (req, res) => {
  const league = String(req.query.league || 'nfl').toLowerCase();
  if (!LEAGUES[league]) return res.status(400).json({ error: 'unknown league' });
  try { res.json({ articles: (await fetchNews(league)).slice(0, 12) }); }
  catch (e) { res.status(502).json({ error: 'upstream unavailable' }); }
});

// ---- picks ----
router.get('/picks', async (req, res) => {
  const premium = isPremium(req.user);
  try {
    const picks = await getPicks(todayET());
    const withLines = await attachLines(filterLeagues(picks, premium));
    res.json({ picks: withLines, premium,
      lockedLeagues: premium ? [] : LEAGUE_KEYS.filter(l => !FREE_LEAGUES.includes(l)),
      disclaimer: DISCLAIMER });
  } catch (e) { res.status(502).json({ error: 'could not load picks' }); }
});

router.get('/picks/best', async (req, res) => {
  if (!isPremium(req.user)) return res.status(402).json({ error: 'premium', message: 'Genius Best Bets are a Premium feature' });
  const picks = await getPicks(todayET());
  res.json({ best: await attachLines(picks.slice(0, 3)), disclaimer: DISCLAIMER });
});

// Attach live line-shopping data to picks. When no Odds API key is configured,
// picks carry { lines: { available: false } } and the UI falls back gracefully.
async function attachLines(picks) {
  if (!oddsAvailable()) return picks.map(p => ({ ...p, lines: { available: false } }));
  const affs = db.prepare('SELECT id, name, url, promo FROM affiliates WHERE enabled = 1').all();
  const byLeague = new Map();
  for (const p of picks) {
    if (!byLeague.has(p.league)) byLeague.set(p.league, []);
    byLeague.get(p.league).push(p);
  }
  await Promise.all([...byLeague.entries()].map(async ([lg, items]) => {
    let oddsData;
    try { oddsData = await getOdds(lg); } catch { oddsData = { available: true, events: [] }; }
    for (const p of items) {
      const ev = findOddsForPick(oddsData, p.home, p.away);
      if (!ev || !Object.keys(ev.books || {}).length) {
        p.lines = { available: true, books: {}, fetchedAt: oddsData.fetchedAt || null,
          splits: { available: false } };
        continue;
      }
      const pickedAbbr = String(p.pickTeam.abbr).toUpperCase();
      const homeAbbr = String(p.home).split(' ')[0].toUpperCase();
      const side = pickedAbbr === homeAbbr ? 'home' : 'away';
      const books = {};
      const spreads = {};
      const totals = {};
      for (const [k, b] of Object.entries(ev.books)) {
        const price = b.h2h && b.h2h[side];
        if (price == null) continue;
        const aff = matchAffiliate(affs, k, b.title);
        books[k] = { title: b.title, price, affiliate: aff ? { name: aff.name, url: aff.url } : null };
        if (b.spread && b.spread[side] != null && b.spread.point != null) {
          spreads[k] = { title: b.title, point: side === 'home' ? b.spread.point : -b.spread.point,
            price: b.spread[side], affiliate: books[k].affiliate };
        }
        if (b.total && b.total.point != null && b.total.over != null && b.total.under != null) {
          totals[k] = { title: b.title, point: b.total.point, over: b.total.over, under: b.total.under,
            affiliate: books[k].affiliate };
        }
      }
      const best = Object.entries(books).reduce((acc, [k, b]) =>
        (!acc || b.price > acc.price) ? { book: k, ...b } : acc, null);
      const bestSpread = Object.entries(spreads).reduce((acc, [k, b]) =>
        (!acc || b.point > acc.point + 1e-9 || (Math.abs(b.point - acc.point) < 1e-9 && b.price > acc.price))
          ? { book: k, ...b } : acc, null);
      const bestOver = Object.entries(totals).reduce((acc, [k, b]) =>
        (!acc || b.over > acc.over) ? { book: k, side: 'over', title: b.title, point: b.point, price: b.over, affiliate: b.affiliate } : acc, null);
      const bestUnder = Object.entries(totals).reduce((acc, [k, b]) =>
        (!acc || b.under > acc.under) ? { book: k, side: 'under', title: b.title, point: b.point, price: b.under, affiliate: b.affiliate } : acc, null);
      // Line movement for the picked side at each book (open -> current).
      let movement = {};
      try { movement = movementSummary(ev.gameKey, 'h2h', side); } catch { movement = {}; }
      p.lines = { available: true, fetchedAt: oddsData.fetchedAt || null, side, books, best,
        spreads, bestSpread, totals, bestOver, bestUnder, movement,
        splits: { available: splitsAvailable() } };
    }
  }));
  return picks;
}

// ---- odds (raw line-shopping feed for the parlay builder) ----
router.get('/odds', async (req, res) => {
  const league = String(req.query.league || '').toLowerCase();
  if (league && !LEAGUES[league]) return res.status(400).json({ error: 'unknown league' });
  if (!oddsAvailable()) return res.json({ available: false, leagues: {} });
  const keys = league ? [league] : LEAGUE_KEYS;
  const affs = db.prepare('SELECT id, name, url, promo FROM affiliates WHERE enabled = 1').all();
  try {
    const out = {};
    await Promise.all(keys.map(async (lg) => {
      const o = await getOdds(lg);
      out[lg] = {
        available: o.available, fetchedAt: o.fetchedAt || null, stale: !!o.stale, error: o.error || null,
        events: (o.events || []).map(e => ({
          oddsId: e.id || null, gameKey: e.gameKey || null,
          homeTeam: e.homeTeam, awayTeam: e.awayTeam, commence: e.commence,
          books: Object.fromEntries(Object.entries(e.books).map(([k, b]) => {
            const aff = matchAffiliate(affs, k, b.title);
            return [k, { ...b, affiliate: aff ? { name: aff.name, url: aff.url } : null }];
          })),
        })),
      };
    }));
    res.json({ available: true, leagues: out });
  } catch (e) { res.status(502).json({ error: 'odds unavailable' }); }
});


// Prelaunch archive: historical user-attested picks, separate from the model's independently logged track record.
router.get('/prelaunch-record', (req, res) => res.json({
  records:[{
    date:'2026-10-08', league:'mlb', matchup:'Cleveland Guardians at Chicago White Sox',
    selected:'Cleveland Guardians', pickType:'moneyline', confidence:54,
    result:'win', finalScore:'CLE 9 - CWS 5', provenance:'user-attested prelaunch prediction',
    issuedBeforeGame:'reported by owner; original timestamp not independently verified',
    source:'https://www.mlb.com/guardians/video/steven-kwan-makes-the-catch-to-secure-game-4-victory'
  }],
  notice:'Prelaunch record is user-attested and excluded from the verified live-model win rate.'
}));


router.get('/verified-picks', (req,res) => {
 const rows=db.prepare(`SELECT id,date,league,home,away,pick_team,pick_type,line,confidence,status,issued_at,starts_at,graded_at
 FROM picks WHERE issued_at IS NOT NULL AND starts_at IS NOT NULL AND issued_at < starts_at
 ORDER BY date DESC,id DESC LIMIT 40`).all();
 res.json({type:'system-timestamped-pregame-picks',picks:rows});
});

router.get('/track-record', (req, res) => {
  res.json(trackRecord());
});

// ---- line movement ----
router.get('/odds/movement', (req, res) => {
  const league = String(req.query.league || '').toLowerCase();
  if (league && !LEAGUES[league]) return res.status(400).json({ error: 'unknown league' });
  if (!oddsAvailable()) return res.json({ available: false, movements: [] });
  try {
    res.json({ available: true, movements: getMovements(league || undefined), fetchedAt: new Date().toISOString() });
  } catch (e) { res.status(502).json({ error: 'movement unavailable' }); }
});

router.get('/odds/history', (req, res) => {
  const { game, book, market, side } = req.query || {};
  if (!game) return res.status(400).json({ error: 'game required' });
  if (!oddsAvailable()) return res.json({ available: false, points: [] });
  try {
    res.json({ available: true, points: getLineHistory(String(game), {
      book: book ? String(book) : undefined,
      market: market ? String(market) : undefined,
      side: side ? String(side) : undefined,
    }) });
  } catch (e) { res.status(502).json({ error: 'history unavailable' }); }
});

// ---- player props (line shopping; coverage varies by book/sport) ----
router.get('/odds/props', async (req, res) => {
  const league = String(req.query.league || '').toLowerCase();
  const event = String(req.query.event || '');
  if (!LEAGUES[league]) return res.status(400).json({ error: 'unknown league' });
  if (!event) return res.status(400).json({ error: 'event required' });
  if (!oddsAvailable()) return res.json({ available: false, props: [] });
  try {
    const out = await getEventProps(league, event);
    const affs = db.prepare('SELECT id, name, url, promo FROM affiliates WHERE enabled = 1').all();
    for (const p of out.props || []) {
      for (const [k, b] of Object.entries(p.books || {})) {
        const aff = matchAffiliate(affs, k, b.title);
        b.affiliate = aff ? { name: aff.name, url: aff.url } : null;
      }
      if (p.best) {
        const aff = matchAffiliate(affs, p.best.book, p.best.title);
        p.best.affiliate = aff ? { name: aff.name, url: aff.url } : null;
      }
    }
    res.json({ ...out, disclaimer: DISCLAIMER });
  } catch (e) { res.status(502).json({ error: 'props unavailable' }); }
});

// ---- public betting splits (honest: no feed exists yet) ----
router.get('/splits', async (req, res) => {
  const league = String(req.query.league || '').toLowerCase();
  if (league && !LEAGUES[league]) return res.status(400).json({ error: 'unknown league' });
  const out = await getSplits(league || undefined);
  res.json({ ...out, disclaimer: DISCLAIMER });
});

// ---- alert center ----
function teamMatchesFavorite(fav, homeTeam, awayTeam) {
  const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const abbr = String(fav.abbr || '').toUpperCase();
  const nm = norm(fav.name);
  const ht = String(homeTeam || '').toUpperCase(), at = String(awayTeam || '').toUpperCase();
  const hn = norm(homeTeam), an = norm(awayTeam);
  if (abbr && (ht.includes(abbr) || at.includes(abbr))) return true;
  return !!(nm && (hn.includes(nm) || an.includes(nm) || nm.includes(hn) || nm.includes(an)));
}

router.get('/alerts', (req, res) => {
  const mine = req.query.mine === '1';
  if (mine && !req.user) return res.status(401).json({ error: 'sign in required' });
  if (!oddsAvailable()) return res.json({ available: false, alerts: [] });
  try {
    let movements = getMovements();
    if (mine) {
      const favs = db.prepare('SELECT * FROM favorites WHERE user_id = ?').all(req.user.id);
      movements = movements.filter(m => favs.some(f => teamMatchesFavorite(f, m.homeTeam, m.awayTeam)));
    }
    const alerts = movements.map(m => ({
      gameKey: m.gameKey, league: m.league,
      homeTeam: m.homeTeam, awayTeam: m.awayTeam, commence: m.commence,
      steam: m.steam, moves: m.moves,
    }));
    res.json({ available: true, alerts, mine, fetchedAt: new Date().toISOString(), disclaimer: DISCLAIMER });
  } catch (e) { res.status(502).json({ error: 'alerts unavailable' }); }
});

// ---- chat ----
router.post('/chat', async (req, res) => {
  const { message } = req.body || {};
  if (!message || !String(message).trim()) return res.status(400).json({ error: 'message required' });
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
  const out = await handleChat(String(message), req.user, ip);
  if (out.error === 'limit') return res.status(429).json(out);
  res.json(out);
});

router.get('/chat/quota', (req, res) => {
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
  const premium = isPremium(req.user);
  const who = req.user ? `u:${req.user.id}` : `ip:${ip}`;
  const day = todayET();
  const row = db.prepare('SELECT count FROM chat_usage WHERE day = ? AND who = ?').get(day, who);
  res.json({ used: row ? row.count : 0, limit: premium ? null : FREE_CHATS_PER_DAY, premium });
});

// ---- teams / favorites / my teams ----
router.get('/teams', async (req, res) => {
  const q = String(req.query.q || '').toLowerCase();
  const all = [];
  await Promise.all(LEAGUE_KEYS.map(async (lg) => {
    try { const { teams } = await getTeams(lg); for (const t of teams) all.push({ ...t, league: lg, label: LEAGUES[lg].label }); }
    catch { /* skip */ }
  }));
  const filtered = q ? all.filter(t => t.name.toLowerCase().includes(q) || t.abbr.toLowerCase() === q) : all;
  res.json({ teams: filtered.slice(0, 60) });
});

function requireUser(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'sign in required' });
  next();
}

router.get('/favorites', requireUser, (req, res) => {
  res.json({ favorites: db.prepare('SELECT * FROM favorites WHERE user_id = ?').all(req.user.id) });
});

router.post('/favorites', requireUser, (req, res) => {
  const { team_key, league, abbr, name } = req.body || {};
  if (!team_key || !league || !abbr || !name) return res.status(400).json({ error: 'team_key, league, abbr, name required' });
  if (!LEAGUES[league]) return res.status(400).json({ error: 'unknown league' });
  db.prepare(`INSERT OR IGNORE INTO favorites (user_id, team_key, league, abbr, name)
    VALUES (?, ?, ?, ?, ?)`).run(req.user.id, team_key, league, abbr, name);
  res.json({ ok: true });
});

router.delete('/favorites', requireUser, (req, res) => {
  const { team_key } = req.body || {};
  db.prepare('DELETE FROM favorites WHERE user_id = ? AND team_key = ?').run(req.user.id, team_key);
  res.json({ ok: true });
});

// Personalized: their teams' games + picks
router.get('/my', requireUser, async (req, res) => {
  const premium = isPremium(req.user);
  const favs = db.prepare('SELECT * FROM favorites WHERE user_id = ?').all(req.user.id);
  const today = todayET();
  const games = [], picks = [];
  const allPicks = await getPicks(today).catch(() => []);
  await Promise.all(favs.map(async (f) => {
    try {
      const { events } = await getScoreboard(f.league);
      for (const e of events) {
        if (e.home.abbr !== f.abbr && e.away.abbr !== f.abbr) continue;
        if (todayET(new Date(e.date)) !== today && e.status.state !== 'in') continue;
        games.push({ team: f, event: e });
        const pick = allPicks.find(p => String(p.event_id) === String(e.id));
        if (pick && (premium || FREE_LEAGUES.includes(pick.league))) picks.push({ team: f, pick });
      }
    } catch { /* skip league */ }
  }));
  res.json({ games, picks, favorites: favs, premium });
});

// ---- billing / premium ----
router.get('/billing', (req, res) => {
  const live = stripeConfigured();
  res.json({
    premiumLink: '',
    checkoutEnabled: live,
    portalUrl: '',
    live,
    testMode: !live,
    price: '$8/month',
    trial: '7-day free trial',
    premium: isPremium(req.user),
  });
});

// ---- affiliates (sportsbook partner links) ----
// Public: only enabled, ordered by priority. All links labeled "Partner link" in UI.
router.get('/affiliates', (req, res) => {
  const rows = db.prepare('SELECT id, name, url, promo, priority FROM affiliates WHERE enabled = 1 ORDER BY priority ASC, id ASC').all();
  res.json({ affiliates: rows });
});

// Track an outbound click. pick_id optional; user_id filled when signed in.
router.post('/affiliates/click', (req, res) => {
  const { sportsbook, pick_id } = req.body || {};
  if (!sportsbook || typeof sportsbook !== 'string') return res.status(400).json({ error: 'sportsbook required' });
  db.prepare('INSERT INTO affiliate_clicks (sportsbook, pick_id, user_id) VALUES (?, ?, ?)')
    .run(sportsbook.slice(0, 120), pick_id != null ? Number(pick_id) : null, req.user ? req.user.id : null);
  res.json({ ok: true });
});

function requireAdmin(req, res, next) {
  if (!req.user || !isAdmin(req.user.email)) return res.status(403).json({ error: 'admin only' });
  next();
}

// Admin CRUD for affiliate links (ADMIN_EMAILS).
router.get('/admin/affiliates', requireAdmin, (req, res) => {
  res.json({ affiliates: db.prepare('SELECT * FROM affiliates ORDER BY priority ASC, id ASC').all() });
});

router.post('/admin/affiliates', requireAdmin, (req, res) => {
  const { name, url, promo, priority, enabled } = req.body || {};
  if (!name || !url) return res.status(400).json({ error: 'name and url required' });
  if (!/^https?:\/\//i.test(url)) return res.status(400).json({ error: 'url must start with http(s)://' });
  const r = db.prepare('INSERT INTO affiliates (name, url, promo, priority, enabled) VALUES (?, ?, ?, ?, ?)')
    .run(String(name).slice(0, 80), String(url).slice(0, 500), String(promo || '').slice(0, 200),
      Number(priority) || 0, enabled === false || enabled === 0 ? 0 : 1);
  res.json({ ok: true, id: r.lastInsertRowid });
});

router.put('/admin/affiliates/:id', requireAdmin, (req, res) => {
  const cur = db.prepare('SELECT * FROM affiliates WHERE id = ?').get(req.params.id);
  if (!cur) return res.status(404).json({ error: 'not found' });
  const { name, url, promo, priority, enabled } = req.body || {};
  if (url && !/^https?:\/\//i.test(url)) return res.status(400).json({ error: 'url must start with http(s)://' });
  db.prepare('UPDATE affiliates SET name = ?, url = ?, promo = ?, priority = ?, enabled = ? WHERE id = ?')
    .run(name != null ? String(name).slice(0, 80) : cur.name,
      url != null ? String(url).slice(0, 500) : cur.url,
      promo != null ? String(promo).slice(0, 200) : cur.promo,
      priority != null ? Number(priority) || 0 : cur.priority,
      enabled === undefined ? cur.enabled : (enabled === false || enabled === 0 ? 0 : 1),
      req.params.id);
  res.json({ ok: true });
});

router.delete('/admin/affiliates/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM affiliates WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Admin click reporting.
router.get('/admin/affiliate-clicks', requireAdmin, (req, res) => {
  const counts = db.prepare(`SELECT sportsbook, COUNT(*) AS clicks,
      COUNT(DISTINCT user_id) AS users, MAX(ts) AS last_click
    FROM affiliate_clicks GROUP BY sportsbook ORDER BY clicks DESC`).all();
  const recent = db.prepare('SELECT * FROM affiliate_clicks ORDER BY id DESC LIMIT 50').all();
  res.json({ counts, recent });
});

// ---- bet tracker ----
const BET_TYPES = ['moneyline', 'spread', 'total', 'parlay'];
const BET_RESULTS = ['pending', 'win', 'loss', 'push'];

export function betSummary(bets) {
  let wins = 0, losses = 0, pushes = 0, staked = 0, net = 0;
  for (const b of bets) {
    const stake = Number(b.stake) || 0;
    if (b.result !== 'pending') staked += stake;
    if (b.result === 'win') { wins++; net += profitFor(stake, b.odds); }
    else if (b.result === 'loss') { losses++; net -= stake; }
    else if (b.result === 'push') { pushes++; }
  }
  const roi = staked > 0 ? +(net / staked * 100).toFixed(1) : 0;
  return {
    bets: bets.length, graded: wins + losses + pushes,
    wins, losses, pushes,
    staked: +staked.toFixed(2), net: +net.toFixed(2), roi,
    units: +(net / 100).toFixed(2), // 1 unit = $100
  };
}

router.get('/bets', requireUser, (req, res) => {
  const bets = db.prepare('SELECT * FROM bets WHERE user_id = ? ORDER BY date DESC, id DESC').all(req.user.id);
  res.json({ bets, summary: betSummary(bets) });
});

router.post('/bets', requireUser, (req, res) => {
  const { date, league, matchup, bet_type, selection, book, stake, odds } = req.body || {};
  if (!matchup || !selection) return res.status(400).json({ error: 'matchup and selection required' });
  if (bet_type && !BET_TYPES.includes(bet_type)) return res.status(400).json({ error: 'bad bet_type' });
  const st = Number(stake), o = parseInt(odds, 10);
  if (!(st > 0) || !Number.isFinite(o) || o === 0 || Math.abs(o) < 100)
    return res.status(400).json({ error: 'stake must be > 0 and odds a valid American price (|odds| >= 100)' });
  const r = db.prepare(`INSERT INTO bets (user_id, date, league, matchup, bet_type, selection, book, stake, odds)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(req.user.id, String(date || todayET()).slice(0, 10), String(league || '').slice(0, 12),
      String(matchup).slice(0, 120), bet_type || 'moneyline', String(selection).slice(0, 120),
      String(book || '').slice(0, 60), st, o);
  res.json({ ok: true, id: r.lastInsertRowid });
});

router.put('/bets/:id', requireUser, (req, res) => {
  const cur = db.prepare('SELECT * FROM bets WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!cur) return res.status(404).json({ error: 'not found' });
  const { result } = req.body || {};
  if (!BET_RESULTS.includes(result)) return res.status(400).json({ error: 'bad result' });
  db.prepare("UPDATE bets SET result = ?, graded_at = CASE WHEN ? != 'pending' THEN datetime('now') ELSE NULL END WHERE id = ?")
    .run(result, result, req.params.id);
  res.json({ ok: true });
});

router.delete('/bets/:id', requireUser, (req, res) => {
  db.prepare('DELETE FROM bets WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ ok: true });
});

// ---- promo offers wall ----
function offerRow(r) {
  return {
    id: r.id, book_name: r.book_name, title: r.title, terms: r.terms,
    promo_code: r.promo_code, url: r.aff_url || r.url,
    via_affiliate: !!r.aff_url,
  };
}

router.get('/offers', (req, res) => {
  const rows = db.prepare(`
    SELECT o.*, a.url AS aff_url FROM offers o
    LEFT JOIN affiliates a ON a.id = o.affiliate_id AND a.enabled = 1
    WHERE o.enabled = 1 ORDER BY o.priority ASC, o.id ASC`).all();
  res.json({ offers: rows.map(offerRow) });
});

router.get('/admin/offers', requireAdmin, (req, res) => {
  res.json({ offers: db.prepare('SELECT * FROM offers ORDER BY priority ASC, id ASC').all() });
});

router.post('/admin/offers', requireAdmin, (req, res) => {
  const { book_name, title, terms, promo_code, url, affiliate_id, priority, enabled } = req.body || {};
  if (!book_name || !title) return res.status(400).json({ error: 'book_name and title required' });
  if (url && !/^https?:\/\//i.test(url)) return res.status(400).json({ error: 'url must start with http(s)://' });
  let affId = null;
  if (affiliate_id != null && affiliate_id !== '') {
    const a = db.prepare('SELECT id FROM affiliates WHERE id = ?').get(affiliate_id);
    if (!a) return res.status(400).json({ error: 'affiliate not found' });
    affId = a.id;
  }
  const r = db.prepare(`INSERT INTO offers (book_name, title, terms, promo_code, url, affiliate_id, priority, enabled)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(String(book_name).slice(0, 80), String(title).slice(0, 160), String(terms || '').slice(0, 500),
      String(promo_code || '').slice(0, 60), String(url || '').slice(0, 500), affId,
      Number(priority) || 0, enabled === false || enabled === 0 ? 0 : 1);
  res.json({ ok: true, id: r.lastInsertRowid });
});

router.put('/admin/offers/:id', requireAdmin, (req, res) => {
  const cur = db.prepare('SELECT * FROM offers WHERE id = ?').get(req.params.id);
  if (!cur) return res.status(404).json({ error: 'not found' });
  const { book_name, title, terms, promo_code, url, affiliate_id, priority, enabled } = req.body || {};
  if (url && !/^https?:\/\//i.test(url)) return res.status(400).json({ error: 'url must start with http(s)://' });
  let affId = cur.affiliate_id;
  if (affiliate_id !== undefined) {
    if (affiliate_id === '' || affiliate_id == null) affId = null;
    else {
      const a = db.prepare('SELECT id FROM affiliates WHERE id = ?').get(affiliate_id);
      if (!a) return res.status(400).json({ error: 'affiliate not found' });
      affId = a.id;
    }
  }
  db.prepare(`UPDATE offers SET book_name = ?, title = ?, terms = ?, promo_code = ?, url = ?,
    affiliate_id = ?, priority = ?, enabled = ? WHERE id = ?`)
    .run(book_name != null ? String(book_name).slice(0, 80) : cur.book_name,
      title != null ? String(title).slice(0, 160) : cur.title,
      terms != null ? String(terms).slice(0, 500) : cur.terms,
      promo_code != null ? String(promo_code).slice(0, 60) : cur.promo_code,
      url != null ? String(url).slice(0, 500) : cur.url,
      affId, priority != null ? Number(priority) || 0 : cur.priority,
      enabled === undefined ? cur.enabled : (enabled === false || enabled === 0 ? 0 : 1),
      req.params.id);
  res.json({ ok: true });
});

router.delete('/admin/offers/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM offers WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Admin grant (ADMIN_EMAILS) — used after a Stripe payment completes.
router.post('/admin/grant', (req, res) => {
  if (!req.user || !isAdmin(req.user.email)) return res.status(403).json({ error: 'admin only' });
  const { email, days } = req.body || {};
  if (!email) return res.status(400).json({ error: 'email required' });
  const u = db.prepare('SELECT id FROM users WHERE email = ?').get(String(email).toLowerCase());
  if (!u) return res.status(404).json({ error: 'user not found' });
  const d = parseInt(days, 10) || 30;
  db.prepare("UPDATE users SET premium_until = datetime('now', ?) WHERE id = ?").run(`+${d} days`, u.id);
  res.json({ ok: true });
});
