/* My Teams page: search teams, save favorites, personalized games + picks */
import { api, esc, fmtTime, toast, openAuthModal } from './app.js';

let favs = [];

async function loadFavs() {
  const { res, data } = await api('/api/favorites');
  favs = res.ok ? data.favorites : [];
  renderFavChips();
}

function renderFavChips() {
  const el = document.getElementById('fav-chips');
  el.innerHTML = favs.length ? '' : '<p class="sec-sub">No favorites yet — search below and tap + to follow a team.</p>';
  for (const f of favs) {
    const c = document.createElement('span');
    c.className = 'team-chip';
    c.innerHTML = `${esc(f.abbr)} · ${esc(f.name)} <span class="x" title="remove">✕</span>`;
    c.querySelector('.x').onclick = async () => {
      await api('/api/favorites', { method: 'DELETE', body: JSON.stringify({ team_key: f.team_key }) });
      loadFavs(); loadMy();
    };
    el.appendChild(c);
  }
}

let searchTimer;
function wireSearch() {
  const input = document.getElementById('team-search');
  input.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => searchTeams(input.value.trim()), 250);
  });
  searchTeams('');
}

async function searchTeams(q) {
  const list = document.getElementById('team-results');
  const { data } = await api('/api/teams?q=' + encodeURIComponent(q));
  const favKeys = new Set(favs.map(f => f.team_key));
  list.innerHTML = '';
  for (const t of (data.teams || []).slice(0, 24)) {
    const row = document.createElement('div');
    row.className = 'score-row';
    const isFav = favKeys.has(t.key);
    row.innerHTML = `${t.logo ? `<img class="logo" src="${esc(t.logo)}" alt="" loading="lazy">` : ''}
      <div class="team-line"><div><div class="nm">${esc(t.name)}</div><div class="rec">${esc(t.label)} · ${esc(t.abbr)}</div></div></div>
      <button class="fav-btn ${isFav ? 'on' : ''}">${isFav ? '★' : '+'}</button>`;
    row.querySelector('button').onclick = async () => {
      if (!(window.SG && window.SG.user)) { openAuthModal('register'); toast('Sign in to save favorite teams'); return; }
      if (isFav) {
        await api('/api/favorites', { method: 'DELETE', body: JSON.stringify({ team_key: t.key }) });
      } else {
        await api('/api/favorites', { method: 'POST', body: JSON.stringify({ team_key: t.key, league: t.league, abbr: t.abbr, name: t.name }) });
      }
      loadFavs(); loadMy();
    };
    list.appendChild(row);
  }
}

function gameCard(g) {
  const e = g.event;
  const st = e.status.state;
  const chip = st === 'in' ? `<span class="status-chip live">● ${esc(e.status.shortDetail || 'LIVE')}</span>`
    : st === 'post' ? `<span class="status-chip">Final</span>` : `<span class="status-chip">${esc(fmtTime(e.date))}</span>`;
  const line = (t) => `<div class="team-line"><div class="nm">${esc(t.shortName || t.abbr)}</div></div><span class="score-num ${t.winner ? 'winner' : ''}">${t.score ?? ''}</span>`;
  return `<div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
      <span class="league-tag">${esc(g.team.abbr)} · ${esc(e.league.toUpperCase())}</span>${chip}
    </div>
    <div class="score-row">${line(e.away)}</div>
    <div class="score-row">${line(e.home)}</div>
  </div>`;
}

function pickMini(p) {
  return `<div class="card">
    <div class="league-tag">${esc(p.pick.league.toUpperCase())}</div>
    <div class="matchup" style="font-size:20px">${esc(p.pick.pickTeam.abbr)} ML · ${p.pick.confidence}%</div>
    <p class="reason">${esc(p.pick.reasoning)}</p>
  </div>`;
}

async function loadMy() {
  const gamesEl = document.getElementById('my-games');
  const picksEl = document.getElementById('my-picks');
  if (!(window.SG && window.SG.user)) {
    gamesEl.innerHTML = '<div class="card"><p class="reason">Sign in to get your personalized teams view.</p></div>';
    picksEl.innerHTML = '';
    return;
  }
  const { data } = await api('/api/my');
  gamesEl.innerHTML = data.games.length ? data.games.map(gameCard).join('')
    : '<div class="card"><p class="reason">None of your teams play today.</p></div>';
  picksEl.innerHTML = data.picks.length
    ? '<h2 class="sec-title" style="font-size:24px">Genius picks for your teams</h2>' + data.picks.map(pickMini).join('')
    : '';
}

document.addEventListener('DOMContentLoaded', async () => {
  if (!document.getElementById('team-search')) return;
  // wait for app.js boot (auth state)
  let tries = 0;
  while (!(window.SG && 'user' in window.SG) && tries++ < 40) await new Promise(r => setTimeout(r, 100));
  await loadFavs();
  wireSearch();
  loadMy();
});
