import React from 'react';
import {Text,View} from 'react-native';
import {Button,ModalPanel,s} from './ui';
import {layout,spacing} from './theme';

export function ActionMenu({title,items,onClose}:{title:string;items:{title:string;danger?:boolean;onPress:()=>void}[];onClose:()=>void}){
  return <ModalPanel onClose={onClose}><View style={{padding:layout.cardInset,gap:spacing.md}}><Text style={s.h2}>{title}</Text>{items.map(item=><Button key={item.title} title={item.title} secondary={!item.danger} danger={item.danger} onPress={()=>{onClose();item.onPress();}}/>)}<Button secondary title="取消" onPress={onClose}/></View></ModalPanel>;
}
