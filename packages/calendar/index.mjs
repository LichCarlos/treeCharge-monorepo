// Calendar dates are date-only values. UTC is used for arithmetic, never for reading the user's local today.
export function parseDay(value) {
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))throw new RangeError('日期格式无效');
  const d=new Date(value+'T12:00:00Z');
  if(!Number.isFinite(d.getTime())||isoDay(d)!==value)throw new RangeError('日期不存在');
  return d;
}
export function isoDay(date){return date.toISOString().slice(0,10);}
export function localToday(){const d=new Date();return String(d.getFullYear())+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}
export function addDays(day,count){const d=parseDay(day);d.setUTCDate(d.getUTCDate()+count);return isoDay(d);}
export function monthStart(day){parseDay(day);return day.slice(0,7)+'-01';}
export function monthShift(day,delta){const d=parseDay(monthStart(day));d.setUTCMonth(d.getUTCMonth()+delta);return isoDay(d);}
export function periodRange(selection){
  const {mode,anchor}=selection,d=parseDay(anchor);let start,endExclusive;
  if(mode==='week'){start=addDays(anchor,-((d.getUTCDay()+6)%7));endExclusive=addDays(start,7);}
  else if(mode==='month'){start=monthStart(anchor);endExclusive=monthShift(start,1);}
  else if(mode==='year'){start=anchor.slice(0,4)+'-01-01';endExclusive=String(d.getUTCFullYear()+1)+'-01-01';}
  else if(mode==='day'){start=anchor;endExclusive=addDays(start,1);}
  else throw new RangeError('日期模式无效');
  return {start,end:addDays(endExclusive,-1),endExclusive};
}
export function shiftPeriod(selection,delta){
  const r=periodRange(selection);
  const anchor=selection.mode==='week'?addDays(r.start,7*delta):selection.mode==='day'?addDays(r.start,delta):monthShift(r.start,selection.mode==='year'?12*delta:delta);
  return {mode:selection.mode,anchor};
}
export function periodLabel(selection){
  const r=periodRange(selection),y=Number(r.start.slice(0,4)),m=Number(r.start.slice(5,7)),day=Number(r.start.slice(8));
  if(selection.mode==='year')return y+'年';
  if(selection.mode==='month')return y+'年'+m+'月';
  if(selection.mode==='day')return y+'年'+m+'月'+day+'日';
  return r.start.replaceAll('-','.')+' — '+(r.end.slice(0,4)===r.start.slice(0,4)?r.end.slice(5):r.end).replaceAll('-','.');
}
export function calendarRows(anchor){
  const first=monthStart(anchor),start=periodRange({mode:'week',anchor:first}).start;
  const last=addDays(monthShift(first,1),-1),rows=[];
  for(let day=start;day<=last;day=addDays(day,7))rows.push(Array.from({length:7},(_,i)=>addDays(day,i)));
  return rows;
}
export function rangeQuery(selection){const r=periodRange(selection);return 'start='+r.start+'&end='+r.end;}
