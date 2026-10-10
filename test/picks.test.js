// Picks engine unit tests: deterministic, canned fixtures.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseRecord, streakBonus, clampConfidence, pickGame, maybeSpreadPick } from '../src/picks.js';
import { normalizeOddsEvent } from '../src/providers/odds.js';

const KC = { abbr: 'KC', name: 'Kansas City Chiefs', record: '11-4' };
const BUF = { abbr: 'BUF', name: 'Buffalo Bills', record: '9-6' };

describe('parseRecord', () => {
  it('parses "12-4" into wins/losses/pct', () => {
    assert.deepEqual(parseRecord('12-4'), { wins: 12, losses: 4, pct: 12 / 16 });
  });
  it('returns null for missing/garbage records', () => {
    assert.equal(parseRecord(''), null);
    assert.equal(parseRecord(null), null);
    assert.equal(parseRecord('TBD'), null);
  });
});

describe('streakBonus', () => {
  it('rewards win streaks, capped at 4', () => {
    assert.equal(streakBonus('W3'), 0.015);
    assert.equal(streakBonus('W9'), 0.02);
  });
  it('penalizes losing streaks', () => assert.equal(streakBonus('L2'), -0.01));
  it('ignores junk', () => assert.equal(streakBonus(''), 0));
});

describe('clampConfidence', () => {
  it('clamps to 52..85', () => {
    assert.equal(clampConfidence(10), 52);
    assert.equal(clampConfidence(99), 85);
    assert.equal(clampConfidence(68.4), 68);
  });
});

describe('pickGame', () => {
  it('is deterministic', () => {
    const a = pickGame('nfl', KC, BUF, 'W3', 'L1');
    const b = pickGame('nfl', KC, BUF, 'W3', 'L1');
    assert.deepEqual(a, b);
  });
  it('picks the better team (home KC over BUF)', () => {
    const p = pickGame('nfl', KC, BUF, 'W3', 'L1');
    assert.equal(p.pickTeam.abbr, 'KC');
    assert.equal(p.pickType, 'moneyline');
  });
  it('can pick the away team when clearly better', () => {
    const strong = { abbr: 'AWY', name: 'Away Strong', record: '14-1' };
    const weak = { abbr: 'HME', name: 'Home Weak', record: '2-13' };
    const p = pickGame('nfl', weak, strong);
    assert.equal(p.pickTeam.abbr, 'AWY');
  });
  it('uses home edge as the tiebreaker for even teams', () => {
    const h = { abbr: 'HME', name: 'Home Even', record: '8-8' };
    const a = { abbr: 'AWY', name: 'Away Even', record: '8-8' };
    assert.equal(pickGame('nfl', h, a).pickTeam.abbr, 'HME');
  });
  it('reasoning cites REAL numbers from the inputs', () => {
    const p = pickGame('nfl', KC, BUF, 'W3', 'L1');
    assert.match(p.reasoning, /11-4/);
    assert.match(p.reasoning, /9-6/);
    assert.match(p.reasoning, /W3/);
  });
  it('reasoning omits missing numbers instead of inventing them', () => {
    const h = { abbr: 'HME', name: 'Home X', record: '' };
    const a = { abbr: 'AWY', name: 'Away X', record: '' };
    const p = pickGame('nfl', h, a);
    // no record strings, no streak -> should not contain invented W-L
    assert.doesNotMatch(p.reasoning, /\d+-\d+/);
  });
  it('never invents spreads, totals, or odds', () => {
    const p = pickGame('nfl', KC, BUF, 'W3', 'L1');
    const blob = JSON.stringify(p).toLowerCase();
    assert.equal(p.pickType, 'moneyline');
    assert.doesNotMatch(blob, /spread/);
    assert.doesNotMatch(blob, /over\/under/);
    assert.doesNotMatch(blob, /odds/);
    assert.doesNotMatch(blob, /-3\.5|\+7/);
  });
  it('confidence stays in 52..85 even for blowout mismatches', () => {
    const strong = { abbr: 'AWY', name: 'Away Strong', record: '15-0' };
    const weak = { abbr: 'HME', name: 'Home Weak', record: '0-15' };
    const p = pickGame('nfl', weak, strong);
    assert.ok(p.confidence >= 52 && p.confidence <= 85, `got ${p.confidence}`);
  });
  it('applies the correct per-league home edge', () => {
    // NHL home edge (0.04) is smaller than NFL (0.06): same even teams,
    // confidence for the home pick should be lower in NHL.
    const h = { abbr: 'HME', name: 'Home Even', record: '8-8' };
    const a = { abbr: 'AWY', name: 'Away Even', record: '8-8' };
    const nfl = pickGame('nfl', h, a).confidence;
    const nhl = pickGame('nhl', h, a).confidence;
    assert.ok(nfl >= nhl, `nfl ${nfl} vs nhl ${nhl}`);
  });
});

function spreadOddsEvent() {
  return normalizeOddsEvent({
    home_team: 'Kansas City Chiefs', away_team: 'Buffalo Bills',
    commence_time: '2026-10-12T20:20:00Z',
    bookmakers: [
      {
        key: 'draftkings', title: 'DraftKings', markets: [
          { key: 'spreads', outcomes: [{ name: 'Kansas City Chiefs', price: -110, point: -3.5 }, { name: 'Buffalo Bills', price: -110, point: 3.5 }] },
        ],
      },
      {
        key: 'fanduel', title: 'FanDuel', markets: [
          { key: 'spreads', outcomes: [{ name: 'Kansas City Chiefs', price: -105, point: -3 }, { name: 'Buffalo Bills', price: -115, point: 3 }] },
        ],
      },
    ],
  });
}

describe('maybeSpreadPick', () => {
  const strongMl = { ...pickGame('nfl', KC, BUF, 'W9', 'L4'), confidence: 68 };
  it('issues a spread pick from a real market line when the model is strong', () => {
    const sp = maybeSpreadPick(strongMl, spreadOddsEvent());
    assert.ok(sp);
    assert.equal(sp.pickType, 'spread');
    assert.equal(sp.pickTeam.abbr, 'KC');
    assert.equal(sp.line, '-3', 'best number for the favorite (FD -3 over DK -3.5)');
    assert.equal(sp.book, 'FanDuel');
    assert.ok(sp.confidence >= 52 && sp.confidence <= 66, `got ${sp.confidence}`);
    assert.match(sp.reasoning, /-3/);
    assert.match(sp.reasoning, /FanDuel/);
  });
  it('returns null when the model is not confident enough', () => {
    const weak = { ...strongMl, confidence: 55 };
    assert.equal(maybeSpreadPick(weak, spreadOddsEvent()), null);
  });
  it('returns null when no real line exists — never invents one', () => {
    assert.equal(maybeSpreadPick(strongMl, null), null);
    assert.equal(maybeSpreadPick(strongMl, { books: {} }), null);
  });
  it('backs the underdog at the biggest number', () => {
    const awayStrong = { abbr: 'AWY', name: 'Away Strong', record: '14-1' };
    const homeWeak = { abbr: 'HME', name: 'Home Weak', record: '2-13' };
    const ml = { ...pickGame('nfl', homeWeak, awayStrong), confidence: 70 };
    assert.equal(ml.pickTeam.abbr, 'AWY');
    const ev = normalizeOddsEvent({
      home_team: 'Home Weak', away_team: 'Away Strong',
      bookmakers: [{
        key: 'dk', title: 'DK', markets: [
          { key: 'spreads', outcomes: [{ name: 'Home Weak', price: -110, point: 7.5 }, { name: 'Away Strong', price: -110, point: -7.5 }] },
        ],
      }],
    });
    const sp = maybeSpreadPick(ml, ev);
    assert.ok(sp);
    assert.equal(sp.line, '-7.5');
  });
});
