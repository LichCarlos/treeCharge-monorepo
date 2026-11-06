import React from 'react';
import {Pressable,Text,View} from 'react-native';
import {Icon,s,colors} from './ui';
import {layout,spacing} from './theme';

export type Breadcrumb={label:string;onPress?:()=>void};
export function Breadcrumbs({items,onBack}:{items:Breadcrumb[];onBack:()=>void}){
  const parent=items.at(-2);
  return <View style={[s.row,{gap:spacing.xs,minHeight:layout.touchTarget}]}>
    {parent&&<Pressable accessibilityRole="button" accessibilityLabel={'返回上一级：'+parent.label} onPress={onBack} style={({pressed})=>[s.row,{gap:spacing.xxs,minHeight:layout.touchTarget,paddingRight:spacing.xs,opacity:pressed?.6:1}]}>
      <Icon name="chevron-back" size={18} color={colors.primaryStrong}/><Text style={s.link}>返回</Text>
    </Pressable>}
    <View accessibilityLabel="页面路径" style={{flex:1,flexDirection:'row',flexWrap:'wrap',alignItems:'center',gap:spacing.xs}}>
      {items.map((item,index)=><React.Fragment key={index}>
        {index>0&&<Icon name="chevron-forward" size={12} color={colors.muted}/>}
        {item.onPress?<Pressable accessibilityRole="button" accessibilityLabel={'前往'+item.label} onPress={item.onPress} style={{minWidth:layout.touchTarget,minHeight:layout.touchTarget,justifyContent:'center'}}><Text style={[s.small,{color:colors.primaryStrong}]}>{item.label}</Text></Pressable>:<Text style={[s.small,{color:colors.ink,fontWeight:'600'}]}>{item.label}</Text>}
      </React.Fragment>)}
    </View>
  </View>;
}
