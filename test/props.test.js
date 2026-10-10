// Player props tests: normalization groups books per selection, best price
// wins, non-prop markets are skipped, and the fetch layer caches + degrades.
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeProps, getEventProps, clearPropsCache, PROP_MARKETS, oddsAvailable,
} from '../src/providers/odds.js';

const okFetch = (data) => () => Promise.resolve({ ok: true, json: () => Promise.resolve(data) });
const failFetch = () => () => Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) });

beforeEach(() => { clearPropsCache(); delete process.env.ODDS_API_KEY; });

function propsJSON() {
  return {
    id: 'ev1', home_team: 'Kansas City Chiefs', away_team: 'Buffalo Bills',
    commence_time: '2026-10-12T20:20:00Z',
    bookmakers: [
      {
        key: 'draftkings', title: 'DraftKings', markets: [
          { key: 'h2h', outcomes: [{ name: 'Kansas City Chiefs', price: -130 }] }, // skipped
          {
            key: 'player_pass_yds',
            outcomes: [
              { name: 'Over', description: 'Patrick Mahomes', price: -110, point: 267.5 },
              { name: 'Under', description: 'Patrick Mahomes', price: -110, point: 267.5 },
            ],
          },
        ],
      },
      {
        key: 'fanduel', title: 'FanDuel', markets: [
          {
            key: 'player_pass_yds',
            outcomes: [
              { name: 'Over', description: 'Patrick Mahomes', price: -105, point: 267.5 },
              { name: 'Under', description: 'Patrick Mahomes', price: -115, point: 267.5 },
            ],
          },
        ],
      },
    ],
  };
}

describe('normalizeProps', () => {
  it('groups selections across books and picks the best price', () => {
    const props = normalizeProps(propsJSON());
    assert.equal(props.length, 2);
    const over = props.find(p => p.name === 'Over');
    assert.equal(over.description, 'Patrick Mahomes');
    assert.equal(over.point, 267.5);
    assert.equal(over.label, 'Pass Yds');
    assert.deepEqual(Object.keys(over.books).sort(), ['draftkings', 'fanduel']);
    assert.equal(over.best.book, 'fanduel'); // -105 > -110
    assert.equal(over.best.price, -105);
  });
  it('skips non-prop markets like h2h', () => {
    const props = normalizeProps(propsJSON());
    assert.ok(props.every(p => p.market !== 'h2h'));
  });
  it('handles empty payloads', () => {
    assert.deepEqual(normalizeProps({}), []);
    assert.deepEqual(normalizeProps({ bookmakers: [] }), []);
  });
});

describe('getEventProps', () => {
  it('returns unavailable without a key and never calls the network', async () => {
    let called = false;
    const out = await getEventProps('nfl', 'ev1', { fetchFn: () => { called = true; } });
    assert.equal(out.available, false);
    assert.deepEqual(out.props, []);
    assert.equal(called, false);
    assert.equal(oddsAvailable(), false);
  });
  it('fetches, normalizes, and caches per event', async () => {
    process.env.ODDS_API_KEY = 'x';
    let calls = 0;
    const fetchFn = () => { calls++; return okFetch(propsJSON())(); };
    const a = await getEventProps('nfl', 'ev1', { fetchFn });
    assert.equal(a.available, true);
    assert.equal(a.cached, false);
    assert.equal(a.props.length, 2);
    assert.equal(a.homeTeam, 'Kansas City Chiefs');
    const b = await getEventProps('nfl', 'ev1', { fetchFn });
    assert.equal(b.cached, true);
    assert.equal(calls, 1);
  });
  it('errors honestly when upstream fails with no cache', async () => {
    process.env.ODDS_API_KEY = 'x';
    const out = await getEventProps('nba', 'evNope', { fetchFn: failFetch() });
    assert.equal(out.available, true);
    assert.deepEqual(out.props, []);
    assert.match(out.error, /props_http_500/);
  });
  it('rejects unknown leagues and missing event ids', async () => {
    process.env.ODDS_API_KEY = 'x';
    const a = await getEventProps('xxx', 'ev1', { fetchFn: okFetch({}) });
    assert.equal(a.error, 'unsupported');
    const b = await getEventProps('nfl', '', { fetchFn: okFetch({}) });
    assert.equal(b.error, 'unsupported');
  });
  it('covers the big leagues with prop market lists', () => {
    for (const lg of ['nfl', 'nba', 'mlb', 'nhl', 'ncaaf']) {
      assert.ok(Array.isArray(PROP_MARKETS[lg]) && PROP_MARKETS[lg].length > 0, lg);
    }
  });
});
