import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword,verifyPassword,canonical } from '../src/security.js';
import { allocate } from '../src/budget.js';
import {dateFilter} from '../src/dates.js';
test('salted scrypt passwords verify and reject a wrong password',async()=>{
  const a=await hashPassword('test-password-123'),b=await hashPassword('test-password-123');assert.notEqual(a,b);
  assert.equal(await verifyPassword('test-password-123',a),true);assert.equal(await verifyPassword('test-password-124',a),false);
});
test('budget allocation rounds deterministically and preserves every cent',()=>{
  const rows=allocate([{key:'a',name:'a',mode:'ratio',ratioBps:5000},{key:'b',name:'b',mode:'remainder',weight:1},{key:'c',name:'c',mode:'remainder',weight:1}],10001);
  assert.deepEqual(rows.map(r=>r.amountMinor),[5001,2500,2500]);
  assert.equal(allocate([{key:'a',name:'a',mode:'fixed',fixedMinor:200}],100)[0].amountMinor,200);
});

test('residual percentages consume the remainder pool and preserve unassigned shares',()=>{
  const rows=[{key:'fixed',name:'日用品',mode:'fixed' as const,fixedMinor:20000},{key:'ratio',name:'交通',mode:'ratio' as const,ratioBps:1000},
    {key:'a',name:'储蓄',mode:'remainder' as const,remainderBps:2500},{key:'b',name:'旅游',mode:'remainder' as const,remainderBps:5000}];
  assert.deepEqual(allocate(rows,1000000).map(r=>r.amountMinor),[20000,100000,220000,440000]);
  assert.throws(()=>allocate([...rows,{key:'extra',name:'超出',mode:'remainder',remainderBps:2600}],1000000),/不能超过100/);
  for(const remainderBps of [-1,10001,0.5])assert.throws(()=>allocate([{key:'a',name:'a',mode:'remainder',remainderBps}],10000),/0–100/);
  assert.deepEqual(allocate([{key:'a',name:'a',mode:'remainder',remainderBps:3333},{key:'b',name:'b',mode:'remainder',remainderBps:6667}],101).map(r=>r.amountMinor),[34,67]);
});
test('overplanned fixed and base-percentage allocations save only without positive residual allocation',()=>{
  const rows=[{key:'a',name:'a',mode:'fixed' as const,fixedMinor:12000},{key:'b',name:'b',mode:'ratio' as const,ratioBps:1000}];
  assert.deepEqual(allocate(rows,10000).map(r=>r.amountMinor),[12000,1000]);
  assert.deepEqual(allocate([...rows,{key:'c',name:'c',mode:'remainder',remainderBps:0}],10000).map(r=>r.amountMinor),[12000,1000,0]);
  assert.throws(()=>allocate([...rows,{key:'c',name:'c',mode:'remainder',remainderBps:1}],10000),/不可完成剩余分配/);
});

test('actual wage reductions keep configured budgets and exhaust the residual pool',()=>{
  const rows=allocate([{key:'a',name:'日用品',mode:'fixed',fixedMinor:20000},{key:'b',name:'交通',mode:'ratio',ratioBps:1000},{key:'c',name:'结余',mode:'remainder',remainderBps:2500}],10000,true);
  assert.deepEqual(rows.map(r=>r.amountMinor),[20000,1000,0]);assert.equal(rows[2].remainderBps,2500);
});
test('canonical request hashes do not depend on object key insertion order',()=>assert.equal(canonical({b:1,a:[{c:2,d:3}]}),canonical({a:[{d:3,c:2}],b:1})));
test('date range validates inclusive boundaries and rejects ambiguous or unbounded input',()=>{
  assert.deepEqual(dateFilter({start:'2024-02-01',end:'2024-02-29'}),{start:'2024-02-01',end:'2024-02-29',endExclusive:'2024-03-01'});
  assert.equal(dateFilter({month:'2024-02'}).end,'2024-02-29');
  for(const q of [{start:'2024-01-01'},{start:'2025-02-29',end:'2025-03-01'},{start:'2025-03-01',end:'2025-02-28'},{month:'2024-02',start:'2024-02-01',end:'2024-02-29'},{start:'2024-01-01',end:'2026-01-01'}])assert.throws(()=>dateFilter(q));
});
