// Regression tests for indexable editorial content and functional free research tools.
import test from 'node:test';
import assert from 'node:assert/strict';
import app from '../src/app.js';
import {impliedProbability,decimalOdds,twoWayNoVig} from '../public/js/odds-calculator.js';
import {additionalGuides} from '../src/organic-guides.js';

test('American moneyline conversion is mathematically accurate and bounded',()=>{
 assert.equal(impliedProbability(150),0.4);
 assert.equal(impliedProbability(-150),0.6);
 assert.equal(decimalOdds(150),2.5);
 assert.ok(Math.abs(decimalOdds(-110)-(1+100/110))<1e-12);
 const two=twoWayNoVig(-110,-110);
 assert.ok(two);
 assert.ok(Math.abs(two.first-.5)<1e-12);
 assert.ok(Math.abs(two.second-.5)<1e-12);
 assert.ok(Math.abs(two.overround - 4.761904761904767)<1e-8);
 const asymmetric=twoWayNoVig(150,-170);
 assert.ok(Math.abs(asymmetric.first+asymmetric.second-1)<1e-12);
 for(const bad of ['','0','abc','99','-99','+999999','Infinity','-0','10.4'])assert.equal(impliedProbability(bad),null,'bad odds '+bad);
 assert.equal(twoWayNoVig(110,'bad'),null);
});

test('all original evergreen guides are complete and non-duplicative',()=>{
 const titles=new Set();
 for(const [slug,g] of Object.entries(additionalGuides)){
  assert.match(slug,/^[a-z-]+$/);
  assert.ok(g.title.length>=35);
  assert.ok(g.desc.length>=65);
  assert.equal(g.parts.length,6);
  assert.ok(g.parts.every(([h,c])=>h.length>10&&c.length>180));
  assert.ok(!titles.has(g.title));titles.add(g.title);
 }
 assert.equal(titles.size,4);
});

test('crawlable calculator and evergreen content are in dynamic sitemap and link from the homepage',async()=>{
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s))});
 const origin='http://127.0.0.1:'+server.address().port;
 try{
  const sitemap=await (await fetch(origin+'/sitemap.xml')).text();
  assert.match(sitemap,/<urlset/);
  assert.match(sitemap,/https:\/\/thesportsgenius.com\/tools\/odds-calculator/);
  for(const slug of Object.keys(additionalGuides))assert.ok(sitemap.includes('https://thesportsgenius.com/guides/'+slug),'sitemap '+slug);
  const home=await (await fetch(origin+'/')).text();
  assert.match(home,/Free Odds Calculator/);
  const toolRes=await fetch(origin+'/tools/odds-calculator');
  assert.equal(toolRes.status,200);
  const tool=await toolRes.text();
  assert.match(tool,/<h1 class="display">AMERICAN ODDS CALCULATOR/);
  assert.match(tool,/name="a"/);
  assert.match(tool,/name="b"/);
  assert.match(tool,/odds-calculator\.js/);
  assert.match(tool,/rel="canonical" href="https:\/\/thesportsgenius.com\/tools\/odds-calculator"/);
  assert.match(tool,/"@type":"WebApplication"/);
  assert.doesNotMatch(tool,/name="robots" content="noindex/);
  for(const [slug,g] of Object.entries(additionalGuides)){
   const r=await fetch(origin+'/guides/'+slug);
   assert.equal(r.status,200,slug);
   const html=await r.text();
   assert.ok(html.includes(g.title));
   assert.match(html,/"@type":"Article"/);
   assert.match(html,/rel="canonical"/);
   assert.ok(g.parts.every(([h,c])=>html.includes(h)),slug);
  }
  const kit=await (await fetch(origin+'/share-kit')).text();
  assert.match(kit,/utm_source=facebook/);
  assert.match(kit,/utm_source=tiktok/);
  assert.match(kit,/utm_source=youtube/);
  assert.match(kit,/utm_campaign=sports_research_launch/);
  assert.match(kit,/noindex, follow/);
  const robots=await (await fetch(origin+'/robots.txt')).text();
  assert.match(robots,/Sitemap: https:\/\/thesportsgenius.com\/sitemap.xml/);
  const missing=await fetch(origin+'/guides/nonexistent-article');
  assert.equal(missing.status,404);
  const stripe=await fetch(origin+'/api/billing');
  assert.equal(stripe.status,200);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
