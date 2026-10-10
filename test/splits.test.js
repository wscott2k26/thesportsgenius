// Splits provider tests: unavailable-by-default honesty, the provider
// abstraction, and graceful failure. We never assert fabricated data.
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  registerSplitsProvider, splitsAvailable, getSplits, SPLITS_UNAVAILABLE_NOTE,
} from '../src/providers/splits.js';

beforeEach(() => { registerSplitsProvider(null); });

describe('splits provider abstraction', () => {
  it('is unavailable with no provider wired', () => {
    assert.equal(splitsAvailable(), false);
  });
  it('returns an honest unavailable payload, never fabricated numbers', async () => {
    const out = await getSplits('nfl');
    assert.equal(out.available, false);
    assert.deepEqual(out.splits, []);
    assert.ok(out.note && out.note.length > 0, 'explains why');
    assert.ok(!JSON.stringify(out).match(/\d{2}%/), 'no fake percentages anywhere');
  });
  it('lights up when a real provider registers', async () => {
    registerSplitsProvider(async (league) => ({
      league,
      splits: [{
        gameKey: 'g1', homeTeam: 'Chiefs', awayTeam: 'Bills', commence: '2026-10-12T20:20:00Z',
        markets: { moneyline: { home: { bets: 60, handle: 45 }, away: { bets: 40, handle: 55 } } },
      }],
      fetchedAt: '2026-10-10T12:00:00Z',
    }));
    assert.equal(splitsAvailable(), true);
    const out = await getSplits('nfl');
    assert.equal(out.available, true);
    assert.equal(out.splits.length, 1);
    assert.equal(out.splits[0].markets.moneyline.home.bets, 60);
  });
  it('degrades gracefully when the provider throws', async () => {
    registerSplitsProvider(async () => { throw new Error('feed down'); });
    const out = await getSplits('nfl');
    assert.equal(out.available, false);
    assert.deepEqual(out.splits, []);
    assert.ok(out.error);
  });
  it('rejects a non-function provider', () => {
    assert.throws(() => registerSplitsProvider('nope'), /bad_provider/);
  });
  it('carries the documented unavailable note', () => {
    assert.match(SPLITS_UNAVAILABLE_NOTE, /never show fabricated splits/i);
  });
});
