// Bet tracker tests: summary math + CRUD API (auth-gated, user-isolated).
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/db.js';
import { installStub } from './fixtures.mjs';
import { betSummary } from '../src/routes/api.js';
import app from '../src/app.js';

let server, base;
const realFetch = globalThis.fetch;
process.env.ADMIN_EMAILS = 'admin@test.com';

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
  db.prepare('DELETE FROM users').run();
  db.prepare('DELETE FROM bets').run();
  db.prepare('DELETE FROM offers').run();
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
  process.chdir(new URL('..', import.meta.url).pathname);
});
after(() => new Promise((r) => server.close(r)));

async function register(email) {
  const { data } = await req('POST', '/api/auth/register',
    { body: { email, password: 'password123' } });
  return data.token;
}

describe('betSummary', () => {
  it('computes record, net, ROI and units', () => {
    const s = betSummary([
      { stake: 100, odds: 150, result: 'win' },   // +150
      { stake: 110, odds: -110, result: 'loss' },  // -110
      { stake: 50, odds: -110, result: 'push' },   // stake back
      { stake: 20, odds: 200, result: 'pending' }, // not graded -> excluded from staked
    ]);
    assert.equal(s.wins, 1);
    assert.equal(s.losses, 1);
    assert.equal(s.pushes, 1);
    assert.equal(s.staked, 260);
    assert.equal(s.net, 40); // +150 - 110 + 0
    assert.equal(s.roi, 15.4);
    assert.equal(s.units, 0.4);
  });
  it('handles an empty ledger', () => {
    const s = betSummary([]);
    assert.deepEqual([s.bets, s.wins, s.staked, s.net, s.roi, s.units], [0, 0, 0, 0, 0, 0]);
  });
});

describe('bets API', () => {
  let token, other;
  it('registers two users', async () => {
    token = await register('bettor@test.com');
    other = await register('stranger@test.com');
    assert.ok(token && other);
  });
  it('requires sign-in', async () => {
    const { status } = await req('GET', '/api/bets');
    assert.equal(status, 401);
  });
  it('logs a bet', async () => {
    const { status, data } = await req('POST', '/api/bets', {
      token, body: { date: '2026-10-09', league: 'NFL', matchup: 'Chiefs vs Bills', bet_type: 'spread', selection: 'Chiefs -3.5', book: 'DraftKings', stake: 50, odds: -110 },
    });
    assert.equal(status, 200);
    assert.ok(data.id);
  });
  it('rejects bad stake and bad odds', async () => {
    const bad1 = await req('POST', '/api/bets', {
      token, body: { matchup: 'x', selection: 'y', stake: -5, odds: -110 },
    });
    assert.equal(bad1.status, 400);
    const bad2 = await req('POST', '/api/bets', {
      token, body: { matchup: 'x', selection: 'y', stake: 10, odds: 50 },
    });
    assert.equal(bad2.status, 400);
    const bad3 = await req('POST', '/api/bets', {
      token, body: { matchup: 'x', selection: 'y', stake: 10, odds: 'abc' },
    });
    assert.equal(bad3.status, 400);
  });
  it('lists bets with a summary', async () => {
    const { status, data } = await req('GET', '/api/bets', { token });
    assert.equal(status, 200);
    assert.equal(data.bets.length, 1);
    assert.equal(data.summary.bets, 1);
    assert.equal(data.summary.graded, 0);
  });
  it('grades a bet and the summary updates', async () => {
    const { data: list } = await req('GET', '/api/bets', { token });
    const id = list.bets[0].id;
    const g = await req('PUT', `/api/bets/${id}`, { token, body: { result: 'win' } });
    assert.equal(g.status, 200);
    const { data } = await req('GET', '/api/bets', { token });
    assert.equal(data.summary.wins, 1);
    assert.ok(data.summary.net > 0);
    const bad = await req('PUT', `/api/bets/${id}`, { token, body: { result: 'maybe' } });
    assert.equal(bad.status, 400);
  });
  it('isolates users from each other', async () => {
    const { data } = await req('GET', '/api/bets', { token: other });
    assert.equal(data.bets.length, 0);
    const { data: list } = await req('GET', '/api/bets', { token });
    const id = list.bets[0].id;
    const del = await req('DELETE', `/api/bets/${id}`, { token: other });
    assert.equal(del.status, 200); // no-op: not their row
    const still = await req('GET', '/api/bets', { token });
    assert.equal(still.data.bets.length, 1);
  });
  it('deletes a bet', async () => {
    const { data: list } = await req('GET', '/api/bets', { token });
    const { status } = await req('DELETE', `/api/bets/${list.bets[0].id}`, { token });
    assert.equal(status, 200);
    const { data } = await req('GET', '/api/bets', { token });
    assert.equal(data.bets.length, 0);
  });
});

describe('offers API', () => {
  let adminToken;
  it('registers an admin', async () => {
    adminToken = await register('admin@test.com');
    assert.ok(adminToken);
  });
  it('rejects non-admin offer creation', async () => {
    const userToken = await register('regular@test.com');
    const { status } = await req('POST', '/api/admin/offers', {
      token: userToken, body: { book_name: 'X', title: 'Y' },
    });
    assert.equal(status, 403);
  });
  it('admin creates, lists, updates and deletes an offer', async () => {
    const c = await req('POST', '/api/admin/offers', {
      token: adminToken,
      body: { book_name: 'DraftKings', title: 'Bet $5 get $200', terms: '21+. T&Cs apply.', promo_code: 'GENIUS', url: 'https://example.com/dk', priority: 1 },
    });
    assert.equal(c.status, 200);
    const pub = await req('GET', '/api/offers');
    assert.equal(pub.data.offers.length, 1);
    assert.equal(pub.data.offers[0].title, 'Bet $5 get $200');
    assert.equal(pub.data.offers[0].promo_code, 'GENIUS');
    const u = await req('PUT', `/api/admin/offers/${c.data.id}`, {
      token: adminToken, body: { enabled: false },
    });
    assert.equal(u.status, 200);
    const pub2 = await req('GET', '/api/offers');
    assert.equal(pub2.data.offers.length, 0, 'disabled offers are hidden');
    const d = await req('DELETE', `/api/admin/offers/${c.data.id}`, { token: adminToken });
    assert.equal(d.status, 200);
  });
  it('rejects bad affiliate references', async () => {
    const { status } = await req('POST', '/api/admin/offers', {
      token: adminToken, body: { book_name: 'X', title: 'Y', affiliate_id: 99999 },
    });
    assert.equal(status, 400);
  });
  it('links an offer to an affiliate for click-tracked CTAs', async () => {
    const a = await req('POST', '/api/admin/affiliates', {
      token: adminToken, body: { name: 'FanDuel', url: 'https://example.com/fd' },
    });
    assert.equal(a.status, 200);
    const c = await req('POST', '/api/admin/offers', {
      token: adminToken, body: { book_name: 'FanDuel', title: 'No sweat first bet', affiliate_id: a.data.id },
    });
    assert.equal(c.status, 200);
    const pub = await req('GET', '/api/offers');
    assert.equal(pub.data.offers[0].url, 'https://example.com/fd');
    assert.equal(pub.data.offers[0].via_affiliate, true);
  });
});
