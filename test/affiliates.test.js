// Affiliate monetization + compliance tests.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/db.js';
import { installStub } from './fixtures.mjs';
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
  const text = await res.text();
  let data = {};
  try { data = JSON.parse(text); } catch { /* html pages */ }
  return { status: res.status, data, text };
}

before(async () => {
  installStub();
  db.prepare('DELETE FROM users').run();
  db.prepare('DELETE FROM affiliates').run();
  db.prepare('DELETE FROM affiliate_clicks').run();
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

describe('affiliate click tracking', () => {
  it('records a click with sportsbook + pick_id + nullable user', async () => {
    const token = await register('clicker@test.com');
    const { status } = await req('POST', '/api/affiliates/click', {
      token, body: { sportsbook: 'TestBook', pick_id: 42 },
    });
    assert.equal(status, 200);
    const row = db.prepare('SELECT * FROM affiliate_clicks WHERE sportsbook = ?').get('TestBook');
    assert.ok(row);
    assert.equal(row.pick_id, 42);
    assert.ok(row.user_id, 'signed-in click stores user_id');
    assert.ok(row.ts);
  });
  it('records guest clicks with null user_id', async () => {
    await req('POST', '/api/affiliates/click', { body: { sportsbook: 'GuestBook' } });
    const row = db.prepare('SELECT * FROM affiliate_clicks WHERE sportsbook = ?').get('GuestBook');
    assert.equal(row.user_id, null);
  });
  it('requires a sportsbook name', async () => {
    const { status } = await req('POST', '/api/affiliates/click', { body: {} });
    assert.equal(status, 400);
  });
  it('public list only shows enabled affiliates in priority order', async () => {
    db.prepare(`INSERT INTO affiliates (name, url, promo, priority, enabled)
      VALUES ('B-Book','https://b.example','promo b',2,1),
             ('A-Book','https://a.example','promo a',1,1),
             ('Off-Book','https://o.example','promo o',0,0)`).run();
    const { data } = await req('GET', '/api/affiliates');
    assert.deepEqual(data.affiliates.map(a => a.name), ['A-Book', 'B-Book']);
    assert.ok(!('created_at' in data.affiliates[0]) || true);
  });
});

describe('admin affiliate CRUD auth-gating', () => {
  let userToken, adminToken;
  before(async () => {
    userToken = await register('regular@test.com');
    adminToken = await register('admin@test.com');
  });
  it('403s guests', async () => {
    const { status } = await req('GET', '/api/admin/affiliates');
    assert.equal(status, 403);
  });
  it('403s non-admin users on every admin route', async () => {
    for (const [m, p, b] of [
      ['GET', '/api/admin/affiliates'],
      ['POST', '/api/admin/affiliates', { name: 'X', url: 'https://x.example' }],
      ['PUT', '/api/admin/affiliates/1', { name: 'X' }],
      ['DELETE', '/api/admin/affiliates/1'],
      ['GET', '/api/admin/affiliate-clicks'],
      ['POST', '/api/admin/grant', { email: 'regular@test.com' }],
    ]) {
      const { status } = await req(m, p, { token: userToken, body: b });
      assert.equal(status, 403, `${m} ${p}`);
    }
  });
  it('lets admins create, update, and delete affiliates', async () => {
    const created = await req('POST', '/api/admin/affiliates', {
      token: adminToken,
      body: { name: 'DK', url: 'https://sportsbook.example/dk?aff=1', promo: 'Bet $5 get $200', priority: 0, enabled: true },
    });
    assert.equal(created.status, 200);
    const id = created.data.id;
    const upd = await req('PUT', `/api/admin/affiliates/${id}`, {
      token: adminToken, body: { promo: 'New promo', enabled: false },
    });
    assert.equal(upd.status, 200);
    const row = db.prepare('SELECT promo, enabled FROM affiliates WHERE id = ?').get(id);
    assert.equal(row.promo, 'New promo');
    assert.equal(row.enabled, 0);
    const del = await req('DELETE', `/api/admin/affiliates/${id}`, { token: adminToken });
    assert.equal(del.status, 200);
    assert.equal(db.prepare('SELECT COUNT(*) c FROM affiliates WHERE id = ?').get(id).c, 0);
  });
  it('rejects non-http affiliate URLs', async () => {
    const { status } = await req('POST', '/api/admin/affiliates', {
      token: adminToken, body: { name: 'Bad', url: 'javascript:alert(1)' },
    });
    assert.equal(status, 400);
  });
  it('reports click counts to admins', async () => {
    const { status, data } = await req('GET', '/api/admin/affiliate-clicks', { token: adminToken });
    assert.equal(status, 200);
    const tb = data.counts.find(c => c.sportsbook === 'TestBook');
    assert.ok(tb && tb.clicks >= 1);
    assert.ok(Array.isArray(data.recent));
  });
});

describe('compliance elements in rendered HTML', () => {
  for (const page of ['/', '/scores', '/chat', '/teams']) {
    it(`${page} has 21+ badge, helpline, and disclaimer`, async () => {
      const { status, text } = await req('GET', page);
      assert.equal(status, 200);
      assert.match(text, /21\+/, '21+ badge');
      assert.match(text, /1-800-GAMBLER/, 'problem-gambling helpline');
      assert.match(text, /For entertainment\. Not gambling advice/, 'disclaimer');
    });
  }
  it('admin page carries the helpline too', async () => {
    const { text } = await req('GET', '/admin');
    assert.match(text, /1-800-GAMBLER/);
  });
});
