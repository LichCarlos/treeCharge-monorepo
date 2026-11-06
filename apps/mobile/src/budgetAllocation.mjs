// Work in integer cents; remainder rows do not reserve money from manual entries.
export function allocationPreview(rows,baseMinor){
  const base=Number.isSafeInteger(baseMinor)&&baseMinor>0?baseMinor:0;
  const bps=value=>Number.isFinite(value)?Math.min(10000,Math.max(0,Math.floor(value))):0;
  const manual=rows.map(row=>row.mode==='fixed'?row.fixedMinor??0:row.mode==='ratio'?Math.round(base*bps(row.ratioBps)/10000):0);
  const reserved=manual.reduce((sum,value)=>sum+value,0),remaining=base-reserved;
  const residual=rows.filter(row=>row.mode==='remainder'),weight=residual.reduce((sum,row)=>sum+(row.weight??1),0);
  const explicit=residual.some(row=>row.remainderBps!=null),totalBps=residual.reduce((sum,row)=>sum+bps(row.remainderBps),0);
  const denominator=explicit?10000:weight;
  const portions=residual.map((row,index)=>{const numerator=BigInt(Math.max(0,remaining))*BigInt(explicit?bps(row.remainderBps):row.weight??1),den=BigInt(denominator||1);return {key:row.key,index,value:Number(numerator/den),rest:Number(numerator%den)};});
  const order=[...portions].sort((a,b)=>b.rest-a.rest||a.index-b.index);
  const target=explicit?Number((BigInt(Math.max(0,remaining))*BigInt(totalBps)*2n+10000n)/20000n):Math.max(0,remaining);
  for(let i=0,left=target-portions.reduce((sum,p)=>sum+p.value,0);denominator&&i<left;i++)order[i].value++;
  return {baseMinor:base,reservedMinor:reserved,remainingMinor:remaining,remainderBps:explicit?totalBps:residual.length?10000:0,
    unallocatedMinor:remaining-portions.reduce((sum,p)=>sum+p.value,0),rows:rows.map((row,index)=>({...row,
    amountMinor:row.mode==='remainder'?portions.find(p=>p.key===row.key)?.value??0:manual[index],
    availableMinor:base-reserved+manual[index]}))};
}
export function inputMinor(value){
  if(!/^\d+(\.\d{0,2})?$/.test(value??''))return null;
  const [whole,decimal='']=value.split('.'),amount=Number(whole)*100+Number(decimal.padEnd(2,'0'));
  return Number.isSafeInteger(amount)&&amount<=99999999999?amount:null;
}
