/* Parlay builder: 2-6 legs from live lines, one leg per game, combined odds
   computed honestly from each leg's line. Best-odds book highlighted. */
import { api, esc, toast, trackAffiliate } from './app.js';

const state = {
  legs: [],        // available legs
  picked: [],      // picked leg ids (one per game enforced)
  risk: 'conservative',
  picksByGame: new Map(), // "league:home:away" -> genius pick (for auto-build)
  propEvents: [],  // {league, oddsId, homeTeam, awayTeam, label} for the props explorer
  propsCtx: null,  // {league, oddsId} currently shown in the props pool
};

const toDec = (o) => (o > 0 ? 1 + o / 100 : 1 + 100 / Math.abs(o));
const toAm = (d) => (d >= 2 ? Math.round((d - 1) * 100) : Math.round(-100 / (d - 1)));
const fmtAm = (p) => (p > 0 ? `+${p}` : `${p}`);
const gameKey = (l) => `${l.league}|${l.homeTeam}|${l.awayTeam}`;

function buildLegs(oddsData) {
  const legs = [];
  for (const [league, lg] of Object.entries(oddsData.leagues || {})) {
    for (const e of lg.events || []) {
      const books = e.books || {};
      const bookKeys = Object.keys(books);
      if (!bookKeys.length) continue;
      const label = `${e.awayTeam} @ ${e.homeTeam}`;
      const push = (market, side, sideLabel, getPrice, getPoint) => {
        const prices = {};
        for (const k of bookKeys) {
          const b = books[k];
          const price = getPrice(b);
          if (price == null) continue;
          prices[k] = { title: b.title, price, point: getPoint ? getPoint(b) : null, affiliate: b.affiliate || null };
        }
        if (!Object.keys(prices).length) return;
        const best = Object.values(prices).reduce((a, b) => (b.price > a.price ? b : a));
        legs.push({
          id: `${league}:${e.homeTeam}:${e.awayTeam}:${market}:${side}`,
          league, homeTeam: e.homeTeam, awayTeam: e.awayTeam, label,
          market, side, sideLabel, prices, bestPrice: best.price,
        });
      };
      push('moneyline', 'home', `${e.homeTeam} ML`, b => b.h2h && b.h2h.home);
      push('moneyline', 'away', `${e.awayTeam} ML`, b => b.h2h && b.h2h.away);
      push('spread', 'home', null, b => b.spread && b.spread.home, b => b.spread && b.spread.point);
      push('spread', 'away', null, b => b.spread && b.spread.away, b => -(b.spread && b.spread.point));
      push('total', 'over', null, b => b.total && b.total.over, b => b.total && b.total.point);
      push('total', 'under', null, b => b.total && b.total.under, b => b.total && b.total.point);
      // human labels for spread/total
      for (const l of legs) {
        if (!l.sideLabel) {
          if (l.market === 'spread') {
            const pt = l.prices[Object.keys(l.prices)[0]].point;
            l.sideLabel = `${l.side === 'home' ? l.homeTeam : l.awayTeam} ${pt > 0 ? '+' + pt : pt}`;
          } else {
            const pt = l.prices[Object.keys(l.prices)[0]].point;
            l.sideLabel = `${l.side === 'over' ? 'Over' : 'Under'} ${pt}`;
          }
        }
      }
    }
  }
  return legs;
}

function renderPool() {
  const pool = document.getElementById('leg-pool');
  const legs = state.legs.filter(l => !l.prop);
  if (!legs.length) {
    pool.innerHTML = '<div class="card"><p class="reason">No priced legs today — check back when games are lined.</p></div>';
    return;
  }
  pool.innerHTML = legs.map(l => {
    const on = state.picked.includes(l.id);
    const gk = gameKey(l);
    const clash = !on && state.picked.some(id => gameKey(state.legs.find(x => x.id === id)) === gk);
    return `<button class="leg-opt${on ? ' picked' : ''}" data-leg="${esc(l.id)}" ${clash ? 'disabled style="opacity:0.35;cursor:not-allowed"' : ''}>
      <span><span class="mk">${esc(l.league.toUpperCase())} • ${esc(l.market.toUpperCase())}</span><br>${esc(l.sideLabel)}<br>
      <span style="font-size:12px;color:var(--muted)">${esc(l.label)}</span></span>
      <span class="odds">${fmtAm(l.bestPrice)}</span>
    </button>`;
  }).join('');
  pool.querySelectorAll('.leg-opt').forEach(b => b.onclick = () => toggleLeg(b.dataset.leg));
}

function toggleLeg(id) {
  const i = state.picked.indexOf(id);
  if (i >= 0) state.picked.splice(i, 1);
  else {
    if (state.picked.length >= 6) { toast('Max 6 legs per parlay'); return; }
    const gk = gameKey(state.legs.find(l => l.id === id));
    if (state.picked.some(pid => gameKey(state.legs.find(l => l.id === pid)) === gk)) {
      toast('One leg per game keeps the math honest'); return;
    }
    state.picked.push(id);
  }
  renderPool();
  renderPropsPool();
  renderSlip();
}

// ---------- player props explorer ----------
function buildPropEvents(oddsData) {
  const evs = [];
  for (const [league, lg] of Object.entries(oddsData.leagues || {})) {
    for (const e of lg.events || []) {
      if (!e.oddsId) continue;
      evs.push({ league, oddsId: e.oddsId, homeTeam: e.homeTeam, awayTeam: e.awayTeam,
        label: `${league.toUpperCase()}: ${e.awayTeam} @ ${e.homeTeam}` });
    }
  }
  state.propEvents = evs;
  const sel = document.getElementById('props-game');
  sel.innerHTML = evs.length
    ? evs.map(v => `<option value="${esc(v.league)}|${esc(v.oddsId)}">${esc(v.label)}</option>`).join('')
    : '<option value="">No lined games right now</option>';
}

function materializePropLegs(league, ev, props) {
  const ctxKey = `${league}|${ev.oddsId || ev.eventId}`;
  state.legs = state.legs.filter(l => !(l.prop && l.propGame === ctxKey));
  state.picked = state.picked.filter(id => state.legs.some(l => l.id === id));
  for (const s of props || []) {
    const prices = {};
    for (const [k, b] of Object.entries(s.books || {})) {
      prices[k] = { title: b.title, price: b.price, point: s.point, affiliate: b.affiliate || null };
    }
    if (!Object.keys(prices).length || !s.best) continue;
    const who = s.description ? `${s.description} ` : '';
    const ou = s.point != null ? `${s.name} ${s.point}` : s.name;
    state.legs.push({
      id: `${league}|${ctxKey}|prop|${s.market}|${s.name}|${s.point ?? ''}`,
      league, homeTeam: ev.homeTeam, awayTeam: ev.awayTeam,
      label: `${ev.awayTeam} @ ${ev.homeTeam}`,
      market: 'prop', side: s.name,
      sideLabel: `${who}${ou} — ${s.label}`.replace(/\s+/g, ' ').trim(),
      prices, bestPrice: s.best.price, prop: true, propGame: ctxKey,
    });
  }
}

function renderPropsPool() {
  const pool = document.getElementById('props-pool');
  if (!pool) return;
  const ctx = state.propsCtx;
  if (!ctx) return; // nothing loaded yet; leave placeholder empty
  const legs = state.legs.filter(l => l.prop && l.propGame === `${ctx.league}|${ctx.oddsId}`);
  if (!legs.length) {
    pool.innerHTML = '<div class="card"><p class="reason">No player props listed for this game right now — coverage varies by sportsbook.</p></div>';
    return;
  }
  pool.innerHTML = legs.map(l => {
    const on = state.picked.includes(l.id);
    const gk = gameKey(l);
    const clash = !on && state.picked.some(pid => {
      const x = state.legs.find(y => y.id === pid);
      return x && gameKey(x) === gk;
    });
    return `<button class="leg-opt${on ? ' picked' : ''}" data-leg="${esc(l.id)}" ${clash ? 'disabled style="opacity:0.35;cursor:not-allowed"' : ''}>
      <span><span class="mk">PROP</span><br>${esc(l.sideLabel)}<br>
      <span style="font-size:12px;color:var(--muted)">${esc(l.label)}</span></span>
      <span class="odds">${fmtAm(l.bestPrice)}</span>
    </button>`;
  }).join('');
  pool.querySelectorAll('[data-leg]').forEach(b => b.onclick = () => toggleLeg(b.dataset.leg));
}

async function loadProps() {
  const sel = document.getElementById('props-game');
  const pool = document.getElementById('props-pool');
  if (!sel.value) { toast('No game selected'); return; }
  const [league, oddsId] = sel.value.split('|');
  const ev = state.propEvents.find(v => v.league === league && v.oddsId === oddsId) || {};
  pool.innerHTML = '<div class="card"><p class="reason">Loading props…</p></div>';
  try {
    const { res, data } = await api(`/api/odds/props?league=${encodeURIComponent(league)}&event=${encodeURIComponent(oddsId)}`);
    if (!res.ok) throw new Error(data.error || 'failed');
    if (!data.available) {
      pool.innerHTML = '<div class="card"><p class="reason">Props need the odds feed — the site admin must configure an Odds API key first.</p></div>';
      return;
    }
    state.propsCtx = { league, oddsId };
    materializePropLegs(league, { ...ev, eventId: data.eventId }, data.props || []);
    renderPropsPool();
    if (!(data.props || []).length) {
      toast('No props listed for this game — try another');
    }
  } catch {
    pool.innerHTML = '<div class="card"><p class="reason">Could not load props right now.</p></div>';
  }
}

// Books offering every picked leg -> combined odds per book.
function bookCombos() {
  const picked = state.picked.map(id => state.legs.find(l => l.id === id)).filter(Boolean);
  if (picked.length < 2) return { picked, combos: [] };
  const bookSets = picked.map(l => new Set(Object.keys(l.prices)));
  const common = [...bookSets[0]].filter(k => bookSets.every(s => s.has(k)));
  const combos = common.map(k => {
    const dec = picked.reduce((a, l) => a * toDec(l.prices[k].price), 1);
    const aff = picked.map(l => l.prices[k].affiliate).find(Boolean);
    return { book: k, title: picked[0].prices[k].title, decimal: dec, american: toAm(dec), affiliate: aff || null };
  }).sort((a, b) => b.decimal - a.decimal);
  return { picked, combos };
}

function renderSlip() {
  const { picked, combos } = bookCombos();
  const wrap = document.getElementById('slip-legs');
  const total = document.getElementById('slip-total');
  const booksEl = document.getElementById('slip-books');
  if (!picked.length) {
    wrap.innerHTML = '<p class="sec-sub">No legs yet — tap legs on the left (2–6).</p>';
    total.style.display = 'none'; booksEl.innerHTML = '';
    return;
  }
  wrap.innerHTML = picked.map(l => `
    <div class="slip-leg"><span>${esc(l.sideLabel)} <span style="color:var(--muted)">(${fmtAm(l.bestPrice)} best)</span></span>
    <span class="x" data-unpick="${esc(l.id)}">✕</span></div>`).join('');
  wrap.querySelectorAll('[data-unpick]').forEach(x => x.onclick = () => toggleLeg(x.dataset.unpick));
  if (combos.length) {
    const best = combos[0];
    total.style.display = '';
    document.getElementById('slip-odds').textContent = fmtAm(best.american);
    document.getElementById('slip-book').textContent = `best at ${best.title} • ${picked.length} legs`;
    booksEl.innerHTML = combos.slice(0, 4).map((c, i) => `
      <div class="line-row${i === 0 ? ' is-best' : ''}">
        <span class="line-book">${esc(c.title)}</span>
        ${i === 0 ? '<span class="best-line-badge">BEST</span>' : ''}
        <span class="line-price" style="font-size:17px">${fmtAm(c.american)}</span>
        ${c.affiliate ? `<button class="bet-btn small" data-aff="${esc(c.affiliate.name)}" data-url="${esc(c.affiliate.url)}">BET NOW</button>` : ''}
      </div>`).join('');
    booksEl.querySelectorAll('.bet-btn').forEach(b => b.onclick = () =>
      trackAffiliate(b.dataset.aff, null, b.dataset.url));
  } else {
    total.style.display = 'none';
    booksEl.innerHTML = '<p class="lines-note">Add one more leg to price the parlay (2 minimum).</p>';
  }
}

function autoBuild() {
  const pool = state.legs.filter(l => !state.picked.includes(l.id));
  let cands = [];
  if (state.risk === 'conservative') {
    // Genius favorites: highest-confidence moneyline picks first.
    const scored = pool.filter(l => l.market === 'moneyline').map(l => {
      const gp = state.picksByGame.get(gameKey(l));
      const geniusSide = gp && gp.pickTeam ? gp.pickTeam.abbr : null;
      const sideAbbr = (l.side === 'home' ? l.homeTeam : l.awayTeam).split(' ').map(w => w[0]).join('').toUpperCase();
      const isGenius = geniusSide && (l.sideLabel.toUpperCase().includes(geniusSide) || sideAbbr.includes(geniusSide.slice(0, 2)));
      return { l, score: isGenius ? (gp.confidence || 52) : 0, fav: l.bestPrice < 0 };
    }).filter(x => x.fav && x.score > 0).sort((a, b) => b.score - a.score);
    cands = scored.slice(0, 4).map(x => x.l);
  } else if (state.risk === 'moonshot') {
    cands = pool.filter(l => l.market === 'moneyline' && l.bestPrice > 0)
      .sort((a, b) => b.bestPrice - a.bestPrice).slice(0, 6);
  } else {
    const favs = pool.filter(l => l.market === 'moneyline' && l.bestPrice < 0)
      .sort((a, b) => a.bestPrice - b.bestPrice).slice(0, 2);
    const dogs = pool.filter(l => l.market === 'moneyline' && l.bestPrice > 0)
      .sort((a, b) => b.bestPrice - a.bestPrice).slice(0, 2);
    cands = [...favs, ...dogs];
  }
  state.picked = [];
  for (const l of cands) {
    const gk = gameKey(l);
    if (state.picked.length >= 6) break;
    if (state.picked.some(id => gameKey(state.legs.find(x => x.id === id)) === gk)) continue;
    state.picked.push(l.id);
  }
  if (!state.picked.length) toast('No legs match that profile today — try picking manually');
  renderPool();
  renderSlip();
}

function slipText() {
  const { picked, combos } = bookCombos();
  if (!picked.length) return '';
  const lines = ['🧠 THE SPORTS GENIUS — PARLAY SLIP'];
  picked.forEach((l, i) => lines.push(`${i + 1}. ${l.sideLabel} (${fmtAm(l.bestPrice)} best)`));
  if (combos.length) lines.push(`Combined: ${fmtAm(combos[0].american)} at ${combos[0].title}`);
  lines.push('21+. Gambling problem? Call or text 1-800-GAMBLER.');
  return lines.join('\n');
}

async function boot() {
  document.querySelectorAll('#risk-row .risk-btn').forEach(b => b.onclick = () => {
    document.querySelectorAll('#risk-row .risk-btn').forEach(x => x.classList.remove('on'));
    b.classList.add('on');
    state.risk = b.dataset.risk;
  });
  document.getElementById('auto-build').onclick = autoBuild;
  document.getElementById('clear-slip').onclick = () => { state.picked = []; renderPool(); renderSlip(); };
  document.getElementById('copy-slip').onclick = async () => {
    const t = slipText();
    if (!t) { toast('Add legs first'); return; }
    try { await navigator.clipboard.writeText(t); toast('Slip copied 📋'); }
    catch { toast('Copy failed — select the text manually'); }
  };

  try {
    const [{ data: odds }, { data: picksData }] = await Promise.all([
      api('/api/odds'), api('/api/picks'),
    ]);
    if (!odds.available) {
      document.getElementById('no-lines').style.display = '';
      return;
    }
    document.getElementById('builder').style.display = '';
    for (const p of picksData.picks || []) {
      // key by matchup for auto-build genius matching
      state.picksByGame.set(`${p.league}|${p.home.replace(/^[A-Z]{2,4} /, '')}|${p.away.replace(/^[A-Z]{2,4} /, '')}`, p);
    }
    state.legs = buildLegs(odds);
    buildPropEvents(odds);
    document.getElementById('props-load').onclick = loadProps;
    renderPool();
    renderSlip();
  } catch {
    document.getElementById('leg-pool').innerHTML = '<div class="card"><p class="reason">Could not load lines right now.</p></div>';
  }
}

document.addEventListener('DOMContentLoaded', boot);
