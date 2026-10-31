import {createHmac,timingSafeEqual} from 'node:crypto';
import {Router,raw} from 'express';
import {db,isPremium} from './db.js';
import {selectSportsSubscription} from './subscription-state.js';
export const billingRouter=Router();
export const stripeWebhookRouter=Router();
for(const [column,definition] of [['stripe_customer_id','TEXT'],['stripe_subscription_id','TEXT']]){
 const cols=db.prepare('PRAGMA table_info(users)').all().map(x=>x.name);
 if(!cols.includes(column))db.exec('ALTER TABLE users ADD COLUMN '+column+' '+definition);
}
db.exec("CREATE TABLE IF NOT EXISTS stripe_events (id TEXT PRIMARY KEY, received_at TEXT NOT NULL DEFAULT (datetime('now')))");
// Validate the Stripe credential against our exact, live $8 monthly price before
// exposing real checkout. No secret values or API responses are logged.
let verifiedLivePrice=false;
async function verifyLivePrice(){
 const secret=process.env.STRIPE_SECRET_KEY,priceId=process.env.STRIPE_PRICE_ID;
 if(!secret||!priceId){verifiedLivePrice=false;return}
 if(!/^(sk|rk)_live_/.test(secret)){
  verifiedLivePrice=false;
  const keyType=/^(sk|rk)_test_/.test(secret)?'test key':/^pk_/.test(secret)?'publishable key':'unrecognized key';
  console.error('[stripe preflight] FAIL: '+keyType+' cannot authorize live checkout');return;
 }
 try{
  const response=await fetch('https://api.stripe.com/v1/prices/'+encodeURIComponent(priceId),{
   headers:{Authorization:'Bearer '+secret},signal:AbortSignal.timeout(10000)
  });
  const price=await response.json();
  verifiedLivePrice=!!(response.ok&&price.livemode===true&&price.active===true&&price.id===priceId&&
   price.unit_amount===800&&price.currency==='usd'&&price.type==='recurring'&&
   price.recurring?.interval==='month'&&price.recurring?.interval_count===1);
  console.info('[stripe preflight] '+(verifiedLivePrice?'PASS: correct live monthly plan':'FAIL: live price/account mismatch'));
 }catch{
  verifiedLivePrice=false;console.error('[stripe preflight] FAIL: could not verify Stripe plan');
 }
}
if(process.env.STRIPE_SECRET_KEY){
 void verifyLivePrice();
 const retry=setInterval(()=>{void verifyLivePrice()},5*60*1000);
 retry.unref?.();
}
const configured=()=>!!(verifiedLivePrice&&process.env.STRIPE_SECRET_KEY&&process.env.STRIPE_PRICE_ID&&
 process.env.STRIPE_WEBHOOK_SECRET&&process.env.STRIPE_LIVE==='1');

async function stripe(endpoint,body){
 const response=await fetch('https://api.stripe.com/v1/'+endpoint,{
 method:'POST',headers:{Authorization:'Bearer '+process.env.STRIPE_SECRET_KEY,'Content-Type':'application/x-www-form-urlencoded'},
 body:new URLSearchParams(body)
 });
 const json=await response.json();
 if(!response.ok)throw Error(json?.error?.message||'Stripe request failed');
 return json;
}
function signed(payload,header,secret){
 const t=/t=(\d+)/.exec(header||'')?.[1],signatures=[...(header||'').matchAll(/v1=([a-f0-9]+)/g)].map(x=>x[1]);
 if(!t||Math.abs(Date.now()/1000-Number(t))>300)return false;
 const expected=createHmac('sha256',secret).update(t+'.'+payload).digest();
 return signatures.some(h=>h.length===64&&timingSafeEqual(Buffer.from(h,'hex'),expected));
}
// The source of truth is Stripe's CURRENT subscription list for this customer,
// not the order in which signed webhook events happen to arrive.
async function currentCustomerSubscriptions(customer) {
  if (!/^(sk|rk)_live_/.test(process.env.STRIPE_SECRET_KEY || ''))
    throw new Error('Live Stripe credential is required for webhook reconciliation');
  const subscriptions = [];
  let cursor = null;
  for (let page = 0; page < 5; page++) {
    const query = new URLSearchParams({ customer, status: 'all', limit: '100' });
    if (cursor) query.set('starting_after', cursor);
    const response = await fetch('https://api.stripe.com/v1/subscriptions?' + query, {
      headers: { Authorization: 'Bearer ' + process.env.STRIPE_SECRET_KEY },
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) throw new Error('Stripe subscription status could not be verified');
    const result = await response.json();
    if (!Array.isArray(result.data)) throw new Error('Malformed Stripe subscription response');
    subscriptions.push(...result.data);
    if (!result.has_more) return subscriptions;
    cursor = result.data.at(-1)?.id;
    if (!cursor) throw new Error('Malformed Stripe pagination');
  }
  throw new Error('Stripe subscription pagination limit reached');
}
// A single production replica currently serves this app. Serialize webhooks
// per customer to avoid overwriting newer reconciliation with older work.
const customerQueues = new Map();
async function serialCustomer(customer, fn) {
  const previous = customerQueues.get(customer) || Promise.resolve();
  const next = previous.catch(() => {}).then(fn);
  customerQueues.set(customer, next);
  try { return await next; }
  finally { if (customerQueues.get(customer) === next) customerQueues.delete(customer); }
}
stripeWebhookRouter.post('/stripe/webhook', raw({type:'application/json',limit:'150kb'}), async(req,res)=>{
  if(!process.env.STRIPE_WEBHOOK_SECRET)return res.sendStatus(503);
  const body=req.body?.toString('utf8')||'';
  if(!signed(body,req.headers['stripe-signature'],process.env.STRIPE_WEBHOOK_SECRET))return res.sendStatus(400);
  let event;try{event=JSON.parse(body)}catch{return res.sendStatus(400)}
  if(typeof event?.id!=='string'||event.id.length>255||typeof event.type!=='string')return res.sendStatus(400);
  const alreadySeen=()=>!!db.prepare('SELECT id FROM stripe_events WHERE id=?').get(event.id);
  const markSeen=()=>db.prepare('INSERT OR IGNORE INTO stripe_events (id) VALUES (?)').run(event.id);
  if(alreadySeen())return res.json({received:true});
  if(!event.type.startsWith('customer.subscription.')) {
    markSeen();return res.json({received:true});
  }
  const obj=event.data?.object||{};
  const customer=typeof obj.customer==='string' ? obj.customer : obj.customer?.id;
  if(typeof customer!=='string'||!/^cus_[a-zA-Z0-9]+$/.test(customer))return res.sendStatus(400);
  try {
    await serialCustomer(customer,async()=>{
      if(alreadySeen())return;
      const user=db.prepare('SELECT * FROM users WHERE stripe_customer_id=?').get(customer);
      if(!user){markSeen();return}
      const all=await currentCustomerSubscriptions(customer);
      const state=selectSportsSubscription(all,process.env.STRIPE_PRICE_ID);
      const write=db.transaction(()=>{
        db.prepare('UPDATE users SET premium_until=?,stripe_subscription_id=? WHERE id=? AND stripe_customer_id=?')
          .run(state.premiumUntil,state.id,user.id,customer);
        markSeen();
      });
      write();
    });
    return res.json({received:true});
  } catch(e) {
    console.error('[stripe webhook] customer reconciliation failed; Stripe should retry');
    return res.sendStatus(503);
  }
});
billingRouter.post('/billing/checkout',async(req,res)=>{
 if(!req.user)return res.status(401).json({error:'Sign in first'});
 if((process.env.NODE_ENV==='production'||process.env.EMAIL_VERIFICATION_REQUIRED==='1') && !req.user.email_verified_at)return res.status(403).json({error:'Verify your email before upgrading'});
 if(isPremium(req.user))return res.status(409).json({error:'Premium is already active. Manage your plan instead.'});
 if(!configured())return res.status(503).json({error:'Live Stripe checkout is not yet configured'});
 try{
  let customer=req.user.stripe_customer_id;
  if(!customer){
   const c=await stripe('customers',{email:req.user.email,'metadata[user_id]':String(req.user.id)});
   customer=c.id;
   db.prepare('UPDATE users SET stripe_customer_id=? WHERE id=? AND stripe_customer_id IS NULL').run(customer,req.user.id);
  }
  const url=process.env.PUBLIC_BASE_URL||'https://sports-genius-web-production.up.railway.app';
  const session=await stripe('checkout/sessions',{
   mode:'subscription',customer,'line_items[0][price]':process.env.STRIPE_PRICE_ID,
   'line_items[0][quantity]':'1',success_url:url+'/?checkout=success',cancel_url:url+'/?checkout=cancel',
   'subscription_data[trial_period_days]':'7',
   'client_reference_id':String(req.user.id),'subscription_data[metadata][user_id]':String(req.user.id)
  });
  res.json({url:session.url});
 }catch(e){res.status(502).json({error:'Stripe checkout unavailable'});}
});
billingRouter.post('/billing/portal',async(req,res)=>{
 if(!req.user)return res.status(401).json({error:'Sign in first'});
 if(!configured())return res.status(503).json({error:'Billing not configured'});
 const customer=req.user.stripe_customer_id;
 if(!customer)return res.status(400).json({error:'No Stripe customer attached'});
 try{const s=await stripe('billing_portal/sessions',{customer,return_url:(process.env.PUBLIC_BASE_URL||'https://sports-genius-web-production.up.railway.app')+'/'});res.json({url:s.url})}
 catch{res.status(502).json({error:'Billing portal unavailable'})}
});
export {configured as stripeConfigured};
