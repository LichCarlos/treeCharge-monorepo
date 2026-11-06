import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateBalances, compensateNegativeTag } from '../src/domain/templates/budget-balances.mjs';
const fixture = () => ({ baseMinor: 130000, allocations: [{ id: 'traffic', amountMinor: 80000 }, { id: 'entertainment', amountMinor: 50000 }], usages: [{ id: 'expense-1', tagId: 'traffic', kind: 'consume', amountMinor: 90000 }], transfers: [] });
const available = state => Object.fromEntries(calculateBalances(state).rows.map(row => [row.tagId, row.availableMinor]));

test('overspend is recorded as a negative tag, never rejected or hidden', () => {
  assert.deepEqual(available(fixture()), { traffic: -10000, entertainment: 50000 });
  assert.equal(calculateBalances(fixture()).totalAvailableMinor, 40000);
});
test('deduct another tag and offset deficit, preserving every actual amount', () => {
  const state = fixture();
  const after = compensateNegativeTag(state, { operationId: 'deduct-1', targetTagId: 'traffic', deductions: [{ fromTagId: 'entertainment', amountMinor: 10000 }] });
  assert.deepEqual(available(after), { traffic: 0, entertainment: 40000 });
  assert.deepEqual(after.usages, state.usages);
  assert.deepEqual(after.allocations, state.allocations);
  assert.equal(calculateBalances(after).totalAvailableMinor, 40000);
  assert.deepEqual(available(state), { traffic: -10000, entertainment: 50000 });
});
test('partial compensation leaves visible negative balance', () => {
  const after = compensateNegativeTag(fixture(), { operationId: 'partial', targetTagId: 'traffic', deductions: [{ fromTagId: 'entertainment', amountMinor: 6000 }] });
  assert.deepEqual(available(after), { traffic: -4000, entertainment: 44000 });
});
test('one deficit may be covered from several positive tags atomically', () => {
  const state = fixture();
  state.allocations[1].amountMinor = 6000;
  state.allocations.push({ id: 'shopping', amountMinor: 44000 });
  const after = compensateNegativeTag(state, { operationId: 'many', targetTagId: 'traffic', deductions: [{ fromTagId: 'entertainment', amountMinor: 6000 }, { fromTagId: 'shopping', amountMinor: 4000 }] });
  assert.deepEqual(available(after), { traffic: 0, entertainment: 0, shopping: 40000 });
});
test('no sufficient source or over-compensation cannot mutate source data', () => {
  const state = fixture();
  const unchanged = structuredClone(state);
  assert.throws(() => compensateNegativeTag(state, { operationId: 'too-much', targetTagId: 'traffic', deductions: [{ fromTagId: 'entertainment', amountMinor: 60000 }] }), /余额不足/);
  assert.throws(() => compensateNegativeTag(state, { operationId: 'overfill', targetTagId: 'traffic', deductions: [{ fromTagId: 'entertainment', amountMinor: 11000 }] }), /不能超过待补缺口/);
  assert.deepEqual(state, unchanged);
});
test('repeated confirmation is idempotent and changed request cannot reuse its id', () => {
  const request = { operationId: 'once', targetTagId: 'traffic', deductions: [{ fromTagId: 'entertainment', amountMinor: 10000 }] };
  const after = compensateNegativeTag(fixture(), request);
  assert.equal(compensateNegativeTag(after, request), after);
  assert.equal(after.transfers.length, 1);
  assert.throws(() => compensateNegativeTag(after, { ...request, deductions: [{ fromTagId: 'entertainment', amountMinor: 5000 }] }), /相同操作ID/);
});
test('editing actual expense after compensation recomputes balance without undoing history', () => {
  const after = compensateNegativeTag(fixture(), { operationId: 'fix', targetTagId: 'traffic', deductions: [{ fromTagId: 'entertainment', amountMinor: 10000 }] });
  const edited = { ...after, usages: [{ ...after.usages[0], amountMinor: 85000 }] };
  assert.deepEqual(available(edited), { traffic: 5000, entertainment: 40000 });
  assert.equal(edited.transfers.length, 1);
  assert.equal(calculateBalances(edited).totalAvailableMinor, 45000);
});
test('tag duplicate bindings cannot double-count real usage', () => {
  const state = fixture();
  state.usages.push({ ...state.usages[0] });
  assert.throws(() => calculateBalances(state), /ID重复/);
});
