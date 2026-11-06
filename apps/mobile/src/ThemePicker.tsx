import React from 'react';
import {Pressable,Text,View} from 'react-native';
import {Card,FourColumnGrid,Icon,colors,s} from './ui';
import {getTheme,themeGroups,spacing,radius,type ThemeName} from './theme';

export function ThemePicker({value,onChange}:{value:ThemeName;onChange:(name:ThemeName)=>void}){
  return <Card><View style={{gap:spacing.lg}}><Text style={s.h3}>主题风格</Text>{themeGroups.map(group=><View key={group.id} style={{gap:spacing.sm}}>
    <Text accessibilityRole="header" style={s.label}>{group.label}</Text>
    <FourColumnGrid>{group.options.map(option=>{
      const palette=getTheme(option.id),selected=value===option.id;
      return <Pressable key={option.id} accessibilityRole="radio" accessibilityLabel={group.label+'·'+option.label+'主题'} aria-checked={selected} accessibilityState={{checked:selected}} onPress={()=>onChange(option.id)} style={({pressed})=>({alignItems:'center',justifyContent:'center',gap:spacing.xs,minHeight:80,minWidth:48,opacity:pressed?.65:1})}>
        <View style={{width:48,height:48,borderRadius:radius.md,backgroundColor:palette.canvas,borderWidth:selected?3:1,borderColor:selected?colors.ink:colors.outline,alignItems:'center',justifyContent:'center'}}>
          <View style={{width:28,height:24,borderRadius:6,backgroundColor:palette.card,borderWidth:palette.borderWidth,borderColor:palette.line}}/>
          <View style={{position:'absolute',bottom:5,right:5,width:14,height:14,borderRadius:7,backgroundColor:palette.accent,borderWidth:1,borderColor:colors.ink}}/>
          {selected&&<View style={{position:'absolute',inset:0,alignItems:'center',justifyContent:'center'}}><Icon name="checkmark" size={22} color={palette.onPrimary}/></View>}
        </View>
        <Text numberOfLines={1} style={[s.small,selected&&{color:colors.primaryStrong,fontWeight:'700'}]}>{option.label}</Text>
      </Pressable>;
    })}</FourColumnGrid>
  </View>)}</View></Card>;
}
