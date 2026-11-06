import React,{useState} from 'react';
import {Modal,Pressable,ScrollView,Text,TextInput,View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {Icon,colors,s} from './ui';
import {categoryIcon} from './categoryIcons';
import {layout,radius,spacing} from './theme';

export function TransactionFilters({categories,value,onChoose,query,onQuery}:{categories:any[];value:string;onChoose:(id:string)=>void;query:string;onQuery:(value:string)=>void}){
  const [visible,setVisible]=useState(false);
  const selected=categories.find(c=>c.id===value);
  const options=[{id:'',name:'全部类别'},...categories];
  return <View testID="transaction-filters" style={{flexDirection:'row',alignItems:'stretch',gap:spacing.xs}}>
    <Pressable accessibilityRole="button" accessibilityLabel="筛选消费类别" accessibilityState={{expanded:visible}} onPress={()=>setVisible(true)} style={[s.input,{width:'35%',flexDirection:'row',alignItems:'center',gap:spacing.xxs,paddingHorizontal:spacing.xs}]}>
      <Text numberOfLines={1} ellipsizeMode="tail" style={[s.body,{flex:1}]}>{selected?.name??'全部类别'}</Text><Icon name="chevron-down" size={16}/>
    </Pressable>
    <TextInput accessibilityLabel="搜索明细" style={[s.input,{flex:1,minWidth:0}]} placeholder="备注、类别、金额…" placeholderTextColor={colors.muted} value={query} onChangeText={onQuery} returnKeyType="search"/>
    <Modal visible={visible} transparent animationType="slide" onRequestClose={()=>setVisible(false)}><View style={[s.modalShade,{justifyContent:'flex-end',padding:0}]}>
      <Pressable accessibilityRole="button" accessibilityLabel="收起类别筛选" onPress={()=>setVisible(false)} style={{position:'absolute',inset:0}}/>
      <SafeAreaView edges={['bottom','left','right']} style={[s.modalBox,{maxHeight:'80%',borderBottomLeftRadius:0,borderBottomRightRadius:0}]}>
        <View style={{padding:layout.pageInset,gap:spacing.sm,flexShrink:1}}><View style={s.spread}><Text style={s.h2}>选择类别</Text><Pressable accessibilityRole="button" accessibilityLabel="关闭类别筛选" onPress={()=>setVisible(false)} style={s.iconButton}><Icon name="close"/></Pressable></View>
          <ScrollView style={{flexShrink:1}} keyboardShouldPersistTaps="handled" contentContainerStyle={{gap:spacing.xs}}>{options.map(c=><Pressable key={c.id} accessibilityRole="button" accessibilityLabel={'筛选类别'+c.name} accessibilityState={{selected:value===c.id}} onPress={()=>{onChoose(c.id);setVisible(false);}} style={[s.row,{minHeight:layout.touchTarget,padding:spacing.sm,borderWidth:colors.borderWidth,borderColor:colors.line,borderRadius:radius.md,backgroundColor:value===c.id?colors.accent:colors.input}]}>
            <Icon name={c.id?categoryIcon(c):'apps-outline'}/><Text numberOfLines={1} style={[s.body,{flex:1}]}>{c.name}</Text>{value===c.id&&<Icon name="checkmark-circle" color={colors.ink}/>}
          </Pressable>)}</ScrollView>
        </View>
      </SafeAreaView>
    </View></Modal>
  </View>;
}
