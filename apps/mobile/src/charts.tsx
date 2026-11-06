import React from 'react';
import {Text,View} from 'react-native';
import Svg,{Circle,Path,Polyline} from 'react-native-svg';
import {s,colors} from './ui';
import {amount} from './api';
const chartSeries=['#0072E3','#FF5C38','#00AA3C','#AB54F7','#151515','#FFB200'];
export const chartColors=new Proxy(['',...chartSeries],{get:(target,key,receiver)=>key==='0'?colors.primary:Reflect.get(target,key,receiver)}) as string[];
export function Trend({data}:{data:any[]}) {
  if(data.length<2)return <Text style={s.muted}>至少两个日期有支出后显示折线。</Text>;
  const max=Math.max(1,...data.map(x=>x.amountMinor)),min=Math.min(0,...data.map(x=>x.amountMinor)),range=Math.max(1,max-min);
  const points=data.map((d,i)=>(10+i/(data.length-1)*280)+','+(110-(d.amountMinor-min)/range*95)).join(' ');
  return <View><Svg width="100%" height={145} viewBox="0 0 300 130"><Path d="M10 110 H290" stroke={colors.line}/><Polyline points={points} fill="none" stroke={colors.ink} strokeWidth={3} strokeLinejoin="round"/></Svg><View style={s.spread}><Text style={s.small}>{data[0]?.day}</Text><Text style={s.small}>{data.at(-1)?.day}</Text></View></View>;
}
export function Donut({data}:{data:any[]}) {
  if(data.some(x=>x.amountMinor<0))return <Text style={s.small}>存在净退款负值，使用金额列表展示。</Text>;
  const total=data.reduce((s,x)=>s+x.amountMinor,0);if(!total)return <Text style={s.muted}>暂无消费数据。</Text>;
  let offset=0;
  return <View style={{alignItems:'center'}}><Svg width={180} height={180} viewBox="0 0 180 180">{data.map((x,i)=>{
    const value=x.amountMinor/total*439.82,part=<Circle key={x.id} cx={90} cy={90} r={70} fill="none" stroke={chartColors[i%chartColors.length]} strokeWidth={20} strokeDasharray={value+' '+(439.82-value)} strokeDashoffset={-offset} rotation={-90} origin="90,90"/>;offset+=value;return part;
  })}</Svg><Text style={[s.small,{position:'absolute',top:70}]}>分类净支出</Text><Text style={[s.h3,{position:'absolute',top:95}]}>¥{amount(total)}</Text></View>;
}
