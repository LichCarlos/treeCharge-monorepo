import React from 'react';
import {Modal,Pressable,ScrollView,Text,View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {Button,Icon,s,colors} from './ui';
import {layout,spacing} from './theme';
export function LedgerPicker({visible,ledgers,value,onChoose,onClose,onManage}:{visible:boolean;ledgers:any[];value:string;onChoose:(id:string)=>void;onClose:()=>void;onManage:()=>void}){
  return <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}><View style={[s.modalShade,{justifyContent:'flex-end',padding:0}]}><Pressable accessibilityRole="button" accessibilityLabel="收起账本选择" onPress={onClose} style={{position:'absolute',inset:0}}/><SafeAreaView edges={['bottom','left','right']} style={[s.modalBox,{maxHeight:'80%',borderBottomLeftRadius:0,borderBottomRightRadius:0}]}><View style={{padding:layout.pageInset,gap:spacing.md,flexShrink:1}}>
    <View style={{alignSelf:'center',width:38,height:4,borderRadius:2,backgroundColor:colors.line}}/>
    <View style={s.spread}><Text style={s.h2}>选择账本</Text><Pressable accessibilityRole="button" accessibilityLabel="关闭账本选择" style={s.iconButton} onPress={onClose}><Icon name="close"/></Pressable></View>
    <ScrollView style={{flexShrink:1}} contentContainerStyle={{gap:spacing.xs}}>{ledgers.map(l=><Pressable key={l.id} accessibilityRole="button" accessibilityLabel={'切换到'+l.name} accessibilityState={{selected:value===l.id}} onPress={()=>{onChoose(l.id);onClose();}} style={[s.row,{padding:16,borderWidth:colors.borderWidth,borderColor:colors.line,borderRadius:15,backgroundColor:l.id===value?colors.accent:colors.input}]}><Icon name={l.ledger_type==='savings'?'trending-up-outline':'wallet-outline'}/><View style={{flex:1,gap:5}}><Text style={s.h3}>{l.name}</Text><Text style={s.small}>{l.ledger_type==='savings'?'存钱账本':'收支账本'}</Text></View>{value===l.id&&<Icon name="checkmark-circle" color={colors.ink}/>}</Pressable>)}{!ledgers.length&&<Text style={s.muted}>还没有账本，先创建一个。</Text>}</ScrollView>
    <Button title="管理 / 新建账本" secondary icon="settings-outline" onPress={()=>{onClose();onManage();}}/>
  </View></SafeAreaView></View></Modal>;
}
