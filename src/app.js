// The Sports Genius â€” express app (no listener; see index.js).
import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import { router as authRouter, authMiddleware } from './routes/auth.js';
import { router as apiRouter } from './routes/api.js';
import { billingRouter,stripeWebhookRouter } from './billing.js';
import { pushRouter } from './push.js';
import {growthRouter,growthApiRouter} from './growth.js';

export const app = express();
// Consolidate duplicate public hosts for Google while preserving POST/webhook routing.
app.use((req,res,next)=>{
 const hostname=String(req.headers.host||'').split(':')[0].toLowerCase();
 if((req.method==='GET'||req.method==='HEAD')&&hostname==='www.thesportsgenius.com'){
  return res.redirect(308,'https://thesportsgenius.com'+req.originalUrl);
 }
 next();
});


app.use('/api',stripeWebhookRouter);
app.use(express.json({ limit: '256kb' }));
app.use(cookieParser());
app.use(authMiddleware);
app.use('/api',billingRouter);

app.use('/api/auth', authRouter);
app.use('/api', apiRouter);
app.use('/api', pushRouter);
app.use('/api',growthApiRouter);
app.use('/',growthRouter);

// Browsers and crawlers requesting the legacy favicon path get our branded SVG.
app.get('/favicon.ico', (req,res) => res.redirect(308, '/favicon.svg'));

// Static frontend
const pub = path.join(process.cwd(), 'public');
app.use(express.static(pub, { extensions: ['html'] }));

// SPA-ish fallbacks for pretty page URLs
for (const p of ['/scores', '/chat', '/teams', '/admin', '/offers', '/parlay', '/tracker', '/alerts', '/splits', '/history', '/photo-credits', '/game', '/josie']) {
  app.get(p, (req, res) => res.sendFile(path.join(pub, `${p.slice(1)}.html`)));
}

export default app;
