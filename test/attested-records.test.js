// Integration coverage for historical owner-attested records. DB_PATH=:memory:.
import { before, after, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/db.js';
import app from '../src/app.js';

process.env.ADMIN_EMAILS = 'ledger-admin@example.test';
let server, base, token;
const historical = {
  date: '2026-10-11', league: 'mlb',
  matchup: 'Cleveland Guardians vs. Example Opponent',
  selected: 'Cleveland Guardians', pickType: 'moneyline',
  result: 'loss', finalScore: 'CLE 1 - OPP 3',
  ownerAttested: true, notes: 'Test fixture, not real MLB history',
};
async function req(path, opts = {}) {
  const { admin = false, body = undefined, ...other } = opts;
  const headers = { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...other.headers };
  if (admin) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(base + path, { ...other, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  return { code: res.status, body: await res.json() };
}

before(async () => {
  db.prepare("INSERT INTO users (email,pass_hash) VALUES ('ledger-admin@example.test','ignored-in-this-test')").run();
  const user = db.prepare("SELECT id FROM users WHERE email='ledger-admin@example.test'").get();
  token = 'historical-record-test-token';
  db.prepare("INSERT INTO sessions (token,user_id,expires_at) VALUES (?,?,datetime('now','+1 hour'))").run(token,user.id);
  server = await new Promise(resolve => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  base = 'http://127.0.0.1:' + server.address().port;
});
after(async () => { await new Promise(resolve => server.close(resolve)); });
beforeEach(() => { db.prepare('DELETE FROM owner_attested_picks').run(); });

describe('owner-attested pick archive', () => {
  it('preserves the existing separately labeled prelaunch pick', async () => {
    const r = await req('/api/prelaunch-record');
    assert.equal(r.code, 200);
    assert.equal(r.body.records.length, 1);
    assert.equal(r.body.attested.wins, 1);
    assert.equal(r.body.attested.losses, 0);
    assert.match(r.body.notice, /excluded from the verified/i);
  });

  it('requires admin authorization and explicit provenance', async () => {
    const blocked = await req('/api/admin/prelaunch-record', { method: 'POST', body: historical });
    assert.equal(blocked.code, 403);
    const unconfirmed = await req('/api/admin/prelaunch-record', { method:'POST', admin:true, body:{...historical,ownerAttested:false} });
    assert.equal(unconfirmed.code, 400);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM owner_attested_picks').get().n, 0);
  });

  it('stores a completed loss only once without modifying the verified record', async () => {
    const verifiedBefore = (await req('/api/track-record')).body;
    const r1 = await req('/api/admin/prelaunch-record', { method:'POST', admin:true, body:historical });
    assert.equal(r1.code, 201);
    assert.equal(r1.body.created, true);
    const r2 = await req('/api/admin/prelaunch-record', { method:'POST', admin:true, body:{
      ...historical,
      selected: ' CLEVELAND  GUARDIANS ',
      matchup: '  cleveland   GUARDIANS vs. example opponent ',
      result: 'win', // must never silently alter an existing archived outcome
    }});
    assert.equal(r2.code, 200);
    assert.equal(r2.body.alreadyPresent, true);
    const archived = (await req('/api/prelaunch-record')).body;
    assert.equal(archived.attested.wins, 1);
    assert.equal(archived.attested.losses, 1);
    assert.equal(archived.records.length, 2);
    assert.ok(archived.records.every(p => /owner-attested|user-attested/.test(p.provenance)));
    assert.equal(db.prepare('SELECT COUNT(*) n FROM owner_attested_picks').get().n, 1);
    assert.deepEqual((await req('/api/track-record')).body, verifiedBefore);
  });

  it('does not duplicate the legacy pick', async () => {
    const duplicate = await req('/api/admin/prelaunch-record', { method:'POST', admin:true, body:{
      ...historical, date:'2026-10-08',
      matchup:'Cleveland Guardians at Chicago White Sox',
      selected:'Cleveland Guardians',result:'win',
      finalScore:'CLE 9 - CWS 5',
    }});
    assert.equal(duplicate.code, 200);
    assert.equal(duplicate.body.alreadyPresent, true);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM owner_attested_picks').get().n, 0);
  });

  it('rejects incomplete, future, or misleading entries', async () => {
    for (const patch of [
      { finalScore:'' },
      { date:'2099-01-01' },
      { league:'unknown' },
      { source:'javascript:alert(1)' },
      { confidence:101 },
      { result:'pending' },
    ]) {
      const r = await req('/api/admin/prelaunch-record', { method:'POST', admin:true, body:{...historical,...patch} });
      assert.equal(r.code, 400, JSON.stringify(patch));
    }
    assert.equal(db.prepare('SELECT COUNT(*) n FROM owner_attested_picks').get().n, 0);
  });
});
