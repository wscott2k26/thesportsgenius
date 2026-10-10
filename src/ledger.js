import { createHash } from 'node:crypto';
import { db } from './db.js';
db.exec(`CREATE TABLE IF NOT EXISTS pick_ledger (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 pick_id INTEGER UNIQUE NOT NULL,
 previous_hash TEXT NOT NULL,
 entry_hash TEXT NOT NULL,
 snapshot TEXT NOT NULL,
 recorded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
)`);
const fields=['id','date','league','event_id','home','away','pick_team','pick_type','line','confidence','reasoning','issued_at','starts_at'];
const digest=s=>createHash('sha256').update(s).digest('hex');
export function snapshotPick(id){
 const p=db.prepare('SELECT * FROM picks WHERE id=?').get(id);
 if(!p?.issued_at||!p?.starts_at||p.issued_at>=p.starts_at)return;
 const snapshot=JSON.stringify(Object.fromEntries(fields.map(k=>[k,p[k]??null])));
 const last=db.prepare('SELECT entry_hash FROM pick_ledger ORDER BY id DESC LIMIT 1').get();
 const prev=last?.entry_hash||'GENESIS';
 db.prepare('INSERT OR IGNORE INTO pick_ledger (pick_id,previous_hash,entry_hash,snapshot) VALUES (?,?,?,?)').run(id,prev,digest(prev+'\n'+snapshot),snapshot);
}
export function integrity(){
 const rows=db.prepare('SELECT * FROM pick_ledger ORDER BY id').all();
 let prev='GENESIS';
 for(const entry of rows){
  if(entry.previous_hash!==prev||entry.entry_hash!==digest(prev+'\n'+entry.snapshot))return {valid:false,count:rows.length,failedId:entry.id,externallyAnchored:false};
  const original=db.prepare('SELECT * FROM picks WHERE id=?').get(entry.pick_id);
  if(!original)return {valid:false,count:rows.length,failedId:entry.id,externallyAnchored:false};
  const current=JSON.stringify(Object.fromEntries(fields.map(k=>[k,original[k]??null])));
  if(current!==entry.snapshot)return {valid:false,count:rows.length,failedId:entry.id,externallyAnchored:false};
  prev=entry.entry_hash;
 }
 return {valid:true,count:rows.length,root:prev,externallyAnchored:false};
}
