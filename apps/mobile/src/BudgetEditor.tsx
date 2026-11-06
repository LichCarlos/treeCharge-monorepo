import React,{useEffect,useState} from 'react';
import {ActivityIndicator,Text,View} from 'react-native';
import {api,amount,minor,operationId,today} from './api';
import {FormModal,ModalPanel,Button,colors,s,type FormSpec,type Field} from './ui';
import {useBudgetState} from './useBudgetState';
import {allocationPreview,inputMinor} from './budgetAllocation.mjs';

export type BudgetTarget={ledgerId:string;month:string;categoryId?:string;planId?:string};
type Props={workspace:string;userId:string;admin:boolean;offline:boolean;target:BudgetTarget;onClose:()=>void;onSaved?:()=>void};
export function BudgetEditor({workspace,userId,admin,offline,target,onClose,onSaved}:Props){
  const state=useBudgetState(workspace,target.ledgerId,target.month);
  const [form,setForm]=useState<FormSpec|null>(null),[error,setError]=useState(''),[ready,setReady]=useState(false);
  useEffect(()=>{let live=true;void state.refresh(true).then(()=>live&&setReady(true)).catch(e=>live&&setError(e.message));return()=>{live=false;};},[workspace,target.ledgerId,target.month]);
  useEffect(()=>{let live=true;
    async function prepare(){
      if(!ready||state.loading||state.stale||!state.data)return;
      const all=state.data,c=all.categories.find((c:any)=>c.id===target.categoryId&&c.ledger_id===target.ledgerId);
      if(target.categoryId&&!c)throw new Error('类别已删除，请重新选择');
      if(c?.allowed_directions?.length&&!c.allowed_directions.includes('expense'))throw new Error('收入类别无需设置消费额度');
      const p=target.planId?all.budgets.find((p:any)=>p.id===target.planId):all.budgets.find((p:any)=>p.status==='active')??all.budgets.find((p:any)=>p.status==='draft');
      if(target.planId&&!p)throw new Error('预算已变化，请重新选择');
      const details=p?await api(`/v1/workspaces/${workspace}/budgets/${p.id}`):{name:target.month.slice(0,7)+'月度预算',month:target.month.slice(0,7)+'-01',base_minor:null,salary_template:all.ledgers.find((l:any)=>l.id===target.ledgerId)?.salary_template===true};
      const salaryMode=details?.salary_template===true;
      const rows:any[]=details?.rows??all.categories.filter((x:any)=>x.ledger_id===target.ledgerId&&(!x.allowed_directions?.length||x.allowed_directions.includes('expense'))).map((x:any)=>({key:x.id,name:x.name,mode:'fixed',fixedMinor:null,categoryIds:[x.id]})),row=rows.find(r=>r.categoryIds.includes(c?.id));
      const full=!c;
      let fields:Field[],initial:Record<string,string>,submit:FormSpec['submit'],summary:FormSpec['summary'];
      const preview=(v:Record<string,string>)=>allocationPreview(rows.map(r=>({key:r.key,mode:v['mode_'+r.key]??r.mode,
        fixedMinor:inputMinor(v['value_'+r.key]),ratioBps:inputMinor(v['value_'+r.key]),remainderBps:inputMinor(v['value_'+r.key])??0})),inputMinor(v.base));
      const summaryView=(base:number|null,remaining:number)=> <View accessibilityLabel="预算分配概览" style={[s.card,{gap:8,backgroundColor:colors.light}]}><Text style={s.label}>{salaryMode?'工资':'总额度'} ¥{amount(base??0)}</Text><Text accessibilityLiveRegion="polite" style={[s.h3,{color:remaining<0?colors.red:colors.ink}]}>{remaining<0?(salaryMode?'预算超出工资':'超出额度'):(salaryMode?'预算后结余':'当前可分配')} ¥{amount(Math.abs(remaining))}</Text></View>;
      if(full){
        fields=[{key:'base',label:salaryMode?'工资（元）':'可支配总额（元）',type:'money',required:true}];initial={base:details.base_minor==null?'':String(details.base_minor/100)};
        if(salaryMode){fields.push({key:'salaryDate',label:'工资日期',type:'date',required:true,maxDate:today()});initial.salaryDate=details.salary_income?.occurred_on??(target.month.slice(0,7)===today().slice(0,7)?today():target.month.slice(0,7)+'-01');}
        for(const r of rows){
          fields.push({key:'mode_'+r.key,label:r.name+' · 分配方式',type:'select',required:true,options:[{value:'fixed',label:'固定金额'},{value:'ratio',label:'百分比'},{value:'remainder',label:'剩余分配'}]},
            {key:'value_'+r.key,label:r.name+' · 分配值',labelFor:v=>r.name+(v['mode_'+r.key]==='remainder'?' · 剩余池百分比（0–100）':v['mode_'+r.key]==='ratio'?(salaryMode?' · 工资百分比（0–100）':' · 总额百分比（0–100）'):' · 固定金额（元）'),type:'money',required:!salaryMode,hintFor:v=>{
              const result=preview(v),entry=result.rows.find(x=>x.key===r.key),mode=v['mode_'+r.key];
              if(mode==='remainder')return result.remainingMinor<0?'不可完成剩余分配：固定金额和总额百分比已超出计划':'剩余池 ¥'+amount(result.remainingMinor)+' · 可分配比例 '+Math.max(0,100-(result.remainderBps-(inputMinor(v['value_'+r.key])??0))/100)+'% · 本项 ¥'+amount(entry.amountMinor);
              if(mode==='ratio')return (salaryMode?'按工资 ¥':'按总额度 ¥')+amount(result.baseMinor)+' 计算 · 本项 ¥'+amount(entry.amountMinor);
              return (result.remainingMinor<0?'当前超出计划 ¥':'当前总量剩余 ¥')+amount(Math.abs(result.remainingMinor));
            }});
          const residual=rows.filter(x=>x.mode==='remainder'),sum=residual.reduce((n,x)=>n+(x.weight??1),0);
          initial['mode_'+r.key]=r.mode;initial['value_'+r.key]=r.mode==='fixed'?(r.fixedMinor==null?'':String(r.fixedMinor/100)):r.mode==='ratio'?(r.ratioBps==null?'':String(r.ratioBps/100)):String((r.remainderBps??Math.floor(10000*(r.weight??1)/(sum||1)))/100);
        }
        summary=v=>{const result=preview(v);return <View style={{gap:5}}>{summaryView(result.baseMinor,result.remainingMinor)}<Text accessibilityLiveRegion="polite" style={[s.small,{color:result.remainingMinor<0||result.remainderBps>10000?colors.red:colors.muted}]}>{result.remainingMinor<0?'不可完成剩余分配':`剩余池已分配 ${result.remainderBps/100}% · 未分配 ¥${amount(result.unallocatedMinor)}`}</Text></View>;};
        submit=async(v,id)=>{
          const result=preview(v);
          if(result.remainderBps>10000)throw new Error('剩余分配比例合计不能超过100%');
          if(result.remainingMinor<0&&result.remainderBps>0)throw new Error('不可完成剩余分配，请将剩余池比例设为0或调整其他额度');
          for(const r of rows)if(v['mode_'+r.key]!=='fixed'&&v['value_'+r.key]?.trim()&&minor(v['value_'+r.key])>10000)throw new Error('百分比请输入0–100');
          const updated=rows.map(r=>({key:r.key,name:r.name,purpose:r.purpose,categoryIds:r.categoryIds,mode:v['mode_'+r.key],
            ...(v['mode_'+r.key]==='fixed'?{fixedMinor:v['value_'+r.key]?.trim()?minor(v['value_'+r.key]):null}:v['mode_'+r.key]==='ratio'?{ratioBps:v['value_'+r.key]?.trim()?minor(v['value_'+r.key]):null}:{remainderBps:v['value_'+r.key]?.trim()?minor(v['value_'+r.key]):0})}));
          await save(p?`/budgets/${p.id}`:'/budgets',{ledgerId:target.ledgerId,name:details.name,month:details.month,baseMinor:minor(v.base),rows:updated,...(p?{expectedRevision:details.entity_revision}:{}),...(salaryMode?{salaryOccurredOn:v.salaryDate}:{})},v,id,p?'PUT':'POST');
        };
      }else{
        if(!c)throw new Error('请选择需要设置额度的类别');
        const allocated=p?.management_mode==='allocated';
        fields=[];initial={};
        fields.push({key:'limit',label:c.name+' · '+target.month.slice(0,7)+'消费上限（元）',type:'money',required:allocated,placeholder:allocated?'请输入本类别额度':'留空取消上限',
          });
        const current=allocationPreview(rows,details?.base_minor).rows.find(r=>r.key===row?.key);
        initial.limit=row?.mode==='fixed'?(row.fixedMinor==null?'':String(row.fixedMinor/100)):row?.initial_minor==null?(details?.base_minor?String((current?.amountMinor??0)/100):''):String(row.initial_minor/100);
        submit=async(v,id)=>{
          await save(`/categories/${c.id}/limit`,{month:target.month.slice(0,7)+'-01',limitMinor:v.limit?.trim()?minor(v.limit):null,expectedRevision:c.revision,planId:p?.id??null,expectedPlanRevision:details?.entity_revision??null},v,id);
        };
      }
      if(admin)fields.push({key:'reason',label:'管理员操作理由',type:'textarea',required:true});
      if(live)setForm({key:`budget-editor:v4:${workspace}:${target.ledgerId}:${target.month}:${target.categoryId??p?.id}:${c?.revision??0}:${details?.entity_revision??0}:${rows.map(r=>r.key).join(',')}`,title:full?(salaryMode?'工资与类别额度':'设置预算分配'):'设置消费上限',operationId:operationId(),fields,initial,summary,pinSummary:true,
        stepSummary:full?v=>{const result=preview(v);return <Text accessibilityLiveRegion="polite" style={[s.small,{color:result.remainingMinor<0?colors.red:colors.primaryStrong}]}>{salaryMode?'工资':'总额度'} ¥{amount(result.baseMinor??0)} · {result.remainingMinor<0?'超出':'结余'} ¥{amount(Math.abs(result.remainingMinor))}</Text>;}:undefined,
        actions:[{title:'重新读取额度',onPress:()=>{setForm(null);setError('');setReady(false);void state.refresh(true).then(()=>setReady(true)).catch(e=>setError(e.message));}}],
        submit:async(v,id)=>{if(offline)throw new Error('当前离线，请联网后设置额度');await submit(v,id);onSaved?.();}});
    }
    async function save(path:string,body:any,v:Record<string,string>,id:string,method='PUT'){await api(`/v1/workspaces/${workspace}${path}`,method,{...body,operationId:id,...(admin?{reason:v.reason}:{})});}
    if(!form)void prepare().catch(e=>live&&setError(e.message));
    return()=>{live=false;};
  },[ready,state.data,state.loading,state.stale,form]);
  if(form)return <FormModal spec={form} userId={userId} onClose={onClose}/>;
  return <ModalPanel onClose={onClose}><View style={[s.card,{gap:16}]}>{error||state.error?<Button title={error||state.error} danger onPress={()=>{setError('');void state.refresh(true).then(()=>setReady(true)).catch(()=>{});}}/>:<ActivityIndicator/>}<Button secondary title="取消" onPress={onClose}/></View></ModalPanel>;
}
