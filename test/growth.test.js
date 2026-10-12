// Regression gates for the organic SEO / traffic features.
import test from 'node:test';
import assert from 'node:assert/strict';
import {renderMatch,matchupUrl} from '../src/growth.js';
import app from '../src/app.js';

const sample={
 id:'401234567',league:'nfl',date:'2026-10-12T23:15:00Z',
 home:{name:'Home Owls',abbr:'HOW',record:'4-2',score:null},
 away:{name:'Away Bears',abbr:'ABR',record:'3-3',score:null},
 status:{state:'pre',detail:'Scheduled'},broadcasts:['ESPN'],venue:'Example Stadium',venueCity:'Example City',venueState:'SC'
};
test('unique, escaped, canonical SSR sports matchup',()=>{
 const html=renderMatch(sample,'2026-10-12T16:00:00Z');
 assert.match(html,/<h1[^>]*>Away Bears vs Home Owls<\/h1>/);
 assert.match(html,/rel="canonical" href="https:\/\/thesportsgenius.com\/matchup\/nfl\/401234567\/20261012"/);
 assert.match(html,/"@type":"SportsEvent"/);
 assert.match(html,/ESPN/);
 assert.match(html,/Save this game/);
 assert.doesNotMatch(html,/noindex/);
 assert.equal(matchupUrl(sample),'/matchup/nfl/401234567/20261012');
 const hostile={...sample,away:{...sample.away,name:'<script>alert(1)</script>'}};
 const safe=renderMatch(hostile);
 assert.doesNotMatch(safe,/<script>alert/);
 assert.match(safe,/&lt;script&gt;alert/);
});
test('growth routes keep legacy app safe, guides indexable and private dashboard protected',async()=>{
 const server=app.listen(0);
 const address='http://127.0.0.1:'+server.address().port;
 try{
  const guide=await fetch(address+'/guides/matchup-research');const html=await guide.text();
  const cfgResponse=await fetch(address+'/api/growth/config');assert.equal(cfgResponse.status,200);
  const cfg=await cfgResponse.json();assert.equal(cfg.consentRequired,true);
  assert.equal(cfg.ga4MeasurementId,null,'never inject GA4 ID unless configured');
  const privResponse=await fetch(address+'/privacy');assert.equal(privResponse.status,200);
  const privacy=await privResponse.text();assert.match(privacy,/optional Google Analytics/i);
  assert.match(privacy,/Privacy &amp; Analytics/);

  assert.equal(guide.status,200);
  assert.match(html,/rel="canonical" href="https:\/\/thesportsgenius.com\/guides\/matchup-research"/);
  assert.match(html,/"@type":"Article"/);
  assert.equal((await fetch(address+'/matchup/nfl/bogus/20261012')).status,404);
  assert.equal((await fetch(address+'/guides/not-here')).status,404);
  const saved=await (await fetch(address+'/saved-games')).text();
  assert.match(saved,/noindex, follow/);
  assert.equal((await fetch(address+'/api/growth/summary')).status,403);
  const bad=await fetch(address+'/api/growth/track',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({event:'pageview',path:'https://example.com',source:'direct'})});
  assert.equal(bad.status,400);
  const good=await fetch(address+'/api/growth/track',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({event:'pageview',path:'/matchups',source:'social'})});
  assert.equal(good.status,204);
  assert.equal((await fetch(address+'/api/health')).status,200);
  assert.equal((await fetch(address+'/api/billing')).status,200);
 }finally{await new Promise(resolve=>server.close(resolve))}
});
