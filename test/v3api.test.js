// v3 API route tests: movement, alerts (incl. my-teams filtering), splits,
// props — graceful behavior with no Odds API key configured.
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/db.js';
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
  delete process.env.ODDS_API_KEY; // no key: every odds feature must degrade
  db.prepare('DELETE FROM users').run();
  db.prepare('DELETE FROM odds_history').run();
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
  process.chdir(new URL('..', import.meta.url).pathname);
});
after(() => new Promise((r) => server.close(r)));
beforeEach(() => { db.prepare('DELETE FROM odds_history').run(); });

function snap(game_key, home, away, book, market, side, price, line, ts) {
  db.prepare(`INSERT INTO odds_history
    (game_key, league, home_team, away_team, commence, book, market, side, line, price, ts)
    VALUES (?, 'nfl', ?, ?, '2026-10-12T20:20:00Z', ?, ?, ?, ?, ?, ?)`)
    .run(game_key, home, away, book, market, side, line, price, ts);
}

describe('movement + alerts routes', () => {
  it('GET /api/odds/movement reports unavailable without a key', async () => {
    const { status, data } = await req('GET', '/api/odds/movement');
    assert.equal(status, 200);
    assert.equal(data.available, false);
    assert.deepEqual(data.movements, []);
  });
  it('GET /api/odds/history requires a game param', async () => {
    const { status } = await req('GET', '/api/odds/history');
    assert.equal(status, 400);
  });
  it('GET /api/odds/history reports unavailable without a key', async () => {
    const { data } = await req('GET', '/api/odds/history?game=g1');
    assert.equal(data.available, false);
  });
  it('GET /api/alerts reports unavailable without a key', async () => {
    const { data } = await req('GET', '/api/alerts');
    assert.equal(data.available, false);
    assert.deepEqual(data.alerts, []);
  });
  it('GET /api/alerts?mine=1 requires sign-in', async () => {
    const { status, data } = await req('GET', '/api/alerts?mine=1');
    assert.equal(status, 401);
    assert.equal(data.error, 'sign in required');
  });
  it('alerts filter to followed teams (mine=1)', async () => {
    process.env.ODDS_API_KEY = 'x'; // movement reads snapshots, not the network
    try {
      const reg = await req('POST', '/api/auth/register',
        { body: { email: 'alerts@test.com', password: 'password123' } });
      const token = reg.data.token;
      await req('POST', '/api/favorites', { token,
        body: { team_key: 'nfl-kc', league: 'nfl', abbr: 'KC', name: 'Kansas City Chiefs' } });
      // movement on a Chiefs game + movement on an unrelated game
      snap('g-kc', 'Kansas City Chiefs', 'Buffalo Bills', 'draftkings', 'h2h', 'home', -110, null, '2026-10-10 10:00:00');
      snap('g-kc', 'Kansas City Chiefs', 'Buffalo Bills', 'draftkings', 'h2h', 'home', -140, null, '2026-10-10 12:00:00');
      snap('g-other', 'Dallas Cowboys', 'Philadelphia Eagles', 'draftkings', 'h2h', 'home', -110, null, '2026-10-10 10:00:00');
      snap('g-other', 'Dallas Cowboys', 'Philadelphia Eagles', 'draftkings', 'h2h', 'home', -140, null, '2026-10-10 12:00:00');
      const all = await req('GET', '/api/alerts');
      assert.equal(all.data.alerts.length, 2);
      const mine = await req('GET', '/api/alerts?mine=1', { token });
      assert.equal(mine.data.mine, true);
      assert.equal(mine.data.alerts.length, 1);
      assert.equal(mine.data.alerts[0].gameKey, 'g-kc');
      assert.ok(mine.data.alerts[0].moves[0].delta === -30);
    } finally {
      delete process.env.ODDS_API_KEY;
    }
  });
});

describe('splits route', () => {
  it('GET /api/splits is honest about having no feed', async () => {
    const { status, data } = await req('GET', '/api/splits');
    assert.equal(status, 200);
    assert.equal(data.available, false);
    assert.deepEqual(data.splits, []);
    assert.ok(data.note);
    assert.ok(!JSON.stringify(data).match(/\d{2}% bets/), 'no fabricated percentages');
  });
  it('rejects unknown leagues', async () => {
    const { status } = await req('GET', '/api/splits?league=xxx');
    assert.equal(status, 400);
  });
});

describe('props route', () => {
  it('GET /api/odds/props reports unavailable without a key', async () => {
    const { data } = await req('GET', '/api/odds/props?league=nfl&event=ev1');
    assert.equal(data.available, false);
    assert.deepEqual(data.props, []);
  });
  it('requires league and event', async () => {
    assert.equal((await req('GET', '/api/odds/props?event=ev1')).status, 400);
    assert.equal((await req('GET', '/api/odds/props?league=nfl')).status, 400);
    assert.equal((await req('GET', '/api/odds/props?league=xxx&event=ev1')).status, 400);
  });
});

describe('new pages serve', () => {
  it('GET /alerts and /splits return 200 HTML', async () => {
    for (const p of ['/alerts', '/splits']) {
      const res = await realFetch(base + p);
      assert.equal(res.status, 200);
      const html = await res.text();
      assert.match(html, /The Sports Genius/);
      assert.match(html, /1-800-GAMBLER/); // responsible-gambling disclaimer on every new page
    }
  });
});
