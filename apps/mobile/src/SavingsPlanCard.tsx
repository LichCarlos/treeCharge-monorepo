import React from 'react';
import {Pressable,Text,View} from 'react-native';
import {amount} from './api';
import {Button,Card,Icon,s,colors} from './ui';
import {spacing} from './theme';

export function SavingsPlanCard({plan,deleted=false,onOpen,onRestore,onPurge,headerAction,children}:{plan:any;deleted?:boolean;onOpen?:()=>void;onRestore?:()=>void;onPurge?:()=>void;headerAction?:React.ReactNode;children?:React.ReactNode}){
  const progress=plan.target_minor>0?Math.max(0,Math.min(100,(plan.saved_minor??0)/plan.target_minor*100)):0;
  const name=plan.plan_name??plan.name;
  const removed=new Date(plan.deleted_at),pad=(n:number)=>String(n).padStart(2,'0');
  const removedAt=Number.isFinite(removed.getTime())?`${removed.getFullYear()}-${pad(removed.getMonth()+1)}-${pad(removed.getDate())} ${pad(removed.getHours())}:${pad(removed.getMinutes())}`:'--';
  const body=<Card style={{gap:spacing.md,...(deleted?{backgroundColor:colors.input}:{})}}>
    <View style={s.spread}><View style={[s.row,{flex:1}]}><View style={[s.iconCircle,deleted&&{backgroundColor:colors.input}]}><Icon name="wallet-outline" color={deleted?colors.muted:colors.primaryStrong}/></View><Text style={[s.h3,{flex:1,color:deleted?colors.muted:colors.ink}]}>{name}</Text></View>{headerAction??<Icon name={deleted?'trash-outline':'chevron-forward'} color={colors.muted}/>}</View>
    {deleted&&<Text style={s.small}>删除于 {removedAt}</Text>}
    <View style={[s.spread,{flexWrap:'wrap'}]}><Text selectable style={[s.h2,{color:deleted?colors.muted:colors.ink,fontVariant:['tabular-nums']}]}>¥{amount(plan.saved_minor??0)}</Text><Text style={s.small}>目标 ¥{amount(plan.target_minor)}</Text></View>
    <View accessible accessibilityRole="progressbar" accessibilityLabel={name+'存款进度'} accessibilityValue={{min:0,max:100,now:progress,text:progress.toFixed(1)+'%'}} style={{height:8,borderWidth:1,borderColor:colors.line,borderRadius:4,overflow:'hidden',backgroundColor:colors.input}}><View style={{height:'100%',width:`${progress}%`,backgroundColor:deleted?colors.muted:colors.ink}}/></View>
    <View style={s.spread}><Text style={s.small}>{deleted?'已删除':progress>=100?'已达成':'进行中'} · {progress.toFixed(1)}%</Text>{!deleted&&plan.deadline&&<Text style={s.small}>{plan.deadline}</Text>}</View>
    {children}
    {deleted&&<View style={[s.row,{justifyContent:'flex-end',flexWrap:'wrap'}]}><Button secondary title="恢复" onPress={()=>onRestore?.()}/><Button danger title="永久删除" onPress={()=>onPurge?.()}/></View>}
  </Card>;
  return deleted||!onOpen?body:<Pressable accessibilityRole="button" accessibilityLabel={'查看计划'+name} onPress={onOpen}>{body}</Pressable>;
}
