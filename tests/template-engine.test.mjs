import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import { allocateBudget, weeklyChallenge, emergencyFund } from '../src/domain/templates/template-engine.mjs';
const config = JSON.parse(await fs.readFile(new URL('../src/domain/templates/default-templates.json', import.meta.url), 'utf8'));
const salary = config.templates.find(item => item.id === 'salary-allocation');

const configuredRows = Object.fromEntries(salary.rows.filter(row => row.mode !== 'remainder').map(row => [row.key, { mode: 'fixed', fixedMinor: 10000 }]));
test('salary template seeds tags only and requires user-entered allocations', () => {
  assert.equal(salary.baseMinor, null);
  assert.equal(salary.rows.filter(row => row.fixedMinor === null).length, 14);
  assert.equal('salaryBandsMinor' in salary, false);
  assert.throws(() => allocateBudget(salary, 1000000), /请设置/);
});
test('any positive disposable salary works with user amounts; no reference salary bands', () => {
  const result = allocateBudget(salary, 1050000, { overrides: configuredRows });
  assert.equal(result.expenseBudgetMinor, 140000);
  assert.equal(result.savingsBudgetMinor, 910000);
  assert.equal(result.allocatedMinor, 1050000);
  assert.equal(allocateBudget(salary, 1800000, { overrides: configuredRows }).savingsBudgetMinor, 1660000);
});
test('fixed zero override is preserved and ratios use the original base', () => {
  const result = allocateBudget(salary, 1000000, { overrides: { ...configuredRows, phone: { mode: 'fixed', fixedMinor: 0 }, free: { mode: 'ratio', ratioBps: 300 } } });
  assert.equal(result.rows.find(row => row.key === 'phone').amountMinor, 0);
  assert.equal(result.rows.find(row => row.key === 'free').amountMinor, 30000);
  assert.equal(result.allocatedMinor, 1000000);
});
test('weighted residual distributes every cent with stable tie breaking', () => {
  const result = allocateBudget({ rows: [
    { key: 'a', purpose: 'savings_budget', mode: 'remainder', weight: 1 },
    { key: 'b', purpose: 'savings_budget', mode: 'remainder', weight: 1 },
    { key: 'c', purpose: 'savings_budget', mode: 'remainder', weight: 1 }
  ] }, 100);
  assert.deepEqual(result.rows.map(row => row.amountMinor), [34, 33, 33]);
  assert.equal(result.allocatedMinor, 100);
});
test('explicit remaining pool percentages preserve unallocated shares and allow plans over base',()=>{
  const template={rows:[{key:'a',mode:'fixed',fixedMinor:20000},{key:'b',mode:'ratio',ratioBps:1000},{key:'c',mode:'remainder',remainderBps:2500}]};
  const result=allocateBudget(template,1000000);assert.deepEqual(result.rows.map(r=>r.amountMinor),[20000,100000,220000]);assert.equal(result.unallocatedMinor,660000);
  const over=allocateBudget({rows:[{key:'a',mode:'fixed',fixedMinor:12000},{key:'b',mode:'remainder',remainderBps:0}]},10000);
  assert.equal(over.unallocatedMinor,-2000);assert.equal(over.rows[1].amountMinor,0);
});
test('over-allocation and invalid base fail without returning a negative savings budget', () => {
  assert.throws(() => allocateBudget(salary, 1000000, { overrides: { ...configuredRows, housing: { mode: 'fixed', fixedMinor: 1000000 } } }), /超出基数/);
  assert.throws(() => allocateBudget(salary, 0), /有效整数范围/);
  assert.throws(() => allocateBudget(salary, 1000000.5), /有效整数范围/);
});
test('initial use is manual with no selected template', () => {
  assert.equal(config.defaultTemplateId, null);
  assert.equal(config.defaultMode, 'manual');
  assert.equal(config.templates.length, 1);
});

test('default template names fit a single short category label',()=>{
  for(const template of config.templates){
    assert(Array.from(template.name).length<=5);
    for(const row of template.rows)assert(Array.from(row.name).length<=5,row.name);
  }
});
