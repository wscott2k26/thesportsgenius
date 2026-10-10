// The Odds API provider (the-odds-api.com): live multi-book moneyline/spread/total
// lines for line shopping. Env-gated: ODDS_API_KEY. Server-side cached
// (ODDS_REFRESH_HOURS, default 12) to respect the free tier's 500 credits/mo —
// one refresh costs ~15 credits (5 leagues x 3 markets x 1 region).
// No key -> { available: false }; upstream failure -> serve stale, else error.
//
// Every fresh fetch is snapshotted into odds_history (see providers/movement.js)
// so open-vs-current line movement is computed from real data only.

import { gameKey, snapshotOdds } from './movement.js';

const SPORT_KEYS = {
  nfl: 'americanfootball_nfl',
  nba: 'basketball_nba',
  mlb: 'baseball_mlb',
  nhl: 'icehockey_nhl',
  ncaaf: 'americanfootball_ncaaf',
};

export function oddsAvailable() {
  return !!process.env.ODDS_API_KEY;
}

function refreshMs() {
  const h = Number(process.env.ODDS_REFRESH_HOURS);
  return (Number.isFinite(h) && h > 0 ? h : 12) * 3600_000;
}

// ---------- odds math (American <-> decimal, parlay, payout) ----------
export function americanToDecimal(odds) {
  const o = Number(odds);
  if (!Number.isFinite(o) || o === 0) throw new Error('bad_odds');
  return o > 0 ? 1 + o / 100 : 1 + 100 / Math.abs(o);
}

export function decimalToAmerican(d) {
  const x = Number(d);
  if (!Number.isFinite(x) || x <= 1) throw new Error('bad_decimal');
  return x >= 2 ? Math.round((x - 1) * 100) : Math.round(-100 / (x - 1));
}

export function formatAmerican(price) {
  const p = Number(price);
  return p > 0 ? `+${p}` : `${p}`;
}

// Profit on a WINNING bet at American odds (stake returned separately).
export function profitFor(stake, americanOdds) {
  const s = Number(stake), o = Number(americanOdds);
  if (!(s > 0) || !Number.isFinite(o) || o === 0) throw new Error('bad_bet');
  return o > 0 ? s * o / 100 : s * 100 / Math.abs(o);
}

// Combined decimal odds for parlay legs (each leg an American price).
export function parlayDecimal(legPrices) {
  return legPrices.map(americanToDecimal).reduce((a, b) => a * b, 1);
}

export function parlayAmerican(legPrices) {
  return decimalToAmerican(parlayDecimal(legPrices));
}

// ---------- normalization ----------
export function normalizeOddsEvent(ev) {
  const books = {};
  for (const b of ev.bookmakers || []) {
    const entry = { title: b.title || b.key };
    for (const m of b.markets || []) {
      if (m.key === 'h2h') {
        const home = (m.outcomes || []).find(o => o.name === ev.home_team);
        const away = (m.outcomes || []).find(o => o.name === ev.away_team);
        if (home && away) entry.h2h = { home: home.price, away: away.price };
      } else if (m.key === 'spreads') {
        const home = (m.outcomes || []).find(o => o.name === ev.home_team);
        const away = (m.outcomes || []).find(o => o.name === ev.away_team);
        if (home && away && home.point != null) {
          entry.spread = { home: home.price, away: away.price, point: home.point };
        }
      } else if (m.key === 'totals') {
        const over = (m.outcomes || []).find(o => o.name === 'Over');
        const under = (m.outcomes || []).find(o => o.name === 'Under');
        if (over && under && over.point != null) {
          entry.total = { over: over.price, under: under.price, point: over.point };
        }
      }
    }
    if (entry.h2h || entry.spread || entry.total) books[b.key] = entry;
  }
  return {
    id: ev.id || null,
    gameKey: gameKey(ev.home_team, ev.away_team, ev.commence_time),
    homeTeam: ev.home_team || '',
    awayTeam: ev.away_team || '',
    commence: ev.commence_time || '',
    books,
  };
}

function normName(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Match one of our picks (home/away like "KC Kansas City Chiefs") to an odds
// event (full team names). Tolerant both directions.
export function findOddsForPick(oddsData, homeStr, awayStr) {
  const hn = normName(homeStr), an = normName(awayStr);
  return (oddsData.events || []).find(e => {
    const eh = normName(e.homeTeam), ea = normName(e.awayTeam);
    const hOk = eh && hn && (hn.includes(eh) || eh.includes(hn));
    const aOk = ea && an && (an.includes(ea) || ea.includes(an));
    return hOk && aOk;
  }) || null;
}

// Best moneyline price for a side ('home'|'away') across books.
// Higher American price = better payout, so max wins.
export function bestMoneyline(books, side) {
  let best = null;
  for (const [key, b] of Object.entries(books || {})) {
    const price = b.h2h && b.h2h[side];
    if (price == null) continue;
    if (!best || price > best.price) best = { book: key, title: b.title, price };
  }
  return best;
}

// Best spread for a side: the point most favorable to that side — i.e. maximize
// the side-relative point (a favorite wants -3 over -3.5; an underdog wants
// +3.5 over +3). Tie-break on the better price.
// The Odds API spread point is from the home perspective; away point = -point.
export function bestSpread(books, side) {
  let best = null;
  for (const [key, b] of Object.entries(books || {})) {
    const s = b.spread;
    if (!s || s.point == null || s[side] == null) continue;
    const point = side === 'home' ? s.point : -s.point;
    const price = s[side];
    if (!best || point > best.point + 1e-9 ||
        (Math.abs(point - best.point) < 1e-9 && price > best.price)) {
      best = { book: key, title: b.title, point, price };
    }
  }
  return best;
}

export function formatSpread(point) {
  const p = Number(point);
  return p > 0 ? `+${p}` : `${p}`;
}

// Match an Odds API book (key/title) to an admin-configured affiliate row.
export function matchAffiliate(affiliates, bookKey, bookTitle) {
  const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const k = norm(bookKey), t = norm(bookTitle);
  return (affiliates || []).find(a => {
    const n = norm(a.name);
    return n && n.length >= 4 && (n === k || n === t || k.includes(n) || t.includes(n));
  }) || null;
}

// ---------- fetch + cache ----------
const cache = new Map(); // leagueKey -> { at, data }

export async function getOdds(leagueKey, { fetchFn = fetch } = {}) {
  if (!oddsAvailable()) return { available: false, events: [] };
  const sport = SPORT_KEYS[leagueKey];
  if (!sport) return { available: true, events: [], error: 'unknown_league' };
  const now = Date.now();
  const c = cache.get(leagueKey);
  if (c && now - c.at < refreshMs()) return { available: true, cached: true, ...c.data };
  const url = `https://api.the-odds-api.com/v4/sports/${sport}/odds/?apiKey=${process.env.ODDS_API_KEY}&regions=us&markets=h2h,spreads,totals&oddsFormat=american`;
  try {
    const res = await fetchFn(url);
    if (!res.ok) throw new Error(`odds_http_${res.status}`);
    const json = await res.json();
    const data = { events: (Array.isArray(json) ? json : []).map(normalizeOddsEvent), fetchedAt: new Date().toISOString() };
    cache.set(leagueKey, { at: now, data });
    try { snapshotOdds(leagueKey, data.events); } catch { /* movement is best-effort */ }
    return { available: true, cached: false, ...data };
  } catch (err) {
    if (c) return { available: true, cached: true, stale: true, ...c.data };
    return { available: true, events: [], error: String((err && err.message) || err) };
  }
}

export function clearOddsCache() { cache.clear(); }

// ---------- player props ----------
// Per-event prop markets via the /events/{eventId}/odds endpoint. Coverage of
// non-featured markets is limited to selected books/sports per The Odds API,
// so anything missing simply yields no props — never fabricated. Each call
// costs (markets x regions) credits, so results are cached 6h and the route
// only fetches on demand. No key -> { available: false }.
const PROP_MARKETS = {
  nfl: ['player_pass_yds', 'player_rush_yds', 'player_receptions', 'player_reception_yds'],
  nba: ['player_points', 'player_rebounds', 'player_assists', 'player_threes'],
  mlb: ['batter_hits', 'batter_home_runs', 'pitcher_strikeouts'],
  nhl: ['player_points', 'player_goals', 'player_assists'],
  ncaaf: ['player_pass_yds', 'player_rush_yds'],
};

const propsCache = new Map(); // `${league}:${eventId}` -> { at, data }

function propLabel(marketKey) {
  return String(marketKey).replace(/^(player_|batter_|pitcher_)/, '')
    .replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// Generic normalization: any player_/batter_/pitcher_ market is grouped by
// (market, outcome name, point) with per-book prices. Best price wins.
export function normalizeProps(ev) {
  const out = [];
  for (const b of ev.bookmakers || []) {
    for (const m of b.markets || []) {
      const mk = m.key || '';
      if (!/^(player_|batter_|pitcher_)/.test(mk)) continue;
      for (const o of m.outcomes || []) {
        if (o.price == null) continue;
        const point = o.point ?? null;
        let sel = out.find(s => s.market === mk && s.name === o.name && String(s.point) === String(point));
        if (!sel) {
          sel = {
            market: mk, label: propLabel(mk), name: o.name,
            description: o.description || '', point, books: {},
          };
          out.push(sel);
        }
        sel.books[b.key] = { title: b.title || b.key, price: o.price };
      }
    }
  }
  for (const s of out) {
    s.best = Object.entries(s.books).reduce((acc, [k, v]) =>
      (!acc || v.price > acc.price) ? { book: k, ...v } : acc, null);
  }
  return out;
}

export async function getEventProps(leagueKey, eventId, { fetchFn = fetch } = {}) {
  if (!oddsAvailable()) return { available: false, props: [] };
  const sport = SPORT_KEYS[leagueKey];
  const markets = PROP_MARKETS[leagueKey];
  if (!sport || !markets || !eventId) return { available: true, props: [], error: 'unsupported' };
  const key = `${leagueKey}:${eventId}`;
  const now = Date.now();
  const c = propsCache.get(key);
  if (c && now - c.at < 6 * 3600_000) return { available: true, cached: true, ...c.data };
  const url = `https://api.the-odds-api.com/v4/sports/${sport}/events/${encodeURIComponent(eventId)}/odds/` +
    `?apiKey=${process.env.ODDS_API_KEY}&regions=us&markets=${markets.join(',')}&oddsFormat=american`;
  try {
    const res = await fetchFn(url);
    if (!res.ok) throw new Error(`props_http_${res.status}`);
    const json = await res.json();
    const data = {
      eventId,
      homeTeam: json.home_team || '', awayTeam: json.away_team || '',
      commence: json.commence_time || '',
      props: normalizeProps(json),
      fetchedAt: new Date().toISOString(),
    };
    propsCache.set(key, { at: now, data });
    return { available: true, cached: false, ...data };
  } catch (err) {
    if (c) return { available: true, cached: true, stale: true, ...c.data };
    return { available: true, props: [], error: String((err && err.message) || err) };
  }
}

export function clearPropsCache() { propsCache.clear(); }
export { PROP_MARKETS };
