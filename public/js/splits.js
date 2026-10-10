/* Betting splits: % of bets vs % of handle. Honest feed only — if no data
   provider is wired, the page says so plainly instead of faking numbers. */
import { api, esc, refreshUser, fmtTime } from './app.js';

function splitBar(label, bets, handle) {
  const b = Math.max(0, Math.min(100, Number(bets) || 0));
  const h = Math.max(0, Math.min(100, Number(handle) || 0));
  return `<div class="split-row">
    <span class="split-label">${esc(label)}</span>
    <div class="split-bars">
      <div class="split-bar"><i style="width:${b}%"></i><span>${b}% bets</span></div>
      <div class="split-bar money"><i style="width:${h}%"></i><span>${h}% handle</span></div>
    </div>
  </div>`;
}

function splitCard(g) {
  const mk = g.markets || {};
  const sections = [];
  if (mk.moneyline) sections.push(`<div class="split-sec"><b>Moneyline</b>${splitBar(g.homeTeam, mk.moneyline.home.bets, mk.moneyline.home.handle)}${splitBar(g.awayTeam, mk.moneyline.away.bets, mk.moneyline.away.handle)}</div>`);
  if (mk.spread) sections.push(`<div class="split-sec"><b>Spread</b>${splitBar(g.homeTeam, mk.spread.home.bets, mk.spread.home.handle)}${splitBar(g.awayTeam, mk.spread.away.bets, mk.spread.away.handle)}</div>`);
  if (mk.total) sections.push(`<div class="split-sec"><b>Total</b>${splitBar('Over', mk.total.over.bets, mk.total.over.handle)}${splitBar('Under', mk.total.under.bets, mk.total.under.handle)}</div>`);
  return `<div class="card">
    <div class="league-tag">${esc((g.league || '').toUpperCase())}</div>
    <div class="matchup" style="font-size:22px">${esc(g.awayTeam)} @ ${esc(g.homeTeam)}</div>
    <p class="reason" style="font-size:12.5px">${g.commence ? esc(fmtTime(g.commence)) : ''}</p>
    ${sections.join('') || '<p class="reason">No split markets reported for this game.</p>'}
  </div>`;
}

async function load() {
  const feed = document.getElementById('splits-feed');
  try {
    const { data } = await api('/api/splits');
    if (!data.available) {
      feed.innerHTML = `<div class="card">
        <div class="league-tag">STATUS</div>
        <div class="matchup" style="font-size:24px">Splits feed coming soon</div>
        <p class="reason">${esc(data.note || 'Public betting splits are not available yet.')}</p>
        <p class="reason">What you'll see here when the feed lands: per-game <b>% of bets vs % of handle</b> bars for moneyline, spread, and totals — the same sharp-money view the big sites charge for. We researched every available data source and found no honest free feed, so we're holding this slot open rather than showing you made-up numbers. Fake social proof would poison the one thing this site runs on: trust.</p>
        <p class="reason" style="font-size:12.5px">Meanwhile, real line movement is already live on the <a href="/alerts" style="color:var(--gold)">Alerts</a> page — that's market truth you can verify at any book.</p>
      </div>`;
      return;
    }
    if (!data.splits.length) {
      feed.innerHTML = '<div class="card"><p class="reason">No games with reported splits right now.</p></div>';
      return;
    }
    feed.innerHTML = `<div class="grid">${data.splits.map(splitCard).join('')}</div>`;
  } catch {
    feed.innerHTML = '<div class="card"><p class="reason">Could not load splits right now. Try refreshing.</p></div>';
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  await refreshUser();
  load();
});
