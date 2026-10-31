// Auth: email/password (bcryptjs), Bearer token sessions (30-day expiry).
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { randomBytes, createHash } from 'node:crypto';
import { db, isPremium } from '../db.js';

export const router = Router();

// Verification is mandatory in production; isolated existing tests keep their
// current behavior unless they explicitly opt in to verification.
export const verificationRequired = () => process.env.NODE_ENV === 'production' ||
  process.env.EMAIL_VERIFICATION_REQUIRED === '1';
const verificationMailConfigured = () => !!(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
const verificationBase = () => (process.env.PUBLIC_BASE_URL || 'https://thesportsgenius.com').replace(/\/+$/, '');
for (const [column, type] of [
  ['email_verified_at', 'TEXT'],
  ['verification_token_hash', 'TEXT'],
  ['verification_expires_at', 'TEXT'],
  ['verification_sent_at', 'TEXT']
]) {
  const columns = db.prepare('PRAGMA table_info(users)').all().map(x => x.name);
  if (!columns.includes(column)) db.exec('ALTER TABLE users ADD COLUMN ' + column + ' ' + type);
}

async function sendVerification(user) {
  if (!verificationMailConfigured()) throw new Error('email provider not configured');
  const last = Date.parse(user.verification_sent_at || '') || 0;
  if (Date.now() - last < 60000) return false; // 60-second resend cooldown
  const token = randomBytes(32).toString('hex');
  const hash = createHash('sha256').update(token).digest('hex');
  const expires = new Date(Date.now() + 30 * 60000).toISOString();
  const sent = new Date().toISOString();
  db.prepare('UPDATE users SET verification_token_hash=?, verification_expires_at=?, verification_sent_at=? WHERE id=? AND email_verified_at IS NULL')
    .run(hash, expires, sent, user.id);
  const link = verificationBase() + '/api/auth/verify-email?uid=' + encodeURIComponent(user.id) + '&token=' + token;
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM, to: [user.email],
      subject: 'Verify your Sports Genius account',
      text: 'Verify your email address to activate your Sports Genius account. This link expires in 30 minutes:\n' + link +
        '\n\nIf you did not request an account, you can ignore this message.'
    }),
    signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) throw new Error('verification email could not be sent');
  return true;
}

router.get('/verify-email', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.set('Referrer-Policy', 'no-referrer');
  const id = Number(req.query.uid);
  const token = String(req.query.token || '');
  if (!Number.isSafeInteger(id) || id <= 0 || !/^[a-f0-9]{64}$/.test(token))
    return res.status(400).type('html').send('<p>Invalid verification link. Sign in to request another one.</p>');
  const hash = createHash('sha256').update(token).digest('hex');
  const changed = db.prepare(
    'UPDATE users SET email_verified_at=?, verification_token_hash=NULL, verification_expires_at=NULL WHERE id=? AND email_verified_at IS NULL AND verification_token_hash=? AND verification_expires_at>?'
  ).run(new Date().toISOString(), id, hash, new Date().toISOString());
  if (changed.changes !== 1)
    return res.status(400).type('html').send('<p>Verification link expired or already used. Sign in to request another one.</p>');
  return res.type('html').send('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Email verified</title></head><body style="font:18px system-ui;max-width:560px;margin:12vh auto;padding:24px;background:#0a0c10;color:#fff"><h1>Email verified!</h1><p>Your Sports Genius account is ready. Sign in to continue.</p><a style="color:#e8c57c" href="/">Return to Sports Genius</a></body></html>');
});

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
    if (s && (!verificationRequired() || s.email_verified_at)) req.user = s;
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
  const { password } = req.body || {};
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'valid email required' });
  if (!password || password.length < 8) return res.status(400).json({ error: 'password must be 8+ characters' });
  if (verificationRequired() && !verificationMailConfigured()) return res.status(503).json({ error: 'Account verification is temporarily unavailable. Please try again later.' });
  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
  if (exists) return res.status(409).json({ error: 'email already registered' });
  const hash = await bcrypt.hash(password, 10);
  const r = db.prepare('INSERT INTO users (email, pass_hash) VALUES (?, ?)').run(email.toLowerCase(), hash);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(r.lastInsertRowid);
  if (verificationRequired()) {
    try {
      await sendVerification(user);
      return res.status(202).json({ verification_required: true, message: 'Check your email to verify your account, then sign in.' });
    } catch {
      return res.status(503).json({ verification_required: true, error: 'Verification email is temporarily unavailable. Your account was created; try signing in later to resend.' });
    }
  }
  const token = newToken(user.id);
  res.cookie('sg_token', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 30 * 864e5 });
  res.json({ token, user: publicUser(user) });
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get((email || '').toLowerCase());
  if (!user || !(await bcrypt.compare(password || '', user.pass_hash)))
    return res.status(401).json({ error: 'invalid email or password' });
  if (verificationRequired() && !user.email_verified_at) {
    try {
      await sendVerification(user); // Only after correct password; rate limited.
      return res.status(403).json({ verification_required: true, error: 'Email verification required. Check your inbox or try signing in again in a minute.' });
    } catch {
      return res.status(503).json({ verification_required: true, error: 'Email verification is temporarily unavailable. Please try again later.' });
    }
  }
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
