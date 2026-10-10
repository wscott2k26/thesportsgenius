# Sports Genius launch checklist (design unchanged)

- All original public HTML/CSS/JS/background photos are preserved byte-for-byte.
- This upload deliberately excludes the original `.env` and `data/genius.db`.
- ROTATE the previously exposed Odds API key before deploying; configure the replacement only inside Railway Variables (`ODDS_API_KEY`).
- Connect a private GitHub repository to Railway; never commit `.env` or user data.
- Create Railway service using this repo and attach persistent volume mounted to `/app/data`.
- Configure `DB_PATH=/app/data/genius.db`, `NODE_ENV=production`, and optional `OPENAI_API_KEY`, `ADMIN_EMAILS` and `ODDS_API_KEY` in Railway.
- Make sure the volume is mounted before you let users sign up.
- Add custom domains in Railway then set Namecheap DNS using the specific records Railway supplies.
- Test `/api/health`, picks, login/logout, admin access, mobile display and score fetch on deployed URL.
- Keep `STRIPE_LIVE` disabled until payment verification and entitlement provisioning are implemented and tested.
- Verify applicable affiliate rules, state jurisdiction requirements and sports-data licensing before monetization.
- The earlier local `npm ci` could not complete in this restricted environment; automated test results are not validated.
