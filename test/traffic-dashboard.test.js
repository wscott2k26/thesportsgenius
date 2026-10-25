// Regression checks for aggregate owner analytics and campaign-tagged Josie traffic.
import test from 'node:test';
import assert from 'node:assert/strict';
import app from '../src/app.js';
import { db } from '../src/db.js';
test('private command center has responsive dashboard modules and owner-only API',async()=>{
 const server=app.listen(0);
 const base='http://127.0.0.1:'+server.address().port;
 try{
  const page=await fetch(base+'/growth-dashboard.html');
  assert.equal(page.status,200);
  const html=await page.text();
  assert.match(html,/TRAFFIC COMMAND CENTER/);
  assert.match(html,/growth-dashboard\.css/);
  assert.match(html,/growth-dashboard\.js/);
  assert.equal((await fetch(base+'/api/growth/summary?days=30')).status,403);
  const js=await (await fetch(base+'/js/growth-dashboard.js')).text();
  assert.match(js,/utm_source=tiktok/);
  assert.match(js,/Josie campaign performance|byCampaign/);
 }finally{await new Promise(resolve=>server.close(resolve))}
});
test('social attribution stores approved aggregate campaign, rejects uncontrolled tags',async()=>{
 const server=app.listen(0);
 const base='http://127.0.0.1:'+server.address().port;
 const payload=(campaign)=>JSON.stringify({event:'pageview',path:'/josie',source:'tiktok',campaign});
 try{
  let ok=await fetch(base+'/api/growth/track',{method:'POST',headers:{'content-type':'application/json'},body:payload('josie_reacts')});
  assert.equal(ok.status,204);
  ok=await fetch(base+'/api/growth/track',{method:'POST',headers:{'content-type':'application/json'},body:payload('fake_tracking_id_12345')});
  assert.equal(ok.status,204);
  assert.ok(db.prepare("SELECT total FROM growth_campaign_daily WHERE campaign='josie_reacts' AND source='tiktok'").get()?.total>=1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM growth_campaign_daily WHERE campaign='fake_tracking_id_12345'").get().n,0);
  ok=await fetch(base+'/api/growth/track',{method:'POST',headers:{'content-type':'application/json'},body:payload('sports_research_launch')});
  assert.equal(ok.status,204);
  assert.ok(db.prepare("SELECT total FROM growth_campaign_daily WHERE campaign='sports_research_launch' AND source='tiktok'").get()?.total>=1);
  assert.equal((await fetch(base+'/josie')).status,200);
  const landing=await (await fetch(base+'/josie')).text();
  assert.match(landing,/growth-client\.js/);
  assert.match(landing,/See live scores/);
 }finally{await new Promise(resolve=>server.close(resolve))}
});