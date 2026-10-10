// The Sports Genius — express app (no listener; see index.js).
import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import { router as authRouter, authMiddleware } from './routes/auth.js';
import { router as apiRouter } from './routes/api.js';

export const app = express();

app.use(express.json({ limit: '256kb' }));
app.use(cookieParser());
app.use(authMiddleware);

app.use('/api/auth', authRouter);
app.use('/api', apiRouter);

// Static frontend
const pub = path.join(process.cwd(), 'public');
app.use(express.static(pub, { extensions: ['html'] }));

// SPA-ish fallbacks for pretty page URLs
for (const p of ['/scores', '/chat', '/teams', '/admin', '/offers', '/parlay', '/tracker', '/alerts', '/splits', '/history', '/photo-credits', '/game']) {
  app.get(p, (req, res) => res.sendFile(path.join(pub, `${p.slice(1)}.html`)));
}

export default app;
