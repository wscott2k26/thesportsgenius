import { fileURLToPath } from 'node:url';
// API tests: auth, picks shape, chat fallback, favorites, premium gating.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/db.js';
import { clearCache } from '../src/providers/espn.js';
import { installStub } from './fixtures.mjs';
import app from '../src/app.js';

let server, base;
const realFetch = globalThis.fetch;

async function req(method, path, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const res = await realFetch(base + path, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

before(async () => {
  installStub();
  clearCache();
  db.prepare('DELETE FROM users').run();
  db.prepare('DELETE FROM picks').run();
  db.prepare('DELETE FROM chat_usage').run();
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
  // run from project root so express.static finds ./public
  process.chdir(fileURLToPath(new URL('..', import.meta.url)));
});
after(() => new Promise((r) => server.close(r)));

describe('auth', () => {
  let token;
  it('registers a user', async () => {
    const { status, data } = await req('POST', '/api/auth/register',
      { body: { email: 'fan@test.com', password: 'password123' } });
    assert.equal(status, 200);
    assert.ok(data.token);
    assert.equal(data.user.email, 'fan@test.com');
    assert.equal(data.user.premium, false);
    token = data.token;
  });
  it('rejects duplicate registration', async () => {
    const { status } = await req('POST', '/api/auth/register',
      { body: { email: 'fan@test.com', password: 'password123' } });
    assert.equal(status, 409);
  });
  it('rejects bad logins', async () => {
    const { status } = await req('POST', '/api/auth/login',
      { body: { email: 'fan@test.com', password: 'wrongpass1' } });
    assert.equal(status, 401);
  });
  it('logs in and /me works with the bearer token', async () => {
    const { status, data } = await req('POST', '/api/auth/login',
      { body: { email: 'fan@test.com', password: 'password123' } });
    assert.equal(status, 200);
    const me = await req('GET', '/api/auth/me', { token: data.token });
    assert.equal(me.status, 200);
    assert.equal(me.data.user.email, 'fan@test.com');
  });
  it('stores bcrypt hashes, not plaintext', async () => {
    const row = db.prepare('SELECT pass_hash FROM users WHERE email = ?').get('fan@test.com');
    assert.ok(row.pass_hash.startsWith('$2'));
    assert.doesNotMatch(row.pass_hash, /password123/);
  });
});

describe('picks API', () => {
  it('returns picks with the required shape', async () => {
    const { status, data } = await req('GET', '/api/picks');
    assert.equal(status, 200);
    assert.ok(Array.isArray(data.picks));
    assert.ok(data.picks.length >= 1, 'stub has a KC vs BUF pre-game today');
    for (const p of data.picks) {
      assert.ok(p.pickTeam && p.pickTeam.abbr && p.pickTeam.name);
      assert.equal(p.pickType, 'moneyline');
      assert.ok(p.confidence >= 52 && p.confidence <= 85);
      assert.ok(typeof p.reasoning === 'string' && p.reasoning.length > 0);
    }
    assert.ok(data.disclaimer.includes('Not gambling advice'));
  });
  it('free tier only gets 2 leagues', async () => {
    const { data } = await req('GET', '/api/picks');
    assert.deepEqual(data.lockedLeagues.sort(), ['mlb', 'ncaab', 'ncaaf', 'nhl', 'wnba']);
  });
  it('track-record starts calibrating', async () => {
    const { data } = await req('GET', '/api/track-record');
    assert.equal(data.calibrating, true);
  });
});

describe('chat fallback (no OpenAI key)', () => {
  it('answers a team question from real data', async () => {
    const { status, data } = await req('POST', '/api/chat', { body: { message: 'How are the Chiefs doing?' } });
    assert.equal(status, 200);
    assert.equal(data.mode, 'fallback');
    assert.ok(data.reply.startsWith("Here's what the data says:"));
    assert.match(data.reply, /Kansas City Chiefs/);
    assert.match(data.reply, /11-4/);
  });
  it('offers help when no team matches', async () => {
    const { status, data } = await req('POST', '/api/chat', { body: { message: 'blorb blarg zzz' } });
    assert.equal(status, 200);
    assert.match(data.reply, /Here's what the data says/);
  });
  it('enforces the free 5/day limit', async () => {
    // burn through the guest quota for this IP
    for (let i = 0; i < 4; i++) await req('POST', '/api/chat', { body: { message: 'Lakers?' } });
    const { status, data } = await req('POST', '/api/chat', { body: { message: 'Lakers?' } });
    assert.equal(status, 429);
    assert.equal(data.error, 'limit');
  });
});

describe('favorites', () => {
  let token;
  before(async () => {
    const { data } = await req('POST', '/api/auth/login',
      { body: { email: 'fan@test.com', password: 'password123' } });
    token = data.token;
  });
  it('requires sign-in', async () => {
    const { status } = await req('GET', '/api/favorites');
    assert.equal(status, 401);
  });
  it('adds, lists, and removes a favorite', async () => {
    const add = await req('POST', '/api/favorites', {
      token, body: { team_key: 'nfl:kc', league: 'nfl', abbr: 'KC', name: 'Kansas City Chiefs' },
    });
    assert.equal(add.status, 200);
    const list = await req('GET', '/api/favorites', { token });
    assert.equal(list.data.favorites.length, 1);
    assert.equal(list.data.favorites[0].abbr, 'KC');
    const del = await req('DELETE', '/api/favorites', { token, body: { team_key: 'nfl:kc' } });
    assert.equal(del.status, 200);
    const list2 = await req('GET', '/api/favorites', { token });
    assert.equal(list2.data.favorites.length, 0);
  });
  it('rejects unknown leagues', async () => {
    const { status } = await req('POST', '/api/favorites', {
      token, body: { team_key: 'xx:yy', league: 'quidditch', abbr: 'Q', name: 'Quid' },
    });
    assert.equal(status, 400);
  });
});

describe('premium gating', () => {
  let freeToken, proToken;
  before(async () => {
    const f = await req('POST', '/api/auth/register',
      { body: { email: 'free2@test.com', password: 'password123' } });
    freeToken = f.data.token;
    const p = await req('POST', '/api/auth/register',
      { body: { email: 'pro@test.com', password: 'password123' } });
    proToken = p.data.token;
    db.prepare("UPDATE users SET premium_until = datetime('now', '+30 days') WHERE email = 'pro@test.com'").run();
  });
  it('blocks Best Bets for guests', async () => {
    const { status, data } = await req('GET', '/api/picks/best');
    assert.equal(status, 402);
    assert.equal(data.error, 'premium');
  });
  it('blocks Best Bets for free users', async () => {
    const { status } = await req('GET', '/api/picks/best', { token: freeToken });
    assert.equal(status, 402);
  });
  it('serves Best Bets (top-3 by confidence) to premium', async () => {
    const { status, data } = await req('GET', '/api/picks/best', { token: proToken });
    assert.equal(status, 200);
    assert.ok(Array.isArray(data.best));
    assert.ok(data.best.length <= 3);
    const confs = data.best.map(p => p.confidence);
    assert.deepEqual(confs, [...confs].sort((a, b) => b - a));
  });
  it('billing endpoint exposes Stripe env gating', async () => {
    const { data } = await req('GET', '/api/billing');
    assert.equal(data.price, '$8/month');
    assert.equal(data.trial, '7-day free trial');
    assert.equal(typeof data.testMode, 'boolean');
    assert.equal(data.premium, false); // guest
    const me = await req('GET', '/api/billing', { token: proToken });
    assert.equal(me.data.premium, true);
  });
});
