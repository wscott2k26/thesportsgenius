import {describe,it,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import app from '../src/app.js';
import {db} from '../src/db.js';
import {snapshotPick,integrity} from '../src/ledger.js';
let server,base;
before(async()=>{await new Promise(resolve=>{server=app.listen(0,resolve)});base='http://127.0.0.1:'+server.address().port});
after(()=>new Promise(resolve=>server.close(resolve)));
describe('subscription security',()=>{
 it('keeps live checkout gated without Stripe keys',async()=>{
  const r=await fetch(base+'/api/billing');
  assert.equal(r.status,200);assert.equal((await r.json()).checkoutEnabled,false);
  const checkout=await fetch(base+'/api/billing/checkout',{method:'POST'});
  assert.equal(checkout.status,401);
 });
 it('rejects unsigned Stripe webhooks and accepts signed subscription events',async()=>{
  const secret='whsec_release_test';
  process.env.STRIPE_WEBHOOK_SECRET=secret;
  const user=db.prepare("INSERT INTO users(email,pass_hash,stripe_customer_id) VALUES (?,?,?)").run('release-test@example.invalid','unused','cus_release_fake');
  const event={id:'evt_release_test',type:'customer.subscription.updated',
   data:{object:{customer:'cus_release_fake',id:'sub_release_fake',status:'active',current_period_end:1940000000}}};
  const payload=JSON.stringify(event);
  const bad=await fetch(base+'/api/stripe/webhook',{method:'POST',headers:{'content-type':'application/json','stripe-signature':'t=123,v1=abc'},body:payload});
  assert.equal(bad.status,400);
  const t=Math.floor(Date.now()/1000);
  const signature=createHmac('sha256',secret).update(t+'.'+payload).digest('hex');
  const opts={method:'POST',headers:{'content-type':'application/json','stripe-signature':`t=${t},v1=${signature}`},body:payload};
  const valid=await fetch(base+'/api/stripe/webhook',opts);
  assert.equal(valid.status,200);
  const row=db.prepare('SELECT premium_until FROM users WHERE id=?').get(user.lastInsertRowid);
  assert.ok(new Date(row.premium_until)>new Date());
  const again=await fetch(base+'/api/stripe/webhook',opts);
  assert.equal(again.status,200);
  assert.equal(db.prepare('SELECT count(*) AS n FROM stripe_events WHERE id=?').get(event.id).n,1);
  delete process.env.STRIPE_WEBHOOK_SECRET;
 });
});
describe('prediction integrity',()=>{
 it('detects changes to snapshotted picks',()=>{
  const pick=db.prepare(`INSERT INTO picks(date,league,event_id,home,away,pick_team,confidence,reasoning,issued_at,starts_at,status)
   VALUES ('2026-10-10','nfl','proof-release','KC Chiefs','BUF Bills','KC Chiefs',65,'before game','2026-10-10T10:00:00Z','2026-10-10T15:00:00Z','pending')`).run();
  snapshotPick(Number(pick.lastInsertRowid));
  assert.equal(integrity().valid,true);
  db.prepare('UPDATE picks SET reasoning=? WHERE id=?').run('altered after issuance',pick.lastInsertRowid);
  assert.equal(integrity().valid,false);
 });
});


describe('background push gating',()=>{
 it('exposes configuration without private keys and requires a signed-in user',async()=>{
  const config=await fetch(base+'/api/push/config');assert.equal(config.status,200);
  const json=await config.json();assert.equal(typeof json.available,'boolean');
  assert.equal('privateKey' in json,false);
  const sub=await fetch(base+'/api/push/subscribe',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({endpoint:'https://example.invalid/x',keys:{auth:'a',p256dh:'p'}})});
  assert.equal(sub.status,401);
 });
});
