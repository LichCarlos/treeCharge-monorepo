import test from 'node:test';
import assert from 'node:assert/strict';
import {categoryAllowanceIndex,categoryAllowanceKey} from '../apps/mobile/src/categoryAllowance.mjs';

const plan={id:'p',ledger_id:'daily',month:'2026-11-01',status:'active'};
const balance={plan_id:'p',category_ids:['food'],initial_minor:10000,available_minor:7500,transferred_in_minor:0,transferred_out_minor:0};
const lookup=(plans=[plan],balances=[balance],ledger='daily',category='food',date='2026-11-02')=>categoryAllowanceIndex(plans,balances).get(categoryAllowanceKey(ledger,category,date));

test('category allowance is isolated by ledger, month and category, including cross-year ranges',()=>{
  const plans=[plan,{...plan,id:'past',month:'2025-11-01'},{...plan,id:'other',ledger_id:'trip'}];
  const balances=[balance,{...balance,plan_id:'past',initial_minor:20000,available_minor:18000},{...balance,plan_id:'other',initial_minor:30000,available_minor:24000}];
  assert.equal(lookup(plans,balances).remaining,7500);
  assert.equal(lookup(plans,balances,'daily','food','2025-11-02').remaining,18000);
  assert.equal(lookup(plans,balances,'trip').remaining,24000);
  assert.equal(lookup(plans,balances,'daily','unknown'),undefined);
  assert.equal(lookup(plans,balances,'daily','food','2026-12-01'),undefined);
});

test('allowance uses adjusted limit and actual remaining after manual transfers',()=>{
  const result=lookup([plan],[{...balance,transferred_in_minor:3000,transferred_out_minor:1000,available_minor:9000}]);
  assert.equal(result.limit,12000);assert.equal(result.remaining,9000);assert.equal(result.percentage,75);
  const source=lookup([plan],[{...balance,transferred_out_minor:5000,available_minor:2500}]);
  assert.equal(source.limit,5000);assert.equal(source.percentage,50);
});

test('negative, zero, exhausted and refunded allowances have finite clamped progress',()=>{
  for(const [limit,remaining,percent] of [[10000,-500,0],[0,-500,0],[0,0,0],[10000,0,0],[10000,15000,100]]){
    const result=lookup([plan],[{...balance,initial_minor:limit,available_minor:remaining}]);
    assert.equal(result.limit,limit);assert.equal(result.remaining,remaining);assert.equal(result.percentage,percent);assert.equal(result.pending,false);
  }
});

test('shared categories use the same remaining without duplicating mappings; draft is not treated as zero',()=>{
  const shared={...balance,category_ids:['food','food','travel']};
  const index=categoryAllowanceIndex([plan],[shared]);assert.equal(index.size,2);
  assert.equal(index.get(categoryAllowanceKey('daily','food','2026-11')),index.get(categoryAllowanceKey('daily','travel','2026-11')));
  assert.equal(lookup([plan],[shared]).shared,true);
  const draft={...plan,id:'draft',status:'draft'};
  assert.deepEqual(lookup([draft],[{...balance,plan_id:'draft',initial_minor:null,available_minor:null}]),{limit:null,remaining:null,percentage:0,shared:false,pending:true});
  assert.equal(lookup([{...plan,status:'deleted'}]),undefined);
  assert.equal(lookup([draft,plan],[{...balance,plan_id:'draft',initial_minor:null,available_minor:null},balance]).pending,false);
});

test('a configured category is usable while other salary categories remain unset',()=>{
  const draft={...plan,status:'draft'};
  const configured=lookup([draft],[balance]);
  assert.equal(configured.pending,false);assert.equal(configured.limit,10000);assert.equal(configured.remaining,7500);
  const unset={...balance,category_ids:['traffic'],initial_minor:null,available_minor:null};
  const index=categoryAllowanceIndex([draft],[balance,unset]);
  assert.equal(index.get(categoryAllowanceKey('daily','food','2026-11')).percentage,75);
  assert.equal(index.get(categoryAllowanceKey('daily','traffic','2026-11')).pending,true);
});
