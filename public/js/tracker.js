/* Bet tracker: log bets, grade them, see record / ROI / units. Requires sign-in. */
import { api, esc, toast, refreshUser } from './app.js';

const fmt$ = (n) => (n < 0 ? `-$${Math.abs(n).toFixed(2)}` : `$${n.toFixed(2)}`);
const fmtAm = (p) => (p > 0 ? `+${p}` : `${p}`);

function resChip(r) {
  const label = { win: 'WON', loss: 'LOST', push: 'PUSH', pending: 'PENDING' }[r] || r;
  return `<span class="res-chip ${esc(r)}">${label}</span>`;
}

function renderSummary(s) {
  const tiles = [
    [s.wins + '-' + s.losses + (s.pushes ? '-' + s.pushes : ''), 'Record', 'gold'],
    [s.roi + '%', 'ROI', s.roi >= 0 ? 'pos' : 'neg'],
    [(s.units >= 0 ? '+' : '') + s.units, 'Units', s.units >= 0 ? 'pos' : 'neg'],
    [fmt$(s.net), 'Net profit', s.net >= 0 ? 'pos' : 'neg'],
    [fmt$(s.staked), 'Total staked', ''],
    [s.graded + ' graded', 'Bets', ''],
  ];
  document.getElementById('stat-tiles').innerHTML = tiles.map(([v, k, c]) =>
    `<div class="stat-tile"><div class="v ${c}">${esc(String(v))}</div><div class="k">${k}</div></div>`).join('');
}

function renderBets(bets) {
  const tb = document.querySelector('#bet-table tbody');
  if (!bets.length) {
    tb.innerHTML = '<tr><td colspan="6" class="reason">No bets logged yet — log your first one on the right.</td></tr>';
    return;
  }
  tb.innerHTML = bets.map(b => `
    <tr>
      <td style="white-space:nowrap">${esc(b.date)}</td>
      <td><b>${esc(b.selection)}</b><br><span style="color:var(--muted);font-size:12px">${esc(b.matchup)}${b.book ? ' • ' + esc(b.book) : ''} • ${esc(b.bet_type)}</span></td>
      <td>${fmt$(b.stake)}</td>
      <td>${fmtAm(b.odds)}</td>
      <td>${resChip(b.result)}</td>
      <td><div class="row-actions">
        ${b.result === 'pending' ? `
          <button class="mini-btn" data-grade="win" data-id="${b.id}">Win</button>
          <button class="mini-btn" data-grade="loss" data-id="${b.id}">Loss</button>
          <button class="mini-btn" data-grade="push" data-id="${b.id}">Push</button>` : `
          <button class="mini-btn" data-grade="pending" data-id="${b.id}">Reopen</button>`}
        <button class="mini-btn" data-del="${b.id}" title="Delete">✕</button>
      </div></td>
    </tr>`).join('');
  tb.querySelectorAll('[data-grade]').forEach(x => x.onclick = async () => {
    await api(`/api/bets/${x.dataset.id}`, { method: 'PUT', body: JSON.stringify({ result: x.dataset.grade }) });
    load();
  });
  tb.querySelectorAll('[data-del]').forEach(x => x.onclick = async () => {
    if (!confirm('Delete this bet?')) return;
    await api(`/api/bets/${x.dataset.del}`, { method: 'DELETE' });
    load();
  });
}

async function load() {
  const { res, data } = await api('/api/bets');
  if (!res.ok) { toast('Could not load bets'); return; }
  renderSummary(data.summary);
  renderBets(data.bets);
}

async function boot() {
  await refreshUser();
  const u = window.SG && window.SG.user;
  if (!u) {
    document.getElementById('need-login').style.display = '';
    return;
  }
  document.getElementById('tracker-app').style.display = '';
  const form = document.getElementById('bet-form');
  form.date.value = new Date().toISOString().slice(0, 10);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = document.getElementById('bet-err');
    err.textContent = '';
    const body = Object.fromEntries(new FormData(form).entries());
    const { res, data } = await api('/api/bets', { method: 'POST', body: JSON.stringify(body) });
    if (!res.ok) { err.textContent = data.error || 'Failed to log bet'; return; }
    form.reset();
    form.date.value = new Date().toISOString().slice(0, 10);
    toast('Bet logged 📒');
    load();
  });
  load();
}

document.addEventListener('DOMContentLoaded', boot);
