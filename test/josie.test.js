import {describe,it,before,after} from 'node:test';
import assert from 'node:assert/strict';
import app from '../src/app.js';
let server,base;
before(async()=>{await new Promise(resolve=>{server=app.listen(0,resolve)});base='http://127.0.0.1:'+server.address().port});
after(()=>new Promise(resolve=>server.close(resolve)));
describe('Josie brand and YouTube growth',()=>{
 it('shows real Short, channel subscription, and original picks on home',async()=>{
  const response=await fetch(base+'/');
  assert.equal(response.status,200);
  const html=await response.text();
  assert.match(html,/JOSIE'S PICKS TODAY/);
  assert.match(html,/id="meet-josie"/);
  assert.match(html,/KYN3KQNto-0/);
  assert.match(html,/sub_confirmation=1/);
  assert.match(html,/id="picks-grid"/);
  assert.match(html,/id="sg-verified-record"/);
 });
 it('serves the dedicated Josie page and stylesheet',async()=>{
  const page=await fetch(base+'/josie');
  assert.equal(page.status,200);
  const html=await page.text();
  assert.match(html,/MEET JOSIE/);
  assert.match(html,/UC-LV50veVvNK0yM217uK0CA/);
  const css=await fetch(base+'/css/josie.css');
  assert.equal(css.status,200);
  assert.match(await css.text(),/\.josie-feature/);
 });
});
