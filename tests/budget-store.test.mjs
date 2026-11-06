import test from 'node:test';
import assert from 'node:assert/strict';
import {createBudgetStore} from '../apps/mobile/src/budgetStore.mjs';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};

test('account change drops the previous user snapshot and ignores its pending response',async()=>{
  const store=createBudgetStore(),wait=deferred();store.setAccount('alice');
  const old=store.load('w','ledger','2026-11',()=>wait.promise);
  store.setAccount('bob');assert.equal(store.snapshot('w','ledger','2026-11').data,null);
  await store.load('w','ledger','2026-11',async()=>({owner:'bob'}));
  wait.resolve({owner:'alice'});await old;
  assert.deepEqual(store.snapshot('w','ledger','2026-11').data,{owner:'bob'});
});

test('budget consumers share one request and snapshot for the same ledger month',async()=>{
  const store=createBudgetStore(),wait=deferred();let calls=0;
  const load=()=>{calls++;return wait.promise;};
  const a=store.load('w','ledger','2026-11',load),b=store.load('w','ledger','2026-11-30',load);
  await Promise.resolve();assert.equal(calls,1);assert.equal(store.snapshot('w','ledger','2026-11').loading,true);
  const state={balances:[{remaining:4000}]};wait.resolve(state);
  assert.equal(await a,state);assert.equal(await b,state);
  assert.equal(store.snapshot('w','ledger','2026-11').data,state);
  assert.equal(store.snapshot('w','ledger','2026-11-01').data,state);
});

test('budget mutation invalidates all months in only its own workspace',async()=>{
  const store=createBudgetStore();
  for(const [workspace,ledger,month] of [['w','a','2026-11'],['w','a','2025-01'],['w','b','2026-11'],['other','a','2026-11']]){
    await store.load(workspace,ledger,month,async()=>({workspace,ledger,month}));
  }
  store.invalidate('w');assert.equal(store.revision('w'),1);
  assert.equal(store.snapshot('w','a','2026-11').stale,true);
  assert.equal(store.snapshot('w','a','2025-01').stale,true);
  assert.equal(store.snapshot('w','b','2026-11').stale,true);
  assert.equal(store.snapshot('other','a','2026-11').stale,false);
});

test('a response started before a mutation cannot overwrite the newer allowance',async()=>{
  const store=createBudgetStore(),old=deferred();
  const request=store.load('w','ledger','2026-11',()=>old.promise);
  store.invalidate('w');await store.load('w','ledger','2026-11',async()=>({remaining:700}));
  old.resolve({remaining:10000});await request;
  assert.deepEqual(store.snapshot('w','ledger','2026-11').data,{remaining:700});
  assert.equal(store.snapshot('w','ledger','2026-11').stale,false);
});

test('a failed allowance request stays retryable and does not look like zero budget',async()=>{
  const store=createBudgetStore();
  await assert.rejects(store.load('w','ledger','2026-11',async()=>{throw new Error('offline');}));
  assert.equal(store.snapshot('w','ledger','2026-11').data,null);
  assert.equal(store.snapshot('w','ledger','2026-11').error,'offline');
  await store.load('w','ledger','2026-11',async()=>({remaining:0}),true);
  assert.deepEqual(store.snapshot('w','ledger','2026-11').data,{remaining:0});
  assert.equal(store.snapshot('w','ledger','2026-11').error,'');
});
