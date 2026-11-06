import React,{useRef,useState} from 'react';
import {Text,TextInput,View} from 'react-native';
import {operationId} from './api';
import {Button,Icon,ModalPanel,s,colors} from './ui';
import {layout,spacing} from './theme';

export type Confirmation={title:string;message:string;confirmLabel:string;danger?:boolean;submit:(operation:string,reason:string)=>Promise<void>};
export function ConfirmActionModal({action,admin,onClose}:{action:Confirmation;admin:boolean;onClose:()=>void}){
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[reason,setReason]=useState('');
  const pending=useRef(false),operation=useRef(operationId());
  async function confirm(){if(pending.current)return;setError('');if(admin&&!reason.trim()){setError('请填写管理员操作理由');return;}
    pending.current=true;setBusy(true);try{await action.submit(operation.current,reason);onClose();}catch(e){setError((e as Error).message);}finally{pending.current=false;setBusy(false);}}
  return <ModalPanel animation="fade" onClose={()=>!busy&&onClose()}><View style={{padding:layout.cardInset,gap:spacing.md}}>
    <View style={s.row}><Icon name={action.danger?'trash-outline':'refresh-outline'} color={action.danger?colors.red:colors.primaryStrong}/><Text style={s.h2}>{action.title}</Text></View>
    <Text style={s.body}>{action.message}</Text>
    {admin&&<TextInput accessibilityLabel="管理员操作理由" placeholder="管理员操作理由" value={reason} onChangeText={setReason} style={s.input}/>}
    {!!error&&<Text accessibilityRole="alert" style={s.error}>{error}</Text>}
    <Button title={busy?'正在处理…':action.confirmLabel} danger={action.danger} disabled={busy} onPress={()=>void confirm()}/>
    <Button title="取消" secondary disabled={busy} onPress={onClose}/>
  </View></ModalPanel>;
}
