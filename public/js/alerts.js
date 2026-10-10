/* Alert Center: significant line moves from real market snapshots. */
import { api, esc, toast, refreshUser, fmtTime } from './app.js';

const state = { tab: 'all' };

const fmtAm = (p) => (p > 0 ? `+${p}` : `${p}`);
const fmtPt = (p) => (p > 0 ? `+${p}` : `${p}`);

function moveLine(m) {
  const o = m.open, c = m.current;
  if (m.market === 'h2h') {
    return `${fmtAm(o.price)} → ${fmtAm(c.price)} <span class="mv-delta">(${m.magnitude}¢ ${m.dir === 'toward' ? 'toward' : 'away from'} ${esc(m.side)})</span>`;
  }
  return `${fmtPt(o.line)} (${fmtAm(o.price)}) → ${fmtPt(c.line)} (${fmtAm(c.price)}) <span class="mv-delta">(${m.magnitude} pts)</span>`;
}

function marketLabel(market) {
  return { h2h: 'Moneyline', spreads: 'Spread', totals: 'Total' }[market] || market;
}

function alertCard(a) {
  const moves = a.moves.slice(0, 6).map(m => `
    <div class="mv-row">
      <span class="mv-book">${esc(m.book)}</span>
      <span class="mv-market">${marketLabel(m.market)} · ${esc(m.side)}</span>
      <span class="mv-line">${moveLine(m)}</span>
    </div>`).join('');
  const extra = a.moves.length > 6 ? `<p class="reason" style="font-size:12px">+ ${a.moves.length - 6} more book moves</p>` : '';
  return `<div class="card alert-card${a.steam ? ' is-steam' : ''}">
    <div class="league-tag">${esc(a.league.toUpperCase())}${a.steam ? ' <span class="steam-badge">🔥 STEAM</span>' : ''}</div>
    <div class="matchup" style="font-size:22px">${esc(a.awayTeam)} @ ${esc(a.homeTeam)}</div>
    <p class="reason" style="font-size:12.5px">${a.commence ? esc(fmtTime(a.commence)) : ''}</p>
    ${moves}${extra}
  </div>`;
}

async function load() {
  const feed = document.getElementById('alerts-feed');
  const note = document.getElementById('alerts-login-note');
  try {
    const q = state.tab === 'mine' ? '?mine=1' : '';
    const { res, data } = await api('/api/alerts' + q);
    if (res.status === 401) {
      note.style.display = '';
      feed.innerHTML = '';
      return;
    }
    note.style.display = 'none';
    if (!data.available) {
      feed.innerHTML = '<div class="card"><p class="reason">Line alerts need the odds feed — the site admin must configure an Odds API key first.</p></div>';
      return;
    }
    if (!data.alerts.length) {
      feed.innerHTML = `<div class="card"><p class="reason">${state.tab === 'mine'
        ? 'No big moves on your teams right now. Follow teams on the My Teams page.'
        : 'No significant line moves in the last few days. The market is quiet — check back after the next odds refresh.'}</p></div>`;
      return;
    }
    feed.innerHTML = data.alerts.map(alertCard).join('');
  } catch {
    feed.innerHTML = '<div class="card"><p class="reason">Could not load alerts right now. Try refreshing.</p></div>';
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  await refreshUser();
  document.querySelectorAll('.alert-tabs [data-tab]').forEach(b => b.onclick = () => {
    document.querySelectorAll('.alert-tabs [data-tab]').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    state.tab = b.dataset.tab;
    load();
  });
  document.getElementById('alerts-refresh').onclick = () => { load(); toast('Alerts refreshed'); };
  load();
  setInterval(load, 5 * 60_000); // polling refresh, simple and robust
});
