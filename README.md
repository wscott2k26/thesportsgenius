# The Sports Genius 🧠

AI sports predictions + talk site. Dark glassmorphism, gold accents, rotating stadium backgrounds.

**Live data:** NFL, NBA, MLB, NHL, and College Football via ESPN's public JSON endpoints (server-side cached: scoreboards 60s, standings 10min, teams 24h; serves stale with a visible "delayed" flag on upstream failure).

## The picks model — honest statement

The "Genius" is a **transparent heuristic, not machine learning**. For each pre-game matchup today it computes:

- **Win %** parsed from each team's real record string (e.g. `11-4` → .733)
- **Home edge** per league (NFL +0.06, NBA +0.05, MLB +0.03, NHL +0.04, NCAAF +0.05)
- **Streak bonus** (±0.005 per game, capped at 4) from standings data

Output: moneyline winner + confidence clamped to 52–85 + a one-line reasoning that cites **only real numbers**. It never invents spreads, totals, odds, or stats — if a number is missing, it's omitted from the reasoning.

Picks generate once per day (persisted in SQLite), auto-grade win/loss when games go final, and the track-record badge shows the **real** last-30-day win rate — or "Calibrating — building track record" until 5+ picks are graded. Never a fake number.

## v2 — live odds, spreads, parlay builder, bet tracker, offers wall

- **Live odds / line shopping** (`src/providers/odds.js`, The Odds API): every pick card shows per-book moneyline prices for the picked side with a **BEST LINE** badge, exactly like the approved mockup. `ODDS_API_KEY` env-gated; server-side cached (`ODDS_REFRESH_HOURS`, default 12 — the free tier's 500 credits/mo ≈ one daily refresh of 5 leagues × 3 markets). No key → graceful "lines unavailable" fallback. Each book's **BET NOW** button deep-links to the admin-configured affiliate URL for that book (matched by name), and clicks are tracked in the existing `affiliate_clicks` table.
- **Spread picks**: issued only when the moneyline model is strong (≥62% confidence) **and** a real market spread exists — the line is the market's best number for the picked side, never invented (confidence capped 52–66). Spread picks auto-grade win/loss/**push** against the final score + stored line. The model does not project scores, so it issues **no total picks** — totals appear for line shopping and parlays only. This is stated honestly in the UI.
- **Parlay builder** (`/parlay`): 2–6 legs from live lines (one leg per game keeps the math honest), risk profiles (Conservative = Genius favorites, Balanced = mix, Moonshot = long shots) with auto-build, combined odds computed straight from each leg's line per book, best-odds book highlighted with affiliate BET NOW, and a copy-to-clipboard shareable slip.
- **Bet tracker** (`/tracker`, sign-in required): log bets (date, matchup, type, selection, book, stake, American odds), grade win/loss/push, dashboard shows record, ROI %, units (1u = $100), net profit, total staked.
- **Promo offers wall** (`/offers`): admin-managed bonus offers (`/admin` → "Promo offers wall": book, title, terms, promo code, link via an existing affiliate for click-tracked CTAs or a direct URL, priority, enabled). Styled like the approved mockup.
- 21+ and **1-800-GAMBLER** responsible-gambling disclaimers on every betting surface; honest track-record logic unchanged.

## Ask the Genius

POST `/api/chat`. With `OPENAI_API_KEY` (server env) or a per-user key saved in settings, it calls `gpt-4o-mini` with live scores, standings, and today's picks injected into the system prompt (instructed to never invent stats). Without a key, a rule-based fallback answers strictly from real ESPN data, prefixed "Here's what the data says:". Free tier: 5 chats/day. **For entertainment. Not gambling advice.**

## Accounts & Premium

- Guest browsing + email/password accounts (bcryptjs), Bearer-token sessions (30 days)
- **Premium: $8/mo, 7-day free trial.** Unlocks: all 5 leagues' picks (free gets NFL + NBA), **Genius Best Bets** (top-3 highest-confidence picks), unlimited Genius chat, no ads
- Free tier: 5 chats/day, picks for 2 leagues
- Stripe via Payment Links (env-gated): `STRIPE_PREMIUM_LINK`, `STRIPE_PORTAL_URL`, `STRIPE_LIVE=1` for live mode — a **TEST MODE** badge shows in the nav until live. After payment, an admin grants Premium at `/admin` (emails in `ADMIN_EMAILS`)
- **My Teams** page: follow teams, see their games today + the Genius pick when they play

## Affiliate monetization (sportsbook partner links)

Admins (emails in `ADMIN_EMAILS`) manage sportsbook links at `/admin`:

1. **Apply to each sportsbook's affiliate program yourself** — DraftKings, FanDuel, BetMGM, etc. all run their own affiliate/partner programs with an application + approval step. This is on you, Will.
2. Once approved, they give you a **tracking URL**. Paste it into the admin settings page (`/admin` → "Sportsbook affiliate links"): name, affiliate URL, bonus/promo text, priority order, enabled flag.
3. Links render next to every pick card as **"Bet this at [Sportsbook]"** buttons and in the **"Sportsbook offers"** homepage section — every one carries a **"Partner link"** badge.
4. Outbound clicks are tracked in SQLite (`affiliate_clicks`: timestamp, sportsbook, pick_id, user_id nullable); view counts per sportsbook + recent clicks at `/admin`.

Until you paste real URLs, **do not add placeholder links** — the section stays hidden when no affiliates are configured.

## Compliance

- **21+** badge in the site header and footer
- **"Gambling problem? Call or text 1-800-GAMBLER"** in the footer of every page
- **"For entertainment. Not gambling advice."** next to picks and chat
- Picks are moneyline winners only — never spreads/totals/odds

## Run it

```bash
cd sports-genius
npm install
cp .env.example .env   # fill in values
npm start              # http://localhost:3000
npm test               # 51 tests, all green
```

## Env vars

| Var | Purpose |
|---|---|
| `PORT` | default 3000 |
| `DB_PATH` | default `./data/genius.db` (`:memory:` for tests) |
| `OPENAI_API_KEY` | server-wide key for Ask the Genius AI mode (optional; per-user keys also supported) |
| `STRIPE_PREMIUM_LINK` | $8/mo payment link |
| `STRIPE_PORTAL_URL` | customer portal link |
| `STRIPE_LIVE` | `1` = live mode; anything else shows the TEST MODE badge |
| `ADMIN_EMAILS` | comma-separated admin emails (affiliate settings, Premium grants) |

## Honest limits

- ESPN endpoints are unofficial and can change/rate-limit without notice; the app degrades to cached data with a "delayed" flag rather than failing silently
- The picks model is a simple heuristic — the track record badge exists so the numbers speak for themselves
- No live odds/spreads/totals anywhere (by design — we only predict winners)
- Background photos (`public/bg/*.jpg`) are generated separately; the rotation skips any missing file gracefully
