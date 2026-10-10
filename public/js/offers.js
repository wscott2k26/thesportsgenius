/* Sportsbook offers wall: admin-managed bonus offers with partner CTAs. */
import { api, esc, trackAffiliate } from './app.js';

async function load() {
  const grid = document.getElementById('offers-grid');
  try {
    const { data } = await api('/api/offers');
    const offers = data.offers || [];
    if (!offers.length) {
      grid.innerHTML = '<div class="card"><p class="reason">No offers live right now — check back soon.</p></div>';
      return;
    }
    grid.innerHTML = offers.map(o => `
      <div class="card offer-card">
        <div class="league-tag">${esc(o.book_name)}</div>
        <div class="matchup" style="font-size:24px;line-height:1.25">${esc(o.title)}</div>
        ${o.promo_code ? `<div><span class="promo-code">CODE: ${esc(o.promo_code)}</span></div>` : ''}
        ${o.terms ? `<p class="terms">${esc(o.terms)}</p>` : ''}
        ${o.url
          ? `<button class="btn-gold offer-claim" style="width:100%" data-book="${esc(o.book_name)}" data-url="${esc(o.url)}">CLAIM NOW <span class="partner-badge">Partner link</span></button>`
          : `<p class="terms">Ask support for the claim link.</p>`}
      </div>`).join('');
    grid.querySelectorAll('.offer-claim').forEach(b => b.onclick = () =>
      trackAffiliate(b.dataset.book, null, b.dataset.url));
  } catch {
    grid.innerHTML = '<div class="card"><p class="reason">Could not load offers right now.</p></div>';
  }
}

document.addEventListener('DOMContentLoaded', load);
