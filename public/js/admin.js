/* Admin page: affiliate CRUD + click reporting. Admins only (ADMIN_EMAILS). */
import { api, esc, toast } from './app.js';

async function loadAffiliates() {
  const { res, data } = await api('/api/admin/affiliates');
  const el = document.getElementById('aff-list');
  if (!res.ok) { el.innerHTML = `<p class="err">${esc(data.error || 'failed')}</p>`; return; }
  el.innerHTML = '';
  for (const a of data.affiliates) {
    const row = document.createElement('div');
    row.className = 'score-row';
    row.innerHTML = `
      <div class="team-line"><div>
        <div class="nm">${esc(a.name)} ${a.enabled ? '' : '<span style="color:var(--muted)">(disabled)</span>'}</div>
        <div class="rec">${esc(a.promo || '')} · priority ${a.priority}</div>
        <div class="rec" style="word-break:break-all">${esc(a.url)}</div>
      </div></div>
      <button class="fav-btn" data-act="toggle">${a.enabled ? 'Disable' : 'Enable'}</button>
      <button class="fav-btn" data-act="del">Delete</button>`;
    row.querySelector('[data-act="toggle"]').onclick = async () => {
      await api('/api/admin/affiliates/' + a.id, { method: 'PUT', body: JSON.stringify({ enabled: !a.enabled }) });
      loadAffiliates();
    };
    row.querySelector('[data-act="del"]').onclick = async () => {
      if (!confirm(`Delete ${a.name}?`)) return;
      await api('/api/admin/affiliates/' + a.id, { method: 'DELETE' });
      loadAffiliates();
    };
    el.appendChild(row);
  }
  if (!data.affiliates.length) el.innerHTML = '<p class="sec-sub">No affiliates configured yet. Add your first sportsbook below.</p>';
}

async function loadReport() {  const { res, data } = await api('/api/admin/affiliate-clicks');
  const el = document.getElementById('click-report');
  if (!res.ok) { el.innerHTML = `<p class="err">${esc(data.error || 'failed')}</p>`; return; }
  if (!data.counts.length) { el.innerHTML = '<p class="sec-sub">No clicks tracked yet.</p>'; return; }
  el.innerHTML = '<div class="score-row" style="font-weight:700"><div class="team-line"><div class="nm">Sportsbook</div></div><span class="score-num">Clicks</span></div>' +
    data.counts.map(c => `<div class="score-row"><div class="team-line"><div><div class="nm">${esc(c.sportsbook)}</div><div class="rec">${c.users || 0} signed-in users · last ${esc(c.last_click || '—')}</div></div></div><span class="score-num">${c.clicks}</span></div>`).join('');
}

/* ---- promo offers wall ---- */
let AFFS_FOR_OFFERS = [];

async function loadOffers() {
  const { res: ar, data: ad } = await api('/api/admin/affiliates');
  AFFS_FOR_OFFERS = ar.ok ? ad.affiliates : [];
  const sel = document.getElementById('of-aff');
  sel.innerHTML = '<option value="">— none (use direct URL) —</option>' +
    AFFS_FOR_OFFERS.map(a => `<option value="${a.id}">${esc(a.name)}</option>`).join('');

  const { res, data } = await api('/api/admin/offers');
  const el = document.getElementById('offer-list');
  if (!res.ok) { el.innerHTML = `<p class="err">${esc(data.error || 'failed')}</p>`; return; }
  el.innerHTML = '';
  for (const o of data.offers) {
    const row = document.createElement('div');
    row.className = 'score-row';
    const via = o.affiliate_id ? `via affiliate #${o.affiliate_id}` : (o.url ? 'direct URL' : 'no link');
    row.innerHTML = `
      <div class="team-line"><div>
        <div class="nm">${esc(o.book_name)} — ${esc(o.title)} ${o.enabled ? '' : '<span style="color:var(--muted)">(disabled)</span>'}</div>
        <div class="rec">${o.promo_code ? 'code ' + esc(o.promo_code) + ' · ' : ''}${esc(via)} · priority ${o.priority}</div>
      </div></div>
      <button class="fav-btn" data-act="toggle">${o.enabled ? 'Disable' : 'Enable'}</button>
      <button class="fav-btn" data-act="del">Delete</button>`;
    row.querySelector('[data-act="toggle"]').onclick = async () => {
      await api('/api/admin/offers/' + o.id, { method: 'PUT', body: JSON.stringify({ enabled: !o.enabled }) });
      loadOffers();
    };
    row.querySelector('[data-act="del"]').onclick = async () => {
      if (!confirm(`Delete offer "${o.title}"?`)) return;
      await api('/api/admin/offers/' + o.id, { method: 'DELETE' });
      loadOffers();
    };
    el.appendChild(row);
  }
  if (!data.offers.length) el.innerHTML = '<p class="sec-sub">No offers yet. Add your first bonus above.</p>';
}

function wireOffers() {
  document.getElementById('of-add').onclick = async () => {
    const err = document.getElementById('of-err');
    err.textContent = '';
    const body = {
      book_name: document.getElementById('of-book').value.trim(),
      title: document.getElementById('of-title').value.trim(),
      terms: document.getElementById('of-terms').value.trim(),
      promo_code: document.getElementById('of-code').value.trim(),
      affiliate_id: document.getElementById('of-aff').value || null,
      url: document.getElementById('of-url').value.trim(),
      priority: parseInt(document.getElementById('of-priority').value, 10) || 0,
      enabled: true,
    };
    const { res, data } = await api('/api/admin/offers', { method: 'POST', body: JSON.stringify(body) });
    if (!res.ok) { err.textContent = data.error || 'failed'; return; }
    for (const id of ['of-book', 'of-title', 'of-terms', 'of-code', 'of-url']) document.getElementById(id).value = '';
    toast('Offer added');
    loadOffers();
  };
}

document.addEventListener('DOMContentLoaded', async () => {
  let tries = 0;
  while (!(window.SG && 'user' in window.SG) && tries++ < 40) await new Promise(r => setTimeout(r, 100));
  const u = window.SG && window.SG.user;
  if (!u || !u.admin) {
    document.getElementById('admin-gate').innerHTML = '<div class="card"><p class="reason">Admins only. Your email must be in ADMIN_EMAILS on the server.</p></div>';
    return;
  }
  document.getElementById('admin-gate').style.display = 'none';
  document.getElementById('admin-body').style.display = '';
  loadAffiliates();
  loadOffers();
  wireOffers();
  loadReport();

  document.getElementById('af-add').onclick = async () => {
    const err = document.getElementById('af-err');
    err.textContent = '';
    const body = {
      name: document.getElementById('af-name').value.trim(),
      url: document.getElementById('af-url').value.trim(),
      promo: document.getElementById('af-promo').value.trim(),
      priority: parseInt(document.getElementById('af-priority').value, 10) || 0,
      enabled: true,
    };
    const { res, data } = await api('/api/admin/affiliates', { method: 'POST', body: JSON.stringify(body) });
    if (!res.ok) { err.textContent = data.error || 'failed'; return; }
    document.getElementById('af-name').value = '';
    document.getElementById('af-url').value = '';
    document.getElementById('af-promo').value = '';
    toast('Affiliate added');
    loadAffiliates();
  };

  document.getElementById('grant-btn').onclick = async () => {
    const err = document.getElementById('grant-err');
    err.textContent = '';
    const email = document.getElementById('grant-email').value.trim();
    const { res, data } = await api('/api/admin/grant', { method: 'POST', body: JSON.stringify({ email, days: 30 }) });
    if (!res.ok) { err.textContent = data.error || 'failed'; return; }
    toast('Premium granted');
  };
});
