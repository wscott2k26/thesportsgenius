// ESPN provider for The Sports Genius: fetches ESPN's public JSON endpoints and
// normalizes into our own shapes. App code talks to this module, never raw ESPN.
const BASE = 'https://site.api.espn.com/apis/site/v2/sports';
const UA = { 'User-Agent': 'SportsGenius/1.0' };

export const LEAGUES = {
  nfl:   { sport: 'football',   league: 'nfl',              label: 'NFL',        emoji: '🏈' },
  nba:   { sport: 'basketball', league: 'nba',              label: 'NBA',        emoji: '🏀' },
  mlb:   { sport: 'baseball',   league: 'mlb',              label: 'MLB',        emoji: '⚾' },
  nhl:   { sport: 'hockey',     league: 'nhl',              label: 'NHL',        emoji: '🏒' },
  ncaaf: { sport: 'football',   league: 'college-football', label: 'College FB', emoji: '🎓' },
};
export const LEAGUE_KEYS = Object.keys(LEAGUES);

// Per-league home-field edge used by the picks model.
export const HOME_EDGE = { nfl: 0.06, nba: 0.05, mlb: 0.03, nhl: 0.04, ncaaf: 0.05 };

async function getJson(url, fetchFn = fetch) {
  const res = await fetchFn(url, { headers: UA });
  if (!res.ok) throw new Error(`espn_http_${res.status}`);
  return res.json();
}

function normTeam(comp) {
  const t = comp.team || {};
  return {
    abbr: t.abbreviation || '',
    name: t.displayName || t.shortDisplayName || '',
    shortName: t.shortDisplayName || t.abbreviation || '',
    score: comp.score ?? null,
    winner: comp.winner === true,
    color: t.color || '888888',
    alternateColor: t.alternateColor || null,
    logo: (t.logos && t.logos[0] && t.logos[0].href) || '',
    record: (comp.records && comp.records[0] && comp.records[0].summary) || '',
  };
}

export function normalizeEvent(e, leagueKey) {
  const comp = (e.competitions && e.competitions[0]) || {};
  const competitors = comp.competitors || [];
  const home = competitors.find(c => c.homeAway === 'home') || competitors[0] || {};
  const away = competitors.find(c => c.homeAway === 'away') || competitors[1] || {};
  return {
    id: String(e.id),
    league: leagueKey,
    kind: 'match',
    date: e.date,
    name: e.name || e.shortName || '',
    shortName: e.shortName || '',
    week: e.week ? e.week.number : null,
    status: normStatus(e.status),
    home: normTeam(home),
    away: normTeam(away),
    broadcasts: normBroadcasts(comp),
    ...normVenueFields(comp.venue),
  };
}

function normStatus(st) {
  st = st || {};
  return {
    state: (st.type && st.type.state) || 'pre', // pre | in | post
    detail: (st.type && (st.type.detail || st.type.shortDetail)) || '',
    shortDetail: (st.type && st.type.shortDetail) || '',
    period: st.period || null,
    clock: st.displayClock || null,
    completed: (st.type && st.type.completed) === true,
  };
}

function normBroadcasts(comp) {
  const out = [];
  for (const b of ((comp && comp.broadcasts) || [])) {
    for (const n of (b.names || [])) if (!out.includes(n)) out.push(n);
  }
  return out;
}

function normVenueFields(venue) {
  venue = venue || {};
  return {
    venue: venue.fullName || venue.displayName || '',
    venueCity: (venue.address && venue.address.city) || '',
    venueState: (venue.address && venue.address.state) || '',
  };
}

export async function fetchScoreboard(leagueKey, { fetchFn = fetch } = {}) {
  const l = LEAGUES[leagueKey];
  if (!l) throw new Error('unknown_league');
  const d = await getJson(`${BASE}/${l.sport}/${l.league}/scoreboard`, fetchFn);
  return (d.events || []).map(e => normalizeEvent(e, leagueKey));
}

export function normalizeArticle(a, leagueKey) {
  const imgs = a.images || [];
  return {
    id: String(a.id || a.nowId || ''),
    league: leagueKey,
    headline: a.headline || '',
    description: a.description || '',
    published: a.published || '',
    link: (a.links && a.links.web && a.links.web.href) || '',
    image: (imgs[0] && imgs[0].url) || '',
    source: 'ESPN',
  };
}

export async function fetchNews(leagueKey, { fetchFn = fetch } = {}) {
  const l = LEAGUES[leagueKey];
  if (!l) throw new Error('unknown_league');
  const d = await getJson(`${BASE}/${l.sport}/${l.league}/news`, fetchFn);
  return (d.articles || []).map(a => normalizeArticle(a, leagueKey));
}

export async function fetchStandings(leagueKey, { fetchFn = fetch } = {}) {
  const l = LEAGUES[leagueKey];
  if (!l) throw new Error('unknown_league');
  const d = await getJson(`${BASE}/${l.sport}/${l.league}/standings`, fetchFn).catch(() => null);
  if (!d || !d.children) return { groups: [] };
  const groups = [];
  for (const conf of d.children) {
    for (const div of (conf.children || [])) {
      const rows = ((div.standings && div.standings.entries) || []).map(en => {
        const team = en.team || {};
        const get = (name) => {
          const s = (en.stats || []).find(s => s.name === name);
          return s ? s.displayValue : '';
        };
        return {
          abbr: team.abbreviation || '',
          name: team.displayName || '',
          logo: (team.logos && team.logos[0] && team.logos[0].href) || '',
          wins: get('wins'),
          losses: get('losses'),
          pct: get('winPercent') || get('avgPointsFor'),
          extra: get('streak'),
        };
      });
      if (rows.length) groups.push({ name: `${conf.name} ${div.name}`.trim(), rows });
    }
  }
  return { groups };
}

export async function fetchSummary(leagueKey, eventId, { fetchFn = fetch } = {}) {
  const l = LEAGUES[leagueKey];
  if (!l) throw new Error('unknown_league');
  const d = await getJson(`${BASE}/${l.sport}/${l.league}/summary?event=${eventId}`, fetchFn);
  const header = d.header || {};
  const comp = (header.competitions && header.competitions[0]) || {};
  const scoringPlays = (d.scoringPlays || []).map(p => ({
    text: p.text || '',
    awayScore: p.awayScore, homeScore: p.homeScore,
    period: (p.period && p.period.number) || null,
    clock: p.clockDisplayValue || p.clock || '',
  }));
  const leaders = (d.leaders || []).flatMap(lg =>
    (lg.leaders || []).slice(0, 2).map(x => ({
      category: lg.shortDisplayName || lg.displayName || '',
      athlete: (x.athlete && x.athlete.displayName) || '',
      value: x.displayValue || '',
      team: lg.team || '',
    }))
  );
  const gameInfo = d.gameInfo || {};
  return {
    event: header.id ? normalizeEvent({
      id: header.id, date: comp.date, name: header.name, shortName: header.shortName,
      competitions: [comp], status: comp.status,
    }, leagueKey) : null,
    scoringPlays: scoringPlays.slice(-12).reverse(),
    leaders: leaders.slice(0, 6),
    venue: gameInfo.venue ? (gameInfo.venue.fullName || '') : '',
    venueCity: (gameInfo.venue && gameInfo.venue.address && gameInfo.venue.address.city) || '',
    venueState: (gameInfo.venue && gameInfo.venue.address && gameInfo.venue.address.state) || '',
    attendance: gameInfo.attendance || null,
  };
}

export async function fetchTeams(leagueKey, { fetchFn = fetch } = {}) {
  const l = LEAGUES[leagueKey];
  if (!l) throw new Error('unknown_league');
  const d = await getJson(`${BASE}/${l.sport}/${l.league}/teams?limit=40`, fetchFn);
  const out = [];
  for (const s of (d.sports || [])) {
    for (const lg of (s.leagues || [])) {
      for (const t of (lg.teams || [])) {
        const tm = t.team || {};
        out.push({
          key: `${leagueKey}:${(tm.abbreviation || '').toLowerCase()}`,
          abbr: tm.abbreviation || '',
          name: tm.displayName || '',
          color: tm.color || '888888',
          alternateColor: tm.alternateColor || null,
          logo: (tm.logos && tm.logos[0] && tm.logos[0].href) || '',
        });
      }
    }
  }
  return out;
}

// ---------------- server-side cache ----------------
// scoreboards 60s, standings 10min, teams 24h. On upstream failure serve stale
// and mark the payload `delayed: true` so the UI shows it.
const cache = new Map();
const TTL = { scoreboard: 60_000, standings: 10 * 60_000, teams: 24 * 60 * 60_000 };

async function cached(kind, key, ttl, loader) {
  const now = Date.now();
  const c = cache.get(key);
  if (c && now - c.at < ttl) return { ...c.data, delayed: false };
  try {
    const data = await loader();
    const entry = { at: now, data };
    cache.set(key, entry);
    return { ...data, delayed: false };
  } catch (err) {
    if (c) return { ...c.data, delayed: true, error: String(err && err.message || err) };
    throw err;
  }
}

export async function getScoreboard(leagueKey, opts = {}) {
  return cached('scoreboard', `sb:${leagueKey}`, TTL.scoreboard, async () => {
    const events = await fetchScoreboard(leagueKey, opts);
    return { events, fetchedAt: new Date().toISOString() };
  });
}

export async function getStandings(leagueKey, opts = {}) {
  return cached('standings', `st:${leagueKey}`, TTL.standings, async () => {
    const s = await fetchStandings(leagueKey, opts);
    return { ...s, fetchedAt: new Date().toISOString() };
  });
}

export async function getTeams(leagueKey, opts = {}) {
  return cached('teams', `tm:${leagueKey}`, TTL.teams, async () => {
    const teams = await fetchTeams(leagueKey, opts);
    return { teams, fetchedAt: new Date().toISOString() };
  });
}

export function clearCache() { cache.clear(); }
