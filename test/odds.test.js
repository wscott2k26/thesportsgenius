// Odds provider tests: math, normalization, best-line selection, caching, no-key fallback.
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  oddsAvailable, americanToDecimal, decimalToAmerican, formatAmerican,
  profitFor, parlayDecimal, parlayAmerican,
  normalizeOddsEvent, findOddsForPick, bestMoneyline, bestSpread,
  formatSpread, matchAffiliate, getOdds, clearOddsCache,
} from '../src/providers/odds.js';

function oddsApiJSON() {
  return [{
    home_team: 'Kansas City Chiefs', away_team: 'Buffalo Bills',
    commence_time: '2026-10-12T20:20:00Z',
    bookmakers: [
      {
        key: 'draftkings', title: 'DraftKings', markets: [
          { key: 'h2h', outcomes: [{ name: 'Kansas City Chiefs', price: -130 }, { name: 'Buffalo Bills', price: 110 }] },
          { key: 'spreads', outcomes: [{ name: 'Kansas City Chiefs', price: -110, point: -3.5 }, { name: 'Buffalo Bills', price: -110, point: 3.5 }] },
          { key: 'totals', outcomes: [{ name: 'Over', price: -105, point: 45.5 }, { name: 'Under', price: -115, point: 45.5 }] },
        ],
      },
      {
        key: 'fanduel', title: 'FanDuel', markets: [
          { key: 'h2h', outcomes: [{ name: 'Kansas City Chiefs', price: -125 }, { name: 'Buffalo Bills', price: 105 }] },
          { key: 'spreads', outcomes: [{ name: 'Kansas City Chiefs', price: -105, point: -3 }, { name: 'Buffalo Bills', price: -115, point: 3 }] },
        ],
      },
      { key: 'junkbook', title: 'JunkBook', markets: [] }, // no markets -> excluded
    ],
  }];
}

const okFetch = (data) => () => Promise.resolve({ ok: true, json: () => Promise.resolve(data) });
const failFetch = () => () => Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) });

beforeEach(() => { clearOddsCache(); delete process.env.ODDS_API_KEY; });

describe('oddsAvailable', () => {
  it('is false without a key, true with one', () => {
    assert.equal(oddsAvailable(), false);
    process.env.ODDS_API_KEY = 'x';
    assert.equal(oddsAvailable(), true);
  });
});

describe('odds math', () => {
  it('americanToDecimal converts both sides', () => {
    assert.equal(americanToDecimal(100), 2);
    assert.equal(americanToDecimal(150), 2.5);
    assert.ok(Math.abs(americanToDecimal(-110) - 1.90909) < 1e-4);
  });
  it('decimalToAmerican round-trips', () => {
    assert.equal(decimalToAmerican(2), 100);
    assert.equal(decimalToAmerican(2.5), 150);
    assert.equal(decimalToAmerican(1.90909), -110);
  });
  it('profitFor pays winners correctly', () => {
    assert.equal(profitFor(100, 150), 150);
    assert.equal(profitFor(110, -110), 100);
    assert.ok(Math.abs(profitFor(50, -110) - 45.4545) < 1e-3);
  });
  it('parlayAmerican multiplies legs honestly', () => {
    // two -110 legs -> 1.909^2 = 3.644 -> +264
    assert.equal(parlayAmerican([-110, -110]), 264);
    assert.ok(parlayDecimal([100, 100]) === 4);
  });
  it('formatAmerican signs prices', () => {
    assert.equal(formatAmerican(145), '+145');
    assert.equal(formatAmerican(-110), '-110');
  });
  it('rejects garbage odds', () => {
    assert.throws(() => americanToDecimal(0), /bad_odds/);
    assert.throws(() => profitFor(-5, 110), /bad_bet/);
  });
});

describe('normalizeOddsEvent', () => {
  it('extracts h2h, spreads, totals per book and drops empty books', () => {
    const e = normalizeOddsEvent(oddsApiJSON()[0]);
    assert.equal(e.homeTeam, 'Kansas City Chiefs');
    assert.deepEqual(e.books.draftkings.h2h, { home: -130, away: 110 });
    assert.deepEqual(e.books.draftkings.spread, { home: -110, away: -110, point: -3.5 });
    assert.deepEqual(e.books.draftkings.total, { over: -105, under: -115, point: 45.5 });
    assert.ok(!e.books.junkbook, 'book with no markets excluded');
    assert.ok(!e.books.fanduel.total, 'missing totals market is simply absent');
  });
});

describe('findOddsForPick', () => {
  it('matches our "ABBR Full Name" strings to odds team names', () => {
    const data = { events: [normalizeOddsEvent(oddsApiJSON()[0])] };
    const hit = findOddsForPick(data, 'KC Kansas City Chiefs', 'BUF Buffalo Bills');
    assert.ok(hit);
    assert.equal(hit.homeTeam, 'Kansas City Chiefs');
  });
  it('returns null when teams do not match', () => {
    const data = { events: [normalizeOddsEvent(oddsApiJSON()[0])] };
    assert.equal(findOddsForPick(data, 'DAL Dallas Cowboys', 'PHI Philadelphia Eagles'), null);
  });
});

describe('best-line selection', () => {
  it('bestMoneyline picks the highest price', () => {
    const e = normalizeOddsEvent(oddsApiJSON()[0]);
    // away Bills: DK +110 beats FD +105
    assert.deepEqual(bestMoneyline(e.books, 'away'), { book: 'draftkings', title: 'DraftKings', price: 110 });
    // home Chiefs: FD -125 beats DK -130
    assert.deepEqual(bestMoneyline(e.books, 'home'), { book: 'fanduel', title: 'FanDuel', price: -125 });
  });
  it('bestSpread picks the smallest number for the side backed', () => {
    const e = normalizeOddsEvent(oddsApiJSON()[0]);
    // home favorite: FD -3 beats DK -3.5
    const hs = bestSpread(e.books, 'home');
    assert.equal(hs.point, -3);
    assert.equal(hs.book, 'fanduel');
    // away underdog: DK +3.5 beats FD +3
    const as = bestSpread(e.books, 'away');
    assert.equal(as.point, 3.5);
    assert.equal(as.book, 'draftkings');
  });
  it('formatSpread signs the point', () => {
    assert.equal(formatSpread(-3.5), '-3.5');
    assert.equal(formatSpread(7), '+7');
  });
});

describe('matchAffiliate', () => {
  const affs = [{ name: 'DraftKings', url: 'https://dk.example' }, { name: 'FanDuel', url: 'https://fd.example' }];
  it('matches book keys and titles to admin affiliates', () => {
    assert.equal(matchAffiliate(affs, 'draftkings', 'DraftKings').url, 'https://dk.example');
    assert.equal(matchAffiliate(affs, 'fanduel', 'FanDuel').url, 'https://fd.example');
  });
  it('returns null when no affiliate is configured', () => {
    assert.equal(matchAffiliate(affs, 'betmgm', 'BetMGM'), null);
    assert.equal(matchAffiliate([], 'draftkings', 'DraftKings'), null);
  });
  it('does not false-positive on short names', () => {
    assert.equal(matchAffiliate([{ name: 'Bet' }], 'betmgm', 'BetMGM'), null);
  });
});

describe('getOdds', () => {
  it('returns available:false with no key and never calls the network', async () => {
    let called = 0;
    const out = await getOdds('nfl', { fetchFn: () => { called++; return okFetch([])(); } });
    assert.equal(out.available, false);
    assert.equal(called, 0);
  });
  it('fetches and normalizes with a key', async () => {
    process.env.ODDS_API_KEY = 'test';
    const out = await getOdds('nfl', { fetchFn: okFetch(oddsApiJSON()) });
    assert.equal(out.available, true);
    assert.equal(out.events.length, 1);
    assert.ok(out.events[0].books.draftkings);
    assert.ok(out.fetchedAt);
  });
  it('serves the cache instead of refetching', async () => {
    process.env.ODDS_API_KEY = 'test';
    let calls = 0;
    const f = () => { calls++; return okFetch(oddsApiJSON())(); };
    await getOdds('nfl', { fetchFn: f });
    const second = await getOdds('nfl', { fetchFn: f });
    assert.equal(calls, 1);
    assert.equal(second.cached, true);
  });
  it('serves stale cache when upstream fails', async () => {
    process.env.ODDS_API_KEY = 'test';
    process.env.ODDS_REFRESH_HOURS = '0.00001'; // ~36ms TTL
    await getOdds('nfl', { fetchFn: okFetch(oddsApiJSON()) });
    await new Promise(r => setTimeout(r, 60)); // let the cache expire
    const out = await getOdds('nfl', { fetchFn: failFetch() });
    delete process.env.ODDS_REFRESH_HOURS;
    assert.equal(out.stale, true);
    assert.equal(out.events.length, 1);
  });
  it('rejects unknown leagues', async () => {
    process.env.ODDS_API_KEY = 'test';
    const out = await getOdds('quidditch', { fetchFn: okFetch([]) });
    assert.equal(out.error, 'unknown_league');
  });
});
