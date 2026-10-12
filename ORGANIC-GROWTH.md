# Sports Genius — Organic Growth Operations

## Deployed features
- /matchups: real provider-grounded matchup directory for six leagues.
- /matchup/:league/:eventId/:YYYYMMDD: unique SSR HTML page, SportsEvent JSON-LD, score, records, venue and available broadcast listing; no invented picks.
- /sitemap.xml: dynamic sitemap, refreshed with recently scheduled games; /feed.xml: RSS game research.
- /guides and two original explainers on researching matchups and reading betting odds.
- /share-kit: organic post captions with trackable UTM links.
- /saved-games: device-only bookmarks and downloadable calendar reminders.
- Anonymous first-party counters: page views, shares, saves, calendar adds and copied captions by broad source. No visitor IPs, cookies, full referrers, identities. DNT/GPC honored.
- /growth-dashboard.html: private reports; protected /api/growth/summary requires signed-in user whose email is in ADMIN_EMAILS.
- Existing favorites and push reminders at /teams stay unchanged.

## Weekly editorial routine
1. Inspect actual Search Console impressions, clicks and indexing coverage. Do not invent rankings or keyword demand.
2. Choose 3–5 timely, factual games from /matchups. Confirm league, teams, times and source data freshness.
3. Add editorial context only when independently supported: travel/rest, performance against comparable opposition, verified injury status. Label editorial opinions and forecasts separately from actual scores.
4. Check unique titles, dated sources, canonical URLs, internal links and accessibility on a phone.
5. Publish short factual sports clips to sports-relevant TikTok, Instagram Reels, Facebook and YouTube Shorts audiences. Copy links with UTM tags from /share-kit or matchup Share buttons.
6. Offer the existing favorite-team reminders and browser bookmarks for return visits. Do not spam.
7. Review Search Console, anonymous growth metrics and relevant conversions weekly; refine topics based on measured performance.

## Release and SEO gates
- Sitemap discovery does not guarantee Google indexing. Track status in the free Search Console.
- Server-rendered event pages exist only for actual game IDs. Recent historical games resolve for up to 90 days, when supplied by the source.
- All public data from ESPN may be delayed or unavailable; only display verified source facts, never guaranteed wins or free streaming.
- Run DB_PATH=:memory: node --test test/*.test.js, JavaScript syntax checks, and live HTTP smoke tests on /matchups, /sitemap.xml, /guides, a known matchup, /api/health and /api/billing.
- Keep Sports Genius Premium, Stripe code and production Stripe variables unchanged.
- Built-in counters are not Google Analytics 4. GA4 requires a genuine Measurement ID and privacy review; do not invent a GA4 property or claim it is active.
- Paid sportsbook ads/affiliate campaigns need platform-policy, legal and jurisdiction review. Content is informational; 21+, 1-800-GAMBLER.
