# Deploying The Sports Genius

## Railway (recommended)

```bash
npm install -g @railway/cli
railway login
cd sports-genius
railway init        # create a new project
railway up          # deploy
railway domain      # generate a public domain, e.g. sports-genius.up.railway.app
```

Railway auto-detects Node. Set env vars in the Railway dashboard (project → Variables):

- `OPENAI_API_KEY` (optional — enables AI chat mode)
- `ODDS_API_KEY` (optional — enables live multi-book odds: line shopping on pick cards, spread picks, parlay builder pricing. Free tier at the-odds-api.com = 500 credits/mo ≈ one daily refresh; set `ODDS_REFRESH_HOURS` to tune, default 12)
- `STRIPE_PREMIUM_LINK`, `STRIPE_PORTAL_URL`, `STRIPE_LIVE=1` (when ready for real payments)
- `ADMIN_EMAILS` — your email, so you can reach `/admin`

**SQLite note:** the app stores users/picks/clicks in `./data/genius.db` on local disk. On Railway, add a **Volume** mounted at `/app/data` and set `DB_PATH=/app/data/genius.db` so the database survives redeploys. (Without a volume, picks history and accounts reset on each deploy.)

## Namecheap DNS → thesportsgenius.com

1. In Railway: project → Settings → Domains → **Add Custom Domain** → enter `thesportsgenius.com` (and `www.thesportsgenius.com`). Railway will show you the target to point DNS at (a CNAME value like `xxxx.up.railway.app`, per Railway's custom-domain docs).
2. In Namecheap: domain → **Advanced DNS**:
   - `CNAME` record, Host `@`, Value = the Railway target
   - `CNAME` record, Host `www`, Value = the Railway target
   - (If Namecheap won't allow CNAME on `@`, use their **ALIAS** record type for `@` pointing at the same target.)
3. Back in Railway, wait for the domain to verify — it provisions a TLS certificate automatically.
4. DNS propagation can take a few minutes to 48 hours; `dig thesportsgenius.com` to check.

## Post-deploy checklist

- [ ] Open the site, check the ticker + picks load (picks generate on first visit each day)
- [ ] Register an account with your `ADMIN_EMAILS` email → visit `/admin`
- [ ] Paste your real sportsbook affiliate URLs in `/admin` (see README — apply to affiliate programs first)
- [ ] Create the $8/mo Stripe product + payment link, paste into Railway vars, set `STRIPE_LIVE=1`
- [ ] Add the 6 stadium backgrounds to `public/bg/` (bg-nfl.jpg, bg-nba.jpg, bg-mlb.jpg, bg-soccer.jpg, bg-hockey.jpg, bg-tennis.jpg) if not already deployed
- [ ] Test on your phone: chat quota (5/day free), favorites, Best Bets after granting yourself Premium
