# Shared Survivor Engine V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a correct, accessible, free-to-play NFL Survivor pilot that Jay can run with friends, using one isolated service and one authoritative set of game records shared by The Sports Genius and a future standalone destination.

**Architecture:** Create a new Node.js/Express 5 service with PostgreSQL and centrally hosted Survivor sign-in/game screens. Implement strict, transaction-safe pick deadlines and auditable result settlement. Integrate The Sports Genius only through a reversible navigation/landing link; keep the original site's SQLite, accounts, billing, predictions, scoreboards, team logos, and Josie code untouched.

**Tech Stack:** Node.js 22 ES modules, Express 5, PostgreSQL (pg), bcryptjs, secure server-side sessions, minimal HTML/CSS/vanilla JavaScript, node:test and assert/strict, Railway for an isolated eventual pilot deployment.

**Spec:** docs/superpowers/specs/2026-10-20-survivor-engine-v1-design.md on the separate design/survivor-v1-spec-2026-10-20 review branch of wscott2k26/thesportsgenius.

## Global Constraints

- Do not implement, provision services, incur spending, run new scheduled GitHub Actions, or deploy until Will approves this implementation plan and execution approach.
- Keep the existing The Sports Genius production service, SQLite data, prediction ledger, paid subscriptions, scores, logos, and Josie experience unchanged until explicit integration rollout.
- New code belongs in a separate repository, proposed name wscott2k26/stormandme-survivor-engine. Do not overwrite or transplant existing TSG files.
- NFL only in the first free-to-play pilot; one entry per account per private pool, one chosen team per week, no team reuse.
- Store kickoff and events as UTC; default display zone America/New_York. At or after the effective chosen-game kickoff the pick is forbidden.
- WIN survives; LOSS, TIE and a missing accepted pick after round close eliminate. Postponed/disputed/unknown outcomes stay ON_HOLD.
- The only source of truth is the Survivor PostgreSQL database. No browser-computed grading, no auto-linking users by email to TSG accounts, no copied TSG auth secrets.
- API keys never enter the browser. Accepted picks and grade decisions are immutable audit events; corrections use explicit replay.
- Cash-prize handling stays DISABLED; never create a money pool or route entry money through current Stripe. Partner links require a separate provider agreement, eligibility and legal approval.
- Premium commissioner billing stays DISABLED during the free pilot; only feature-gated, server-enforced entitlements may be implemented.
- Survivor must use a separate Railway workspace with a **$15 compute email alert and $25 compute hard limit for the private pilot**. The hard limit shuts down that workspace, so production requires an explicit revised availability/budget decision.
- No purchased domain, SMS, AI calls, extra persistent staging services, or paid data feeds without additional approval.
- Use TDD on every task; each task has its own test, run-red, minimal implementation, run-green, review and commit cycle.
- Do not merge a TSG integration commit into main before the standalone game is independently healthy and the regression tests are green.
- No prize payouts, sportsbook mechanics, rebuys, multicontest entries, public discovery, or other sports in this plan.

## Review Focus

The following five user-facing failure modes require explicit tests in the owning tasks:

1. **Boundary instant:** a request received exactly at the chosen game's kickoff must fail with GAME_STARTED even if the browser shows an earlier time. Test in Task 6.
2. **Schedule mutation:** a previously valid pick whose game is rescheduled or moved outside the scoring week must not silently eliminate the entry. Test in Tasks 3 and 7.
3. **Concurrent writes:** two simultaneous eligible picks cannot create two active picks or bypass team reuse. Test in Task 6.
4. **Late score correction:** a corrected result after the next round is graded must replay survival deterministically without modifying locked picks. Test in Task 8.
5. **Authorization leakage:** an unverified or unrelated account must not enter a private pool or see concealed selections before reveal; commissioner identity does not grant early pick access. Test in Tasks 2, 5 and 9.

## File and ownership map

Two repositories. Prefix S/ indicates the **new** wscott2k26/stormandme-survivor-engine repository; prefix T/ indicates the **existing** wscott2k26/thesportsgenius repository. These prefixes are explanatory, not literal directory names.

| Responsibility | Exact planned files |
|---|---|
| Server bootstrap, settings, health | S/package.json, S/src/app.js, S/src/server.js, S/src/config.js, S/test/app.test.js |
| Database schema, migrations, transaction helper | S/migrations/001_core.sql, S/src/db/pool.js, S/src/db/migrate.js, S/test/db.test.js, S/test/helpers/test-db.js |
| Auth, session, email verification, CSRF | S/src/auth/routes.js, S/src/auth/service.js, S/src/auth/middleware.js, S/src/notifications/sender.js, S/test/auth.test.js |
| NFL feed and game snapshots | S/src/nfl/tsg-adapter.js, S/src/nfl/sync.js, S/test/nfl-feed.test.js |
| Pure Survivor rules | S/src/core/rules.js, S/test/rules.test.js |
| Pool membership and invite routes | S/src/pools/service.js, S/src/pools/routes.js, S/test/pools.test.js |
| Atomic picks and audit | S/src/picks/service.js, S/src/picks/routes.js, S/test/picks.test.js |
| Round lock and missed-pick worker | S/src/rounds/reconcile.js, S/test/rounds.test.js |
| Grading and correction replay | S/src/results/settle.js, S/src/results/replay.js, S/test/results.test.js |
| Standings/history privacy | S/src/standings/service.js, S/src/standings/routes.js, S/test/standings.test.js |
| Hosted user interface | S/public/index.html, S/public/pool.html, S/public/css/survivor.css, S/public/js/auth.js, S/public/js/pool.js, S/test/ui-contract.test.js |
| Premium flags, invitations and admin | S/src/entitlements/service.js, S/src/admin/routes.js, S/src/notifications/reminders.js, S/test/operations.test.js |
| Ops and pilot | S/Dockerfile, S/railway.json, S/scripts/verify-local.sh, S/docs/pilot-qa.md, S/docs/runbook.md, S/test/release-gates.test.js |
| Reversible Sports Genius entrance | T/public/index.html, T/public/survivor.html, T/src/app.js, T/test/survivor-entry.test.js |

Existing T/src/app.js uses the Express static files and explicit pretty-page route fallback. Existing T/package.json has a node:test command; new T tests follow that convention. Existing public/index.html has navigation and Josie content; add a small Survivor link without disturbing its sections.

Use a dependency-injected clock and database handle to make tests deterministic. Define JS modules with JSDoc type contracts where TypeScript isn't used.

---

### Task 1: Standalone server with persistent schema

**Files:** Create S/package.json, S/src/config.js, S/src/app.js, S/src/server.js, S/migrations/001_core.sql, S/src/db/pool.js, S/src/db/migrate.js, S/test/helpers/test-db.js, S/test/app.test.js, S/test/db.test.js.

**Interfaces:**
- Produces: createApp({ db, clock, sender, nflSource }); createDbPool(connectionString); applyMigrations(db).
- Consumes: environment validation for DATABASE_URL, SESSION_SECRET, public origin and email settings; production startup rejects missing secrets.

- [ ] **Step 1: Write failing server/database tests.** GET /health returns HTTP 200 and {ok:true}; GET /ready fails if DB is unreachable. Running migrations twice leaves exactly the same tables and constraints. Foreign keys and unique (pool_id,user_id) membership constraint work.
- [ ] **Step 2: Run red.** Run `node --test test/app.test.js test/db.test.js`. Expected: imports or missing schema fail.
- [ ] **Step 3: Implement.** Set Node 22, ES modules and npm test script; implement bootstrapping and schema for users, sessions, seasons, weeks, teams, games, pools, memberships, entries, picks, pick_events, result_events, grade_events, audit_events, entitlements and notifications. Separate migrations from server startup. Use foreign keys/unique indexes and a test Postgres database.
- [ ] **Step 4: Run green.** Same test command succeeds. `npm test` also succeeds on empty initial suite.
- [ ] **Step 5: Review and commit** new-repo bootstrap as `feat: initialize standalone survivor data service`.

### Task 2: Independent secure account flow

**Files:** Create S/src/auth/routes.js, S/src/auth/service.js, S/src/auth/middleware.js, S/src/notifications/sender.js, S/test/auth.test.js.

**Interfaces:**
- Produces: registerUser(db,{email,password},sender), verifyEmail(db,token), loginUser(db,{email,password}), requireUser(req,res,next), requireCsrf(req,res,next).
- Session cookie: survivor_sid, Secure/HttpOnly/SameSite=Lax in production, random 256-bit opaque token stored as a hash in PostgreSQL; 30-day expiry and explicit logout revocation.
- Sender contract: send({to,subject,text,kind}) resolves or reports failure. Use a fake sender for tests; production requires a configured actual transactional provider.

- [ ] **Step 1: Write failing tests.** Password hash never equals plaintext, unverified account is rejected by requireVerified, expired/forged session returns 401, logout revokes session, CSRF or bad Origin blocks state-changing requests, password reset token is one use, repeated invalid login is rate limited, public profile excludes private email, and the user can request a basic export/account-deletion workflow with audit retention.
- [ ] **Step 2: Run red.** `node --test test/auth.test.js` must fail.
- [ ] **Step 3: Implement** auth routes under /v1/auth and GET /v1/me, single-use email verification and reset tokens, safe errors, account export/deletion endpoints with documented audit retention and session middleware. Never import TSG auth or localStorage bearer tokens.
- [ ] **Step 4: Run green.** `node --test test/auth.test.js` passes.
- [ ] **Step 5: Review and commit** as `feat: add independent verified survivor accounts`.

### Task 3: Canonical NFL schedule and feed contract

**Files:** Create S/src/nfl/tsg-adapter.js, S/src/nfl/sync.js, S/test/nfl-feed.test.js.

**Interfaces:**
- Produces: loadWeek({season,week}) -> {games,fetchedAt,delayed,source}; normalizeSportsGeniusGame(event) -> {providerGameId,week,homeTeamId,awayTeamId,kickoffUtc,status,homeScore,awayScore,completed,logoUrls}; syncNflWeek(db,source,{season,week}).
- The pilot adapter reads the existing TSG normalized GET /api/scores?league=nfl response. TSG currently exposes leagues.nfl.events with ID, date, week, home/away, status.state and status.completed. Do not assume this current-feed endpoint covers every future or historical week.

- [ ] **Step 1: Write failing tests.** Fake fixture conversion retains stable provider ID, valid kickoff ISO time, team identity and logos; missing week, partial teams, stale data and contradictory final score go into unavailable/review state. A confirmed kickoff reschedule updates the effective time without rewriting old events. Out-of-week postponement produces a persisted POSTPONED_OUT_OF_WEEK game state without fabricating a grade.
- [ ] **Step 2: Run red.** `node --test test/nfl-feed.test.js` fails.
- [ ] **Step 3: Implement** read-only fetch adapter with timeout, caching, normalized persistence and exact source/revision stamps; no direct modifications to TSG. Validate actual league-week coverage and legal/terms suitability before a public feed commitment.
- [ ] **Step 4: Run green.** `node --test test/nfl-feed.test.js` passes; a manual read-only integration check reports feed coverage without mutating production.
- [ ] **Step 5: Review and commit** as `feat: ingest versioned nfl schedule snapshots`.

### Task 4: Pure Survivor rules

**Files:** Create S/src/core/rules.js and S/test/rules.test.js.

**Interfaces:**
- Produces: validateSelection({entry,teamId,game,usedTeamIds,nowUtc}) -> {allowed,code,lockAtUtc}; evaluateOutcome({game,pickedTeamId}) -> 'WIN'|'LOSS'|'TIE'|'PENDING'; calculateRoundClose(games) -> ISO UTC instant.
- Allowed states: ALIVE, ELIMINATED, ON_HOLD, WINNER, CO_WINNER, NO_SURVIVOR.

- [ ] **Step 1: Write failing tests.** Used team, bye and missing game rejected; a choice before kickoff accepted; tie eliminated; canceled and nonfinal held; round close equals last eligible kickoff; midseason start week is respected; zero or multiple survivors at season end produce correct labels.
- [ ] **Step 2: Run red.** `node --test test/rules.test.js` fails.
- [ ] **Step 3: Implement** deterministic pure functions free of network, database and browser dependencies.
- [ ] **Step 4: Run green.** `node --test test/rules.test.js` passes.
- [ ] **Step 5: Review and commit** as `feat: codify nfl survivor rules`.

### Task 5: Private pools, invites and membership

**Files:** Create S/src/pools/service.js, S/src/pools/routes.js, S/test/pools.test.js.

**Interfaces:**
- Produces: createPool(db,{ownerId,name,season,startWeek,enrollmentCutoffUtc}), joinPool(db,{userId,inviteCode}), getPool(db,{poolId,viewerId}).
- Route contract: POST /v1/pools, POST /v1/pools/:id/join, GET /v1/pools/:id.

- [ ] **Step 1: Write failing tests.** Verified commissioner creates a named private pool; hashed invitation joins exactly once; invalid, revoked or expired invitation is denied; a nonmember cannot inspect a private pool; commissioner can also join as a player; joining after enrollment cutoff fails.
- [ ] **Step 2: Run red.** `node --test test/pools.test.js` fails.
- [ ] **Step 3: Implement** transaction-backed pool and membership operations, 100-entry pilot cap, owner role checks and immutable rules after the first round begins.
- [ ] **Step 4: Run green.** `node --test test/pools.test.js` passes.
- [ ] **Step 5: Review and commit** as `feat: support private survivor pools and invites`.

### Task 6: Atomic accepted picks and immutable change history

**Files:** Create S/src/picks/service.js, S/src/picks/routes.js, S/test/picks.test.js.

**Interfaces:**
- Produces: submitPick(db,{userId,entryId,season,week,teamId,nowUtc,idempotencyKey}) -> {pickId,teamId,acceptedAtUtc,lockAtUtc,version}; getPickHistory(db,{entryId,viewerId}).
- Route contract: PUT /v1/entries/:id/weeks/:week/pick and GET /v1/entries/:id/history.

- [ ] **Step 1: Write failing tests.** Accepted at kickoff minus 1ms, GAME_STARTED at exact kickoff and after; USED_TEAM and ENTRY_ELIMINATED rejected; two simultaneous writes yield at most one final active row; repeated same idempotency key returns same outcome; replacing a pick after its original game's kickoff fails; every accepted change produces an audit event.
- [ ] **Step 2: Run red.** `node --test test/picks.test.js` fails.
- [ ] **Step 3: Implement** server-clock validation and serialized PostgreSQL transaction guarded by entry/round locking and unique constraints; never trust client lock timestamps.
- [ ] **Step 4: Run green.** `node --test test/picks.test.js` passes, including concurrent test.
- [ ] **Step 5: Review and commit** as `feat: submit atomic audited survivor picks`.

### Task 7: Kickoff locking, no-pick elimination and postponements

**Files:** Create S/src/rounds/reconcile.js, S/test/rounds.test.js.

**Interfaces:**
- Produces: reconcileRound(db,{season,week,nowUtc}) -> {lockedCount,missingEliminatedCount,heldCount}; callable by internal bounded timer and admin-safe reconcile command.

- [ ] **Step 1: Write failing tests.** Accepted pick locks at effective kickoff; no-pick entry remains ALIVE before final eligible kickoff and ELIMINATED afterward; a rescheduled game's effective kickoff controls lock; an out-of-week postponement puts the relevant pick ON_HOLD; re-running reconciliation changes nothing; a DB failure commits no partial batch.
- [ ] **Step 2: Run red.** `node --test test/rounds.test.js` fails.
- [ ] **Step 3: Implement** bounded, idempotent round sweeps with database transactions and per-round job-locking. Do not rely on GitHub scheduled workflows.
- [ ] **Step 4: Run green.** `node --test test/rounds.test.js` passes.
- [ ] **Step 5: Review and commit** as `feat: reconcile pick deadlines and missed rounds`.

### Task 8: Final-result grading and correction replay

**Files:** Create S/src/results/settle.js, S/src/results/replay.js, S/test/results.test.js.

**Interfaces:**
- Produces: settleConfirmedGame(db,{gameId,resultRevision}) -> {gradedCount,heldCount}; replayFromRound(db,{poolId,season,week,reason,adminId}) -> {replayedWeeks,changedEntries}.
- Reconcile never overwrites original accepted picks; append grade_events for each change.

- [ ] **Step 1: Write failing tests.** WIN survives, LOSS and TIE eliminate, nonfinal/conflicting result produces ON_HOLD, duplicate result revisions do not double-grade, confirmed correction after a later settled round replays entries consistently, and a commissioner cannot call admin-only replay.
- [ ] **Step 2: Run red.** `node --test test/results.test.js` fails.
- [ ] **Step 3: Implement** finality verification and append-only result event ledger, transaction-safe settlement, replay from earlier stable checkpoint, admin authorization and audit reasons.
- [ ] **Step 4: Run green.** `node --test test/results.test.js` passes; correction replay is deterministic on repeat.
- [ ] **Step 5: Review and commit** as `feat: settle and safely replay survivor results`.

### Task 9: Standings, history and concealed picks

**Files:** Create S/src/standings/service.js, S/src/standings/routes.js, S/test/standings.test.js.

**Interfaces:**
- Produces: listStandings(db,{poolId,viewerId,nowUtc}) and getEntryHistory(db,{entryId,viewerId,nowUtc}).
- Routes: GET /v1/pools/:id/standings, GET /v1/pools/:id/activity and GET /v1/entries/:id/history.

- [ ] **Step 1: Write failing tests.** Standings order and survivor count derive from authoritative settled state, two clients receive byte-equivalent canonical ranking IDs/state, commissioner cannot inspect hidden opponents' picks early, own pick remains visible, post-round reveal works, anonymous access to private standings fails.
- [ ] **Step 2: Run red.** `node --test test/standings.test.js` fails.
- [ ] **Step 3: Implement** read models and privacy-scoped view serializers, without exposing emails or unneeded player profile fields.
- [ ] **Step 4: Run green.** `node --test test/standings.test.js` passes.
- [ ] **Step 5: Review and commit** as `feat: expose safe shared survivor standings`.

### Task 10: Hosted free-game experience

**Files:** Create S/public/index.html, S/public/pool.html, S/public/css/survivor.css, S/public/js/auth.js, S/public/js/pool.js, S/test/ui-contract.test.js.

**Interfaces:**
- Hosted routes: /survivor, /survivor/pools/:id and /survivor/login using server's same-origin API/session; branded source query controls only presentation and return links, never privileges.

- [ ] **Step 1: Write failing HTML/API contract tests.** Pages contain reachable sign-in, pool create/join, pick form, current deadline, accepted-pick receipt, standings, visible errors, keyboard focus targets and reduced-motion CSS; user sees no fake acceptance on 409/401/503.
- [ ] **Step 2: Run red.** `node --test test/ui-contract.test.js` fails.
- [ ] **Step 3: Implement** responsive premium-light design, polished NFL matchups and licensed/fallback logos, accessible errors and state transitions; use real API calls only. Keep gameplay browser sessions same-origin with Survivor service.
- [ ] **Step 4: Run green.** `node --test test/ui-contract.test.js` passes; manual mobile and keyboard review required.
- [ ] **Step 5: Review and commit** as `feat: add responsive survivor pilot experience`.

### Task 11: Reminders, commissioner feature flags and moderation

**Files:** Create S/src/notifications/reminders.js, S/src/entitlements/service.js, S/src/admin/routes.js, S/test/operations.test.js.

**Interfaces:**
- Produces: enqueueRoundReminders(db,{poolId,week,nowUtc}), hasCommissionerFeature(db,{userId,feature}), registerAdminCorrection(db,{adminId,gameId,reason}).
- Premium features: custom logo/theme, multiple active pools and expanded reporting under server-verified entitlement flags. Pilot default is free; premium checkout disabled.

- [ ] **Step 1: Write failing tests.** Reminder is opt-in, capped and sent at most once per reminder event; email failure never changes pick legality; fake PREMIUM header/client query cannot unlock paid feature; admin writes require real admin role and reason; partner link flag defaults false and disabled link never appears.
- [ ] **Step 2: Run red.** `node --test test/operations.test.js` fails.
- [ ] **Step 3: Implement** low-volume reminder scheduler, entitlement gates integrated with pool count, branding and extended reports, admin read-only health/status, audit exception entry and partner-disabled UI configuration.
- [ ] **Step 4: Run green.** `node --test test/operations.test.js` passes.
- [ ] **Step 5: Review and commit** as `feat: add safe commissioner flags and operations`.

### Task 12: Reversible The Sports Genius integration

**Files:** Modify T/public/index.html and T/src/app.js; create T/public/survivor.html and T/test/survivor-entry.test.js. Do not modify T/src/db.js, T/src/routes/auth.js, T/src/billing.js, T/src/providers/espn.js, T/public/josie.html or T/public/css/josie.css.

**Interfaces:**
- A visible Survivor navigation item plus /survivor landing page. The page uses SURVIVOR_PUBLIC_URL only as an allowlisted absolute HTTPS destination for central hosted gameplay; no user token or TSG cookie copied.
- Rollback: hide the link/route with a feature flag or revert the single integration commit. Existing app keeps serving every original route.

- [ ] **Step 1: Write failing regression test.** /survivor navigation and landing have a valid allowed outbound destination; no unsafe arbitrary redirect; /scores, /josie and /api/health are still present and existing test suite passes. TSG sign-in and billing code remain textually unchanged.
- [ ] **Step 2: Run red.** In TSG repo run `npm test`; new test fails before integration.
- [ ] **Step 3: Implement** new nav entry, a small landing page and explicit route fallback in T/src/app.js. Preserve old HTML sections, image links and styles.
- [ ] **Step 4: Run green.** `npm test` passes. Verify rendering at desktop and mobile widths; compare baseline screenshots for navigation, scores and Josie.
- [ ] **Step 5: Review and commit** to a separate TSG integration branch as `feat: add reversible survivor entry point`. Do not merge or deploy before Task 13 gates.

### Task 13: Verification, hosting preparation and Jay's pilot release gate

**Files:** Create S/Dockerfile, S/railway.json, S/scripts/verify-local.sh, S/docs/pilot-qa.md, S/docs/runbook.md, S/test/release-gates.test.js.

**Interfaces:**
- Health endpoints /health and /ready remain read-only. One approved deployment target in a dedicated Survivor Railway workspace. No provisioned resources until execution approval and separate budget preflight.

- [ ] **Step 1: Write failing release-gates tests.** All mandatory environment variables validated, paid-contest links disabled, premium checkout disabled, health/ready accurate, secrets absent from API responses, unapproved origin rejected and database unavailability shown safely.
- [ ] **Step 2: Run red.** `node --test test/release-gates.test.js` fails.
- [ ] **Step 3: Implement** lean Docker image and process restart policy, local verification script, non-secret config template, incident/runbook and migration/backup strategy. Prepare resource limit recommendations from measured staging metrics; no always-on extra replica.
- [ ] **Step 4: Run green.** In new repo run `npm test` and `sh scripts/verify-local.sh`; in TSG run `npm test`. Both succeed, with no production site mutation.
- [ ] **Step 5: Complete manual pilot checklist.** Obtain Will's explicit deployment/spend authorization; provision only the isolated workspace; configure $15 soft alert and $25 compute hard stop **before** nontrivial workloads; turn on native backups plus export and perform restore drill; simulate an NFL week with Jay and several accounts; verify both entry points, win/loss/tie/no-pick/correction, mobile behavior, audit trail and no TSG regressions; monitor costs for one week.
- [ ] **Step 6: Review and commit** as `docs: certify survivor pilot gates and recovery`. Keep cash-contest feature off and public signups off until separate approval.

## Delivery sequence and stop conditions

1. **Build under review:** Tasks 1–9 deliver tested backend gameplay; no production changes.
2. **Closed alpha:** Tasks 10–11 deliver playable, responsive private test flow with premium/payment flags off.
3. **Integration candidate:** Task 12 only after independent service works; stage on a feature branch, not TSG main.
4. **Private Jay pilot:** Task 13 after explicit spending/deployment authorization; no live-prize contests.
5. **Public free launch:** A separate decision after pilot proof, feed coverage review, backup restore, abuse/privacy checks and budget policy revision. The $25 pilot hard stop cannot silently remain in force for public game deadlines.
6. **Commercial expansion:** Premium subscriptions and partner-hosted cash contests require their own small specs/plans, provider review and approvals.

Stop immediately and escalate to Will if an action requires purchasing a domain, raising the Railway spending limit, activating Stripe payments, enabling new billable automation, changing a production database, or weakening a game rule. A failed feed, doubtful settled score or incompatible kickoff is an operational hold, not permission to guess.

## Final handoff requirements

The implementing engineer presents: passing command/test outputs, changed-file summary, before/after Sports Genius regression evidence, verified database backup/restore, isolated-workspace cost screenshot/estimate, completion of Jay's full-week game scenario, open risks and rollback steps.

**Execution remains unapproved.** This implementation plan is for Will's review and selection of how to carry out the work.