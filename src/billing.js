import {createHmac,timingSafeEqual} from 'node:crypto';
import {Router,raw} from 'express';
import {db,isPremium} from './db.js';
export const billingRouter=Router();
export const stripeWebhookRouter=Router();
for(const [column,definition] of [['stripe_customer_id','TEXT'],['stripe_subscription_id','TEXT']]){
 const cols=db.prepare('PRAGMA table_info(users)').all().map(x=>x.name);
 if(!cols.includes(column))db.exec('ALTER TABLE users ADD COLUMN '+column+' '+definition);
}
db.exec("CREATE TABLE IF NOT EXISTS stripe_events (id TEXT PRIMARY KEY, received_at TEXT NOT NULL DEFAULT (datetime('now')))");
const configured=()=>!!(process.env.STRIPE_SECRET_KEY&&process.env.STRIPE_PRICE_ID&&process.env.STRIPE_WEBHOOK_SECRET&&process.env.STRIPE_LIVE==='1');
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
stripeWebhookRouter.post('/stripe/webhook',raw({type:'application/json',limit:'150kb'}),(req,res)=>{
 if(!process.env.STRIPE_WEBHOOK_SECRET)return res.sendStatus(503);
 const body=req.body?.toString('utf8')||'';
 if(!signed(body,req.headers['stripe-signature'],process.env.STRIPE_WEBHOOK_SECRET))return res.sendStatus(400);
 let event;try{event=JSON.parse(body)}catch{return res.sendStatus(400)}
 try{
  const seen=db.prepare('SELECT id FROM stripe_events WHERE id=?').get(event.id);
  if(seen)return res.json({received:true});
  const obj=event.data?.object||{};
  if(event.type.startsWith('customer.subscription.')){
   const user=db.prepare('SELECT * FROM users WHERE stripe_customer_id=?').get(obj.customer);
   if(user){
    const active=['active','trialing'].includes(obj.status);
    const endSeconds=obj.current_period_end||obj.items?.data?.[0]?.current_period_end||0;
    const end=active&&endSeconds>0?new Date(endSeconds*1000).toISOString():null;
    db.prepare('UPDATE users SET premium_until=?,stripe_subscription_id=? WHERE id=?').run(end,obj.id,user.id);
   }
  }
  db.prepare('INSERT INTO stripe_events (id) VALUES (?)').run(event.id);
  res.json({received:true});
 }catch(e){console.error('[stripe webhook]',e);res.sendStatus(500)}
});
billingRouter.post('/billing/checkout',async(req,res)=>{
 if(!req.user)return res.status(401).json({error:'Sign in first'});
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
