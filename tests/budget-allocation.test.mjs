import test from 'node:test';
import assert from 'node:assert/strict';
import {allocationPreview,inputMinor} from '../apps/mobile/src/budgetAllocation.mjs';

test('salary entries expose the remaining pool and release the current row for editing',()=>{
  const rows=[{key:'supplies',mode:'fixed',fixedMinor:20000},{key:'traffic',mode:'fixed',fixedMinor:null},{key:'saving',mode:'remainder',weight:1}];
  const result=allocationPreview(rows,inputMinor('10000'));
  assert.equal(result.remainingMinor,980000);
  assert.equal(result.rows[1].availableMinor,980000);
  assert.equal(result.rows[2].amountMinor,980000);
  rows[1].fixedMinor=80000;
  const edited=allocationPreview(rows,1000000);
  assert.equal(edited.rows[0].availableMinor,920000);
  assert.equal(edited.rows[2].amountMinor,900000);
});

test('ratio rounding and multiple remainder rows preserve cents, including overspend',()=>{
  const rows=[{key:'ratio',mode:'ratio',ratioBps:5000},{key:'a',mode:'remainder',weight:1},{key:'b',mode:'remainder',weight:1}];
  assert.deepEqual(allocationPreview(rows,10001).rows.map(r=>r.amountMinor),[5001,2500,2500]);
  const over=allocationPreview([{key:'a',mode:'fixed',fixedMinor:10002},{key:'b',mode:'remainder'}],10001);
  assert.equal(over.remainingMinor,-1);assert.equal(over.rows[1].amountMinor,0);
  assert.equal(inputMinor('0.01'),1);assert.equal(inputMinor('12.'),1200);
  for(const invalid of ['NaN','-1','1.001','1e3',''])assert.equal(inputMinor(invalid),null);
});

test('remaining percentages use the same pool and do not auto-fill unused percentages',()=>{
  const rows=[{key:'f',mode:'fixed',fixedMinor:20000},{key:'p',mode:'ratio',ratioBps:1000},{key:'r',mode:'remainder',remainderBps:2500}];
  const preview=allocationPreview(rows,1000000);
  assert.deepEqual(preview.rows.map(r=>r.amountMinor),[20000,100000,220000]);
  assert.equal(preview.remainingMinor,880000);assert.equal(preview.remainderBps,2500);assert.equal(preview.unallocatedMinor,660000);
  rows.push({key:'r2',mode:'remainder',remainderBps:8000});assert.equal(allocationPreview(rows,1000000).remainderBps,10500);
  assert.deepEqual(allocationPreview([{key:'a',mode:'remainder',remainderBps:3333},{key:'b',mode:'remainder',remainderBps:6667}],101).rows.map(r=>r.amountMinor),[34,67]);
  assert.doesNotThrow(()=>allocationPreview([{key:'a',mode:'remainder',remainderBps:99999999999},{key:'b',mode:'remainder',remainderBps:99999999999}],99999999999));
});
