import React,{useCallback,useEffect,useRef,useState} from 'react';
import {ActivityIndicator,Platform,Pressable,Text,View} from 'react-native';
import {api,amount,minor,operationId,today} from './api';
import {Button,Card,Empty,FormModal,Icon,s,colors,type Field,type FormSpec} from './ui';
import {RecordComposer,type RecordSpec,type RecordDraft} from './RecordComposer';
import {categoryIcon} from './categoryIcons';
import {useWorkspaceState} from './useWorkspaceState';
import {SavingsPlanCard} from './SavingsPlanCard';
import {ConfirmActionModal,type Confirmation} from './ConfirmActionModal';
import {ActionMenu} from './ActionMenu';
import {spacing} from './theme';

type Props={workspace:string;root:string;userId:string;admin:boolean;planId:string;deletedOnly?:boolean;onDeleted:()=>void;onSelect:(id:string)=>void;onNavigate:()=>void;onManageCategories:(ledgerId:string)=>void};
export function SavingsManager({workspace,root,userId,admin,planId,deletedOnly=false,onDeleted,onSelect,onNavigate,onManageCategories}:Props){
  const [state,setState]=useState<any>(null),[stats,setStats]=useState<any>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [form,setForm]=useState<FormSpec|null>(null),[record,setRecord]=useState<RecordSpec|null>(null);
  const sequence=useRef(0);
  const shared=useWorkspaceState(workspace);
  const [confirmation,setConfirmation]=useState<Confirmation|null>(null);
  const [menu,setMenu]=useState(false);
  const load=useCallback(async(force=false)=>{
    const own=++sequence.current;setBusy(true);setError('');
    try{
      const all=await shared.refresh(force);
      const goal=all.goals.find((g:any)=>g.id===planId);
      let details=all;
      let report:{transactions:any[];totals:{deposit:number;withdrawal:number}}|null=null;
      if(goal){
        const history=await api<{transactions:any[];totals:{deposit:number;withdrawal:number}}>(`/v1/workspaces/${workspace}/savings-plans/${goal.id}/records`);
        report=history;
        details={...all,transactions:history.transactions,goals:all.goals.map((g:any)=>g.id===goal.id?{...g,saved_minor:history.totals.deposit-history.totals.withdrawal}:g)};
      }
      if(own!==sequence.current)return;
      setState({...details,goals:details.goals.filter((g:any)=>details.ledgers.some((l:any)=>l.id===g.ledger_id&&l.ledger_type==='savings'))});setStats(report);
      if(planId&&!goal){setRecord(null);setForm(null);setMenu(false);onSelect('');}
    }catch(e){if(own===sequence.current)setError((e as Error).message);}
    finally{if(own===sequence.current)setBusy(false);}
  },[workspace,planId,deletedOnly,shared.refresh]);
  useEffect(()=>{setState(null);setStats(null);setRecord(null);setForm(null);setConfirmation(null);setMenu(false);},[workspace,planId,deletedOnly]);
  useEffect(()=>{void load();return()=>{sequence.current++;};},[load,shared.data]);
  const path=(p:string)=>`/v1/workspaces/${workspace}${p}`;
  async function write(p:string,body:any,id:string,reason?:string,method='POST'){
    return api(path(p),method,{...body,operationId:id,...(admin?{reason}:{})});
  }
  function open(key:string,title:string,fields:Field[],initial:Record<string,string>,submit:FormSpec['submit'],destructive=false){
    setForm({key:`${workspace}:savings:${key}`,title,fields:[...fields,...(admin?[{key:'reason',label:'管理员操作理由',type:'textarea' as const,required:true}]:[])],initial,operationId:operationId(),destructive,submit:async(v,id)=>{await submit(v,id);await load();}});
  }
  function newPlan(existingLedger?:any){
    open('new:'+ (existingLedger?.id??'new'),'新建存款计划',[
      {key:'name',label:'计划名称',required:true,placeholder:'例如：旅行基金、新电脑'},
      {key:'template',label:'计划模板',type:'select',required:true,options:[{value:'none',label:'自定义目标'}]},
      {key:'amount',label:'目标金额（元）',type:'money',required:true},
      {key:'deadline',label:'目标日期（可选）',type:'date'}
    ],{name:existingLedger?.name??'',template:'none'},async(v,id)=>{
      await write(existingLedger?'/goals':'/savings-plans',{...(existingLedger?{ledgerId:existingLedger.id}:{parentId:root}),name:v.name,targetMinor:minor(v.amount),deadline:v.deadline||null},id,v.reason);
    });
  }
  const goal=state?.goals.find((g:any)=>g.id===planId);
  const ledger=state?.ledgers.find((l:any)=>l.id===goal?.ledger_id);
  const categories=(state?.categories??[]).filter((c:any)=>c.ledger_id===goal?.ledger_id);
  function editPlan(){if(!goal)return;open('edit:'+goal.id,'编辑存款计划',[
    {key:'name',label:'计划名称',required:true},{key:'amount',label:'目标金额（元）',type:'money',required:true},{key:'deadline',label:'目标日期（可选）',type:'date'}
  ],{name:goal.name,amount:String(goal.target_minor/100),deadline:goal.deadline??''},async(v,id)=>{await write('/goals/'+goal.id,{name:v.name,targetMinor:minor(v.amount),deadline:v.deadline||null,expectedRevision:goal.revision},id,v.reason,'PUT');});}
  function remove(e:any){const plan=e.id===goal?.id;setConfirmation({title:plan?'删除存款计划':'删除记录',message:plan?'删除此计划？可在已删除计划中恢复。':'删除此记录？',confirmLabel:'确认删除',danger:true,submit:async(id,reason)=>{
    await write('/entities/'+e.id,{expectedRevision:e.revision},id,reason,'DELETE');
    if(plan){setRecord(null);onSelect('');}else await load(true);
  }});}
  function restore(e:any){setConfirmation({title:'恢复存款计划',message:'恢复此计划及本次删除的记录？',confirmLabel:'确认恢复',submit:async(id,reason)=>{
    await write('/entities/'+e.id+'/restore',{expectedRevision:e.revision},id,reason);await load(true);
  }});}
  function purge(e:any){setConfirmation({title:'永久删除存款计划',message:'永久删除此计划及全部记录？此操作无法恢复。',confirmLabel:'永久删除',danger:true,submit:async(id,reason)=>{
    await write('/savings-plans/'+e.id+'/permanent',{expectedRevision:e.revision},id,reason,'DELETE');await load(true);
  }});} 
  function compose(direction='deposit',t?:any){if(!goal||!ledger)return;setRecord({key:operationId(),transaction:t,lockLedger:true,initial:{
    ledger:ledger.id,category:t?.category_id??categories.find((c:any)=>!c.allowed_directions?.length||c.allowed_directions.includes(direction))?.id??'',
    direction:t?.direction??direction,expression:t?String(t.amount_minor/100):'',date:t?.occurred_on??today(),remark:t?.remark??'',original:'',reason:''
  }});}
  async function saveRecord(v:RecordDraft,cents:number,id:string){
    if(!goal||v.ledger!==goal.ledger_id)throw new Error('记录必须归属当前计划');
    const t=record?.transaction;
    await write(t?'/transactions/'+t.id:'/transactions',{ledgerId:v.ledger,categoryId:v.category,direction:v.direction,amountMinor:cents,occurredOn:v.date,remark:v.remark,...(t?{expectedRevision:t.revision}:{})},id,v.reason,t?'PUT':'POST');
    await load();
  }
  const orphanLedgers=(state?.ledgers??[]).filter((l:any)=>l.ledger_type==='savings'&&!state.goals.some((g:any)=>g.ledger_id===l.id));
  const deleted=(state?.trash??[]).filter((e:any)=>e.ledger_type==='savings'&&['goal','ledger'].includes(e.kind)&&e.target_minor!=null);
  return <View style={{gap:spacing.md}}>
    {!!error&&<View style={{gap:10}}><Text accessibilityRole="alert" style={s.error}>{error}</Text><Button title="重新读取计划" secondary onPress={()=>void load(true)}/></View>}
    {busy&&<ActivityIndicator color={colors.primaryStrong}/>}
    {!state?null:deletedOnly?<>
      {deleted.map((g:any)=><SavingsPlanCard key={g.id} plan={g} deleted onRestore={()=>restore(g)} onPurge={()=>purge(g)}/>)}
      {!deleted.length&&<Empty title="暂无已删除计划" detail=""/>}
    </>:!planId?<>
      <Button title="新建存款计划" icon="add" onPress={()=>newPlan()}/>
      {state.goals.map((g:any)=><SavingsPlanCard key={g.id} plan={g} onOpen={()=>onSelect(g.id)}/>)}
      {!state.goals.length&&<Empty title="为期待的事物存一点" detail="新建一个计划，手动记录每次存入和取出。"/>}
      {orphanLedgers.map((l:any)=><Card key={l.id}><View style={{gap:12}}><Text style={s.h3}>{l.name}</Text><Button secondary title={'为'+l.name+'建立计划'} onPress={()=>newPlan(l)}/></View></Card>)}
      {Platform.OS!=='web'&&<Button secondary title="已删除计划" icon="trash-outline" onPress={onDeleted}/>}
    </>:!goal||!ledger?<Empty title="计划暂不可用" detail="计划或关联账本可能已被删除，可返回列表查看其他计划。"/>:<>
      <SavingsPlanCard plan={goal} headerAction={<Pressable accessibilityRole="button" accessibilityLabel="存款计划更多操作" onPress={()=>setMenu(true)} style={s.iconButton}><Icon name="ellipsis-horizontal"/></Pressable>}>
        <Text style={s.body}>还需 ¥{amount(Math.max(0,goal.target_minor-goal.saved_minor))}</Text>
        <View style={s.row}><Button style={{flex:1}} title="存入" icon="add" onPress={()=>compose('deposit')}/><Button style={{flex:1}} secondary title="取出" onPress={()=>compose('withdrawal')}/></View>
      </SavingsPlanCard>
      <Card><View style={s.spread}><Text style={s.body}>累计存入 ¥{amount(stats?.totals.deposit??0)}</Text><Text style={s.body}>取出 ¥{amount(stats?.totals.withdrawal??0)}</Text></View></Card>
      <Text style={s.h3}>全部存取记录 · {state.transactions.length} 笔</Text>
      {state.transactions.length?<Card>{state.transactions.map((t:any)=><View key={t.id} style={s.item}><View style={s.spread}><View style={{flex:1,gap:5}}><View style={s.row}><Icon name={categoryIcon(state.categories.find((c:any)=>c.id===t.category_id)??t)} size={24}/><Text style={s.h3}>{t.category_name} · {t.direction==='deposit'?'存入':'取出'}</Text></View><Text style={s.small}>{t.occurred_on}{t.remark?' · '+t.remark:''}</Text></View><Text style={s.h3}>{t.direction==='deposit'?'＋':'−'}{amount(t.amount_minor)}</Text></View><View style={[s.row,{justifyContent:'flex-end'}]}><Button secondary title="编辑记录" onPress={()=>compose(t.direction,t)}/><Pressable accessibilityRole="button" accessibilityLabel="删除存取记录" onPress={()=>remove(t)} style={s.iconButton}><Icon name="trash-outline" color={colors.red}/></Pressable></View></View>)}</Card>:<Text style={s.muted}>还没有存取记录</Text>}
      
      
      <Button secondary title="删除计划" danger onPress={()=>remove(goal)}/>
    </>}
    {record&&<RecordComposer key={record.key} spec={record} userId={userId} workspace={workspace} ledgers={ledger?[ledger]:[]} categories={categories} admin={admin} offline={false} onClose={()=>setRecord(null)} onManage={()=>{setRecord(null);if(ledger)onManageCategories(ledger.id);}} onManageLedgers={()=>setRecord(null)} onCategoriesChanged={categories=>setState((v:any)=>v?{...v,categories}:v)} onSave={saveRecord}/>}
    {confirmation&&<ConfirmActionModal action={confirmation} admin={admin} onClose={()=>setConfirmation(null)}/>}
    {menu&&goal&&<ActionMenu title="存款计划" onClose={()=>setMenu(false)} items={[{title:'编辑存款计划',onPress:editPlan},{title:'删除计划',danger:true,onPress:()=>remove(goal)}]}/>}
    <FormModal spec={form} userId={userId} onClose={()=>setForm(null)} onNavigate={()=>{setForm(null);onNavigate();}}/>
  </View>;
}
