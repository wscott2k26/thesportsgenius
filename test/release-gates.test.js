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
 it('rejects unsigned events and reconciles out-of-order updates with current Stripe state',async()=>{
   const secret='whsec_release_test';
   const prior={ webhook:process.env.STRIPE_WEBHOOK_SECRET, key:process.env.STRIPE_SECRET_KEY, price:process.env.STRIPE_PRICE_ID };
   const realFetch=globalThis.fetch;
   process.env.STRIPE_WEBHOOK_SECRET=secret;
   process.env.STRIPE_SECRET_KEY='sk_live_ISOLATED_MOCK_DO_NOT_USE';
   process.env.STRIPE_PRICE_ID='price_release_test';
   let actualStatus='active', stripeReads=0;
   globalThis.fetch=(url,opts={})=>{
     if(String(url).startsWith('https://api.stripe.com/v1/subscriptions?')){
       stripeReads++;
       assert.match(String(url),/customer=cus_releasefake/);
       const sub={id:'sub_release_fake',status:actualStatus,
         current_period_end:1940000000,
         items:{data:[{price:{id:'price_release_test'},current_period_end:1940000000}]}};
       return Promise.resolve(new Response(JSON.stringify({data:[sub],has_more:false}),{status:200,headers:{'content-type':'application/json'}}));
     }
     return realFetch(url,opts);
   };
   const user=db.prepare("INSERT INTO users(email,pass_hash,stripe_customer_id) VALUES (?,?,?)")
     .run('release-test@example.invalid','unused','cus_releasefake');
   async function send(id,status,type='customer.subscription.updated'){
     const event={id,type,data:{object:{customer:'cus_releasefake',id:'sub_release_fake',status,
       current_period_end:1940000000,
       items:{data:[{price:{id:'price_release_test'},current_period_end:1940000000}]}}}};
     const payload=JSON.stringify(event);
     const t=Math.floor(Date.now()/1000);
     const sig=createHmac('sha256',secret).update(t+'.'+payload).digest('hex');
     return fetch(base+'/api/stripe/webhook',{method:'POST',
       headers:{'content-type':'application/json','stripe-signature':'t='+t+',v1='+sig},body:payload});
   }
   try{
     const invalid=await fetch(base+'/api/stripe/webhook',{method:'POST',headers:{'content-type':'application/json','stripe-signature':'t=123,v1=abc'},body:'{}'});
     assert.equal(invalid.status,400);
     assert.equal((await send('evt_release_active','active')).status,200);
     let row=db.prepare('SELECT premium_until FROM users WHERE id=?').get(user.lastInsertRowid);
     assert.ok(new Date(row.premium_until)>new Date());
     actualStatus='canceled';
     assert.equal((await send('evt_release_cancel','canceled','customer.subscription.deleted')).status,200);
     row=db.prepare('SELECT premium_until FROM users WHERE id=?').get(user.lastInsertRowid);
     assert.equal(row.premium_until,null);
     // Delayed CREATED event cannot resurrect a canceled subscription.
     assert.equal((await send('evt_release_delayed_created','active','customer.subscription.created')).status,200);
     row=db.prepare('SELECT premium_until FROM users WHERE id=?').get(user.lastInsertRowid);
     assert.equal(row.premium_until,null);
     assert.equal((await send('evt_release_active','active')).status,200);
     assert.equal(db.prepare('SELECT count(*) AS n FROM stripe_events WHERE id=?').get('evt_release_active').n,1);
     assert.equal(stripeReads,3,'duplicate events must not call Stripe again');
   }finally{
     globalThis.fetch=realFetch;
     for(const [key,val] of Object.entries({STRIPE_WEBHOOK_SECRET:prior.webhook,STRIPE_SECRET_KEY:prior.key,STRIPE_PRICE_ID:prior.price}))
       if(val===undefined)delete process.env[key];else process.env[key]=val;
   }
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
