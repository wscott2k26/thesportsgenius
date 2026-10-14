/* Scores page: league tabs + live scoreboard cards */
import { api, esc, fmtTime, isToday, toast } from './app.js';

const LEAGUE_META = { nfl: ['NFL', '🏈'], nba: ['NBA', '🏀'], wnba: ['WNBA', '🏀'], mlb: ['MLB', '⚾'], nhl: ['NHL', '🏒'], ncaab: ['NCAA Basketball', 'NCAA'], ncaaf: ['College FB', '🎓'] };
let current = new URLSearchParams(location.search).get('league')?.toLowerCase() || 'nfl';
if (!Object.prototype.hasOwnProperty.call(LEAGUE_META, current)) current = 'nfl';

function teamLine(t, isHome) {
  return `<div class="team-line">
    ${t.logo ? `<img class="logo" src="${esc(t.logo)}" alt="" loading="lazy">` : ''}
    <div><div class="nm">${esc(t.shortName || t.abbr)}</div>${t.record ? `<div class="rec">${esc(t.record)}</div>` : ''}</div>
  </div>`;
}

function card(e) {
  const st = e.status.state;
  const chip = st === 'in' ? `<span class="status-chip live">● ${esc(e.status.shortDetail || 'LIVE')}</span>`
    : st === 'post' ? `<span class="status-chip">Final</span>`
    : `<span class="status-chip">${esc(fmtTime(e.date))}</span>`;
  const score = (t) => t.score != null ? `<span class="score-num ${t.winner ? 'winner' : ''}">${t.score}</span>` : '<span class="score-num"></span>';
  const meta = [e.venue ? esc(e.venue) : '', (e.broadcasts || []).slice(0, 2).map(esc).join(' / '), e.week ? `Week ${e.week}` : ''].filter(Boolean).join(' · ');
  return `<div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
      <span class="league-tag">${esc(LEAGUE_META[e.league]?.[0] || e.league.toUpperCase())} ${LEAGUE_META[e.league]?.[1] || ''}</span>
      ${chip}
    </div>
    <div class="score-row">${teamLine(e.away)}${score(e.away)}</div>
    <div class="score-row">${teamLine(e.home)}${score(e.home)}</div>
    ${meta ? `<div class="delayed-note">${meta}</div>` : ''}
    <a class="sg-gamecenter-link" href="/matchup/${encodeURIComponent(current)}/${encodeURIComponent(e.id)}/${encodeURIComponent(String(e.date).slice(0,10).replaceAll("-",""))}">Read matchup →</a>
    <a class="sg-gamecenter-link" href="/game?league=${encodeURIComponent(current)}&id=${encodeURIComponent(e.id)}&date=${encodeURIComponent(String(e.date).slice(0,10).replaceAll('-',''))}">Open Game Center →</a>
  </div>`;
}

async function load() {
  const wrap = document.getElementById('scores-wrap');
  try {
    const { data } = await api('/api/scores?league=' + current);
    const lg = data.leagues[current] || {};
    const events = [...(lg.events || [])].sort((a, b) => new Date(a.date) - new Date(b.date));
    const live = events.filter(e => e.status.state === 'in');
    const upcoming = events.filter(e => e.status.state === 'pre' && isToday(e.date));
    const done = events.filter(e => e.status.state === 'post' && isToday(e.date));
    const ordered = [...live, ...upcoming, ...done];
    wrap.innerHTML = ordered.length ? ordered.map(card).join('')
      : '<div class="card"><p class="reason">No games on the schedule right now.</p></div>';
    const d = document.getElementById('delayed-note');
    if (d) d.style.display = lg.delayed ? '' : 'none';
  } catch {
    wrap.innerHTML = '<div class="card"><p class="reason">Scores unavailable right now. Try refreshing.</p></div>';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const tabs = document.getElementById('league-tabs');
  if (!tabs) return;
  tabs.innerHTML = Object.entries(LEAGUE_META).map(([k, [label, emoji]]) =>
    `<button class="btn-ghost" data-lg="${k}" style="${k === current ? 'border-color:var(--gold);color:var(--gold);' : ''}">${emoji} ${label}</button>`).join('');
  tabs.querySelectorAll('button').forEach(b => b.onclick = () => {
    current = b.dataset.lg;
    tabs.querySelectorAll('button').forEach(x => x.style.cssText = '');
    b.style.cssText = 'border-color:var(--gold);color:var(--gold);';
    load();
  });
  load();
  setInterval(load, 60000);
});
