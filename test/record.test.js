// Track-record math + pick grading, with canned fixtures.
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { db, todayET } from '../src/db.js';
import { trackRecord, gradePicks } from '../src/picks.js';
import { clearCache } from '../src/providers/espn.js';
import { installStub, scoreboardJSON, scoreboardEvent, KC, BUF } from './fixtures.mjs';

const TODAY = todayET();

function seedPick(date, league, eventId, pickAbbr, status) {
  db.prepare(`INSERT INTO picks (date, league, event_id, home, away, pick_team, confidence, reasoning, status, issued_at, starts_at)
    VALUES (?, ?, ?, 'KC Kansas City Chiefs', 'BUF Buffalo Bills', ?, 70, 'test', ?, '2026-01-01T10:00:00Z', '2026-12-31T20:00:00Z')`)
    .run(date, league, eventId, `${pickAbbr} Team`, status);
}

beforeEach(() => {
  db.prepare('DELETE FROM picks').run();
  clearCache();
});

describe('trackRecord', () => {
  it('returns calibrating when fewer than 5 graded picks exist', () => {
    seedPick(TODAY, 'nfl', 'e1', 'KC', 'win');
    seedPick(TODAY, 'nfl', 'e2', 'KC', 'win');
    const r = trackRecord();
    assert.equal(r.calibrating, true);
    assert.equal(r.graded, 2);
    assert.ok(!('winRate' in r), 'must not expose a win rate while calibrating');
  });
  it('computes a real win rate once 5+ picks are graded', () => {
    for (let i = 0; i < 3; i++) seedPick(TODAY, 'nfl', `w${i}`, 'KC', 'win');
    for (let i = 0; i < 2; i++) seedPick(TODAY, 'nba', `l${i}`, 'LAL', 'loss');
    const r = trackRecord();
    assert.equal(r.calibrating, false);
    assert.equal(r.wins, 3);
    assert.equal(r.losses, 2);
    assert.equal(r.winRate, 60);
  });
  it('only counts the last 30 days', () => {
    for (let i = 0; i < 6; i++) seedPick('2020-01-01', 'nfl', `old${i}`, 'KC', 'win');
    const r = trackRecord();
    assert.equal(r.calibrating, true);
    assert.equal(r.graded, 0);
  });
});

describe('gradePicks', () => {
  it('marks picks win/loss against completed games', async () => {
    seedPick(TODAY, 'nfl', 'g1', 'KC', 'pending');   // KC wins -> win
    seedPick(TODAY, 'nfl', 'g2', 'BUF', 'pending');  // KC wins -> loss
    const restore = installStub();
    // Override the nfl scoreboard with completed games
    globalThis.fetch = (url) => {
      const u = String(url);
      const ok = (d) => Promise.resolve({ ok: true, json: () => Promise.resolve(d) });
      if (u.includes('/nfl/') && u.includes('/scoreboard')) {
        return ok(scoreboardJSON([
          scoreboardEvent({ id: 'g1', home: KC, away: BUF, state: 'post', homeScore: 31, awayScore: 24, homeWinner: true, detail: 'Final' }),
          scoreboardEvent({ id: 'g2', home: KC, away: BUF, state: 'post', homeScore: 31, awayScore: 24, homeWinner: true, detail: 'Final' }),
        ]));
      }
      if (u.includes('/scoreboard')) return ok(scoreboardJSON([]));
      if (u.includes('/standings')) return ok({ children: [] });
      return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
    };
    try {
      const { graded } = await gradePicks(TODAY);
      assert.equal(graded, 2);
      const s1 = db.prepare("SELECT status FROM picks WHERE event_id = 'g1'").get();
      const s2 = db.prepare("SELECT status FROM picks WHERE event_id = 'g2'").get();
      assert.equal(s1.status, 'win');
      assert.equal(s2.status, 'loss');
    } finally { restore(); }
  });

  it('grades spread picks win/loss/push against the final score and stored line', async () => {
    // KC -3.5: wins 31-24 (margin 7) -> cover -> win
    db.prepare(`INSERT INTO picks (date, league, event_id, home, away, pick_team, pick_type, line, confidence, reasoning, status)
      VALUES (?, 'nfl', 's1', 'KC Kansas City Chiefs', 'BUF Buffalo Bills', 'KC Team', 'spread', '-3.5', 60, 'test', 'pending')`).run(TODAY);
    // KC -7.5: wins 31-24 (margin 7) -> no cover -> loss
    db.prepare(`INSERT INTO picks (date, league, event_id, home, away, pick_team, pick_type, line, confidence, reasoning, status)
      VALUES (?, 'nfl', 's2', 'KC Kansas City Chiefs', 'BUF Buffalo Bills', 'KC Team', 'spread', '-7.5', 60, 'test', 'pending')`).run(TODAY);
    // BUF +7: loses 31-24 (margin -7 for BUF) -> push
    db.prepare(`INSERT INTO picks (date, league, event_id, home, away, pick_team, pick_type, line, confidence, reasoning, status)
      VALUES (?, 'nfl', 's3', 'KC Kansas City Chiefs', 'BUF Buffalo Bills', 'BUF Team', 'spread', '+7', 60, 'test', 'pending')`).run(TODAY);
    const restore = installStub();
    globalThis.fetch = (url) => {
      const u = String(url);
      const ok = (d) => Promise.resolve({ ok: true, json: () => Promise.resolve(d) });
      if (u.includes('/nfl/') && u.includes('/scoreboard')) {
        return ok(scoreboardJSON([
          scoreboardEvent({ id: 's1', home: KC, away: BUF, state: 'post', homeScore: 31, awayScore: 24, homeWinner: true, detail: 'Final' }),
          scoreboardEvent({ id: 's2', home: KC, away: BUF, state: 'post', homeScore: 31, awayScore: 24, homeWinner: true, detail: 'Final' }),
          scoreboardEvent({ id: 's3', home: KC, away: BUF, state: 'post', homeScore: 31, awayScore: 24, homeWinner: true, detail: 'Final' }),
        ]));
      }
      if (u.includes('/scoreboard')) return ok(scoreboardJSON([]));
      return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
    };
    try {
      const { graded } = await gradePicks(TODAY);
      assert.equal(graded, 3);
      assert.equal(db.prepare("SELECT status FROM picks WHERE event_id = 's1'").get().status, 'win');
      assert.equal(db.prepare("SELECT status FROM picks WHERE event_id = 's2'").get().status, 'loss');
      assert.equal(db.prepare("SELECT status FROM picks WHERE event_id = 's3'").get().status, 'push');
    } finally { restore(); }
  });
});
