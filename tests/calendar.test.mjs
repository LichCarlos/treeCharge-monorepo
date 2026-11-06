import {test} from 'node:test';
import assert from 'node:assert/strict';
import {periodRange,shiftPeriod,calendarRows,addDays,parseDay} from '../packages/calendar/index.mjs';
test('week starts Monday and crosses the year without dropping Sunday',()=>{
  assert.deepEqual(periodRange({mode:'week',anchor:'2027-01-01'}),{start:'2026-12-28',end:'2027-01-03',endExclusive:'2027-01-04'});
  assert.deepEqual(shiftPeriod({mode:'week',anchor:'2027-01-01'},1),{mode:'week',anchor:'2027-01-04'});
});
test('leap February and year ranges include every calendar day',()=>{
  assert.deepEqual(periodRange({mode:'month',anchor:'2024-02-29'}),{start:'2024-02-01',end:'2024-02-29',endExclusive:'2024-03-01'});
  assert.equal(periodRange({mode:'year',anchor:'2024-02-29'}).endExclusive,'2025-01-01');
  assert.equal(shiftPeriod({mode:'month',anchor:'2024-01-31'},1).anchor,'2024-02-01');
  assert.equal(addDays('2024-02-28',1),'2024-02-29');
});
test('calendar rows contain full Monday to Sunday weeks and reject impossible dates',()=>{
  const rows=calendarRows('2026-11-01');assert.equal(rows.length,6);
  assert.equal(rows[0][0],'2026-10-26');assert.equal(rows.at(-1).at(-1),'2026-12-06');
  assert.throws(()=>parseDay('2025-02-29'));assert.throws(()=>parseDay('2026-13-01'));
});
