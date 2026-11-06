import React from 'react';
import {Pressable,Text,View} from 'react-native';
import {Card,Empty,Icon,colors,s} from './ui';
import {categoryIcon} from './categoryIcons';
import {CategoryAllowanceBar} from './CategoryAllowanceBar';
import {categoryAllowanceIndex,categoryAllowanceKey} from './categoryAllowance.mjs';
import {spacing} from './theme';

export function CategoryDetailsList({categories,ledger,month,plans,balances,onChoose,manage=false}:{categories:any[];ledger:string;month:string;plans:any[];balances:any[];onChoose:(id:string)=>void;manage?:boolean}){
  const own=categories.filter(c=>c.ledger_id===ledger);
  const expenses=own.filter(c=>!c.allowed_directions?.length||c.allowed_directions.includes('expense'));
  const incomes=own.filter(c=>!c.allowed_directions?.length||c.allowed_directions.includes('income'));
  const allowances=categoryAllowanceIndex(plans,balances);
  const item=(c:any,income=false)=><Pressable key={c.id} accessibilityRole="button" accessibilityLabel={manage?'设置类别额度'+c.name:'查看类别全部明细'+c.name+(income?'收入':'支出')} onPress={()=>onChoose(c.id)}>
    <Card><View style={[s.row,{alignItems:'flex-start'}]}><View style={s.iconCircle}><Icon name={categoryIcon(c)}/></View><View style={{flex:1,minWidth:0,gap:spacing.xs}}><View style={s.spread}><Text numberOfLines={1} ellipsizeMode="tail" style={[s.h3,{flex:1}]}>{c.name}</Text><Icon name="chevron-forward" size={18} color={colors.muted}/></View>{!income&&<CategoryAllowanceBar value={allowances.get(categoryAllowanceKey(ledger,c.id,month))} category={c.name} month={month} mode="used"/>}</View></View></Card>
  </Pressable>;
  return <View style={{gap:spacing.sm}}><View style={[s.spread,{flexWrap:'wrap'}]}><Text style={s.h3}>支出类别</Text><Text style={s.small}>{month} · {expenses.length} 类</Text></View>
    {expenses.length?expenses.map(c=>item(c)):<Empty title="还没有支出类别" detail=""/>}
    {!manage&&<><Text style={s.h3}>收入类别</Text>{incomes.length?incomes.map(c=>item(c,true)):<Empty title="还没有收入类别" detail=""/>}</>}
  </View>;
}
