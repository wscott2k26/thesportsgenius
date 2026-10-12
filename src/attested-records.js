// Separately disclosed, owner-attested historical outcomes. Never modify
// timestamp-verified model picks or the immutable pick_ledger here.
import { createHash } from 'node:crypto';
import { db, todayET } from './db.js';

db.exec(`
CREATE TABLE IF NOT EXISTS owner_attested_picks (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 unique_key TEXT NOT NULL UNIQUE,
 date TEXT NOT NULL,
 league TEXT NOT NULL,
 matchup TEXT NOT NULL,
 selected TEXT NOT NULL,
 pick_type TEXT NOT NULL DEFAULT 'moneyline',
 result TEXT NOT NULL CHECK(result IN ('win','loss','push')),
 final_score TEXT NOT NULL,
 confidence INTEGER,
 source TEXT NOT NULL DEFAULT '',
 notes TEXT NOT NULL DEFAULT '',
 recorded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_attested_date ON owner_attested_picks(date);
`);

// Preserve the previously published user-attested prelaunch entry.
// This is a historical claim, NOT proof of a before-first-pitch prediction.
// Retain the original public label and source unless the owner supplies a correction.
export const ORIGINAL_PRELAUNCH = Object.freeze({
  id: 'legacy-prelaunch-20261008-cle',
  date: '2026-10-08',
  league: 'mlb',
  matchup: 'Cleveland Guardians at Chicago White Sox',
  selected: 'Cleveland Guardians',
  pickType: 'moneyline',
  result: 'win',
  finalScore: 'CLE 9 - CWS 5',
  confidence: 54,
  provenance: 'user-attested prelaunch prediction',
  issuedBeforeGame: 'reported by owner; original timestamp not independently verified',
  source: 'https://www.mlb.com/guardians/video/steven-kwan-makes-the-catch-to-secure-game-4-victory',
  notes: '',
  recordedAt: null,
});

const clean = (v, max = 200) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
const norm = s => clean(s, 400).toLowerCase();
const dateValid = s => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) &&
  new Date(s).toISOString().slice(0, 10) === s;

export function uniqueAttestedKey({date, league, matchup, selected, pickType}) {
  const canonical = [date, norm(league), norm(matchup), norm(selected), norm(pickType || 'moneyline')].join('|');
  return createHash('sha256').update(canonical).digest('hex');
}

function storedToPublic(row) {
  return {
    id: row.id, date: row.date, league: row.league, matchup: row.matchup,
    selected: row.selected, pickType: row.pick_type, result: row.result,
    finalScore: row.final_score, confidence: row.confidence, source: row.source,
    notes: row.notes, recordedAt: row.recorded_at,
    provenance: 'owner-attested historical outcome',
    issuedBeforeGame: 'original pregame timestamp not independently verified',
  };
}

export function listOwnerAttested() {
  const rows = db.prepare('SELECT * FROM owner_attested_picks ORDER BY date DESC, id DESC LIMIT 199').all();
  const originalKey = uniqueAttestedKey(ORIGINAL_PRELAUNCH);
  const records = [ORIGINAL_PRELAUNCH, ...rows.filter(r => r.unique_key !== originalKey).map(storedToPublic)]
    .sort((a,b) => b.date.localeCompare(a.date) || String(b.id).localeCompare(String(a.id)));
  const wins = records.filter(r => r.result === 'win').length;
  const losses = records.filter(r => r.result === 'loss').length;
  const pushes = records.filter(r => r.result === 'push').length;
  return {
    records, attested: { wins, losses, pushes, total: records.length },
    notice: 'Owner-attested historical outcomes. The original pregame prediction timestamps have not been independently verified. Excluded from the verified live-model track record and hash-chained pregame ledger.',
  };
}

export function addOwnerAttested(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw Object.assign(new Error('Pick details required.'), { status: 400 });
  const date = clean(input.date, 10), league = clean(input.league, 12).toLowerCase();
  const matchup = clean(input.matchup, 160), selected = clean(input.selected, 90);
  const pickType = clean(input.pickType || 'moneyline', 20).toLowerCase();
  const result = clean(input.result, 20).toLowerCase();
  const finalScore = clean(input.finalScore, 90);
  const source = clean(input.source, 500), notes = clean(input.notes, 600);
  const confidence = input.confidence === '' || input.confidence == null ? null : Number(input.confidence);
  if (!dateValid(date) || date > todayET()) throw Object.assign(new Error('A completed-game date (YYYY-MM-DD) is required.'),{status:400});
  if (!['mlb','nfl','nba','nhl','ncaaf','ncaab','wnba','soccer','tennis'].includes(league))
    throw Object.assign(new Error('Choose a supported league.'),{status:400});
  if (matchup.length < 7 || selected.length < 2 || finalScore.length < 3 || finalScore.length > 90)
    throw Object.assign(new Error('Matchup, selection and final score are required.'),{status:400});
  if (!['moneyline','spread','total'].includes(pickType) || !['win','loss','push'].includes(result))
    throw Object.assign(new Error('Invalid pick type or result.'),{status:400});
  if (confidence !== null && (!Number.isInteger(confidence) || confidence < 0 || confidence > 100))
    throw Object.assign(new Error('Confidence must be 0–100 or blank.'),{status:400});
  if (source && (!/^https:\/\//i.test(source) || source.length > 500))
    throw Object.assign(new Error('Source must be an HTTPS link or left blank.'),{status:400});
  if (input.ownerAttested !== true)
    throw Object.assign(new Error('Confirm this is an owner-attested historical result, not a verified pregame prediction.'),{status:400});

  const key = uniqueAttestedKey({date,league,matchup,selected,pickType});
  if (key === uniqueAttestedKey(ORIGINAL_PRELAUNCH))
    return { created: false, alreadyPresent: true, record: ORIGINAL_PRELAUNCH };
  const insert = db.prepare(`INSERT OR IGNORE INTO owner_attested_picks
    (unique_key,date,league,matchup,selected,pick_type,result,final_score,confidence,source,notes)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(key,date,league,matchup,selected,pickType,result,finalScore,confidence,source,notes);
  const row = db.prepare('SELECT * FROM owner_attested_picks WHERE unique_key=?').get(key);
  return { created: insert.changes === 1, alreadyPresent: insert.changes === 0, record: storedToPublic(row) };
}
