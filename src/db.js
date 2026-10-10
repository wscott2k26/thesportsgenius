// SQLite storage layer (better-sqlite3). DB_PATH env, default ./data/genius.db.
import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';

const dbPath = process.env.DB_PATH || path.join(process.cwd(), 'data', 'genius.db');
if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });

export const db = new Database(dbPath);

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  pass_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  premium_until TEXT,
  openai_key TEXT
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS favorites (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  team_key TEXT NOT NULL,
  league TEXT NOT NULL,
  abbr TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, team_key)
);
CREATE TABLE IF NOT EXISTS chat_usage (
  day TEXT NOT NULL,
  who TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, who)
);
CREATE TABLE IF NOT EXISTS picks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  league TEXT NOT NULL,
  event_id TEXT NOT NULL,
  home TEXT NOT NULL,
  away TEXT NOT NULL,
  pick_team TEXT NOT NULL,
  confidence INTEGER NOT NULL,
  reasoning TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  graded_at TEXT,
  UNIQUE(date, league, event_id)
);
CREATE INDEX IF NOT EXISTS idx_picks_date ON picks(date);
CREATE INDEX IF NOT EXISTS idx_picks_status ON picks(status);
CREATE TABLE IF NOT EXISTS affiliates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  promo TEXT NOT NULL DEFAULT '',
  priority INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS affiliate_clicks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL DEFAULT (datetime('now')),
  sportsbook TEXT NOT NULL,
  pick_id INTEGER,
  user_id INTEGER
);
CREATE INDEX IF NOT EXISTS idx_aff_clicks_book ON affiliate_clicks(sportsbook);
CREATE TABLE IF NOT EXISTS bets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  league TEXT NOT NULL DEFAULT '',
  matchup TEXT NOT NULL,
  bet_type TEXT NOT NULL DEFAULT 'moneyline',
  selection TEXT NOT NULL,
  book TEXT NOT NULL DEFAULT '',
  stake REAL NOT NULL,
  odds INTEGER NOT NULL,
  result TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  graded_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_bets_user ON bets(user_id);
CREATE TABLE IF NOT EXISTS odds_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_key TEXT NOT NULL,
  league TEXT NOT NULL,
  home_team TEXT NOT NULL DEFAULT '',
  away_team TEXT NOT NULL DEFAULT '',
  commence TEXT NOT NULL DEFAULT '',
  book TEXT NOT NULL,
  market TEXT NOT NULL,
  side TEXT NOT NULL,
  line REAL,
  price INTEGER NOT NULL,
  ts TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_odds_hist_game ON odds_history(game_key, book, market, side, ts);
CREATE INDEX IF NOT EXISTS idx_odds_hist_ts ON odds_history(ts);
CREATE TABLE IF NOT EXISTS offers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_name TEXT NOT NULL,
  title TEXT NOT NULL,
  terms TEXT NOT NULL DEFAULT '',
  promo_code TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  affiliate_id INTEGER REFERENCES affiliates(id) ON DELETE SET NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// v2 migration: picks gains pick_type ('moneyline'|'spread') + line (e.g. '-3.5').
// Old rows keep their data; uniqueness becomes (date, league, event_id, pick_type).
{
  const cols = db.prepare('PRAGMA table_info(picks)').all().map(c => c.name);
  if (!cols.includes('pick_type')) {
    db.exec(`
      CREATE TABLE picks_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL,
        league TEXT NOT NULL,
        event_id TEXT NOT NULL,
        home TEXT NOT NULL,
        away TEXT NOT NULL,
        pick_team TEXT NOT NULL,
        pick_type TEXT NOT NULL DEFAULT 'moneyline',
        line TEXT,
        confidence INTEGER NOT NULL,
        reasoning TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        graded_at TEXT,
        UNIQUE(date, league, event_id, pick_type)
      );
      INSERT INTO picks_new (id, date, league, event_id, home, away, pick_team, pick_type, line, confidence, reasoning, status, graded_at)
        SELECT id, date, league, event_id, home, away, pick_team, 'moneyline', NULL, confidence, reasoning, status, graded_at FROM picks;
      DROP TABLE picks;
      ALTER TABLE picks_new RENAME TO picks;
      CREATE INDEX idx_picks_date ON picks(date);
      CREATE INDEX idx_picks_status ON picks(status);
    `);
  }
}

export function todayET(d = new Date()) {  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  return p; // YYYY-MM-DD
}

export function isPremium(user) {
  return !!(user && user.premium_until && new Date(user.premium_until) > new Date());
}


// Verification fields are intentionally NULL for legacy picks without original issuance evidence.
{
  const cols = db.prepare('PRAGMA table_info(picks)').all().map(c => c.name);
  if (!cols.includes('issued_at')) db.exec('ALTER TABLE picks ADD COLUMN issued_at TEXT');
  if (!cols.includes('starts_at')) db.exec('ALTER TABLE picks ADD COLUMN starts_at TEXT');
}
