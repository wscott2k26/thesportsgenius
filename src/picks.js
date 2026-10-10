// Picks engine: a TRANSPARENT HEURISTIC model, not ML.
// Signals: team win% (from real record strings), a per-league home edge, and a
// small streak bonus from standings data. Every input is real ESPN data; the
// reasoning line cites only numbers that actually exist.
//
// Moneyline picks come from the model. Spread picks are issued ONLY when a
// real market spread exists (The Odds API) and the moneyline model is strong
// (>=62%) — the line is the market's, never invented. The model does not
// project scores, so it issues no total picks; totals are shown for line
// shopping and parlays only.
import { db, todayET } from './db.js';
import { snapshotPick } from './ledger.js';
import { getScoreboard, fetchHistoricalScoreboard, getStandings, LEAGUES, LEAGUE_KEYS, HOME_EDGE } from './providers/espn.js';
import { getOdds, oddsAvailable, findOddsForPick, bestSpread, formatSpread } from './providers/odds.js';

export function parseRecord(rec) {
  // "12-4" -> { wins: 12, losses: 4, pct: 0.75 }. Returns null if unparseable.
  const m = /(\d+)\s*-\s*(\d+)/.exec(rec || '');
  if (!m) return null;
  const w = parseInt(m[1], 10), l = parseInt(m[2], 10);
  if (w + l === 0) return null;
  return { wins: w, losses: l, pct: w / (w + l) };
}

export function streakBonus(streak) {
  // standings `extra` looks like "W3" or "L2". Cap at +/-0.02.
  const m = /^([WL])(\d+)/i.exec(streak || '');
  if (!m) return 0;
  const n = Math.min(parseInt(m[2], 10), 4);
  return (m[1].toUpperCase() === 'W' ? 1 : -1) * n * 0.005;
}

export function clampConfidence(x) {
  return Math.max(52, Math.min(85, Math.round(x)));
}

export function pickGame(league, home, away, homeStreak = '', awayStreak = '') {
  // home/away: { abbr, name, record }
  const hr = parseRecord(home.record), ar = parseRecord(away.record);
  const edge = HOME_EDGE[league] ?? 0.04;
  const hPct = hr ? hr.pct : 0.5, aPct = ar ? ar.pct : 0.5;
  const hStreak = streakBonus(homeStreak), aStreak = streakBonus(awayStreak);
  const hScore = hPct + edge + hStreak;
  const aScore = aPct + aStreak;
  const pickHome = hScore >= aScore;
  const chosen = pickHome ? home : away;
  const other = pickHome ? away : home;
  const chosenRec = pickHome ? hr : ar, otherRec = pickHome ? ar : hr;
  const margin = Math.abs(hScore - aScore);
  const confidence = clampConfidence(52 + margin * 120);

  // Reasoning: only real numbers. Never invent home/road splits, odds, totals.
  const bits = [];
  if (chosenRec && otherRec) {
    bits.push(`${chosen.name} ${chosenRec.wins}-${chosenRec.losses} (${chosenRec.pct.toFixed(3)}) vs ${other.name} ${otherRec.wins}-${otherRec.losses} (${otherRec.pct.toFixed(3)})`);
  } else if (chosenRec) {
    bits.push(`${chosen.name} ${chosenRec.wins}-${chosenRec.losses}`);
  }
  const chosenStreak = pickHome ? homeStreak : awayStreak;
  if (/^[WL]\d+/i.test(chosenStreak || '')) bits.push(`${chosen.abbr} riding a ${chosenStreak.toUpperCase()} streak`);
  if (pickHome) bits.push(`+${(edge * 100).toFixed(0)}% ${LEAGUES[league]?.label || league} home edge applied`);
  const reasoning = bits.length ? bits.join('; ') + '.' : 'Both teams even on available data; home edge decides.';

  return {
    league, home, away,
    pickTeam: { abbr: chosen.abbr, name: chosen.name },
    pickType: 'moneyline',
    confidence,
    reasoning,
  };
}

function eventIsToday(event, dateStr) {
  const ev = todayET(new Date(event.date));
  return ev === dateStr && event.status && event.status.state === 'pre';
}

async function buildStandingsMap(leagues) {
  const map = new Map(); // "league:ABBR" -> streak string
  await Promise.all(leagues.map(async (lg) => {
    try {
      const s = await getStandings(lg);
      for (const g of s.groups || []) for (const r of g.rows || []) {
        map.set(`${lg}:${(r.abbr || '').toUpperCase()}`, r.extra || '');
      }
    } catch { /* standings optional; model works without */ }
  }));
  return map;
}

const genInFlight = new Map();

export async function getPicks(dateStr = todayET(), leagues = LEAGUE_KEYS) {
  const existing = db.prepare('SELECT * FROM picks WHERE date = ? ORDER BY confidence DESC').all(dateStr);
  if (existing.length) { gradePicks(dateStr).catch(() => {}); return existing.map(rowToPick); }
  if (genInFlight.has(dateStr)) return genInFlight.get(dateStr);
  const p = generatePicks(dateStr, leagues);
  genInFlight.set(dateStr, p);
  try { return await p; } finally { genInFlight.delete(dateStr); }
}

async function generatePicks(dateStr, leagues) {
  const streaks = await buildStandingsMap(leagues);
  const insert = db.prepare(`INSERT OR IGNORE INTO picks
    (date, league, event_id, home, away, pick_team, pick_type, line, confidence, reasoning, issued_at, starts_at)
    VALUES (?, ?, ?, ?, ?, ?, 'moneyline', NULL, ?, ?, ?, ?)`);
  const made = [];
  for (const lg of leagues) {
    let events = [];
    try { ({ events } = await getScoreboard(lg)); } catch { continue; }
    for (const ev of events) {
      if (ev.kind !== 'match' || !eventIsToday(ev, dateStr)) continue;
      const home = { abbr: ev.home.abbr, name: ev.home.name, record: ev.home.record };
      const away = { abbr: ev.away.abbr, name: ev.away.name, record: ev.away.record };
      const pick = pickGame(lg, home, away,
        streaks.get(`${lg}:${home.abbr.toUpperCase()}`) || '',
        streaks.get(`${lg}:${away.abbr.toUpperCase()}`) || '');
      const added=insert.run(dateStr, lg, ev.id,
        `${home.abbr} ${home.name}`, `${away.abbr} ${away.name}`,
        `${pick.pickTeam.abbr} ${pick.pickTeam.name}`,
        pick.confidence, pick.reasoning, new Date().toISOString(), ev.date);
      if(added.changes)snapshotPick(Number(added.lastInsertRowid));
      made.push({ league: lg, eventId: ev.id, home, away, pick, startAt: ev.date });
    }
  }
  // Spread picks: one per qualifying moneyline pick, only with real market lines.
  if (oddsAvailable() && made.length) {
    const spreadInsert = db.prepare(`INSERT OR IGNORE INTO picks
      (date, league, event_id, home, away, pick_team, pick_type, line, confidence, reasoning, issued_at, starts_at)
      VALUES (?, ?, ?, ?, ?, ?, 'spread', ?, ?, ?, ?, ?)`);
    const byLeague = new Map();
    for (const m of made) {
      if (!byLeague.has(m.league)) byLeague.set(m.league, []);
      byLeague.get(m.league).push(m);
    }
    await Promise.all([...byLeague.entries()].map(async ([lg, items]) => {
      let oddsData;
      try { oddsData = await getOdds(lg); } catch { return; }
      if (!oddsData.events || !oddsData.events.length) return;
      for (const m of items) {
        const ev = findOddsForPick(oddsData, `${m.home.abbr} ${m.home.name}`, `${m.away.abbr} ${m.away.name}`);
        const sp = maybeSpreadPick(m.pick, ev);
        if (!sp) continue;
        const addedSpread=spreadInsert.run(dateStr, lg, m.eventId,
          `${m.home.abbr} ${m.home.name}`, `${m.away.abbr} ${m.away.name}`,
          `${sp.pickTeam.abbr} ${sp.pickTeam.name}`,
          sp.line, sp.confidence, sp.reasoning, new Date().toISOString(), m.startAt);
        if(addedSpread.changes)snapshotPick(Number(addedSpread.lastInsertRowid));
      }
    }));
  }
  const rows = db.prepare('SELECT * FROM picks WHERE date = ? ORDER BY confidence DESC').all(dateStr);
  gradePicks(dateStr).catch(() => {});
  return rows.map(rowToPick);
}

function rowToPick(r) {
  const [pickAbbr, ...pickName] = r.pick_team.split(' ');
  return {
    id: r.id, date: r.date, league: r.league, event_id: r.event_id,
    home: r.home, away: r.away,
    pickTeam: { abbr: pickAbbr, name: pickName.join(' ') },
    pickType: r.pick_type || 'moneyline',
    line: r.line || null,
    confidence: r.confidence, reasoning: r.reasoning,
    status: r.status, issuedAt:r.issued_at || null, startsAt:r.starts_at || null,
  };
}

// Honest spread lean: only when the moneyline model is strong (>=62%) AND a
// real market spread exists for the picked side. Returns null otherwise — we
// never invent a line.
export function maybeSpreadPick(mlPick, oddsEvent) {
  if (!mlPick || !oddsEvent || mlPick.confidence < 62) return null;
  const pickedAbbr = String(mlPick.pickTeam.abbr).toUpperCase();
  const homeAbbr = String(mlPick.home.abbr).toUpperCase();
  const side = pickedAbbr === homeAbbr ? 'home' : 'away';
  const best = bestSpread(oddsEvent.books, side);
  if (!best) return null;
  const bookCount = Object.keys(oddsEvent.books || {}).length;
  const confidence = Math.max(52, Math.min(66, Math.round(52 + (mlPick.confidence - 62) * 1.5)));
  const teamName = side === 'home' ? mlPick.home.name : mlPick.away.name;
  return {
    pickType: 'spread',
    pickTeam: mlPick.pickTeam,
    line: formatSpread(best.point),
    book: best.title,
    confidence,
    reasoning: `Real market line: ${teamName} ${formatSpread(best.point)} (best of ${bookCount} books, via ${best.title}). ` +
      `The Genius's moneyline model prices ${pickedAbbr} at ${mlPick.confidence}% — that edge carries to the spread at this number. ` +
      `Line is from the live market, not invented.`,
  };
}

// Grade pending picks for a date against completed scoreboard events.
export async function gradePicks(dateStr) {
  const pending = db.prepare("SELECT * FROM picks WHERE date = ? AND status = 'pending'").all(dateStr);
  if (!pending.length) return { graded: 0 };
  let graded = 0;
  for (const lg of LEAGUE_KEYS) {
    let events = [];
    try { ({ events } = await getScoreboard(lg)); } catch { continue; }
    const byId = new Map(events.map(e => [String(e.id), e]));
    for (const p of pending.filter(x => x.league === lg)) {
      const ev = byId.get(String(p.event_id));
      if (!ev || ev.status.state !== 'post') continue;
      if (p.pick_type === 'spread') {
        // Grade against the final score and the stored real market line.
        const hs = Number(ev.home.score), as = Number(ev.away.score);
        const line = parseFloat(p.line);
        const pickedIsHome = p.pick_team.split(' ')[0].toUpperCase() === String(ev.home.abbr).toUpperCase();
        if (!Number.isFinite(hs) || !Number.isFinite(as) || !Number.isFinite(line)) continue;
        const margin = pickedIsHome ? hs - as : as - hs;
        const diff = margin + line; // line negative for the favorite
        const result = Math.abs(diff) < 1e-9 ? 'push' : diff > 0 ? 'win' : 'loss';
        db.prepare("UPDATE picks SET status = ?, graded_at = datetime('now') WHERE id = ?").run(result, p.id);
        graded++;
        continue;
      }
      const winner = ev.home.winner ? 'home' : ev.away.winner ? 'away' : null;
      if (!winner) continue;
      const pickedAbbr = p.pick_team.split(' ')[0].toUpperCase();
      const won = (winner === 'home' ? ev.home.abbr : ev.away.abbr).toUpperCase() === pickedAbbr;
      db.prepare("UPDATE picks SET status = ?, graded_at = datetime('now') WHERE id = ?")
        .run(won ? 'win' : 'loss', p.id);
      graded++;
    }
  }
  return { graded };
}

// Real track record over graded picks from the last 30 days. If fewer than 5
// graded picks exist, return calibrating: true — never show a fake number.
export function trackRecord() {
  const row = db.prepare(`SELECT
      COUNT(*) AS n,
      SUM(CASE WHEN status = 'win' THEN 1 ELSE 0 END) AS wins,
      SUM(CASE WHEN status = 'loss' THEN 1 ELSE 0 END) AS losses
    FROM picks WHERE status IN ('win','loss')
      AND issued_at IS NOT NULL AND starts_at IS NOT NULL AND issued_at < starts_at
      AND date >= date('now', '-30 days')`).get();
  const n = row.n || 0, wins = row.wins || 0, losses = row.losses || 0;
  if (n < 5) return { calibrating: true, graded: n };
  return { calibrating: false, graded: n, wins, losses, winRate: +(wins / n * 100).toFixed(1) };
}

export const DISCLAIMER = 'For entertainment only. Not gambling advice.';


// Regrade only outstanding recent picks, using the game-date scoreboard rather
// than relying on today's scoreboard endpoint. Runs at startup and hourly.
export async function reconcileRecentPicks() {
 const dates=db.prepare("SELECT DISTINCT date,league FROM picks WHERE status='pending' AND date >= date('now','-14 days')").all();
 let graded=0;
 for(const entry of dates){
  const day=String(entry.date).replace(/-/g,'');
  if(!/^\d{8}$/.test(day))continue;
  let games=[];
  try{games=await fetchHistoricalScoreboard(entry.league,day);}catch{continue}
  const events=new Map(games.filter(x=>x.status.state==='post').map(x=>[String(x.id),x]));
  const rows=db.prepare("SELECT * FROM picks WHERE date=? AND league=? AND status='pending'").all(entry.date,entry.league);
  for(const p of rows){
   const game=events.get(String(p.event_id));if(!game)continue;
   const hs=Number(game.home.score),as=Number(game.away.score);
   if(!Number.isFinite(hs)||!Number.isFinite(as))continue;
   const home=String(p.pick_team).split(' ')[0].toUpperCase()===String(game.home.abbr).toUpperCase();
   let result;
   if(p.pick_type==='spread'){
    const line=Number(p.line);if(!Number.isFinite(line))continue;
    const value=(home?hs-as:as-hs)+line;
    result=value===0?'push':value>0?'win':'loss';
   } else {
    if(hs===as)continue;
    result=(home?hs>as:as>hs)?'win':'loss';
   }
   db.prepare("UPDATE picks SET status=?,graded_at=datetime('now') WHERE id=? AND status='pending'").run(result,p.id);
   graded++;
  }
 }
 return {graded};
}
