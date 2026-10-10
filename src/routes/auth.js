// Auth: email/password (bcryptjs), Bearer token sessions (30-day expiry).
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { db, isPremium } from '../db.js';

export const router = Router();

function publicUser(u) {
  return { id: u.id, email: u.email, premium: isPremium(u), premium_until: u.premium_until || null,
           has_openai_key: !!u.openai_key, admin: isAdmin(u.email) };
}

export function isAdmin(email) {
  const list = (process.env.ADMIN_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  return list.includes((email || '').toLowerCase());
}

export function authMiddleware(req, res, next) {
  req.user = null;
  let token = null;
  const h = req.headers.authorization;
  if (h && h.startsWith('Bearer ')) token = h.slice(7);
  else if (req.cookies && req.cookies.sg_token) token = req.cookies.sg_token;
  if (token) {
    const s = db.prepare(`SELECT s.*, u.* FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token = ? AND s.expires_at > datetime('now')`).get(token);
    if (s) req.user = s;
  }
  next();
}

function newToken(userId) {
  const token = randomBytes(32).toString('hex');
  db.prepare(`INSERT INTO sessions (token, user_id, expires_at)
    VALUES (?, ?, datetime('now', '+30 days'))`).run(token, userId);
  return token;
}

router.post('/register', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'valid email required' });
  if (!password || password.length < 8) return res.status(400).json({ error: 'password must be 8+ characters' });
  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
  if (exists) return res.status(409).json({ error: 'email already registered' });
  const hash = await bcrypt.hash(password, 10);
  const r = db.prepare('INSERT INTO users (email, pass_hash) VALUES (?, ?)').run(email.toLowerCase(), hash);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(r.lastInsertRowid);
  const token = newToken(user.id);
  res.cookie('sg_token', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 30 * 864e5 });
  res.json({ token, user: publicUser(user) });
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get((email || '').toLowerCase());
  if (!user || !(await bcrypt.compare(password || '', user.pass_hash)))
    return res.status(401).json({ error: 'invalid email or password' });
  const token = newToken(user.id);
  res.cookie('sg_token', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 30 * 864e5 });
  res.json({ token, user: publicUser(user) });
});

router.post('/logout', (req, res) => {
  let token = null;
  const h = req.headers.authorization;
  if (h && h.startsWith('Bearer ')) token = h.slice(7);
  else if (req.cookies && req.cookies.sg_token) token = req.cookies.sg_token;
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  res.clearCookie('sg_token');
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'not signed in' });
  res.json({ user: publicUser(req.user) });
});

// Save a per-user OpenAI key (used for Ask the Genius AI mode).
router.post('/openai-key', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'sign in required' });
  const { key } = req.body || {};
  db.prepare('UPDATE users SET openai_key = ? WHERE id = ?').run(key ? String(key).trim() : null, req.user.id);
  res.json({ ok: true, has_openai_key: !!key });
});
