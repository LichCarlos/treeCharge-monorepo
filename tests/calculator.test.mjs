import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateAmount,calculatorPress} from '../apps/mobile/src/calculator.mjs';
test('calculator sums exact cents and supports chained additions/subtractions',()=>{
  assert.equal(evaluateAmount('0.10+0.20'),30);
  assert.equal(evaluateAmount('38.5+12-0.50'),5000);
  assert.equal(evaluateAmount('2-3'),-100);
  assert.equal(evaluateAmount('12.'),1200);
});
test('calculator rejects incomplete, unsafe and injected expressions',()=>{
  for(const value of ['','1+','1.234','1e3','1/0','1;alert(1)','999999999.99+0.01','9'.repeat(60)])assert.throws(()=>evaluateAmount(value));
});
test('keypad replaces operators, limits decimal precision and permits correction',()=>{
  const enter=keys=>[...keys].reduce((s,k)=>calculatorPress(s,k),'');
  assert.equal(enter('001.239'),'1.23');
  assert.equal(enter('.5+2'),'0.5+2');
  assert.equal(enter('10+-2'),'10-2');
  assert.equal(calculatorPress('12.34','backspace'),'12.3');
  assert.equal(calculatorPress('12','clear'),'');
});
