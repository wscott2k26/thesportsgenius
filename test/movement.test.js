// Line movement tests: game keys, detection thresholds, steam logic,
// snapshot round-trips through the real (in-memory) DB.
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/db.js';
import {
  gameKey, detectMove, steamDirections, snapshotOdds,
  getMovements, getLineHistory, movementSummary, MOVE_THRESHOLDS,
} from '../src/providers/movement.js';

beforeEach(() => { db.prepare('DELETE FROM odds_history').run(); });

function snapRow(game_key, book, market, side, price, line, ts) {
  db.prepare(`INSERT INTO odds_history
    (game_key, league, home_team, away_team, commence, book, market, side, line, price, ts)
    VALUES (?, 'nfl', 'Kansas City Chiefs', 'Buffalo Bills', '2026-10-12T20:20:00Z', ?, ?, ?, ?, ?, ?)`)
    .run(game_key, book, market, side, line, price, ts);
}

describe('gameKey', () => {
  it('is stable and insensitive to punctuation/case', () => {
    const a = gameKey('Kansas City Chiefs', 'Buffalo Bills', '2026-10-12T20:20:00Z');
    const b = gameKey('kansas city chiefs', 'BUFFALO BILLS', '2026-10-12T20:20:00.000Z');
    assert.equal(a, b);
    assert.notEqual(a, gameKey('Kansas City Chiefs', 'Buffalo Bills', '2026-10-13T20:20:00Z'));
  });
});

describe('detectMove', () => {
  it('flags moneyline moves >= 15 cents, ignores smaller', () => {
    assert.equal(detectMove('h2h', { price: -110 }, { price: -125 }).moved, true);
    assert.equal(detectMove('h2h', { price: -110 }, { price: -120 }).moved, false); // 10c
    assert.equal(detectMove('h2h', { price: 110 }, { price: 130 }).moved, true);
  });
  it('gives direction toward/away for moneyline', () => {
    assert.equal(detectMove('h2h', { price: -110 }, { price: -130 }).dir, 'toward');
    assert.equal(detectMove('h2h', { price: -130 }, { price: -110 }).dir, 'away');
  });
  it('flags spread/total moves >= 0.5 points, ignores smaller', () => {
    assert.equal(detectMove('spreads', { line: -3 }, { line: -3.5 }).moved, true);
    assert.equal(detectMove('spreads', { line: -3 }, { line: -3 }).moved, false);
    assert.equal(detectMove('totals', { line: 45.5 }, { line: 46 }).moved, true);
    assert.equal(detectMove('totals', { line: 45.5 }, { line: 45.5 }).moved, false);
  });
  it('reports magnitude and unit', () => {
    const m = detectMove('h2h', { price: -110 }, { price: -135 });
    assert.equal(m.magnitude, 25);
    assert.equal(m.unit, 'cents');
    const s = detectMove('spreads', { line: -3 }, { line: -4 });
    assert.equal(s.magnitude, 1);
    assert.equal(s.unit, 'points');
  });
  it('handles missing inputs without throwing', () => {
    assert.equal(detectMove('h2h', null, { price: -120 }).moved, false);
    assert.equal(detectMove('bogus', { price: 1 }, { price: 2 }).moved, false);
  });
  it('exposes the documented thresholds', () => {
    assert.deepEqual(MOVE_THRESHOLDS, { h2h: 15, spreads: 0.5, totals: 0.5 });
  });
});

describe('steamDirections', () => {
  const mv = (book, dir) => ({ moved: true, book, market: 'h2h', side: 'home', dir });
  it('flags 3+ books moving the same direction', () => {
    assert.equal(steamDirections([mv('dk', 'toward'), mv('fd', 'toward'), mv('mgm', 'toward')]), true);
  });
  it('ignores split or thin moves', () => {
    assert.equal(steamDirections([mv('dk', 'toward'), mv('fd', 'toward')]), false);
    assert.equal(steamDirections([mv('dk', 'toward'), mv('fd', 'away'), mv('mgm', 'toward')]), false);
    assert.equal(steamDirections([]), false);
  });
});

describe('snapshotOdds + getMovements', () => {
  const ev = (books) => ({
    gameKey: 'g1', homeTeam: 'Kansas City Chiefs', awayTeam: 'Buffalo Bills',
    commence: '2026-10-12T20:20:00Z', books,
  });
  it('snapshots every book/market/side row', () => {
    const r = snapshotOdds('nfl', [ev({
      draftkings: {
        title: 'DraftKings',
        h2h: { home: -130, away: 110 },
        spread: { home: -110, away: -110, point: -3.5 },
        total: { over: -105, under: -115, point: 45.5 },
      },
    })]);
    assert.equal(r.snapshots, 2 + 2 + 2);
    assert.equal(db.prepare('SELECT COUNT(*) c FROM odds_history').get().c, 6);
  });
  it('detects a real move between two snapshots', () => {
    snapRow('g2', 'draftkings', 'h2h', 'home', -110, null, '2026-10-10 10:00:00');
    snapRow('g2', 'draftkings', 'h2h', 'home', -135, null, '2026-10-10 12:00:00');
    const ms = getMovements('nfl');
    assert.equal(ms.length, 1);
    assert.equal(ms[0].moves.length, 1);
    assert.equal(ms[0].moves[0].delta, -25);
    assert.equal(ms[0].moves[0].dir, 'toward');
  });
  it('needs two snapshots before reporting movement', () => {
    snapRow('g3', 'draftkings', 'h2h', 'home', -110, null, '2026-10-10 10:00:00');
    assert.equal(getMovements('nfl').length, 0);
  });
  it('flags steam when 3+ books move together', () => {
    for (const b of ['draftkings', 'fanduel', 'betmgm']) {
      snapRow('g4', b, 'h2h', 'home', -110, null, '2026-10-10 10:00:00');
      snapRow('g4', b, 'h2h', 'home', -130, null, '2026-10-10 12:00:00');
    }
    const ms = getMovements('nfl');
    assert.equal(ms.length, 1);
    assert.equal(ms[0].steam, true);
  });
  it('prunes rows older than 7 days on snapshot', () => {
    snapRow('old', 'draftkings', 'h2h', 'home', -110, null, '2020-01-01 10:00:00');
    snapshotOdds('nfl', []);
    assert.equal(db.prepare("SELECT COUNT(*) c FROM odds_history WHERE game_key = 'old'").get().c, 0);
  });
});

describe('getLineHistory + movementSummary', () => {
  it('returns ordered points for a sparkline', () => {
    snapRow('g5', 'draftkings', 'h2h', 'home', -110, null, '2026-10-10 10:00:00');
    snapRow('g5', 'draftkings', 'h2h', 'home', -120, null, '2026-10-10 11:00:00');
    snapRow('g5', 'draftkings', 'h2h', 'home', -130, null, '2026-10-10 12:00:00');
    const pts = getLineHistory('g5', { book: 'draftkings', market: 'h2h', side: 'home' });
    assert.deepEqual(pts.map(p => p.price), [-110, -120, -130]);
  });
  it('summarizes open/current per book', () => {
    snapRow('g6', 'draftkings', 'h2h', 'home', -110, null, '2026-10-10 10:00:00');
    snapRow('g6', 'draftkings', 'h2h', 'home', -140, null, '2026-10-10 12:00:00');
    const s = movementSummary('g6', 'h2h', 'home');
    assert.ok(s.draftkings);
    assert.equal(s.draftkings.open.price, -110);
    assert.equal(s.draftkings.current.price, -140);
    assert.equal(s.draftkings.moved, true);
    assert.equal(s.draftkings.points.length, 2);
  });
});
