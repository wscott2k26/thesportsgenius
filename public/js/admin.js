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


/* Owner-attested historical outcomes — never counted in verified live-model results. */
async function loadPrelaunch() {
  const el = document.getElementById('prelaunch-list');
  try {
    const { res, data } = await api('/api/prelaunch-record');
    if (!res.ok) throw Error(data.error || 'History unavailable');
    const count = data.attested || {};
    const items = (data.records || []).map(p =>
      '<div class="score-row"><div class="team-line"><div>' +
      '<div class="nm">' + esc(p.selected) + ' — ' + esc(String(p.result).toUpperCase()) + '</div>' +
      '<div class="rec">' + esc(p.date) + ' · ' + esc(p.matchup) + ' · ' + esc(p.finalScore) + '</div>' +
      '<div class="rec">' + esc(p.provenance) + ' — timestamp not independently verified</div>' +
      '</div></div></div>').join('');
    el.innerHTML = '<p class="sec-sub">Owner-attested: ' + Number(count.wins || 0) +
      ' wins · ' + Number(count.losses || 0) + ' losses · ' + Number(count.pushes || 0) +
      ' pushes. These do <b>not</b> count toward verified predictions.</p>' +
      (items || '<p class="sec-sub">No historical picks recorded.</p>');
  } catch (e) { el.textContent = e.message || 'Unable to load historical picks'; }
}

function wirePrelaunch() {
  const form = document.getElementById('prelaunch-form');
  const save = document.getElementById('hist-save');
  const err = document.getElementById('hist-err');
  if (!form || !save || !err) return;
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (save.disabled) return;
    if (!form.reportValidity()) return;
    err.textContent = '';
    if (!confirm('Record this historical result as OWNER-ATTESTED only? It will not change the verified record.')) return;
    const payload = Object.fromEntries(new FormData(form).entries());
    payload.ownerAttested = form.elements.namedItem('ownerAttested').checked;
    save.disabled = true;
    try {
      const { res, data } = await api('/api/admin/prelaunch-record', {
        method: 'POST', body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(data.error || 'Unable to record historical pick');
      if (data.alreadyPresent) {
        toast('Already in history — no duplicate added');
      } else {
        toast('Historical pick saved (owner-attested)');
      }
      if (data.created) form.reset();
      await loadPrelaunch();
    } catch (e) {
      err.textContent = e.message || 'Save failed';
    } finally {
      save.disabled = false;
    }
  });
}


/* Traffic dashboard: first-party aggregate counters, NOT unique visitors. */
let trafficBusy = false;
const trafficCount = value => Math.max(0, Number(value) || 0).toLocaleString('en-US');

async function loadTraffic() {
  const status = document.getElementById('traffic-status');
  const kpis = document.getElementById('traffic-kpis');
  const chart = document.getElementById('traffic-chart');
  const breakdown = document.getElementById('traffic-breakdown');
  if (!status || !kpis || !chart || !breakdown || trafficBusy) return;
  trafficBusy = true;
  try {
    const range = Number(document.getElementById('traffic-days')?.value) === 30 ? 30 : 7;
    const { res, data } = await api('/api/growth/summary?days=' + range);
    if (!res.ok) throw Error(res.status === 403 ? 'Your session is not authorized to view analytics.' : (data.error || 'Traffic data unavailable.'));
    const now = new Date(data.reportedAt || Date.now());
    const today = now.toISOString().slice(0,10);
    const rows = Array.isArray(data.byDay) ? data.byDay : [];
    const pages = Array.isArray(data.byPage) ? data.byPage : [];
    const sources = Array.isArray(data.bySource) ? data.bySource : [];
    const sum = filter => rows.filter(filter).reduce((a,r) => a + (Number(r.total)||0),0);
    const views = sum(r => r.event === 'pageview');
    const todayViews = sum(r => r.day === today && r.event === 'pageview');
    const actions = sum(r => r.event !== 'pageview');
    const social = sources.find(x => x.source === 'social')?.views || 0;
    const recent = Number(data.recent15m) || 0;
    const metrics = [
      ['Today (UTC)',todayViews],
      ['Last ' + range + ' days',views],
      ['Past 15 minutes',recent],
      ['Social referrals',social],
      ['Share / save actions',actions],
    ];
    kpis.innerHTML = metrics.map(([label,value]) =>
      '<div style="padding:14px;border:1px solid var(--muted);border-radius:12px">' +
      '<div class="sec-sub" style="font-size:12px;margin-bottom:6px">' + esc(label) + '</div>' +
      '<strong style="font-size:clamp(22px,3vw,34px);color:var(--gold)">' + trafficCount(value) + '</strong></div>').join('');

    // Tiny zero-inclusive chart: last seven UTC days, derived only from counted pageviews.
    const dayLookup = new Map(rows.filter(r => r.event === 'pageview').map(r => [r.day,Number(r.total)||0]));
    const daily = Array.from({length:7},(_,i) => {
      const d = new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()-6+i)).toISOString().slice(0,10);
      return { date:d, count:dayLookup.get(d)||0 };
    });
    const max = Math.max(1,...daily.map(x => x.count));
    chart.innerHTML = '<h3 style="margin:0 0 12px">Daily pageviews · past 7 days</h3>' +
      daily.map(d => '<div style="display:flex;align-items:center;gap:10px;margin:8px 0">' +
      '<span style="width:65px;font-size:12px">' + esc(d.date.slice(5)) + '</span>' +
      '<div style="flex:1;height:12px;border-radius:8px;background:rgba(150,150,150,.12);overflow:hidden">' +
      '<div style="width:' + (100*d.count/max).toFixed(1) + '%;height:100%;background:var(--gold);border-radius:8px"></div></div>' +
      '<strong style="font-size:12px;width:55px;text-align:right">' + trafficCount(d.count) + '</strong></div>').join('');
    const rowsHtml = (list,key,val) => list.slice(0,6).map(x =>
      '<div class="score-row"><div class="team-line" style="word-break:break-word">' +
      esc(x[key]) + '</div><strong>' + trafficCount(x[val]) + '</strong></div>').join('');
    breakdown.innerHTML =
      '<div><h3>Top pages</h3>' + (rowsHtml(pages,'path','views') || '<p class="sec-sub">No tracked pageviews yet.</p>') + '</div>' +
      '<div><h3>Traffic sources</h3>' + (rowsHtml(sources,'source','views') || '<p class="sec-sub">No referral data yet.</p>') + '</div>';
    status.textContent = 'Last refreshed ' + now.toLocaleTimeString('en-US', {hour:'numeric',minute:'2-digit',timeZone:'America/New_York'}) +
      ' ET · updates every 60 sec · pageviews are not unique visitors';
  } catch (error) {
    status.textContent = error.message || 'Unable to load traffic';
  } finally {
    trafficBusy = false;
  }
}
function wireTraffic() {
  const range = document.getElementById('traffic-days');
  if (!range) return;
  range.addEventListener('change', loadTraffic);
  loadTraffic();
  setInterval(() => { if (!document.hidden) loadTraffic(); }, 60000);
}

document.addEventListener('DOMContentLoaded', async () => {
  let tries = 0;
  while (!(window.SG && 'user' in window.SG) && tries++ < 40) await new Promise(r => setTimeout(r, 100));
  const u = window.SG && window.SG.user;
  if (!u || !u.admin) {
    const p = document.createElement('p');
    p.className = 'reason';
    p.textContent = u
      ? 'This account is not an administrator yet. Ask the site owner to add your email to ADMIN_EMAILS.'
      : 'Sign in or create a free account above. Admin access is granted separately by the site owner.';
    const card = document.createElement('div');
    card.className = 'card';
    card.appendChild(p);
    document.getElementById('admin-gate').replaceChildren(card);
    return;
  }
  document.getElementById('admin-gate').style.display = 'none';
  document.getElementById('admin-body').style.display = '';
  loadAffiliates();
  loadOffers();
  wireOffers();
  wirePrelaunch();
  loadPrelaunch();
  wireTraffic();
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
