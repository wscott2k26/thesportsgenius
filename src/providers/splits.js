// Public betting splits ("% of bets vs % of handle", Covers-style).
//
// RESEARCH VERDICT (Oct 10, 2026): no free or cheap reliable splits feed
// exists. The Odds API has no splits endpoint (verified against their v4
// docs); DraftKings publishes trends only on its own network site (scraping
// would be unreliable and a ToS risk); Action Network's API is partner-only.
// We therefore ship the UI plus a clean provider abstraction with an honest
// "splits unavailable" fallback. We NEVER fabricate, simulate, or hardcode
// splits data — fake social proof would destroy the product's trust asset.
//
// When a real feed is contracted, call registerSplitsProvider(async (league)
// => ({ available: true, league, splits: [...], fetchedAt })) and every
// consumer lights up. Split shape:
//   { gameKey, homeTeam, awayTeam, commence, markets: {
//       moneyline: { home: { bets, handle }, away: { bets, handle } },
//       spread:    { home: { bets, handle }, away: { bets, handle } },
//       total:     { over: { bets, handle }, under: { bets, handle } } } } }
// bets/handle are 0-100 percentages.

let provider = null;

export function registerSplitsProvider(fn) {
  if (fn != null && typeof fn !== 'function') throw new Error('bad_provider');
  provider = fn || null;
}

export function splitsAvailable() {
  return !!provider;
}

export const SPLITS_UNAVAILABLE_NOTE =
  'Public betting splits are not available yet — we are evaluating data providers. ' +
  'We will never show fabricated splits.';

export async function getSplits(league) {
  if (!provider) return { available: false, league, splits: [], note: SPLITS_UNAVAILABLE_NOTE };
  try {
    const out = await provider(league);
    if (!out || !Array.isArray(out.splits)) throw new Error('bad_splits_shape');
    return { available: true, league, splits: out.splits, fetchedAt: out.fetchedAt || null };
  } catch (err) {
    return { available: false, league, splits: [], error: String((err && err.message) || err), note: SPLITS_UNAVAILABLE_NOTE };
  }
}
