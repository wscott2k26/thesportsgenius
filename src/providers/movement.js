// Line movement tracking: snapshots of every odds refresh are stored in the
// odds_history table, and open-vs-current movement is computed from real
// snapshots only. Nothing here is simulated — no snapshots, no movement.

import { db } from '../db.js';

// Stable game identity across refreshes (Odds API event ids can rotate).
export function gameKey(homeTeam, awayTeam, commence) {
  const n = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return `${n(awayTeam)}-at-${n(homeTeam)}-${String(commence || '').slice(0, 10)}`;
}

// Movement thresholds: moneyline >= 15 cents, spread/total >= 0.5 point.
export const MOVE_THRESHOLDS = { h2h: 15, spreads: 0.5, totals: 0.5 };

// open/current: { price, line }. Returns { moved, delta, dir, magnitude, unit }.
// For moneyline, dir 'toward' means the price shortened (money coming in on
// that side); 'away' means it drifted. For spread/total, dir is the point
// direction ('up'/'down').
export function detectMove(market, open, current) {
  if (!open || !current) return { moved: false, delta: 0 };
  if (market === 'h2h') {
    const delta = Number(current.price) - Number(open.price);
    if (!Number.isFinite(delta) || Math.abs(delta) < MOVE_THRESHOLDS.h2h) return { moved: false, delta };
    return {
      moved: true, delta,
      dir: delta < 0 ? 'toward' : 'away',
      magnitude: Math.abs(delta), unit: 'cents',
    };
  }
  if (market === 'spreads' || market === 'totals') {
    const delta = Number(current.line) - Number(open.line);
    if (!Number.isFinite(delta) || Math.abs(delta) < MOVE_THRESHOLDS[market]) return { moved: false, delta };
    return {
      moved: true, delta,
      dir: delta < 0 ? 'down' : 'up',
      magnitude: Math.abs(delta), unit: 'points',
    };
  }
  return { moved: false, delta: 0 };
}

// Steam = 3+ distinct books moving the same direction on the same
// (game, market, side). Returned as a boolean per game.
export function steamDirections(moves) {
  const dirBooks = {};
  for (const m of moves || []) {
    if (!m.moved) continue;
    const dk = `${m.market}|${m.side}|${m.dir}`;
    (dirBooks[dk] = dirBooks[dk] || new Set()).add(m.book);
  }
  return Object.values(dirBooks).some(s => s.size >= 3);
}

// Persist one snapshot row per (game, book, market, side). Prunes rows older
// than 7 days so the table stays bounded.
export function snapshotOdds(league, events) {
  db.prepare("DELETE FROM odds_history WHERE ts < datetime('now', '-7 days')").run();
  const ins = db.prepare(`INSERT INTO odds_history
    (game_key, league, home_team, away_team, commence, book, market, side, line, price)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const rows = [];
  for (const e of events || []) {
    const gk = e.gameKey || gameKey(e.homeTeam, e.awayTeam, e.commence);
    for (const [book, b] of Object.entries(e.books || {})) {
      if (b.h2h) {
        if (b.h2h.home != null) rows.push([gk, league, e.homeTeam || '', e.awayTeam || '', e.commence || '', book, 'h2h', 'home', null, b.h2h.home]);
        if (b.h2h.away != null) rows.push([gk, league, e.homeTeam || '', e.awayTeam || '', e.commence || '', book, 'h2h', 'away', null, b.h2h.away]);
      }
      if (b.spread && b.spread.point != null) {
        if (b.spread.home != null) rows.push([gk, league, e.homeTeam || '', e.awayTeam || '', e.commence || '', book, 'spreads', 'home', b.spread.point, b.spread.home]);
        if (b.spread.away != null) rows.push([gk, league, e.homeTeam || '', e.awayTeam || '', e.commence || '', book, 'spreads', 'away', -b.spread.point, b.spread.away]);
      }
      if (b.total && b.total.point != null) {
        if (b.total.over != null) rows.push([gk, league, e.homeTeam || '', e.awayTeam || '', e.commence || '', book, 'totals', 'over', b.total.point, b.total.over]);
        if (b.total.under != null) rows.push([gk, league, e.homeTeam || '', e.awayTeam || '', e.commence || '', book, 'totals', 'under', b.total.point, b.total.under]);
      }
    }
  }
  db.transaction(rs => { for (const r of rs) ins.run(...r); })(rows);
  return { snapshots: rows.length };
}

// Open-vs-current movement per game, from real snapshots in the last 3 days.
// Only games with at least one qualifying move are returned.
export function getMovements(league) {
  const params = league ? [league] : [];
  const rows = db.prepare(`SELECT * FROM odds_history
    WHERE ts > datetime('now', '-3 days')${league ? ' AND league = ?' : ''}
    ORDER BY game_key, book, market, side, ts`).all(...params);
  const groups = new Map();
  for (const r of rows) {
    const k = `${r.game_key}|${r.book}|${r.market}|${r.side}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  const games = new Map();
  for (const rs of groups.values()) {
    if (rs.length < 2) continue; // need an open and a current
    const open = rs[0], cur = rs[rs.length - 1];
    const mv = detectMove(rs[0].market,
      { price: open.price, line: open.line },
      { price: cur.price, line: cur.line });
    if (!mv.moved) continue;
    const gk = rs[0].game_key;
    if (!games.has(gk)) {
      games.set(gk, {
        gameKey: gk, league: rs[0].league,
        homeTeam: rs[0].home_team, awayTeam: rs[0].away_team, commence: rs[0].commence,
        moves: [],
      });
    }
    games.get(gk).moves.push({
      book: rs[0].book, market: rs[0].market, side: rs[0].side,
      open: { price: open.price, line: open.line, at: open.ts },
      current: { price: cur.price, line: cur.line, at: cur.ts },
      ...mv,
    });
  }
  const out = [...games.values()];
  for (const g of out) {
    g.steam = steamDirections(g.moves);
    g.moves.sort((a, b) => b.magnitude - a.magnitude);
  }
  out.sort((a, b) => Number(b.steam) - Number(a.steam) || b.moves.length - a.moves.length);
  return out;
}

// Per-book open/current + full point series for a sparkline.
export function movementSummary(gameKeyStr, market = 'h2h', side = 'home') {
  const rows = db.prepare(`SELECT book, ts, price, line FROM odds_history
    WHERE game_key = ? AND market = ? AND side = ? AND ts > datetime('now', '-3 days')
    ORDER BY book, ts`).all(gameKeyStr, market, side);
  const byBook = {};
  for (const r of rows) {
    (byBook[r.book] = byBook[r.book] || []).push(r);
  }
  const out = {};
  for (const [book, rs] of Object.entries(byBook)) {
    if (rs.length < 2) continue;
    const open = rs[0], cur = rs[rs.length - 1];
    const mv = detectMove(market, { price: open.price, line: open.line }, { price: cur.price, line: cur.line });
    out[book] = {
      open: { price: open.price, line: open.line },
      current: { price: cur.price, line: cur.line },
      moved: mv.moved, delta: mv.delta || 0, dir: mv.dir || null,
      unit: mv.unit || null, magnitude: mv.magnitude || 0,
      points: rs.map(p => ({ t: p.ts, price: p.price, line: p.line })),
    };
  }
  return out;
}

export function getLineHistory(gameKeyStr, { book, market, side } = {}) {
  let sql = 'SELECT ts, price, line FROM odds_history WHERE game_key = ?';
  const params = [gameKeyStr];
  if (book) { sql += ' AND book = ?'; params.push(book); }
  if (market) { sql += ' AND market = ?'; params.push(market); }
  if (side) { sql += ' AND side = ?'; params.push(side); }
  sql += ' ORDER BY ts ASC LIMIT 500';
  return db.prepare(sql).all(...params);
}
