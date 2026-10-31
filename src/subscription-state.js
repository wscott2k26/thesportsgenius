// Pure subscription selection: only our configured Stripe price can grant Premium.
// Use the most recent authoritative Stripe state, never event delivery order.
export function selectSportsSubscription(subscriptions, priceId, nowSeconds = Date.now() / 1000) {
  if (!priceId) throw new Error('Missing Sports Genius price ID');
  if (!Array.isArray(subscriptions)) throw new Error('Invalid Stripe subscription inventory');
  const candidates = [];
  for (const sub of subscriptions) {
    if (!sub || !['active', 'trialing'].includes(sub.status)) continue;
    const items = sub.items?.data || [];
    const matching = items.filter(item => item.price?.id === priceId);
    if (!matching.length) continue;
    const end = Math.max(0,
      ...matching.map(item => Number(item.current_period_end) || 0),
      Number(sub.current_period_end) || 0,
      sub.status === 'trialing' ? (Number(sub.trial_end) || 0) : 0
    );
    if (!Number.isFinite(end) || end <= nowSeconds) continue;
    candidates.push({ id: sub.id, premiumUntil: new Date(end * 1000).toISOString(), end });
  }
  candidates.sort((a, b) => b.end - a.end);
  return candidates.length ? { id: candidates[0].id, premiumUntil: candidates[0].premiumUntil } :
    { id: null, premiumUntil: null };
}
