import test from 'node:test';
import assert from 'node:assert/strict';
import {selectSportsSubscription} from '../src/subscription-state.js';

const PRICE='price_sports_genius_test';
const make=(id,status,price=PRICE,end=1940000000)=>({
  id,status,current_period_end:end,trial_end:end,
  items:{data:[{price:{id:price},current_period_end:end}]}
});
test('subscription state: trial and active get correct expiration',()=>{
  const trial=selectSportsSubscription([make('sub_trial','trialing')],PRICE,1790000000);
  assert.equal(trial.id,'sub_trial');
  assert.equal(trial.premiumUntil,new Date(1940000000*1000).toISOString());
  const active=selectSportsSubscription([make('sub_active','active')],PRICE,1790000000);
  assert.equal(active.id,'sub_active');
});
test('subscription state: cancel, failed, stale, and wrong product cannot grant Premium',()=>{
  for(const status of ['canceled','unpaid','incomplete','incomplete_expired','past_due','paused']){
    assert.deepEqual(selectSportsSubscription([make('sub_bad',status)],PRICE,1790000000),{id:null,premiumUntil:null});
  }
  assert.deepEqual(selectSportsSubscription([make('sub_stale','active',PRICE,1700000000)],PRICE,1790000000),{id:null,premiumUntil:null});
  assert.deepEqual(selectSportsSubscription([make('sub_other','active','price_other')],PRICE,1790000000),{id:null,premiumUntil:null});
});
test('subscription state: chooses most recent eligible paid or trial state',()=>{
  const state=selectSportsSubscription([
    make('sub_canceled','canceled',PRICE,2000000000),
    make('sub_earlier','active',PRICE,1900000000),
    make('sub_later','trialing',PRICE,1940000000),
    make('sub_unrelated','active','price_other',2050000000)
  ],PRICE,1790000000);
  assert.equal(state.id,'sub_later');
});
test('subscription state: missing price cannot grant access',()=>{
  assert.throws(()=>selectSportsSubscription([],null),/Missing/);
});
