# Survivor Engine V1 — Product and Technical Design

**Project:** Storm And Me Survivor  
**Document date:** October 20, 2026  
**Status:** Written design awaiting Will's review and approval. Not authorized for implementation or deployment.  
**Repository destination:** The Sports Genius, documentation-only review branch.  
**Business owner:** Storm And Me LLC

## 1. Product intent

Build one reusable sports Survivor game engine serving two branded entry points: The Sports Genius and a future standalone Survivor destination. Start with NFL, free-to-play private pools, premium commissioner capabilities, and a strictly separated pathway for third-party-hosted real-money contests.

The first measure of success is concrete: Jay creates a Furman Friends pool; friends join, submit valid picks, survive or are eliminated after real NFL games; and both entry points display identical authoritative standings. Players can complete the process from a phone. The existing Sports Genius scoreboard, team logos, live features, subscriber entitlements, and Josie experiences must remain intact.

Cost, account safety, trustworthy scoring, data recoverability, and reliable deadlines take priority over launch speed or feature count.

## 2. Approved boundaries

### Included in the initial free-to-play pilot

- NFL regular-season Survivor with configurable starting NFL week (including a midseason start).
- Player signup and verified email, secure sign-in, one account per person across both Survivor-branded entry points.
- Private pools, commissioner-created invitation links, joining and membership lists.
- One entry per player per pool; one current pick per entry per NFL week.
- Weekly selectable NFL teams, no team reuse by the same entry throughout its pool season.
- Deadline enforcement on the server, elimination logic, results ingestion, idempotent automated grading, standings, and history.
- Clear commissioner tools for invitations, membership, configuration, and audited exceptional result decisions.
- Responsive pick, pool, results, and standings screens. Both brands consume the same game records.
- Capped transactional email reminders, pool links and sharing; public pools are not required for the initial pilot.
- Database backup, restore validation, logs, monitoring, rate limiting, and basic abuse handling.

### Premium commissioner capability

Premium entitlements can unlock custom logos and visual themes, multiple active pools, additional commissioner reporting, and analytics. Basic pool naming remains free. Feature flags and server-side entitlement checks will exist in V1's design. Charging real users and selecting final prices are gated until the free pilot is proven. Premium does not change the odds, team-selection rules, deadlines, or eliminations.

The existing Sports Genius Premium plan is not silently converted into a Survivor Premium entitlement, and the reverse is also true.

### Cash-prize contest pathway

A separate, optional "partner-hosted cash contest" link may later direct an eligible adult to an approved provider. The provider—not Storm And Me—must own applicable eligibility checks, KYC, entry payment, rules, adjudication, prize funds, and payouts. No money pool, prize ledger, entrant fee, wallet, money balance, or payouts live in the Survivor engine.

This feature remains disabled until a real provider agreement and legal/compliance review expressly authorize the destination, target jurisdictions, marketing language, and referral arrangement. Do not reuse existing Stripe checkout for paid entries. The partner name/API and a commercial arrangement are not assumed to exist.

### Not in V1

NCAA, NBA or MLB gameplay; public cash payouts; rebuys; multiple picks per round; syndication to outside websites; mobile native apps; AI game prediction; chat rooms; wagering, sportsbook mechanics, or automated contestant money distribution.

## 3. User roles and journey

**Player:** Registers and verifies email; follows commissioner invite; joins exactly once; views eligible team matchups with recognizable names and logos; picks a team; receives confirmation and clear deadline; sees own pick, survival status, and later historical results.

**Commissioner:** Creates a pool; sets a title, league season and starting week; selects invite-only status; sends invite URL; may participate as a player; tracks membership and read-only pick audit status; cannot silently alter already locked picks.

**Platform administrator:** Manages quarantined schedules/results, restarts failed grading jobs safely, views audit events, enforces abuse controls, and may apply an explained result correction. This is a distinct role from commissioner.

**Visitor:** Can see marketing and a non-sensitive preview; may view public read-only standings when a pool permits them; otherwise must authenticate to access a private pool.

Default pilot limit: up to 100 entries per pool and one entry per account per pool. This is a capacity guardrail, not a priced tier; revise after load testing.

## 4. Canonical NFL Survivor rules

1. A pool belongs to one NFL season and contains an explicitly configured start week through final eligible regular-season week.
2. A player may join until the commissioner's pool enrollment cutoff, set no later than the opening kickoff of the pool's first round.
3. Each surviving entry chooses exactly one participating NFL team per active week. A team must have a scheduled eligible game in that week and cannot be a bye-week team.
4. Once a team has been used in an entry's earlier accepted round, it cannot be picked again by that entry in later rounds, even if the old pick lost.
5. A draft selection is not an accepted pick. A pick becomes accepted only when the server commits a verified write transaction and returns confirmation.
6. Accepted picks may be replaced until the newly chosen team's kickoff, provided the replacement team is eligible and its own kickoff has not passed. Each successful replacement is versioned and audited. At the original game's kickoff, the submitted original pick is locked and cannot later be switched.
7. Deadline checks occur on the server against the effective kickoff timestamp, not the device clock. All stored instants are UTC; display times in the player's chosen zone, defaulting to America/New_York.
8. Picks are hidden from other players until the pool round's final eligible kickoff time has passed. Commissioners cannot inspect private picks early.
9. A team graded **WIN** means the entry survives. **LOSS** or **TIE** means the entry is eliminated. A canceled/abandoned/unresolved game is not automatically treated as a loss.
10. An entry with no accepted pick is eliminated after the final eligible kickoff for that week. Until that cutoff the entry may submit a pick for any game not yet started.
11. Entries only change from ALIVE to ELIMINATED on a settled, auditable decision; uncertainty must produce PENDING_REVIEW, not a guess. The final result is taken from an approved result-source adapter and must be settled after confirmation.
12. If one entry remains alive after the relevant round has fully settled, that entry wins. If nobody remains, the pool has NO_SURVIVOR. If multiple remain at the final season week, they are CO_WINNERS. No automatic cash awards are attached.
13. Pool core rules become immutable after the first round begins. Admin overrides require a recorded reason and before/after snapshot; commissioners cannot bypass the server grading rules.

**Rescheduling policy:** Before the selected game actually begins, a material NFL schedule change recomputes the kickoff deadline using a confirmed updated feed. The player is informed when possible. If a game is moved outside its scheduled NFL scoring week, canceled, or remains disputed, mark affected picks ON_HOLD; do not auto-eliminate. A platform administrator can void the affected round for all entries or resolve using a verified official decision, with a visible audit record. A disputed feed never advances survivors silently.

**Correction policy:** Record the version of every result and event used for grading; a later confirmed correction initiates a controlled replay of affected decisions from the relevant round onward. Never mutate a locked pick to make a correction pass.

## 5. Service architecture

**Chosen approach:** Independent Node.js/Express Survivor API and worker, backed by its own PostgreSQL instance on Railway in a separate billing workspace. The two brand experiences are clients of the same authenticated REST API.

- **Survivor core:** Rules, picks, round lifecycle, elimination and audit modules. Business logic contains no HTML/CSS assumptions.
- **Authentication:** Independent Survivor identity and email verification. Do not copy The Sports Genius password hashes or silently link existing accounts solely by matching email. Central hosted sign-in and callback flow with secure session handling serves both branded entry points.
- **NFL provider adapter:** Ingests team metadata, season schedule, kickoff revisions and final scores from a configurable sports feed. The current Sports Genius feed may be explored as a pilot adapter, but it is not deemed an official or contractually reliable settlement source by assumption; feed rights, terms, availability and corrections need verification before public launch.
- **Scoring worker:** Event-driven or low-frequency scheduled reconciliation inside the Survivor service; no hourly GitHub Actions. Jobs are restartable, bounded and idempotent.
- **PostgreSQL:** Authoritative persistent store; dedicated credentials, least privilege, private networking, and recoverable backups.
- **Brand clients:** The Sports Genius adds an unobtrusive Survivor navigation/landing experience and read-only pool previews without altering legacy picks, scoreboard logic or Josie. Both brands link into the same secure hosted Survivor game experience. A later independent domain may host its own full visual shell against the same API without a data migration.
- **Operations:** Separate configuration and deployment environment. No automatic changes to the existing TSG production service.

The pilot can begin at a purpose-specific subdomain rather than buying another domain. Private auth cookies stay scoped to their owning domain; there is no expectation that TSG cookies work across unrelated domains. Browser-facing APIs enforce explicit origin allowlists, authorization and CSRF protections as applicable.

## 6. Core data contracts

Use opaque UUID primary keys, explicit created/updated timestamps, foreign keys and unique constraints.

- **users:** Survivor identity, verified email, display name, password/session provider reference, account state.
- **sessions:** revocable server-side session metadata, expiry, device/session identifier.
- **seasons / weeks:** NFL season year, week number, round availability and settlement state.
- **teams / games:** stable provider mapping, participants, scheduled/effective kickoff UTC, status, final outcome, feed source, last verification.
- **pools:** commissioner, league, season, start week, name, invite token hash, enrollment cutoff, visibility, immutable rules version, status.
- **memberships / entries:** player-to-pool relation, entry status, enrollment time and elimination/winner week.
- **picks:** entry + week unique active pick; team/game reference, accepted time, locked time, grade, outcome version; append-only pick-change history.
- **game_result_events:** provider payload digest, received time, confirmation state, source revision.
- **grade_events / audit_events:** immutable decision transitions, actor, input version, reason, idempotency key, replay reference.
- **entitlements:** commissioner feature set, billing provider customer reference and expiry; no card details stored.
- **notification_log:** delivery attempt, rate limit, suppression preference, provider response reference.
- **partner_destinations:** only approved, feature-flagged partner URLs and compliance metadata; no deposits, payouts or prize balances.

Database-level uniqueness forbids two active entries for a user/pool, duplicate active round picks, and repeated grading side effects. Idempotency keys protect retries. Every request that changes pool state runs in a transaction.

### API surface

Versioned REST endpoints under /v1:

- POST /auth/register, POST /auth/login, POST /auth/logout, GET /me
- POST /pools, GET /pools/:id, POST /pools/:id/join, GET /pools/:id/standings
- GET /pools/:id/weeks/:week/games, PUT /entries/:id/weeks/:week/pick
- GET /entries/:id/history, GET /pools/:id/activity
- GET /health, GET /ready and internal admin-only source/grade/audit endpoints

Inputs are schema validated. Private pool resources are scoped to verified membership; commissioner endpoints require ownership/role checks, not merely a guessed ID. Responses include a machine-readable error code and safe player-facing message for ALREADY_USED, GAME_STARTED, ENTRY_ELIMINATED, UNVERIFIED_ACCOUNT, INVITE_INVALID, FEED_UNAVAILABLE, and PICK_CONFLICT.

## 7. Results, automation and error handling

1. Refresh schedules conservatively, intensifying bounded polling near kickoff and finals.
2. Record data source and revision; hold conflicting or stale game results.
3. At kickoff, lock eligible submitted picks using the authoritative stored kickoff.
4. At round close, mark missed-pick eliminations.
5. Only grade after game status is explicitly confirmed final under the configured source-check policy.
6. Persist an immutable event and change entry status in the same database transaction.
7. Retry safely on service restart; a second run for the same event must be a no-op.
8. Generate standings directly from settled entry state, never from front-end estimates.
9. If source data fails, show last verified information as delayed and leave decisions ungraded until reliable confirmation. Alert the administrator.
10. Reminders are best effort, not a substitute for server deadlines. Failed email does not change a pick's legality.

The core engine owns authoritative round status; neither branded frontend can call grading operations directly.

## 8. Security and privacy

- Enforce TLS, secure HTTP-only session cookies, appropriate SameSite setting, CSRF protection for cookie-authenticated mutations, rate limits and credential lockout.
- Verify signup email and provide a safe password reset path.
- Separate player, commissioner and admin privileges; test horizontal and vertical authorization.
- Never expose credential secrets, provider keys, raw private picks before reveal, or player emails in public standings.
- Collect only data needed for gameplay; provide account deletion and basic export process; preserve legally or operationally necessary audit records under a documented retention policy.
- Maintain audit logs for accepted/updated picks, grade corrections, role changes, and administration.
- Give players clear game rules, a no-purchase-required experience, age/eligibility terms appropriate for free contests, and non-wagering marketing copy. Obtain counsel review before any prize-linked offering.
- Use a minimally privileged database account and private service-to-database connectivity. Avoid copying existing Sports Genius authentication/session secrets.

## 9. Frontend and brand requirements

- Preserve The Sports Genius's existing design and all score/team-logo functionality.
- Reuse accurate NFL team logos where licenses/asset availability permit; provide reliable fallbacks.
- High-quality light/premium responsive cards and compelling football imagery; avoid clutter, maintain readable contrast.
- Main screens: landing and join, pool setup, weekly matchups, pick confirmation, dashboard, standings, history, commissioner settings.
- Show week, opponent, kickoff, used/not-used, lock state and remaining lives clearly; never imply a pick succeeded without backend confirmation.
- Loading, offline, duplicate-submit, stale data, and failure states must have helpful messages.
- Keyboard navigation, screen-reader labels, reduced-motion support, and mobile touch targets are required.
- Josie's missing icon/image is a separate maintenance ticket. Use locally hosted assets and robust fallbacks when fixing it; that change is outside Survivor's launch-critical work and must be visually checked against existing branding.

## 10. Hosting, cost and risk controls

- Provision Survivor in a **separate Railway workspace** so its hard-stop limit does not shut down The Sports Genius.
- Pilot resource cost planning band: approximately $10–$25/month incremental; this is a budget assumption, not a provider quote.
- Target incremental normal usage under $15/month, soft alert at $15, **compute hard limit $25** during the private pilot. Because a hard limit shuts down the workspace's workloads, the cap must be re-reviewed before public pools with real deadlines.
- Begin with one API/worker service replica and one PostgreSQL instance, no paid domain, no SMS, no always-on extra staging stack.
- Use private networking, low-frequency polls, cached game feeds, rate-limited invitations/reminders, and per-service resource limits based on measured peaks.
- Preview/test locally or in a short-lived environment where possible; avoid auto-running GitHub Actions. Do not turn on an external paid provider without separate Will approval.
- Turn on scheduled PostgreSQL backups and test an actual restore. Maintain a small off-workspace logical backup or export for recovery from accidental volume deletion.
- Review measured hosting usage after one week and after every meaningful deployment; change cost limits only with owner's approval.
- Public launch requires an availability/budget policy that does not intentionally cut off players midweek.

References:
- https://docs.railway.com/pricing
- https://docs.railway.com/pricing/cost-control
- https://docs.railway.com/databases/postgresql
- https://docs.railway.com/guides/postgres-backups-restores
- https://stripe.com/legal/restricted-businesses
- https://www.scstatehouse.gov/code/t16c019.php

The legal/financial links are research context, not a conclusion of regulatory approval.

## 11. Delivery milestones and acceptance gates

The 2–4-week pilot target is an engineering estimate contingent on access, test schedule, and feed quality.

**M0 — Specification:** Will reviews and approves this document. No product code, new services or charges before the implementation-plan review and separate execution approval.

**M1 — Domain and API foundation (1–2 days rules, 3–5 days backend):** schema, migrations, auth, invites, pool creation and join. Automated domain tests for all rules.

**M2 — Free game UX (3–5 days):** complete pick-confirmation loop, locked-state messages, read-only standings, mobile and accessibility pass.

**M3 — Grading automation (2–3 days):** reliable schedule/result ingestion, on-time lock, correctness under retries and correction, traceable audit events.

**M4 — Two-brand integration (2–3 days):** TSG navigation and branded links plus a standalone-compatible experience. Compare underlying data by immutable pool/entry ID on both surfaces.

**M5 — Jay pilot and release gate (3–5 days):** simulate a complete NFL week, verify signed-up participants, then exercise with live fixtures. Rollback procedure and tested database restore ready.

**M6 — Premium/partner gating:** premium commissioner entitlements and price/checkout review only after free-game success. Paid contests may remain permanently disabled without a signed provider and legal approvals; that is not a blocker for free launch.

### Non-negotiable acceptance scenarios

1. Invited user creates an account, verifies email, joins a private pool, and sees correct standings.
2. Valid pick accepted before chosen kickoff; pick rejected at or after kickoff even if client clock is wrong.
3. Same team reuse in a later week rejected; a bye team rejected.
4. Two near-simultaneous pick submissions cannot produce two accepted conflicting picks.
5. WIN survives; LOSS/TIE eliminates; missed pick eliminates only after the week's last eligible kickoff.
6. Postponed, canceled, unknown and conflicting results stay pending with no unjustified elimination.
7. A result correction is auditable and deterministically replays downstream survival states.
8. Running scoring twice does not double-grade or duplicate notifications.
9. Privacy: players and commissioners cannot see private picks before the scheduled reveal or other users' private emails.
10. Both brands return the same canonical standings after a shared state change.
11. Sports Genius scores, logos, subscriptions and Josie areas show no regressions.
12. Database restore test succeeds, monitoring shows healthy service, and a full round can be completed without manual database manipulation.

## 12. Rollout, operational controls and rollback

- Phase A: development and simulated data, isolated from live Sports Genius.
- Phase B: private Jay test pool on real schedules, no monetary prize or public marketing promises.
- Phase C: publicly accessible free pools only after successful pilot, documented support procedure, and budget-limit review.
- Phase D: separately approved premium commissioner billing.
- Phase E: independent legal/provider gate for partner cash contests.

The Sports Genius integration is behind a feature flag. A rollback removes the Survivor navigation/entry point without touching existing score or subscriber data. The Survivor backend has backward-compatible migrations, pre-release backups, and a plan to redeploy the last known healthy build. Do not implement automatic destructive database rollback after user picks exist; use restore only after impact review and snapshot.

## 13. Explicit product decisions and later choices

**Locked for design:** independent service; NFL only; shared canonical pools; free game first; optional premium commissioner features; third-party-only paid cash contest redirects; $25 isolated pilot hard limit; Jay pilot first; no added scheduled GitHub Actions.

**Deferred outside free-pilot acceptance:** commercial name for a separate domain; premium pricing and billing provider configuration; exact partner and partner terms; wider sports; public pool discovery; optional external licensed feed procurement. These choices do not require placeholder behavior in the free game—corresponding user-facing features remain disabled until decided.

## 14. Implementation authorization gate

This document describes intent and behavior. It is not a claim that the engine exists or that paid contests are approved. Will must review and explicitly approve this written specification. Only then may a detailed implementation plan be prepared and reviewed, and only after that plan's execution authorization may product code, hosting services, paid subscriptions, public websites or payment links be changed.
