import React from 'react';
import {Pressable,Text,View} from 'react-native';
import {amount} from './api';
import {categoryIcon} from './categoryIcons';
import {CategoryAllowanceBar} from './CategoryAllowanceBar';
import type {CategoryAllowance} from './categoryAllowance.mjs';
import {colors,Icon,s} from './ui';
import {spacing,layout,radius} from './theme';

const directions:Record<string,string>={income:'收入',expense:'支出',deposit:'存入',withdrawal:'取出',refund:'退款'};
export function TransactionRow({transaction:t,category,allowance,onOpen,onDelete}:{transaction:any;category:any;allowance?:CategoryAllowance;onOpen:()=>void;onDelete:()=>void}){
  const outgoing=['expense','withdrawal'].includes(t.direction);
  return <View style={{backgroundColor:colors.paper,paddingHorizontal:layout.cardInset,paddingVertical:spacing.sm,borderWidth:colors.borderWidth,borderColor:colors.line,borderRadius:radius.lg,marginBottom:spacing.xs,gap:spacing.xs}}>
    <Pressable accessibilityRole="button" accessibilityLabel={'查看消费明细'+t.category_name+' '+t.occurred_on+' '+amount(t.amount_minor)} onPress={onOpen} style={({pressed})=>[s.row,{minHeight:layout.touchTarget,alignItems:'flex-start',opacity:pressed?.65:1}]}>
      <View style={s.iconCircle}><Icon name={categoryIcon(category??{name:t.category_name,icon_id:t.category_icon_id})} size={24}/></View>
      <View style={{flex:1,minWidth:0,gap:spacing.xxs}}><View style={[s.spread,{flexWrap:'wrap'}]}><Text numberOfLines={1} style={[s.h3,{flexShrink:1}]}>{t.category_name}</Text><Text selectable style={[s.h3,{fontVariant:['tabular-nums'],color:outgoing?colors.ink:colors.green}]}>{outgoing?'−':'＋'}{amount(t.amount_minor)}</Text></View><Text numberOfLines={2} ellipsizeMode="tail" style={s.small}>{t.occurred_on} · {directions[t.direction]}{t.remark?' · '+t.remark:''}</Text></View>
    </Pressable>
    <View style={s.row}>{['expense','refund'].includes(t.direction)?<CategoryAllowanceBar value={allowance} category={t.category_name} month={t.occurred_on.slice(0,7)}/>:<View style={{flex:1}}/>}<Pressable accessibilityRole="button" accessibilityLabel={'删除此条'+t.category_name+'记录'} onPress={onDelete} style={({pressed})=>[s.iconButton,{opacity:pressed?.6:1}]}><Icon name="trash-outline" color={colors.red} size={20}/></Pressable></View>
  </View>;
}
