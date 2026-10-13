// Traffic monitor: anonymous aggregate counters and private admin read.
import { before, after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/db.js';
import app from '../src/app.js';

const adminEmail='traffic-admin@example.test';
process.env.ADMIN_EMAILS = adminEmail;
let server, base;
const token='traffic-admin-auth-test-token';

before(async()=>{
  db.prepare('INSERT OR IGNORE INTO users (email,pass_hash) VALUES (?,?)').run(adminEmail,'not-used');
  const u=db.prepare('SELECT id FROM users WHERE email=?').get(adminEmail);
  db.prepare("INSERT OR REPLACE INTO sessions (token,user_id,expires_at) VALUES (?,?,datetime('now','+1 hour'))").run(token,u.id);
  server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s))});
  base='http://127.0.0.1:'+server.address().port;
});
after(async()=>{if(server)await new Promise(resolve=>server.close(resolve))});
beforeEach(()=>{
 db.prepare('DELETE FROM growth_daily').run();
 db.prepare('DELETE FROM growth_minute').run();
});

async function request(path, opts={}) {
  const {admin=false,payload=undefined,...rest}=opts;
  const headers={...(payload?{'Content-Type':'application/json'}:{}),...rest.headers};
  if(admin)headers.Authorization='Bearer '+token;
  const res=await fetch(base+path,{...rest,headers,...(payload?{body:JSON.stringify(payload)}:{})});
  return {status:res.status,body:res.headers.get('content-type')?.includes('application/json')?await res.json():await res.text()};
}
const track=(path,source='direct',headers={})=>request('/api/growth/track',{method:'POST',headers,payload:{event:'pageview',path,source}});

test('traffic report stays administrator-only and appears on private admin page',async()=>{
 assert.equal((await request('/api/growth/summary')).status,403);
 const page=await request('/admin');
 assert.equal(page.status,200);
 assert.match(page.body,/id="admin-traffic-monitor"/);
 assert.match(page.body,/id="traffic-kpis"/);
 assert.match(page.body,/id="traffic-days"/);
 assert.match(page.body,/id="admin-track-record"/);
 assert.equal((await request('/api/growth/summary',{admin:true})).status,200);
});

test('no user tracking IDs and correct pageview pulse + source breakdown',async()=>{
 assert.equal((await track('/','direct')).status,204);
 assert.equal((await track('/matchups','social')).status,204);
 assert.equal((await track('/matchups','social')).status,204);
 const {status,body:d}=await request('/api/growth/summary?days=7',{admin:true});
 assert.equal(status,200);
 assert.equal(d.windowDays,7);
 assert.equal(d.byDay.find(r=>r.event==='pageview')?.total,3);
 assert.equal(d.recent15m,3);
 assert.equal(d.recent5m,3);
 assert.equal(d.byPage.find(r=>r.path==='/matchups')?.views,2);
 assert.equal(d.bySource.find(r=>r.source==='social')?.views,2);
 assert.match(d.note,/not verified unique people/i);
 assert.equal(JSON.stringify(d).includes('127.0.0.1'),false);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM growth_minute').get().n,1);
});

test('respects Do Not Track, Global Privacy Control and blocked bot agents',async()=>{
 const privacyCases=[
   {'DNT':'1'},
   {'Sec-GPC':'1'},
   {'User-Agent':'a-crawler'},
 ];
 for(const headers of privacyCases)assert.equal((await track('/','social',headers)).status,204);
 const {body:d}=await request('/api/growth/summary',{admin:true});
 assert.equal(d.recent15m,0);
 assert.equal(d.byPage.length,0);
 assert.equal(d.bySource.length,0);
});

test('bad analytics input rejected, existing action counters remain separate',async()=>{
 const bad=await request('/api/growth/track',{method:'POST',payload:{event:'pageview',path:'https://example.com/',source:'social'}});
 assert.equal(bad.status,400);
 const action=await request('/api/growth/track',{method:'POST',payload:{event:'share',path:'/matchups',source:'social'}});
 assert.equal(action.status,204);
 const {body:d}=await request('/api/growth/summary?days=30',{admin:true});
 assert.equal(d.byPage.length,0);
 assert.equal(d.recent15m,0);
 assert.equal(d.byDay.find(r=>r.event==='share')?.total,1);
});

test('tracking script covers existing public sport routes without replacing their UIs',async()=>{
 for(const route of ['/','/chat','/parlay','/tracker','/game','/scores','/offers']){
   const res=await request(route);
   assert.equal(res.status,200,route);
   assert.match(res.body,/\/js\/growth-client\.js/,route);
 }
 const privateReport=await request('/growth-dashboard.html');
 assert.equal(privateReport.status,200);
 assert.doesNotMatch(privateReport.body,/\/js\/growth-client\.js/);
});
