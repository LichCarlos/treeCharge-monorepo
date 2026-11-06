import {addDays,parseDay,periodRange} from '@charge/calendar';
import {HttpError} from './http.js';
export function dateFilter(q:Record<string,string|undefined>){
  try {
    if(q.month&&(q.start||q.end))throw new Error('月份与日期范围不能同时指定');
    if(q.month){
      if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(q.month))throw new Error('月份无效');
      return periodRange({mode:'month',anchor:q.month+'-01'});
    }
    if(!q.start&&!q.end)return {start:null,end:null,endExclusive:null};
    if(!q.start||!q.end)throw new Error('开始和结束日期须同时提供');
    const first=parseDay(q.start),last=parseDay(q.end);
    if(last<first)throw new Error('结束日期不能早于开始日期');
    if((last.getTime()-first.getTime())/86400000>365)throw new Error('一次最多选择366天');
    if(q.start<'1900-01-01'||q.end>'2199-12-31')throw new Error('日期范围限1900至2199年');
    return {start:q.start,end:q.end,endExclusive:addDays(q.end,1)};
  }catch(e){throw new HttpError(422,(e as Error).message);}
}
