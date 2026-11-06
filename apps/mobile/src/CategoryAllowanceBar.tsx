import React from 'react';
import {Text,View} from 'react-native';
import {amount} from './api';
import {colors,s} from './ui';
import type {CategoryAllowance} from './categoryAllowance.mjs';
import {spacing,surfaces} from './theme';

export function CategoryAllowanceBar({value,category,month,mode='remaining',compact=false}:{value?:CategoryAllowance;category:string;month:string;mode?:'remaining'|'used';compact?:boolean}){
  const configured=!!value&&!value.pending;
  const negative=configured&&value.remaining!<0;
  const caption=configured?`上限 ¥${amount(value.limit)}${value.shared?' · 共享':''}`:value?.pending?'额度待设置':'未设置上限';
  const remaining=configured?`剩余 ${negative?'-':''}¥${amount(Math.abs(value.remaining!))}`:'';
  const used=configured?Math.max(0,value.limit!-value.remaining!):0;
  const usedPercent=configured?(value.limit!>0?used/value.limit!*100:used>0?100:0):0;
  const progress=mode==='used'?Math.min(100,usedPercent):value?.percentage??0;
  const usage=`已用 ¥${amount(used)} · ${usedPercent.toFixed(1)}%`;
  const bar=(<View accessible accessibilityRole="progressbar" accessibilityLabel={`${category} ${month}${mode==='used'?'消费进度':'类别额度'}`} accessibilityValue={configured?{min:0,max:100,now:progress,text:caption+'，'+(mode==='used'?usage+'，':'')+remaining}:{text:caption}} aria-valuemin={configured?0:undefined} aria-valuemax={configured?100:undefined} aria-valuenow={configured?progress:undefined} aria-valuetext={configured?caption+'，'+(mode==='used'?usage+'，':'')+remaining:caption} style={{height:8,borderWidth:1,borderColor:colors.line,borderRadius:4,overflow:'hidden',backgroundColor:negative?surfaces.dangerSoft:colors.input}}>
      {configured&&<View testID="category-allowance-fill" style={{height:'100%',borderRadius:3,width:`${progress}%`,backgroundColor:negative?colors.red:colors.ink}}/>}
    </View>);
  if(compact)return <View style={{flex:1,minWidth:0,gap:spacing.xxs}}><Text maxFontSizeMultiplier={1.3} numberOfLines={1} adjustsFontSizeToFit style={[s.small,{color:negative?colors.red:colors.ink,backgroundColor:negative?surfaces.dangerSoft:'transparent',borderRadius:4}]}>{configured?remaining:caption}</Text>{bar}</View>;
  return <View style={{flex:1,minWidth:0,gap:spacing.xs}}>
    <View style={[s.spread,{flexWrap:'wrap'}]}><Text style={s.small}>{caption}</Text>{configured&&mode==='used'&&<Text style={[s.small,{fontWeight:'600',color:negative?colors.red:colors.primaryStrong}]}>{usedPercent.toFixed(1)}%</Text>}</View>
    {bar}
    {configured&&<View style={[s.spread,{flexWrap:'wrap'}]}>{mode==='used'&&<Text style={s.small}>已用 ¥{amount(used)}</Text>}<Text style={[s.small,{color:negative?colors.red:colors.primaryStrong,fontWeight:'600'}]}>{remaining}</Text></View>}
  </View>;
}
