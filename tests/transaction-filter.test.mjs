import test from 'node:test';
import assert from 'node:assert/strict';
import {filterTransactions,matchesTransaction} from '../apps/mobile/src/transactionFilter.mjs';

const lunch={id:'a',ledger_id:'ledger-1',category_id:'food-1',category_name:'餐饮',ledger_name:'日常',direction:'expense',amount_minor:123456,occurred_on:'2026-11-01',remark:'午餐 Coffee 42'};

test('search combines remark/category/amount and normalizes case and currency',()=>{
  for(const query of [' 午餐 ','COFFEE','餐饮','1234.56','1,234.56','￥1,234.56元','午餐 1234.56','42'])assert.equal(matchesTransaction(lunch,query),true,query);
  assert.equal(matchesTransaction(lunch,'123456'),false,'integer cents must not masquerade as yuan');
  assert.equal(matchesTransaction(lunch,'午餐 5678'),false);
});

test('category filtering uses IDs and ledger ownership even when names repeat',()=>{
  const repeated={...lunch,id:'b',category_id:'food-2'};
  const otherLedger={...lunch,id:'c',ledger_id:'ledger-2'};
  const income={...lunch,id:'d',category_id:'salary',direction:'income'};
  const rows=[lunch,repeated,otherLedger,income];
  assert.deepEqual(filterTransactions(rows,{ledger:'ledger-1',category:'food-1'}).map(t=>t.id),['a']);
  assert.deepEqual(filterTransactions(rows,{ledger:'ledger-1',income:true}).map(t=>t.id),['d']);
  assert.deepEqual(filterTransactions(rows,{ledger:'ledger-1',category:'food-2',query:'coffee'}).map(t=>t.id),['b']);
});

test('all matching rows remain available in date order beyond 200 records',()=>{
  const rows=Array.from({length:240},(_,i)=>({...lunch,id:String(i).padStart(3,'0'),occurred_on:i%2?'2026-11-02':'2026-11-01'}));
  const result=filterTransactions(rows,{ledger:'ledger-1'});
  assert.equal(result.length,240);
  assert.equal(result[0].occurred_on,'2026-11-01');
  assert.equal(result.at(-1).occurred_on,'2026-11-02');
  assert.equal(rows[1].occurred_on,'2026-11-02','filtering does not mutate server data');
});
