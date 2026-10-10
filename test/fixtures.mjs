// Shared canned ESPN fixtures for deterministic tests.
import { todayET } from '../src/db.js';

delete process.env.OPENAI_API_KEY;

export function todayISO(hourET = 20) {
  // An ISO timestamp that falls "today" in America/New_York.
  const now = new Date();
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  et.setHours(hourET, 20, 0, 0);
  return et.toISOString();
}

function comp(homeAway, abbr, name, record, score, winner, state) {
  return {
    homeAway,
    score: score == null ? null : String(score),
    winner: !!winner,
    team: { abbreviation: abbr, displayName: name, shortDisplayName: name.split(' ').slice(-1)[0], color: 'E31837', logos: [{ href: `https://x/${abbr}.png` }] },
    records: record ? [{ summary: record }] : [],
  };
}

export function scoreboardEvent({ id, home, away, state = 'pre', homeScore = null, awayScore = null, homeWinner = false, awayWinner = false, detail = '8:20 PM ET' }) {
  return {
    id: String(id),
    date: todayISO(),
    name: `${away.name} vs ${home.name}`,
    shortName: `${away.abbr} vs ${home.abbr}`,
    competitions: [{
      competitors: [
        comp('home', home.abbr, home.name, home.record, homeScore, homeWinner),
        comp('away', away.abbr, away.name, away.record, awayScore, awayWinner),
      ],
      broadcasts: [{ names: ['ESPN'] }],
      venue: { fullName: 'Test Stadium', address: { city: 'Testville', state: 'TS' } },
    }],
    status: { type: { state, shortDetail: detail, detail, completed: state === 'post' }, displayClock: null, period: null },
  };
}

export function scoreboardJSON(events) { return { events }; }

export function standingsJSON(rows) {
  return {
    children: [{
      name: 'AFC', children: [{
        name: 'West',
        standings: {
          entries: rows.map(r => ({
            team: { abbreviation: r.abbr, displayName: r.name, logos: [{ href: `https://x/${r.abbr}.png` }] },
            stats: [
              { name: 'wins', displayValue: String(r.w) },
              { name: 'losses', displayValue: String(r.l) },
              { name: 'winPercent', displayValue: (r.w / (r.w + r.l)).toFixed(3) },
              { name: 'streak', displayValue: r.streak || '' },
            ],
          })),
        },
      }],
    }],
  };
}

export function teamsJSON(teams) {
  return {
    sports: [{ leagues: [{ teams: teams.map(t => ({
      team: { abbreviation: t.abbr, displayName: t.name, color: 'E31837', alternateColor: null, logos: [{ href: `https://x/${t.abbr}.png` }] },
    })) }] }],
  };
}

const KC = { abbr: 'KC', name: 'Kansas City Chiefs', record: '11-4' };
const BUF = { abbr: 'BUF', name: 'Buffalo Bills', record: '9-6' };
const LAL = { abbr: 'LAL', name: 'Los Angeles Lakers', record: '24-18' };

// Default stub fetch: deterministic data for nfl/nba, empty for others.
export function stubFetch(url) {
  const u = String(url);
  const ok = (data) => Promise.resolve({ ok: true, json: () => Promise.resolve(data) });
  if (u.includes('/teams?')) {
    const teams = u.includes('/nfl/') ? [KC, BUF]
      : u.includes('/nba/') ? [LAL]
      : [];
    return ok(teamsJSON(teams));
  }
  if (u.includes('/standings')) {
    const rows = u.includes('/nfl/') ? [
      { abbr: 'KC', name: 'Kansas City Chiefs', w: 11, l: 4, streak: 'W3' },
      { abbr: 'BUF', name: 'Buffalo Bills', w: 9, l: 6, streak: 'L1' },
    ] : u.includes('/nba/') ? [
      { abbr: 'LAL', name: 'Los Angeles Lakers', w: 24, l: 18, streak: 'W2' },
    ] : [];
    return ok(standingsJSON(rows));
  }
  if (u.includes('/scoreboard')) {
    if (u.includes('/nfl/')) {
      return ok(scoreboardJSON([
        scoreboardEvent({ id: 'kc-buf-1', home: KC, away: BUF, state: 'pre' }),
      ]));
    }
    return ok(scoreboardJSON([]));
  }
  return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
}

export function installStub() {
  const orig = globalThis.fetch;
  globalThis.fetch = stubFetch;
  return () => { globalThis.fetch = orig; };
}

export { KC, BUF, LAL, todayET };
