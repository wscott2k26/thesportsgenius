# Sports Genius rollout checklist

## Implemented in this release
- Game Center page via public /game, /api/game allowlisting league+event IDs.
- Official broadcast names from ESPN; watch discovery links are searches, not licensed stream URLs.
- NCAA men's basketball scoreboard, favorites and historical results via ESPN.
- Timestamped pick CSV export from original server-issued timestamps, excludes legacy and owner-attested records.
- Optional browser game-start notifications while My Teams page is open; no background push.
- Mobile breakpoints for Game Center, small navigation, and cards.

## Integrity and limitations
- No audited third-party immutable ledger or external timestamp anchoring. Browser-visible timestamps alone are not independently tamper-evident.
- Model confidence is heuristic, not calibrated probability.
- Availability of betting odds, player props, injuries, or broadcaster details depends on external integrations and varies by league.
- The YouTube button is search/discovery, not a promise of a free official stream.
- NCAA/seasonal leagues may have no scheduled games today.
- Personal game notifications require an authenticated user, browser permission and the My Teams page remaining open.
- Stripe billing must stay in test mode until credentials, compliance, and full purchase/restore flows are verified.
- User-attested 2026-10-08 prelaunch win remains outside the verified live record.

## Validation
- Run JS syntax checks on all changed modules.
- Run local app HTTP smoke tests with isolated database and verify production health and API routes.
- Verify responsive layouts in actual browser and test account sign-in end to end before advertising full production readiness.

## Performance safeguard
- Stadium images now preload current and next only, preserving 25-second transitions without 29 upfront image downloads.
