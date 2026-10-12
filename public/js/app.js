/* Shared: stadium bg rotation, auth state, ticker, toast, home picks + ask preview */
const BG_FILES = ["bg-nfl.jpg", "bg-nba.jpg", "bg-mlb.jpg", "bg-soccer.jpg", "bg-hockey.jpg", "bg-tennis.jpg", "bg-extra-02.jpg", "bg-extra-03.jpg", "bg-extra-04.jpg", "bg-extra-05.jpg", "bg-extra-06.jpg", "bg-extra-07.jpg", "bg-extra-08.jpg", "bg-extra-10.jpg", "bg-extra-14.jpg", "bg-extra-15.jpg", "bg-extra-16.jpg", "bg-extra-18.jpg", "bg-extra-19.jpg", "bg-extra-21.jpg", "bg-extra-22.jpg", "bg-extra-23.jpg", "bg-extra-24.jpg", "bg-extra-25.jpg", "bg-extra-26.jpg", "bg-extra-28.jpg", "bg-extra-30.jpg", "bg-extra-31.jpg", "bg-extra-32.jpg"];
const BG_DIR = '/bg/';

export function toast(msg) {
  let t = document.querySelector('.toast');
  if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t); }
  t.textContent = msg; t.classList.add('show');
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 3200);
}

export async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  const token = localStorage.getItem('sg_token');
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const res = await fetch(path, { ...opts, headers });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

export async function refreshUser() {
  const { res, data } = await api('/api/auth/me');
  window.SG = window.SG || {};
  window.SG.user = res.ok ? data.user : null;
  renderNav();
  return window.SG.user;
}

export function renderNav() {
  const u = window.SG && window.SG.user;
  const slot = document.getElementById('nav-auth');
  if (!slot) return;
  slot.innerHTML = '';
  if (u) {
    const span = document.createElement('span');
    span.style.cssText = 'font-size:13px;color:var(--muted);max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
    span.textContent = u.email;
    slot.appendChild(span);
    if (!u.premium) {
      const pro = document.createElement('a'); pro.className = 'btn-gold'; pro.href = '#'; pro.textContent = 'Go Pro';
      pro.onclick = (e) => { e.preventDefault(); goPro(); };
      slot.appendChild(pro);
    } else {
      const badge = document.createElement('span');
      badge.style.cssText = 'font-size:12px;font-weight:800;color:#1c1408;background:var(--gold);border-radius:999px;padding:6px 12px;';
      badge.textContent = 'PRO';
      slot.appendChild(badge);
    }
    const out = document.createElement('button'); out.className = 'btn-ghost'; out.textContent = 'Sign out';
    out.onclick = async () => { await api('/api/auth/logout', { method: 'POST' }); localStorage.removeItem('sg_token'); location.reload(); };
    slot.appendChild(out);
  } else {
    const signin = document.createElement('a'); signin.className = 'btn-ghost'; signin.href = '#'; signin.textContent = 'Sign in';
    signin.onclick = (e) => { e.preventDefault(); openAuthModal('login'); };
    const join = document.createElement('a'); join.className = 'btn-gold'; join.href = '#'; join.textContent = 'Join free';
    join.onclick = (e) => { e.preventDefault(); openAuthModal('register'); };
    slot.append(signin, join);
  }
}

export async function goPro() {
  const { data } = await api('/api/billing');
  if (data.checkoutEnabled) {
    const {res, data: checkout}=await api('/api/billing/checkout',{method:'POST'});
    if(res.ok&&checkout.url){location.assign(checkout.url);return}
    toast(checkout.error||'Sign in before upgrading to Premium.');return;
  }
  toast('Premium checkout is not active yet. No charges will be made.');
}

export function openAuthModal(mode = 'login') {
  const veil = document.getElementById('auth-modal');
  if (!veil) return;
  veil.classList.add('open');
  veil.querySelector('[data-mode-login]').style.display = mode === 'login' ? '' : 'none';
  veil.querySelector('[data-mode-register]').style.display = mode === 'register' ? '' : 'none';
  veil.querySelector('.err').textContent = '';
}
export function closeAuthModal() { document.getElementById('auth-modal')?.classList.remove('open'); }

async function authSubmit(kind, email, pw) {
  const { res, data } = await api(`/api/auth/${kind}`, { method: 'POST', body: JSON.stringify({ email, password: pw }) });
  if (!res.ok) throw new Error(data.error || 'failed');
  localStorage.setItem('sg_token', data.token);
  closeAuthModal();
  await refreshUser();
  toast(kind === 'register' ? 'Welcome to the Genius 🏆' : 'Signed in');
}

export function wireAuthModal() {
  const veil = document.getElementById('auth-modal');
  if (!veil) return;
  veil.addEventListener('click', (e) => { if (e.target === veil) closeAuthModal(); });
  for (const kind of ['login', 'register']) {
    const form = veil.querySelector(`form[data-form="${kind}"]`);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = veil.querySelector('.err');
      try {
        await authSubmit(kind, form.email.value.trim(), form.password.value);
        form.reset();
      } catch (ex) { err.textContent = ex.message; }
    });
    veil.querySelectorAll(`[data-switch]`).forEach(b => b.onclick = () => openAuthModal(b.dataset.switch));
  }
}

/* ---- stadium background rotation ---- */
export function startBackgrounds() {
  const stage = document.querySelector('.bg-stage');
  if (!stage) return;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Only load the current/next venue, not 29 full-size photos immediately.
  const imgs = BG_FILES.map(f => {
    const img = document.createElement('img');
    img.alt = ''; img.dataset.src = BG_DIR + f;
    img.onerror = () => { img.dataset.failed = 'true'; img.classList.remove('on'); };
    stage.appendChild(img);
    return img;
  });
  const loadAt = k => {
    const img = imgs[k];
    if (img && !img.src) img.src = img.dataset.src;
  };
  let i = 0;
  const show = () => {
    loadAt(i);
    imgs.forEach((el, k) => el.classList.toggle('on', k === i && el.dataset.failed !== 'true'));
    loadAt((i + 1) % imgs.length);
    i = (i + 1) % imgs.length;
  };
  show();
  setInterval(show, 25000); // Always rotate photos; reduced motion only suppresses Ken Burns zoom.
}

/* ---- ticker ---- */
export async function loadTicker() {
  const inner = document.querySelector('.ticker-inner');
  if (!inner) return;
  try {
    const { data } = await api('/api/scores');
    const bits = [];
    for (const lg of Object.keys(data.leagues || {})) {
      for (const e of data.leagues[lg].events || []) {
        if (e.status.state === 'in') {
          bits.push(`<span class="live">● LIVE</span> ${esc(e.away.abbr)} ${e.away.score} — ${esc(e.home.abbr)} ${e.home.score} <span class="dot">•</span> ${esc(e.status.shortDetail || '')}`);
        } else if (e.status.state === 'pre' && isToday(e.date)) {
          bits.push(`${esc(e.away.abbr)} vs ${esc(e.home.abbr)} <span class="dot">•</span> ${esc(fmtTime(e.date))}`);
        }
      }
    }
    const text = bits.length ? bits.slice(0, 14).join(' <span class="dot">•</span> ') : 'No live games right now — check back soon';
    inner.innerHTML = '<span class="ticker-copy">' + text + ' <span class="dot">•</span></span><span class="ticker-copy" aria-hidden="true">' + text + ' <span class="dot">•</span></span>';
  } catch { inner.textContent = 'Scores unavailable — retrying shortly'; }
}

export function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
export function isToday(iso) {
  const d = new Date(iso);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d) ===
         new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
export function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }) + ' ET';
}

/* ---- affiliate partner links ---- */
let AFFILIATES = [];
export async function loadAffiliates() {
  try {
    const { data } = await api('/api/affiliates');
    AFFILIATES = data.affiliates || [];
  } catch { AFFILIATES = []; }
  renderOffers();
  return AFFILIATES;
}

export function trackAffiliate(sportsbook, pickId, url) {
  api('/api/affiliates/click', {
    method: 'POST', body: JSON.stringify({ sportsbook, pick_id: pickId ?? null }),
  }).catch(() => {});
  window.open(url, '_blank', 'noopener');
}

function renderOffers() {
  const sec = document.getElementById('offers-section');
  if (!sec) return;
  if (!AFFILIATES.length) { sec.style.display = 'none'; return; }
  sec.style.display = '';
  sec.innerHTML = `<h2 class="sec-title" style="font-size:26px">Sportsbook offers</h2>
    <p class="sec-sub">Partner offers — clearly labeled. 21+. Gambling problem? Call or text 1-800-GAMBLER.</p>
    <div class="grid">` + AFFILIATES.map(a => `
    <div class="card offer-card">
      <div class="league-tag">${esc(a.name)}</div>
      <div class="matchup" style="font-size:21px">${esc(a.promo || 'Partner offer')}</div>
      <button class="bet-btn" data-aff="${esc(a.name)}" data-url="${esc(a.url)}" data-pick="">
        Visit ${esc(a.name)} <span class="partner-badge">Partner link</span>
      </button>
    </div>`).join('') + `</div>`;
  sec.querySelectorAll('.bet-btn').forEach(b => b.onclick = () =>
    trackAffiliate(b.dataset.aff, b.dataset.pick === '' ? null : Number(b.dataset.pick), b.dataset.url));
}

/* ---- home page ---- */
async function loadHome() {
  if (!document.getElementById('picks-grid')) return;
  renderSGVenueStrip();
  renderSGPrelaunch();
  renderSGVerified();
  renderSGGames();
  await loadAffiliates();
  // track record badge
  const badge = document.getElementById('track-badge');
  try {
    const { data } = await api('/api/track-record');
    badge.innerHTML = data.calibrating
      ? `<span class="check">◷</span> Calibrating — building track record (${data.graded} graded)`
      : `<span class="check">✓</span> Verified track record: ${data.wins}-${data.losses} (${data.winRate}%)`;
  } catch { /* keep static fallback */ }
  // picks
  const grid = document.getElementById('picks-grid');
  try {
    const { data } = await api('/api/picks');
    if (!data.picks.length) {
      grid.innerHTML = '<div class="card"><p class="reason">No pre-game matchups left today. Check Scores for live action.</p></div>';
    } else {
      grid.innerHTML = data.picks.map(pickCard).join('');
      grid.querySelectorAll('.bet-btn').forEach(b => b.onclick = () =>
        trackAffiliate(b.dataset.aff, b.dataset.pick === '' ? null : Number(b.dataset.pick), b.dataset.url));
    }
    const lock = document.getElementById('locked-note');
    if (lock && data.lockedLeagues && data.lockedLeagues.length) {
      lock.style.display = '';
      lock.innerHTML = `Premium unlocks picks for <b>${esc(data.lockedLeagues.join(', ').toUpperCase())}</b> + Genius Best Bets + unlimited Genius chat. Start with a 7-day free trial.`;
    }
  } catch {
    grid.innerHTML = '<div class="card"><p class="reason">Could not load picks right now. Try refreshing.</p></div>';
  }
  // Genius Best Bets (premium)
  try {
    const bb = document.getElementById('best-bets');
    if (bb && window.SG && window.SG.user && window.SG.user.premium) {
      const { res, data } = await api('/api/picks/best');
      if (res.ok && data.best && data.best.length) {
        bb.style.display = '';
        bb.innerHTML = `<h2 class="sec-title" style="font-size:24px">⭐ Genius Best Bets</h2><div class="grid">` +
          data.best.map(pickCard).join('') + `</div>`;
        bb.querySelectorAll('.bet-btn').forEach(b => b.onclick = () =>
          trackAffiliate(b.dataset.aff, b.dataset.pick === '' ? null : Number(b.dataset.pick), b.dataset.url));
      }
    }
  } catch { /* optional */ }
}

function pickCard(p) {
  const res = p.status === 'win' ? '<div class="result win">✓ WON</div>'
    : p.status === 'loss' ? '<div class="result loss">✗ LOST</div>'
    : '<div class="result pending">Pending — grades when the game goes final</div>';
  const typeLabel = p.pickType === 'spread' ? `SPREAD ${esc(p.line || '')}` : 'MONEYLINE (WINNER)';
  const bets = lineShopping(p, AFFILIATES);
  const totals = totalsShopping(p);
  const splits = splitsNote(p);
  return `<div class="card">
    <div class="league-tag">${esc(p.league.toUpperCase())}</div>
    <div class="matchup sg-pick-matchup"><span class="sg-team">${sgTeamLogo(p.league,p.away.split(' ')[0])}<span>${esc(p.away.replace(/^[A-Z]{2,4} /, ''))}</span></span><span class="sg-versus">VS</span><span class="sg-team">${sgTeamLogo(p.league,p.home.split(' ')[0])}<span>${esc(p.home.replace(/^[A-Z]{2,4} /, ''))}</span></span></div>
    <span class="pick-pill">PICK ${esc(p.pickTeam.abbr)} ${typeLabel}</span>
    <div class="conf">${p.confidence}% confidence</div>
    <div class="conf-bar"><i style="width:${p.confidence}%"></i></div>
    <p class="reason"><b>Genius reasoning:</b> ${esc(p.reasoning)}</p>
    ${bets}
    ${totals}
    ${splits}
    ${res}
  </div>`;
}

function fmtPrice(price) { const n = Number(price); return n > 0 ? `+${n}` : `${n}`; }
function fmtPt(pt) { const n = Number(pt); return n > 0 ? `+${n}` : `${n}`; }

// Line-movement sparkline (open -> current) for the picked side. Data comes
// from real market snapshots only; nothing renders without history.
function sparkline(mv) {
  if (!mv) return '';
  const entries = Object.entries(mv).filter(([, v]) => v && v.points && v.points.length > 1);
  if (!entries.length) return '';
  // Use the book with the most movement, else the first.
  entries.sort((a, b) => (b[1].magnitude || 0) - (a[1].magnitude || 0));
  const [book, v] = entries[0];
  const pts = v.points.map(p => p.price);
  const w = 120, h = 30, min = Math.min(...pts), max = Math.max(...pts), span = (max - min) || 1;
  const path = pts.map((p, i) => `${(i / (pts.length - 1) * w).toFixed(1)},${(h - (p - min) / span * (h - 4) - 2).toFixed(1)}`).join(' ');
  const arrow = v.moved ? (v.dir === 'toward' ? '↘ toward' : v.dir === 'away' ? '↗ away' : v.dir === 'down' ? '▼' : '▲') : '';
  const note = v.moved
    ? `Moved ${fmtPrice(v.open.price)} → ${fmtPrice(v.current.price)} at ${esc(book)} ${arrow}`
    : `Steady at ${fmtPrice(v.current.price)} (${esc(book)})`;
  return `<div class="sparkline" title="${esc(note)}">
    <svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><polyline points="${path}" fill="none" stroke="var(--gold)" stroke-width="2"/></svg>
    <span>${esc(note)}</span>
  </div>`;
}

// Totals line shopping across every book: best over / best under badged,
// BET NOW deep-links via the admin-matched affiliate. Honest framing: the
// Genius does not project totals, so this is pure line shopping.
function totalsShopping(p) {
  const L = p.lines;
  if (!L || !L.available) return '';
  const books = Object.entries(L.totals || {});
  if (!books.length) return '';
  const rows = books
    .sort((a, b) => b[1].point - a[1].point)
    .map(([key, b]) => {
      const overBest = L.bestOver && L.bestOver.book === key;
      const underBest = L.bestUnder && L.bestUnder.book === key;
      const btn = b.affiliate
        ? `<button class="bet-btn small" data-aff="${esc(b.affiliate.name)}" data-url="${esc(b.affiliate.url)}" data-pick="${p.id}">BET NOW</button>`
        : '';
      return `<div class="line-row">
        <span class="line-book">${esc(b.title)}</span>
        <span class="line-total">${fmtPt(b.point)}</span>
        <span class="line-ou">O ${fmtPrice(b.over)}${overBest ? ' <span class="best-line-badge">BEST</span>' : ''}</span>
        <span class="line-ou">U ${fmtPrice(b.under)}${underBest ? ' <span class="best-line-badge">BEST</span>' : ''}</span>
        ${btn}
      </div>`;
    }).join('');
  return `<div class="line-shop">
    <div class="line-shop-head"><span class="t">TOTALS • SHOP THE LINE</span></div>
    ${rows}
    <p class="lines-note">The Genius doesn't project totals — it shops the best price. 21+. <span class="partner-badge">Partner links</span></p>
  </div>`;
}

// Public betting splits: honest placeholder until a real feed exists. Never
// renders fabricated percentages.
function splitsNote(p) {
  const L = p.lines;
  if (!L || !L.available) return '';
  if (L.splits && L.splits.available) return ''; // real splits UI renders when a feed lands
  return `<p class="splits-note">📊 Public splits: <a href="/splits" style="color:var(--gold)">awaiting data feed</a> — we show real splits only, never estimates.</p>`;
}

// Line shopping: per-book prices for the picked side, best line badged,
// BET NOW deep-links to the admin-configured affiliate URL for that book.
function lineShopping(p, affiliates) {
  const L = p.lines;
  if (!L || !L.available) {
    // Fallback: plain affiliate buttons when no odds feed is configured.
    if (!affiliates.length) return '';
    return `<div class="bet-row">` + affiliates.map(a =>
      `<button class="bet-btn small" data-aff="${esc(a.name)}" data-url="${esc(a.url)}" data-pick="${p.id}">
        Bet this at ${esc(a.name)} <span class="partner-badge">Partner link</span>
      </button>`).join('') + `</div>`;
  }
  const books = Object.entries(L.books || {});
  if (!books.length) {
    return `<p class="lines-unavail">Live lines unavailable for this game right now.</p>`;
  }
  const rows = books
    .sort((a, b) => b[1].price - a[1].price)
    .map(([key, b]) => {
      const isBest = L.best && L.best.book === key;
      const btn = b.affiliate
        ? `<button class="bet-btn small" data-aff="${esc(b.affiliate.name)}" data-url="${esc(b.affiliate.url)}" data-pick="${p.id}">BET NOW</button>`
        : '';
      return `<div class="line-row${isBest ? ' is-best' : ''}">
        <span class="line-book">${esc(b.title)}</span>
        ${isBest ? '<span class="best-line-badge">BEST LINE</span>' : ''}
        <span class="line-price">${fmtPrice(b.price)}</span>${btn}
      </div>`;
    }).join('');
  const fresh = L.fetchedAt
    ? `Odds accurate as of ${esc(new Date(L.fetchedAt).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }))} ET`
    : 'Live market odds';
  return `<div class="line-shop">
    <div class="line-shop-head"><span class="t">LINE SHOPPING • BEST PRICE</span><span class="fresh">${fresh}</span></div>
    ${sparkline(L.movement)}
    ${rows}
    <p class="lines-note">21+. Gambling problem? Call or text 1-800-GAMBLER. Lines move — confirm at the book. <span class="partner-badge">Partner links</span></p>
  </div>`;
}

/* ---- boot ---- */
document.addEventListener('DOMContentLoaded', async () => {
  startBackgrounds();
  wireAuthModal();
  await refreshUser();
  loadTicker();
  setInterval(loadTicker, 60000);
  loadHome();
});

function renderSGVenueStrip(){
 const el=document.getElementById('sg-venue-list');if(!el)return;
 const venues=[['NFL Stadium','bg-nfl.jpg'],['Basketball Arena','bg-nba.jpg'],['MLB Ballpark','bg-mlb.jpg'],['Soccer Stadium','bg-soccer.jpg'],['Hockey Arena','bg-hockey.jpg'],['Tennis Center','bg-tennis.jpg'],['College Football','bg-extra-04.jpg'],['College Basketball','bg-extra-10.jpg']];
 el.innerHTML=venues.map(([name,file])=>'<a class="sg-venue" href="/photo-credits"><img loading="lazy" src="/bg/'+file+'" alt="'+esc(name)+'"><span>'+esc(name)+'</span></a>').join('');
}
async function renderSGGames(){
 const el=document.getElementById('sg-games-list');if(!el)return;
 try{
 const {data}=await api('/api/scores');
 const games=Object.entries(data.leagues||{}).flatMap(([league,info])=>(info.events||[]).filter(e=>e.status.state==='in'||(e.status.state==='pre'&&isToday(e.date))).map(e=>({...e,league})));
 games.sort((a,b)=>(a.status.state==='in'?0:1)-(b.status.state==='in'?0:1)||new Date(a.date)-new Date(b.date));
 el.innerHTML=games.length?games.slice(0,5).map(e=>{
 const query=(e.away.name||e.away.abbr)+' vs '+(e.home.name||e.home.abbr)+' '+e.league+' official live game';
 const yt='https://www.youtube.com/results?search_query='+encodeURIComponent(query);
 const broadcasts=(e.broadcasts||[]).map(x=>esc(x)).join(', ');
 return '<div class="sg-game"><div><strong class="sg-mini-match">'+sgTeamLogo(e.league,e.away.abbr,e.away.logo)+esc(e.away.abbr)+' vs '+sgTeamLogo(e.league,e.home.abbr,e.home.logo)+esc(e.home.abbr)+'</strong><small>'+esc(e.league.toUpperCase())+'</small></div><small>'+(e.status.state==='in'?'LIVE '+esc(e.away.score)+'-'+esc(e.home.score):esc(fmtTime(e.date)))+'</small><a class="sg-gamecenter-link" href="/game?league='+encodeURIComponent(e.league)+'&id='+encodeURIComponent(e.id)+'">Open Game Center →</a><div class="sg-watch-row"><span>'+ (broadcasts?'TV / Stream: '+broadcasts:'Broadcast not listed')+'</span><a href="'+esc(yt)+'" target="_blank" rel="noopener noreferrer" aria-label="Search YouTube for official coverage of '+esc(e.away.abbr)+' versus '+esc(e.home.abbr)+'">Search YouTube ↗</a></div></div>';
 }).join(''):'<p class="reason">No live or upcoming games right now.</p>';
 }catch{el.textContent='Games unavailable right now. See all scores.'}
}

function sgTeamLogo(league,abbr,provided=''){
 const code=String(abbr||'').toLowerCase().replace(/[^a-z0-9]/g,'');
 const routes={nfl:'nfl',nba:'nba',mlb:'mlb',nhl:'nhl',ncaaf:'college-football'};
 const path=routes[String(league||'').toLowerCase()];
 const candidate=provided||((path&&code)?'https://a.espncdn.com/i/teamlogos/'+path+'/500/'+code+'.png':'');
 if(!candidate)return '';
 const url=esc(candidate);
 return '<img class="sg-team-logo" src="'+url+'" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.hidden=true">';
}


async function renderSGPrelaunch(){
 const el=document.getElementById('sg-prelaunch-record');if(!el)return;
 try{
 const {data}=await api('/api/prelaunch-record');
 el.innerHTML=(data.records||[]).map(p=>'<div class="sg-prelaunch-row"><strong>'+esc(p.selected)+' — '+esc(p.result.toUpperCase())+'</strong><span>'+esc(p.matchup)+' · '+esc(p.date)+' · '+esc(p.confidence)+'% confidence · '+esc(p.finalScore)+'</span><small>'+esc(p.provenance)+'</small></div>').join('');
 }catch{el.textContent='Prelaunch history unavailable.'}
}

async function renderSGVerified(){
 const el=document.getElementById('sg-verified-record');if(!el)return;
 try{
 const {data}=await api('/api/verified-picks'),rows=data.picks||[];
 const wins=rows.filter(x=>x.status==='win').length,losses=rows.filter(x=>x.status==='loss').length,pending=rows.filter(x=>x.status==='pending').length;
 el.innerHTML='<p class="reason">'+wins+' wins · '+losses+' losses · '+pending+' pending (most recent 40 picks)</p>'+
 (rows.length?rows.slice(0,6).map(p=>'<div class="sg-game"><strong>'+esc(p.pick_team)+'</strong><small> · '+esc(p.league.toUpperCase())+' · '+esc(p.date)+' · '+esc(p.status.toUpperCase())+'</small></div>').join(''):'<p class="reason">No independently timestamped picks yet. New predictions will appear as they are saved before kickoff.</p>');
 }catch{el.textContent='Verified pick history temporarily unavailable.'}
}
