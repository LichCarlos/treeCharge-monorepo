import React,{useCallback,useEffect,useRef,useState} from 'react';
import {ActivityIndicator,Alert,BackHandler,Platform,Pressable,RefreshControl,ScrollView,SectionList,Text,TextInput,View,useWindowDimensions} from 'react-native';
import {SafeAreaProvider,SafeAreaView} from 'react-native-safe-area-context';
import {StatusBar} from 'expo-status-bar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import {api,ApiError,login,restoreSession,setSession,operationId,amount,minor,today,baseUrl,changeBase,accessToken,type User} from './src/api';
import {Button,Card,Empty,Icon,Select,FormModal,s,colors,type FormSpec,type Field,type Option,SegmentedControl,FourColumnGrid} from './src/ui';
import {Trend,Donut,chartColors} from './src/charts';
import {RecordComposer,type RecordSpec,type RecordDraft} from './src/RecordComposer';
import {LedgerPicker} from './src/LedgerPicker';
import {SavingsManager} from './src/SavingsManager';
import {Breadcrumbs,type Breadcrumb} from './src/Breadcrumbs';
import {NavigationDrawer} from './src/NavigationDrawer';
import {navigationPath,pageTitles as titles,type Page} from './src/navigation';
import {categoryIcon} from './src/categoryIcons';
import {CategoryAllowanceBar} from './src/CategoryAllowanceBar';
import {CategoryDetailsList} from './src/CategoryDetailsList';
import {TransactionRow} from './src/TransactionRow';
import {TransactionFilters} from './src/TransactionFilters';
import {filterTransactions} from './src/transactionFilter.mjs';
import {categoryAllowanceIndex,categoryAllowanceKey} from './src/categoryAllowance.mjs';
import {BudgetEditor,type BudgetTarget} from './src/BudgetEditor';
import {useWorkspaceRevision} from './src/useBudgetState';
import {budgetStore} from './src/budgetStore.mjs';
import {ConfirmActionModal,type Confirmation} from './src/ConfirmActionModal';
import {CategoryManager} from './src/CategoryManager';
import {DateInput,PeriodPicker} from './src/DatePicker';
import {ThemePicker} from './src/ThemePicker';
import {getTheme,ThemeProvider,useTheme,layout,spacing,typography} from './src/theme';
import {periodRange,periodLabel,rangeQuery,type PeriodSelection} from '@charge/calendar';
const nav:[Page|'record',React.ComponentProps<typeof Icon>['name'],string][]=[['transactions','receipt-outline','明细'],['reports','bar-chart-outline','统计'],['record','add','记一笔'],['savings','trending-up-outline','存款计划'],['settings','person-outline','我的']];
const blank={ledgers:[],groups:[],categories:[],dictionaryLedgers:[],dictionaryCategories:[],transactions:[],budgets:[],balances:[],plans:[],goals:[],tags:[],fields:[],relations:[],trash:[],transfers:[]} as Record<string,any[]>;
const directions:Record<string,string>={income:'收入',expense:'支出',deposit:'存入',withdrawal:'取出',refund:'退款'};
const fieldTypes=[['text','文本'],['integer','整数'],['decimal','小数'],['money','金额'],['date','日期'],['boolean','布尔'],['single_select','单选'],['multi_select','多选'],['entity','实体引用']].map(([value,label])=>({value,label}));
function notice(text:string){if(Platform.OS==='web')window.alert(text);else Alert.alert('枝账',text);}
export default function App(){return <SafeAreaProvider><ThemeProvider><AppContent/></ThemeProvider></SafeAreaProvider>;}
function AppContent(){
  const {width}=useWindowDimensions();
  const {themeName,setThemeName}=useTheme();
  const activeTheme=getTheme(themeName);
  const [user,setUser]=useState<User|null>(null),[boot,setBoot]=useState(true),[page,setPage]=useState<Page>('home'),[drawer,setDrawer]=useState(false);
  const [workspaces,setWorkspaces]=useState<any[]>([]),[workspace,setWorkspace]=useState(''),[ledger,setLedger]=useState('');
  const [period,setPeriod]=useState<PeriodSelection>({mode:'month',anchor:today()});
  const range=periodRange(period),dateQuery=rangeQuery(period),periodTitle=periodLabel(period),month=period.anchor.slice(0,7);
  const [data,setData]=useState(blank),[report,setReport]=useState<any>(null),[templates,setTemplates]=useState<any[]>([]),[users,setUsers]=useState<any[]>([]),[logs,setLogs]=useState<any[]>([]);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[updated,setUpdated]=useState(''),[cached,setCached]=useState(false),[form,setForm]=useState<FormSpec|null>(null),[filter,setFilter]=useState(''),[contentId,setContentId]=useState('');
  const [recordSpec,setRecordSpec]=useState<RecordSpec|null>(null),[ledgerPicker,setLedgerPicker]=useState(false);
  const [savingsId,setSavingsId]=useState('');
  const [categoryLedger,setCategoryLedger]=useState('');
  const [budgetTarget,setBudgetTarget]=useState<BudgetTarget|null>(null);
  const [detailTab,setDetailTab]=useState('all'),[categoryFilter,setCategoryFilter]=useState('');
  const allDates=page==='transactions'&&!!contentId;
  const effectiveDateQuery=allDates?'':dateQuery;
  const workspaceRevision=useWorkspaceRevision(workspace);
  const [confirmation,setConfirmation]=useState<Confirmation|null>(null);
  const [authMode,setAuthMode]=useState<'login'|'register'>('login'),[username,setUsername]=useState(''),[password,setPassword]=useState(''),[confirm,setConfirm]=useState(''),[address,setAddress]=useState('');
  const root=workspaces.find(w=>w.id===workspace)?.root_id;
  const requestVersion=useRef(0),liveScope=useRef('');
  const pageScroll=useRef<ScrollView>(null);
  useEffect(()=>{pageScroll.current?.scrollTo({y:0,animated:false});},[page,contentId,detailTab,ledger]);
  const scope=[user?.id,workspace,ledger,contentId,effectiveDateQuery,page==='admin'].join(':');liveScope.current=scope;
  const path=(p:string)=>'/v1/workspaces/'+workspace+p;
  const selectedLedger=data.ledgers.find(l=>l.id===ledger);
  const dictionaryLedgers=data.dictionaryLedgers??data.ledgers,dictionaryCategories=data.dictionaryCategories??data.categories;
  const dictionaryLedger=dictionaryLedgers.find(l=>l.id===categoryLedger)??dictionaryLedgers.find(l=>l.id===ledger)??dictionaryLedgers[0];
  const headerLedger=page==='tree'?dictionaryLedger:selectedLedger;
  const selectLedger=(id:string)=>{setLedger(id);setCategoryLedger(id);setContentId('');setCategoryFilter('');if(user&&workspace)void AsyncStorage.setItem('selected-ledger:'+user.id+':'+workspace,id);};
  const navigate=(p:Page)=>{if(['trash','deletedSavings'].includes(p)&&Platform.OS==='web')return;setPage(p);setDrawer(false);setFilter('');setCategoryFilter('');setContentId('');setSavingsId('');setDetailTab('all');if(p==='tree')void load();};
  function changeDetailTab(value:string){setDetailTab(value);setFilter('');setCategoryFilter('');if(value==='budget'||value==='categories')setPeriod(p=>({...p,mode:'month'}));}
  const refreshData=()=>{if(workspace)budgetStore.invalidate(workspace);else void load();};
  const pagePath=navigationPath(page);
  const breadcrumbs:Breadcrumb[]=pagePath.map((node,index)=>({label:node.label,...(index<pagePath.length-1?{onPress:()=>navigate(node.page!)}:{})}));
  if(page==='savings'&&savingsId){breadcrumbs[breadcrumbs.length-1].onPress=()=>setSavingsId('');breadcrumbs.push({label:'计划详情'});}
  if(page==='transactions'&&contentId){breadcrumbs[breadcrumbs.length-1].onPress=()=>setContentId('');breadcrumbs.push({label:data.categories.find(c=>c.id===contentId)?.name??'类别明细'});}
  const goUp=()=>breadcrumbs.at(-2)?.onPress?.();
  const load=useCallback(async()=>{
    if(!user||user.mustChangePassword)return;
    const ownScope=[user.id,workspace,ledger,contentId,effectiveDateQuery,page==='admin'].join(':');
    if(liveScope.current!==ownScope)return;
    const version=++requestVersion.current,current=()=>version===requestVersion.current&&liveScope.current===ownScope;
    const cacheKey=['cache',user.id,'expenses-v8-independent-caps',workspace,ledger||'all',contentId||'all',effectiveDateQuery].join(':');
    setBusy(true);setError('');
    try{
      const ws=await api<any[]>('/v1/workspaces');if(!current())return;setWorkspaces(ws);
      const w=ws.find(x=>x.id===workspace)?.id??ws[0]?.id;
      if(w&&w!==workspace){setWorkspace(w);return;}
      const ts=await api('/v1/templates');if(!current())return;setTemplates(ts);
      if(w){
        const q='?'+effectiveDateQuery+(ledger?'&ledgerId='+ledger:'')+(contentId?'&categoryId='+contentId:'');
        const [state,stats]=await Promise.all([api('/v1/workspaces/'+w+'/state'+q),api('/v1/workspaces/'+w+'/reports'+q)]);if(!current())return;
        const expenseLedgers=state.ledgers.filter((l:any)=>l.ledger_type==='expense');
        if(expenseLedgers.length&&!expenseLedgers.some((l:any)=>l.id===ledger)){const saved=await AsyncStorage.getItem('selected-ledger:'+user.id+':'+w);if(!current())return;setLedger(expenseLedgers.find((l:any)=>l.id===saved)?.id??expenseLedgers[0].id);return;}
        if(!expenseLedgers.length&&ledger){setLedger('');return;}
        const ids=new Set(expenseLedgers.map((l:any)=>l.id));
        const expenseState={...state,dictionaryLedgers:state.ledgers,dictionaryCategories:state.categories,ledgers:expenseLedgers,categories:state.categories.filter((c:any)=>ids.has(c.ledger_id)),transactions:state.transactions.filter((t:any)=>ids.has(t.ledger_id)),plans:state.plans.filter((p:any)=>ids.has(p.ledger_id)),goals:[],trash:state.trash.filter((e:any)=>e.ledger_type!=='savings'&&e.kind!=='goal')};
        const expenseStats=ledger?stats:null;
        if(contentId&&!expenseState.categories.some((c:any)=>c.id===contentId)){setContentId('');}
        setData(expenseState);setReport(expenseStats);setCached(false);setUpdated(new Date().toLocaleTimeString('zh-CN'));
        await AsyncStorage.setItem(cacheKey,JSON.stringify({state:expenseState,stats:expenseStats,time:new Date().toLocaleString('zh-CN')}));
      }else{setData(blank);setReport(null);}
      if(user.role==='super_admin'&&page==='admin'){const [us,ls]=await Promise.all([api('/v1/admin/users'),api('/v1/admin/audit')]);if(current()){setUsers(us);setLogs(ls);}}
    }catch(e){
      if(!current())return;
      setError((e as Error).message);
      if(e instanceof ApiError&&e.status===401){setUser(null);setData(blank);}
      else if(workspace){const cache=await AsyncStorage.getItem(cacheKey);if(cache&&current()){const c=JSON.parse(cache);setData(c.state);setReport(c.stats);setUpdated(c.time);setCached(true);}}
    }finally{if(current())setBusy(false);}
  },[user?.id,user?.mustChangePassword,workspace,ledger,contentId,effectiveDateQuery,page==='admin']);
  useEffect(()=>{restoreSession().then(async sess=>{setAddress(baseUrl);if(sess){try{setUser(await api<User>('/v1/me'));}catch{await setSession(null);}}}).finally(()=>setBoot(false));},[]);
  useEffect(()=>{setData(blank);setReport(null);setUpdated('');setCached(false);void load();return()=>{requestVersion.current++;};},[load]);
  useEffect(()=>{if(workspaceRevision)void load();},[workspaceRevision]);
  useEffect(()=>{const sub=BackHandler.addEventListener('hardwareBackPress',()=>{if(recordSpec){setRecordSpec(null);return true;}if(ledgerPicker){setLedgerPicker(false);return true;}if(form){setForm(null);return true;}if(drawer){setDrawer(false);return true;}if(page!=='home'){goUp();return true;}return false;});return()=>sub.remove();},[recordSpec,ledgerPicker,form,drawer,page,savingsId,contentId]);
  function open(key:string,title:string,fields:Field[],initial:Record<string,string>,submit:(v:Record<string,string>,id:string)=>Promise<void>,subtitle?:string,destructive=false,actions?:FormSpec['actions']){
    setForm({key:workspace+':'+key,title,subtitle,fields:[...fields,...(user?.role==='super_admin'&&key!=='password:change'?[{key:'reason',label:'管理员操作理由',type:'textarea' as const,required:true}]:[])],initial,operationId:operationId(),destructive,actions,submit:async(v,id)=>{
      if(workspace&&key!=='password:change'){try{const op=await api(path('/operations/'+id));if(op.completed_at){await load();return;}}catch(e){if(!(e instanceof ApiError&&e.status===404))throw e;}}
      await submit(v,id);await load();
    }});
  }
  async function write(p:string,body:any,id:string,reason?:string,method='POST'){
    if(cached)throw new Error('当前为离线缓存，请连接服务器后提交');
    const result=await api(path(p),method,{...body,operationId:id,...(user?.role==='super_admin'?{reason}:{})});
    const keys=await AsyncStorage.getAllKeys();await AsyncStorage.multiRemove(keys.filter(k=>k.startsWith('cache:'+user?.id+':')&&k.includes(workspace)));
    if(method==='DELETE'){setData(blank);setReport(null);}
    return result;
  }
  const ledgerOptions:Option[]=data.ledgers.map(l=>({label:l.name,value:l.id}));
  function categoryPath(id:string){return data.categories.find(c=>c.id===id)?.name??'';}
  const cats=(lid='')=>data.categories.filter(c=>!lid||c.ledger_id===lid).map(c=>({label:c.name,value:c.id}));
  function newLedger(templateKey='none'){
    open('ledger:new:v2:'+templateKey,'新建账本',[
      {key:'name',label:'账本名称',required:true},
      {key:'template',label:'账本模板',type:'select',options:[{label:'不使用模板 · 空白账本',value:'none'},...templates.filter(t=>t.id==='salary-allocation'&&t.ledger_type==='expense').map(t=>({label:t.name,value:t.id+':'+t.version}))],required:true,hint:'模板为整个账本预备消费内容，不会生成实际收支。'},
      {key:'month',label:'预算月份',type:'month',required:true,visibleWhen:v=>v.template!=='none'}],
      {type:'expense',template:templateKey,month:month+'-01',name:templates.find(t=>t.id+':'+t.version===templateKey)?.name??''},async(v,id)=>{
        const t=templates.find(t=>t.id==='salary-allocation'&&t.ledger_type==='expense'&&t.id+':'+t.version===v.template);
        if(v.template!=='none'&&!t)throw new Error('请选择有效的账本模板');
        const r=t?await write('/template-instances',{templateId:t.id,version:t.version,name:v.name,parentId:root,month:v.month},id,v.reason):await write('/ledgers',{name:v.name,ledgerType:'expense',parentId:root},id,v.reason);
        selectLedger(r.id);navigate('transactions');
        if(t)setBudgetTarget({ledgerId:r.id,planId:r.planId,month:v.month});
      },'选择空白记账，或用模板预备类别，再开始记录。');
  }
  function categoryLimit(c:any,targetMonth=month){setBudgetTarget({ledgerId:c.ledger_id,categoryId:c.id,month:targetMonth});}
  function record(t?:any,planned=false,lidOverride?:string,cidOverride?:string){
    if(!planned){
      if(!data.ledgers.length){navigate('ledgers');return;}
      const lid=t?.ledger_id||lidOverride||ledger||data.ledgers[0].id;
      setRecordSpec({key:operationId(),transaction:t,initial:{ledger:lid,category:t?.category_id??cidOverride??'',direction:t?.direction??(data.ledgers.find(l=>l.id===lid)?.ledger_type==='savings'?'deposit':'expense'),expression:t?String(t.amount_minor/100):'',date:t?.occurred_on??today(),remark:t?.remark??'',original:t?.original_id??'',reason:''}});return;
    }
    if(!data.ledgers.length){notice('请先创建账本和消费内容');return;}
    const lid=t?.ledger_id||lidOverride||ledger||data.ledgers[0].id;
    const fields:Field[]=[{key:'ledger',label:'账本',type:'select',options:ledgerOptions,required:true},{key:'category',label:'消费内容',type:'select',optionsFor:v=>cats(v.ledger).filter(()=>!!v.ledger),required:true,hint:'仅展示所选账本的消费内容；没有可选项时，请先在账本中添加。'},
      {key:'direction',label:'收支方向',type:'select',optionsFor:v=>Object.entries(directions).filter(([k])=>(data.ledgers.find(l=>l.id===v.ledger)?.ledger_type==='savings'?['deposit','withdrawal']:planned?['income','expense']:['income','expense','refund']).includes(k)).map(([value,label])=>({value,label})),required:true},
      {key:'amount',label:'金额（元）',type:'money',required:true},{key:'date',label:planned?'计划日期':'发生日期',type:'date',required:true,maxDate:planned?undefined:today()},{key:'remark',label:'备注（可选）',type:'textarea'}];
    if(!planned)fields.push({key:'original',label:'退款关联原支出（仅退款必选）',type:'select',visibleWhen:v=>v.direction==='refund',optionsFor:v=>data.transactions.filter(x=>x.direction==='expense'&&x.ledger_id===v.ledger).map(x=>({label:x.category_name+' ¥'+amount(x.amount_minor)+' · '+x.occurred_on,value:x.id}))});
    open((planned?'plan:':'transaction:')+(t?.id??'new:v2:'+lid+':'+(cidOverride??'')),t?'编辑账目':planned?'添加计划账目':'记一笔',fields,
      {ledger:lid,category:t?.category_id??cidOverride??data.categories.find(c=>c.ledger_id===lid)?.id??'',direction:t?.direction??(data.ledgers.find(l=>l.id===lid)?.ledger_type==='savings'?'deposit':'expense'),amount:t?String(t.amount_minor/100):'',date:t?.occurred_on??today(),remark:t?.remark??'',original:t?.original_id??''},
      async(v,id)=>{const body:any={ledgerId:v.ledger,categoryId:v.category,direction:v.direction,amountMinor:minor(v.amount),remark:v.remark??''};
        if(planned){body.plannedOn=v.date;await write('/plans',body,id,v.reason);}
        else{body.occurredOn=v.date;if(v.direction==='refund'&&v.original)body.originalId=v.original;if(t)body.expectedRevision=t.revision;const r=await write(t?'/transactions/'+t.id:'/transactions',body,id,v.reason,t?'PUT':'POST');if(r.negative?.length)notice('账单已保存。预算存在负余额，可点击负 tag 选择来源补足。');}
      },'保留真实发生金额；超支不会截断账单。每笔记录唯一归属一个消费内容，并可追溯所属账本。');
  }
  async function saveRecord(v:RecordDraft,cents:number,id:string){
    if(!recordSpec)return;
    let completed=false;
    try{const previous=await api(path('/operations/'+id));completed=!!previous.completed_at;}catch(e){if(!(e instanceof ApiError&&e.status===404))throw e;}
    if(!completed){
      const t=recordSpec.transaction,body:any={ledgerId:v.ledger,categoryId:v.category,direction:v.direction,amountMinor:cents,occurredOn:v.date,remark:v.remark};
      if(v.direction==='refund')body.originalId=v.original;if(t)body.expectedRevision=t.revision;
      const result=await write(t?'/transactions/'+t.id:'/transactions',body,id,v.reason,t?'PUT':'POST');
      if(result.negative?.length)notice('已按真实金额保存，当前类别预算已超支。可在预算中选择其他正余额类别扣额补足。');
    }
    selectLedger(v.ledger);setPeriod({mode:'month',anchor:v.date});navigate('transactions');await load();
  }
  function remove(e:any){setConfirmation({title:'删除内容',message:e.ledger_type?'删除此账本及全部记录？':e.allowed_directions?'删除此类别及全部记录？':'删除此记录？',confirmLabel:'确认删除',danger:true,submit:async(id,reason)=>{await write('/entities/'+e.id,{expectedRevision:e.revision},id,reason,'DELETE');await load();}});}
  function rename(e:any){
    const isContent=!!e.ledger_id;
    open('node:v2:'+e.id,isContent?'编辑消费内容':'编辑账本',[{key:'name',label:isContent?'消费内容名称':'账本名称',required:true}],{name:e.name},async(v,id)=>{await write('/entities/'+e.id,{name:v.name,expectedRevision:e.revision},id,v.reason,'PATCH');},isContent?'所属账本：'+(data.ledgers.find(l=>l.id===e.ledger_id)?.name??'')+'。消费内容下直接管理金额记录。':undefined);
  }
  function budgetEdit(p:any){setBudgetTarget({ledgerId:p.ledger_id,planId:p.id,month:p.month});}
  function compensate(target:any){const sources=data.balances.filter(x=>x.plan_id===target.plan_id&&x.available_minor>0),p=data.budgets.find(p=>p.id===target.plan_id);
    if(!sources.length){notice('本期没有正余额 tag，负数与真实账单将保留。');return;}
    open('compensate:'+target.id,'从其他 tag 扣除补足',sources.map(x=>({key:x.id,label:x.name+' · 可用 ¥'+amount(x.available_minor),type:'money',hint:'填写实际扣额；不用的来源填0'})),Object.fromEntries(sources.map(x=>[x.id,'0'])),async(v,id)=>{
      const deductions=sources.map(x=>({bucketId:x.id,amountMinor:minor(v[x.id]||'0')})).filter(x=>x.amountMinor>0),sum=deductions.reduce((s,x)=>s+x.amountMinor,0);
      if(!sum||sum>-target.available_minor)throw new Error('请选择来源，扣额总计不能超过缺口');
      await write('/budgets/'+p.id+'/compensations',{targetId:target.id,deductions,expectedRevision:p.entity_revision},id,v.reason);
    },target.name+' 缺口 ¥'+amount(-target.available_minor)+'。来源减少、目标增加，实际流水不变；支持部分补足。');
  }
  async function configuration(t:any){try{
    const c=await api(path('/entities/'+t.id+'/configuration')),initial:Record<string,string>={tags:c.bindings.map((x:any)=>x.tag_id).join(',')};
    const fields:Field[]=[{key:'tags',label:'辅助标签',type:'multiselect',options:data.tags.filter(x=>x.applicable_kinds.includes(c.entity.kind)).map(x=>({label:x.name,value:x.id}))}];
    for(const f of c.fields){fields.push({key:f.id,label:f.name,type:f.field_type==='date'?'date':f.field_type==='boolean'||f.field_type==='single_select'?'select':f.field_type==='multi_select'?'multiselect':'text',options:f.field_type==='boolean'?[{label:'是',value:'true'},{label:'否',value:'false'}]:c.options.filter((x:any)=>x.field_id===f.id).map((x:any)=>({label:x.name,value:x.id}))});
      initial[f.id]=f.field_type.includes('select')?c.selectedOptions.filter((x:any)=>x.field_id===f.id).map((x:any)=>x.option_id).join(','):String(f.value_text??f.value_integer??f.value_decimal??f.value_date??f.value_boolean??f.value_entity??'');}
    for(const r of data.relations.filter(r=>r.source_kinds.includes(c.entity.kind))){fields.push({key:'rel_'+r.id,label:r.name,type:r.cardinality==='one_to_many'?'multiselect':'select',options:data.transactions.filter(x=>x.id!==t.id).map(x=>({value:x.id,label:x.category_name+' ¥'+amount(x.amount_minor)+' · '+x.occurred_on}))});initial['rel_'+r.id]=c.edges.filter((x:any)=>x.source_id===t.id&&x.definition_id===r.id).map((x:any)=>x.target_id).join(',');}
    open('config:'+t.id,'标签、字段与关联',fields,initial,async(v,id)=>{const values=c.fields.map((f:any)=>({fieldId:f.id,value:!v[f.id]?null:f.field_type.includes('select')?v[f.id].split(','):['money','integer','decimal'].includes(f.field_type)?Number(v[f.id]):f.field_type==='boolean'?v[f.id]==='true':v[f.id]})),edges=data.relations.flatMap(r=>(v['rel_'+r.id]||'').split(',').filter(Boolean).map(targetId=>({definitionId:r.id,targetId})));
      await write('/entities/'+t.id+'/configuration',{expectedRevision:c.entity.revision,tagIds:(v.tags||'').split(',').filter(Boolean),values,edges},id,v.reason,'PUT');});
  }catch(e){setError((e as Error).message);}}
  async function exportFile(){setBusy(true);try{
    const url=baseUrl+path('/export.xlsx?'+dateQuery+(ledger?'&ledgerId='+ledger:'')+(contentId?'&categoryId='+contentId:''));
    if(Platform.OS==='web'){const r=await fetch(url,{headers:{Authorization:'Bearer '+accessToken()}});if(!r.ok)throw new Error((await r.json()).message);const blob=await r.blob(),uri=URL.createObjectURL(blob),a=document.createElement('a');a.href=uri;a.download='枝账-'+range.start+'_'+range.end+'.xlsx';a.click();URL.revokeObjectURL(uri);}
    else{const target=FileSystem.cacheDirectory+'charge-'+range.start+'_'+range.end+'.xlsx',r=await FileSystem.downloadAsync(url,target,{headers:{Authorization:'Bearer '+accessToken()}});if(r.status!==200)throw new Error('导出失败，请缩小范围或重新登录');await Sharing.shareAsync(target,{mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});}
  }catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  async function signOut(){setRecordSpec(null);setForm(null);setBudgetTarget(null);setConfirmation(null);setContentId('');setSavingsId('');try{await api('/v1/auth/logout','POST');}catch{}if(user)for(const key of await AsyncStorage.getAllKeys())if(key.startsWith('cache:'+user.id+':'))await AsyncStorage.removeItem(key);await setSession(null);setUser(null);setData(blank);setWorkspace('');setLedger('');navigate('home');}
  async function submitAuth(){setBusy(true);setError('');try{
    if(authMode==='register'){if(password!==confirm)throw new Error('两次密码不一致');await api('/v1/auth/register','POST',{username,password});setAuthMode('login');setPassword('');setConfirm('');notice('注册成功，请登录');}
    else{const sess=await login(username,password);setUser(sess.user);setPassword('');setWorkspace('');setLedger('');navigate('home');}
  }catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  function passwordForm(){open('password:change','修改密码',[{key:'old',label:'当前密码',type:'password',required:true},{key:'next',label:'新密码（至少12位）',type:'password',required:true},{key:'again',label:'确认新密码',type:'password',required:true}],{},async v=>{if(v.next!==v.again)throw new Error('两次密码不一致');await api('/v1/me/password','POST',{oldPassword:v.old,newPassword:v.next});await signOut();});}
  if(boot)return <SafeAreaView style={[s.page,{paddingTop:layout.safeGap}]}><View style={{flex:1,justifyContent:'center',alignItems:'center',gap:20}}><Icon name="leaf" size={42}/><ActivityIndicator color={colors.primaryStrong}/></View></SafeAreaView>;
  if(!user)return <SafeAreaView style={[s.page,{paddingTop:layout.safeGap}]}><StatusBar style="dark"/><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{flexGrow:1,justifyContent:'center',padding:layout.pageInset}}><View style={{width:'100%',maxWidth:430,alignSelf:'center',gap:spacing.lg}}>
    <View style={{gap:16}}><View style={s.iconCircle}><Icon name="leaf" size={30}/></View><Text style={s.h1}>枝账</Text></View>
    <Card><View style={{gap:20}}><View style={s.spread}><Text style={s.h2}>{authMode==='login'?'欢迎回来':'创建你的空间'}</Text></View>
      <View style={{gap:spacing.xs}}><Text style={s.label}>用户名</Text><TextInput accessibilityLabel="用户名" style={s.input} placeholder="用户名（3～32字符）" value={username} onChangeText={setUsername} autoCapitalize="none"/></View>
      <View style={{gap:spacing.xs}}><Text style={s.label}>密码</Text><TextInput accessibilityLabel="密码" style={s.input} placeholder="密码（12～128字符）" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none"/></View>
      {authMode==='register'&&<View style={{gap:spacing.xs}}><Text style={s.label}>确认密码</Text><TextInput accessibilityLabel="确认密码" style={s.input} placeholder="再次输入密码" value={confirm} onChangeText={setConfirm} secureTextEntry/></View>}
      {!!error&&<Text style={s.error}>{error}</Text>}<Button title={busy?'请稍候…':authMode==='login'?'登录':'注册普通用户'} onPress={submitAuth} disabled={busy}/>
      <Pressable onPress={()=>{setAuthMode(authMode==='login'?'register':'login');setError('');}}><Text style={[s.link,{textAlign:'center'}]}>{authMode==='login'?'还没有账号？注册':'已有账号？返回登录'}</Text></Pressable></View></Card>
    <View style={{gap:8}}><Text style={s.small}>开发服务地址</Text><TextInput accessibilityLabel="开发服务地址" style={s.input} value={address} onChangeText={setAddress} autoCapitalize="none"/>
      <Button secondary title="保存连接地址" onPress={()=>changeBase(address).then(()=>notice('连接地址已更新')).catch(e=>setError(e.message))}/><Text style={s.small}>数据存储于 PostgreSQL 服务 · 注册后为空白工作区</Text></View>
  </View></ScrollView></SafeAreaView>;
  const totals=report?.totals??{income:0,expense:0,refund:0,balance:0,deposit:0,withdrawal:0,netExpense:0};
  const filterCategories=data.categories.filter(c=>c.ledger_id===ledger&&(detailTab!=='income'||!c.allowed_directions?.length||c.allowed_directions.includes('income')));
  const activeCategoryFilter=filterCategories.some(c=>c.id===categoryFilter)?categoryFilter:'';
  const filtered:any[]=filterTransactions(data.transactions,{ledger,category:contentId||activeCategoryFilter,income:!contentId&&detailTab==='income',query:filter});
  const grouped=new Map<string,any[]>();
  for(const t of filtered){const rows=grouped.get(t.occurred_on);if(rows)rows.push(t);else grouped.set(t.occurred_on,[t]);}
  const dailyGroups=[...grouped].map(([day,rows])=>({day,rows}));
  const periodBalance=totals.balance;
  const allowances=categoryAllowanceIndex(data.budgets,data.balances);
  const detailTotals=filtered.reduce((sum,t)=>{if(t.direction==='income')sum.income+=t.amount_minor;else if(t.direction==='expense')sum.expense+=t.amount_minor;else if(t.direction==='refund')sum.refund+=t.amount_minor;return sum;},{income:0,expense:0,refund:0});
  const detailBalance=detailTotals.income-detailTotals.expense+detailTotals.refund;
  const summary=<Card style={{paddingVertical:spacing.sm}}><View style={[s.spread,{alignItems:'center',flexWrap:'wrap'}]}><View style={{flexGrow:1,gap:spacing.xxs}}><Text style={s.small}>期间结余 · {filtered.length} 笔</Text><Text selectable style={[s.amount,{...typography.amountCompact,color:detailBalance<0?colors.red:colors.green}]}>¥{amount(detailBalance)}</Text></View><View style={{gap:spacing.xxs,alignItems:'flex-end',flexGrow:1}}><Text style={s.small}>收入 ¥{amount(detailTotals.income)}</Text><Text style={s.small}>支出 ¥{amount(detailTotals.expense)}{detailTotals.refund?' · 退款 ¥'+amount(detailTotals.refund):''}</Text></View></View></Card>;
  const actions=(e:any,edit:()=>void)=><View style={s.row}><Pressable accessibilityRole="button" accessibilityLabel={'编辑'+(e.name??'账目')} onPress={edit} style={s.iconButton}><Icon name="create-outline" size={18}/></Pressable><Pressable accessibilityRole="button" accessibilityLabel={'删除'+(e.name??'账目')} onPress={()=>remove(e)} style={s.iconButton}><Icon name="trash-outline" color={colors.red} size={17}/></Pressable></View>;
  const row=(t:any)=><TransactionRow key={t.id} transaction={t} category={data.categories.find(c=>c.id===t.category_id)} allowance={allowances.get(categoryAllowanceKey(t.ledger_id,t.category_id,t.occurred_on))} onOpen={()=>record(t)} onDelete={()=>remove(t)}/>;
  const section=(title:string,action?:React.ReactNode)=><View style={s.spread}><Text style={s.h3}>{title}</Text>{action}</View>;
  const monthlyBudget=<View testID="monthly-budget" style={{gap:spacing.xs}}>
    {data.budgets.filter(p=>p.ledger_id===ledger&&p.month.slice(0,7)===month&&p.salary_template).slice(0,1).map(p=><Card key={p.id}><View style={s.spread}><View style={{flex:1,gap:6}}><Text style={s.small}>本月工资</Text><Text style={s.h2}>{p.base_minor==null?'待设置':'¥'+amount(p.base_minor)}</Text></View><Button secondary title="工资与分配方式" onPress={()=>budgetEdit(p)}/></View></Card>)}
    {selectedLedger?.salary_template&&!data.budgets.some(p=>p.ledger_id===ledger&&p.month.slice(0,7)===month)&&<Button secondary title="设置本月工资" onPress={()=>setBudgetTarget({ledgerId:ledger,month})}/>}
    <CategoryDetailsList manage categories={data.categories} ledger={ledger} month={month} plans={data.budgets} balances={data.balances} onChoose={id=>{const c=data.categories.find(c=>c.id===id);if(c)categoryLimit(c);}}/>
  </View>;
  let content:React.ReactNode;
  if(user.mustChangePassword)content=<Empty title="请先修改初始密码" detail="首次管理员登录或密码重置后，需要设置自己的密码。修改后请重新登录。" action={<Button title="修改密码" onPress={passwordForm}/>}/>;
  else if(page==='home')content=<>
    <View style={{paddingVertical:12,gap:10}}><Text style={s.h1}>把生活，慢慢理清。</Text></View>
    <Pressable accessibilityRole="button" accessibilityLabel="进入账本管理" onPress={()=>navigate('overview')}><Card style={s.featureCard}><View style={s.spread}><View style={s.featureIcon}><Icon name="wallet-outline" color={activeTheme.primary} size={30}/></View><Icon name="arrow-forward" color={activeTheme.onPrimary}/></View><View style={{gap:8}}><Text style={s.featureTitle}>账本管理</Text></View><Text style={s.featureText}>进入我的账本 →</Text></Card></Pressable>
    <View accessibilityState={{disabled:true}}><Card style={{opacity:.55,gap:spacing.md,padding:spacing.lg}}><View style={s.spread}><Icon name="book-outline" size={30}/><View style={s.pill}><Text style={s.badge}>第二期 · 待开发</Text></View></View><Text style={s.h2}>笔记管理</Text></Card></View>
  </>;
  else if(!workspace&&page!=='admin'&&page!=='settings')content=<Empty title="还没有工作区" detail="普通用户注册会创建空工作区。超级管理员可以先创建用户，再选择其工作区管理数据。" action={user.role==='super_admin'?<Button title="进入系统管理" onPress={()=>navigate('admin')}/>:undefined}/>;
  else if(!updated&&workspace&&!['admin','settings'].includes(page))content=error?<Empty title="暂时无法读取数据" detail={page==='tree'?'请检查服务连接，重新读取类别字典。':'请检查服务连接，重新读取所选日期。'} action={<Button title="重新加载" onPress={load}/>}/>:<Card><View style={{alignItems:'center',padding:28,gap:15}}><ActivityIndicator color={colors.primaryStrong}/><Text style={s.muted}>{page==='tree'?'正在读取类别字典…':'正在读取'+periodTitle+'的数据…'}</Text></View></Card>;
  else if(page==='overview')content=<>
    <View style={s.summary}><View style={s.spread}><Text style={s.summaryLabel}>{periodTitle} · 收支结余</Text><Icon name="leaf-outline" color={activeTheme.summaryNumber}/></View><Text style={s.summaryNumber}>¥ {amount(periodBalance)}</Text><View style={[s.row,{gap:layout.gutter}]}>{([['收入',totals.income],['净支出',totals.netExpense]]).map(([title,n])=><View key={title} style={{gap:spacing.xxs,flex:1}}><Text style={s.summaryLabel}>{title}</Text><Text style={{color:colors.summaryText,fontSize:17}}>{amount(n as number)}</Text></View>)}</View></View>
    <Pressable accessibilityRole="button" accessibilityLabel="进入收支明细" onPress={()=>navigate('transactions')}><Card style={{padding:spacing.lg,backgroundColor:colors.accent,borderColor:colors.line,gap:spacing.sm}}><View style={s.spread}><Icon name="receipt-outline" size={32}/><Icon name="arrow-forward"/></View><Text style={s.h2}>收支明细</Text><Text style={s.body}>查看流水、类别额度和月度预算</Text></Card></Pressable>
    <View style={s.row}><Button title="选择账本" style={{flex:1}} secondary icon="wallet-outline" onPress={()=>setLedgerPicker(true)}/><Button title="类别管理" style={{flex:1}} secondary icon="pricetags-outline" onPress={()=>navigate('tree')}/></View>
    {section('预算提醒',<Pressable onPress={()=>{navigate('transactions');setDetailTab('categories');}}><Text style={s.link}>查看类别 →</Text></Pressable>)}
    {data.balances.some(x=>x.available_minor<0)?data.balances.filter(x=>x.available_minor<0).map(x=><Pressable key={x.id} onPress={()=>compensate(x)}><Card style={s.spread}><View style={{gap:5}}><Text style={s.h3}>{x.name}</Text></View><Text style={[s.h3,{color:colors.red}]}>−¥{amount(-x.available_minor)}</Text></Card></Pressable>):<Card><View style={s.row}><Icon name="checkmark-circle-outline"/><Text style={s.muted}>目前没有待处理的负余额预算。</Text></View></Card>}
    {section('最近记录',<Pressable onPress={()=>navigate('transactions')}><Text style={s.link}>全部明细 →</Text></Pressable>)}
    {data.transactions.length?<Card>{data.transactions.slice(-5).reverse().map(row)}</Card>:<Empty title="记录你的第一笔" detail={data.ledgers.length?'点击底部＋，选择类别并输入金额。':'先选择或新建一个账本，再开始记账。'} action={<Button secondary title={data.ledgers.length?'去记一笔':'选择账本'} onPress={()=>data.ledgers.length?record():navigate('ledgers')}/>}/>}
  </>;
  else if(page==='ledgers')content=<>
    <View style={s.spread}><Button title="新建账本" icon="add" onPress={()=>newLedger()}/></View>
    <Button secondary title="浏览账本模板" onPress={()=>navigate('templates')}/>
    {!data.ledgers.length&&<Empty title="创建你的第一个账本" detail="默认空白记账，也可选择模板预备类别。"/>}
    {data.ledgers.map(l=><Card key={l.id}><View style={s.spread}><Pressable accessibilityRole="button" accessibilityLabel={'选择账本'+l.name} onPress={()=>{selectLedger(l.id);navigate('transactions');}} style={[s.row,{flex:1}]}><View style={s.iconCircle}><Icon name={l.ledger_type==='savings'?'trending-up-outline':'wallet-outline'}/></View><View style={{flex:1,gap:6}}><Text style={s.h3}>{l.name}</Text><Text style={s.small}>收支账本 · {cats(l.id).length} 个类别{l.id===ledger?' · 当前使用':''}</Text></View>{l.id===ledger&&<Icon name="checkmark-circle" color={colors.primaryStrong}/>}</Pressable>{actions(l,()=>rename(l))}</View></Card>)}
  </>;
  else if(page==='tree')content=null;
  else if(page==='transactions')content=<>
    {!contentId&&['all','income'].includes(detailTab)&&<TransactionFilters categories={filterCategories} value={activeCategoryFilter} onChoose={setCategoryFilter} query={filter} onQuery={setFilter}/>}
    {contentId&&<Card><View style={s.spread}><View style={{flex:1,gap:7}}><Text numberOfLines={1} style={s.h3}>{categoryPath(contentId)}</Text><Text style={s.small}>全部日期</Text></View><Button secondary title="返回列表" onPress={()=>setContentId('')}/></View></Card>}
    {!contentId&&detailTab==='budget'?monthlyBudget:!contentId&&detailTab==='categories'?<CategoryDetailsList categories={data.categories} ledger={ledger} month={month} plans={data.budgets} balances={data.balances} onChoose={id=>{setFilter('');setCategoryFilter('');setContentId(id);}}/>:<>
      {!contentId&&detailTab==='income'?<Card><View style={s.spread}><Text style={s.h3}>期间收入</Text><Text style={[s.amount,{color:colors.green}]}>¥{amount(filtered.reduce((sum:number,t:any)=>sum+t.amount_minor,0))}</Text></View><Text style={[s.small,{marginTop:spacing.xs}]}>{periodTitle} · {filtered.length} 笔</Text></Card>:summary}{contentId&&<TextInput accessibilityLabel="搜索明细" style={s.input} placeholder="备注、类别、金额…" placeholderTextColor={colors.muted} value={filter} onChangeText={setFilter}/>}
      {!filtered.length&&<Empty title="这里还没有明细" detail=""/>}
    </>}
  </>;
  else if(page==='templates')content=<>
    
    <Card><View style={s.spread}><View style={{flex:1,gap:7}}><Text style={s.h3}>空白手动记账</Text></View><Button secondary title="创建" onPress={()=>newLedger()}/></View></Card>
    {templates.filter(t=>t.id==='salary-allocation'&&t.ledger_type==='expense').map(t=><Card key={t.id+':'+t.version}><View style={s.row}><View style={s.iconCircle}><Icon name={t.ledger_type==='savings'?'trending-up-outline':'albums-outline'}/></View><View style={{flex:1,gap:7}}><Text style={s.h3}>{t.name}</Text></View></View><View style={{marginTop:18}}><Button secondary title="使用此模板" onPress={()=>newLedger(t.id+':'+t.version)}/></View></Card>)}
  </>;
  else if(page==='plans')content=<><Button title="添加计划账目" icon="add" onPress={()=>record(undefined,true)}/>{data.plans.map(p=><Card key={p.id}><View style={s.spread}><View style={{flex:1,gap:8}}><Text style={s.h3}>{p.category_name} · {directions[p.direction]}</Text><Text style={s.small}>{p.ledger_name} / {p.planned_on} · {p.status==='pending'?'待确认':p.status==='confirmed'?'已入账':'已取消'}</Text></View><Text style={s.h3}>¥{amount(p.amount_minor)}</Text></View>{p.status==='pending'&&<View style={{marginTop:15}}><Button secondary title="确认实际发生" onPress={()=>open('confirm:'+p.id,'确认计划发生',[{key:'amount',label:'实际金额（元）',type:'money',required:true},{key:'date',label:'实际日期',type:'date',required:true,maxDate:today()}],{amount:String(p.amount_minor/100),date:today()},async(v,id)=>{await write('/plans/'+p.id+'/confirm',{amountMinor:minor(v.amount),occurredOn:v.date},id,v.reason);},'确认后生成一条真实账单，重复确认不再次入账。')}/></View>}</Card>)}{!data.plans.length&&<Empty title="把计划留给未来" detail="计划不进入实际统计，等它发生，再由你确认入账。"/>}</>;
  else if(page==='savings'||page==='deletedSavings'&&Platform.OS!=='web')content=<SavingsManager key={workspace} workspace={workspace} root={root??''} userId={user.id} admin={user.role==='super_admin'} planId={savingsId} deletedOnly={page==='deletedSavings'} onDeleted={()=>navigate('deletedSavings')} onSelect={setSavingsId} onNavigate={()=>setDrawer(true)} onManageCategories={id=>{setCategoryLedger(id);navigate('tree');}}/>;
  else if(page==='configuration')content=<><View style={s.chips}>
    <Button secondary title="新建标签" onPress={()=>open('tag:new','辅助标签',[{key:'name',label:'标签名称',required:true}],{},async(v,id)=>{await write('/tags',{name:v.name,applicableKinds:['transaction','ledger','category']},id,v.reason);})}/>
    <Button secondary title="新建字段" onPress={()=>open('field:new','自定义字段',[{key:'name',label:'字段名称',required:true},{key:'type',label:'字段类型',type:'select',options:fieldTypes,required:true},{key:'options',label:'选项名称（单/多选）',hint:'用逗号分隔'}],{type:'text'},async(v,id)=>{await write('/fields',{name:v.name,fieldType:v.type,applicableKinds:['transaction'],options:(v.options??'').split(/[,，]/).map(x=>x.trim()).filter(Boolean)},id,v.reason);})}/>
    <Button secondary title="新建关系" onPress={()=>open('relation:new','附加关系',[{key:'name',label:'关系名称',required:true},{key:'cardinality',label:'基数',type:'select',options:[{label:'一对一',value:'one_to_one'},{label:'一对多',value:'one_to_many'}],required:true}],{cardinality:'one_to_many'},async(v,id)=>{await write('/relations',{name:v.name,cardinality:v.cardinality,sourceKinds:['transaction'],targetKinds:['transaction']},id,v.reason);})}/></View>
    
    {[['辅助标签','tags'],['自定义字段','fields'],['附加关系','relations']].map(([title,key])=><Card key={key}><Text style={[s.h3,{marginBottom:10}]}>{title}</Text>{data[key].map(x=><View key={x.id} style={s.spread}><Text style={s.body}>{x.name}</Text><Pressable onPress={()=>remove(x)} style={s.iconButton}><Icon name="trash-outline" size={17} color={colors.red}/></Pressable></View>)}{!data[key].length&&<Text style={s.small}>尚未添加</Text>}</Card>)}</>;
  else if(page==='reports')content=<><Card><View style={s.spread}><View style={{gap:8}}><Text style={s.small}>所选期间净支出</Text><Text style={s.amount}>¥{amount(totals.netExpense)}</Text></View><Icon name="analytics-outline" size={30}/></View><View style={[s.row,{marginTop:18}]}><Text style={s.small}>毛支出 {amount(totals.expense)}</Text><Text style={s.small}>退款 {amount(totals.refund)}</Text></View></Card>
    {section('支出趋势')}<Card><View style={[s.spread,{marginBottom:18}]}><View><Text style={s.small}>日均净支出</Text><Text style={s.h3}>¥{amount(report?.averageDailyExpense??0)}</Text></View><View><Text style={s.small}>支出笔数</Text><Text style={s.h3}>{report?.expenseCount??0} 笔</Text></View></View>{report?.highestExpenseDay?.amountMinor>0&&<Text style={[s.small,{marginBottom:12}]}>最高净支出 {report.highestExpenseDay.day} · ¥{amount(report.highestExpenseDay.amountMinor)}</Text>}<Trend data={report?.trend??[]}/></Card>{section('消费内容占比')}<Card><View style={{gap:20}}><Donut data={report?.categories??[]}/>{(report?.categories??[]).map((c:any,i:number)=><Pressable key={c.id} onPress={()=>{setLedger(c.ledger_id??ledger);navigate('transactions');setContentId(c.id);}}><View style={s.spread}><View style={s.row}><View style={{width:8,height:8,borderRadius:4,backgroundColor:chartColors[i%chartColors.length]}}/><Text style={s.body}>{c.name}</Text></View><Text style={s.body}>¥{amount(c.amountMinor)}</Text></View></Pressable>)}</View></Card><Button secondary title="导出 Excel" icon="download-outline" onPress={exportFile}/></>;
  else if(page==='trash'&&Platform.OS!=='web')content=<>{data.trash.map(x=><Card key={x.id}><View style={s.spread}><Text style={s.h3}>{x.name??x.kind}</Text><Button secondary title="恢复" onPress={()=>open('restore:'+x.id,'恢复记录',[],{},async(v,id)=>{await write('/entities/'+x.id+'/restore',{},id,v.reason);})}/></View></Card>)}{!data.trash.length&&<Empty title="回收站是空的" detail=""/>}</>;
  else if(page==='admin')content=user.role!=='super_admin'?<Empty title="无管理权限" detail="只有系统超级管理员可进入。"/>:<>
    <Card style={{backgroundColor:colors.light}}><Text style={s.h3}>系统超级管理员</Text></Card>
    <Button title="创建用户" icon="person-add-outline" onPress={()=>open('admin:new','创建用户',[{key:'username',label:'用户名',required:true},{key:'password',label:'临时密码（至少12位）',type:'password',required:true},{key:'role',label:'角色',type:'select',options:[{label:'普通用户',value:'user'},{label:'超级管理员',value:'super_admin'}],required:true}],{role:'user'},async v=>{await api('/v1/admin/users','POST',{username:v.username,password:v.password,role:v.role,reason:v.reason});})}/>
    {users.map(u=><Card key={u.id}><View style={s.spread}><View style={{gap:7,flex:1}}><Text style={s.h3}>{u.username}</Text><Text style={s.small}>{u.system_role==='super_admin'?'超级管理员':'普通用户'} · {u.deleted_at?'已删除':u.disabled_at?'已停用':'正常'}{u.must_change_password?' · 待改密':''}</Text></View>
      <Pressable onPress={()=>open('admin:'+u.id,'管理 '+u.username,[{key:'role',label:'角色',type:'select',options:[{label:'普通用户',value:'user'},{label:'超级管理员',value:'super_admin'}],required:true},{key:'disabled',label:'账号状态',type:'select',options:[{label:'启用',value:'false'},{label:'停用',value:'true'}],required:true},{key:'deleted',label:'账号保留状态',type:'select',options:[{label:'保留账号',value:'false'},{label:'移除账号',value:'true'}],required:true}],{role:u.system_role,disabled:String(!!u.disabled_at),deleted:String(!!u.deleted_at)},async v=>{await api('/v1/admin/users/'+u.id,'PATCH',{role:v.role,disabled:v.disabled==='true',deleted:v.deleted==='true',reason:v.reason});},'变更将撤销旧会话，并保留最后一名有效管理员。')}><Text style={s.link}>管理</Text></Pressable></View>
      <Pressable style={{marginTop:15}} onPress={()=>open('reset:'+u.id,'重置密码',[{key:'password',label:'临时密码（至少12位）',type:'password',required:true}],{},async v=>{await api('/v1/admin/users/'+u.id+'/reset-password','POST',{password:v.password,reason:v.reason});},'撤销旧会话，下次登录必须改密。')}><Text style={s.link}>重置密码</Text></Pressable></Card>)}
    <Button secondary title="管理注册开关" onPress={()=>open('registration:setting','用户注册开关',[{key:'enabled',label:'是否允许公开注册',type:'select',options:[{label:'允许',value:'true'},{label:'关闭',value:'false'}],required:true}],{enabled:'true'},async v=>{await api('/v1/admin/settings/registration','PUT',{enabled:v.enabled==='true',reason:v.reason});})}/>
    {section('最近系统操作')}{logs.slice(0,30).map(l=><Card key={l.id}><Text style={s.body}>{l.action}</Text><Text style={s.small}>{l.actor_name??'部署系统'} · {new Date(l.created_at).toLocaleString('zh-CN')}</Text>{l.reason&&<Text style={s.small}>{l.reason}</Text>}</Card>)}</>;
  else content=<><Card><View style={{gap:12}}><Text style={s.h3}>{user.username}</Text><Text style={s.small}>{user.role==='super_admin'?'系统超级管理员':'普通用户'} · PostgreSQL在线数据</Text><Text style={s.small}>{baseUrl}</Text></View></Card>
    <ThemePicker value={themeName} onChange={name=>void setThemeName(name)}/>
    <Button secondary title="选择 / 管理账本" icon="wallet-outline" onPress={()=>navigate('ledgers')}/><Button secondary title="管理类别" icon="pricetags-outline" onPress={()=>navigate('tree')}/><Button secondary title="导出所选日期 Excel" icon="download-outline" onPress={exportFile}/><Button secondary title="修改密码" onPress={passwordForm}/><Button secondary title="退出登录" onPress={signOut}/></>;
  const showDateFilter=!allDates&&!['overview','settings','admin','ledgers','templates','configuration','trash','savings','deletedSavings','tree'].includes(page);
  const showWorkspaceFilter=user.role==='super_admin'&&workspaces.length>0;
  const pageHeading=(<><View style={{gap:page==='transactions'?spacing.xxs:spacing.xs}}><Breadcrumbs items={breadcrumbs} onBack={goUp}/><View style={[s.spread,{flexWrap:'wrap'}]}><Text style={[s.h1,{flexGrow:1,flexShrink:1}]}>{page==='savings'&&savingsId?'计划详情':titles[page]}</Text>{['transactions','reports'].includes(page)&&<Pressable accessibilityRole="button" accessibilityLabel="切换当前账本" onPress={()=>setLedgerPicker(true)} style={[s.pill,s.row,{gap:spacing.xxs,maxWidth:'100%'}]}><Text numberOfLines={1} style={[s.badge,{flexShrink:1}]}>{selectedLedger?.name??'选择账本'}</Text><Icon name="chevron-down" size={14} color={colors.primaryStrong}/></Pressable>}</View>
        {page==='transactions'&&!contentId&&<View testID="detail-tabs"><SegmentedControl value={detailTab} onChange={changeDetailTab} options={[{value:'all',label:'收支流水'},{value:'categories',label:'类别额度'},{value:'income',label:'收入明细'},{value:'budget',label:'月度预算'}]}/></View>}
        {page!=='home'&&(showDateFilter||showWorkspaceFilter)&&<View style={{gap:spacing.xs}}>{showWorkspaceFilter&&<Select value={workspace} onChange={w=>{setData(blank);setReport(null);setWorkspace(w);setLedger('');setContentId('');}} options={workspaces.map(w=>({value:w.id,label:user.role==='super_admin'?(w.owner_name??'用户')+' / '+w.name:w.name}))}/>}
          {showDateFilter&&<><View testID="detail-period"><PeriodPicker value={period} onChange={setPeriod} monthOnly={page==='transactions'&&['budget','categories'].includes(detailTab)}/></View>{cached&&<Text style={s.small}>离线缓存 · {updated}</Text>}</>}</View>}
      </View>{!!error&&<Pressable onPress={()=>setError('')}><Text accessibilityRole="alert" style={s.error}>{error} · 点击收起</Text></Pressable>}</>);
  const virtualRecords=page==='transactions'&&(!!contentId||['all','income'].includes(detailTab))&&!!updated&&!!workspace&&!user.mustChangePassword;
  return <SafeAreaView style={[s.page,{paddingTop:layout.safeGap}]}><StatusBar style="dark"/><View style={s.shell}><View style={s.header}>
    <Pressable accessibilityRole="button" accessibilityLabel="打开侧边抽屉" onPress={()=>setDrawer(true)} style={s.iconButton}><Icon name="menu-outline" size={25}/></Pressable><Text style={s.brand}>枝账</Text><View style={{flex:1}}/>{page!=='home'&&page!=='ledgers'&&page!=='savings'&&page!=='deletedSavings'&&page!=='transactions'&&page!=='reports'&&<Pressable accessibilityRole="button" accessibilityLabel="选择或切换账本" onPress={()=>setLedgerPicker(true)} style={[s.row,{gap:spacing.xxs,maxWidth:'42%',flexShrink:1,minHeight:layout.touchTarget}]}><Text numberOfLines={1} style={[s.label,{flexShrink:1}]}>{headerLedger?.name??'选择账本'}</Text><Icon name="chevron-down" size={15}/></Pressable>}<Pressable accessibilityRole="button" accessibilityLabel="刷新数据" onPress={refreshData} style={s.iconButton}>{busy?<ActivityIndicator color={colors.primaryStrong}/>:<Icon name="refresh-outline" size={20}/>}</Pressable></View>
    {virtualRecords?<SectionList
      key={ledger+':'+contentId+':'+detailTab}
      testID="transaction-list"
      sections={dailyGroups.map(g=>({title:g.day,data:g.rows}))}
      keyExtractor={item=>item.id}
      renderItem={({item})=>row(item)}
      renderSectionHeader={({section})=><View style={[s.sectionHeader,{paddingTop:spacing.md}]}><Text style={s.h3}>{section.title} · {['日','一','二','三','四','五','六'][new Date(section.title+'T12:00:00').getDay()]}</Text><Text style={s.small}>当日净额 ¥{amount(section.data.reduce((sum:number,t:any)=>sum+(['expense','withdrawal'].includes(t.direction)?-t.amount_minor:t.amount_minor),0))}</Text></View>}
      ListHeaderComponent={<View style={{gap:spacing.xs}}>{pageHeading}{content}</View>}
      contentContainerStyle={[s.content,{gap:0,paddingTop:spacing.xs}]}
      keyboardShouldPersistTaps="handled"
      stickySectionHeadersEnabled={false}
      initialNumToRender={12} maxToRenderPerBatch={12} windowSize={7}
      refreshControl={<RefreshControl refreshing={busy} onRefresh={refreshData} tintColor={colors.primaryStrong}/>}
    />:<ScrollView ref={pageScroll} testID="detail-content" keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={busy} onRefresh={refreshData} tintColor={colors.primaryStrong}/>} contentContainerStyle={[s.content,page==='transactions'&&{gap:spacing.xs,paddingTop:spacing.xs}]}>{pageHeading}{content}</ScrollView>}

    {page!=='home'&&!user.mustChangePassword&&<View style={[s.footer,{alignItems:'center'}]}>{nav.map(([p,icon,label])=>p==='record'?<Pressable key={p} accessibilityRole="button" accessibilityLabel="底部加号记一笔" onPress={()=>record()} style={{alignItems:'center',justifyContent:'center',width:56,height:56,borderRadius:20,backgroundColor:colors.accent,marginTop:0,borderWidth:colors.buttonBorderWidth,borderColor:colors.line}}><Icon name="add" color={colors.onPrimary} size={31}/></Pressable>:<Pressable key={p} accessibilityRole="tab" accessibilityLabel={label} accessibilityState={{selected:page===p||page==='deletedSavings'&&p==='savings'}} onPress={()=>navigate(p)} style={[s.tab,{flex:1},(page===p||page==='deletedSavings'&&p==='savings')&&s.navSelected]}><Icon name={icon} color={page===p||page==='deletedSavings'&&p==='savings'?colors.ink:colors.muted}/><Text numberOfLines={1} style={[s.small,{color:page===p||page==='deletedSavings'&&p==='savings'?colors.ink:colors.muted}]}>{label}</Text></Pressable>)}</View>}

  </View><NavigationDrawer visible={drawer} page={page} admin={user.role==='super_admin'} onClose={()=>setDrawer(false)} onNavigate={navigate}/><LedgerPicker visible={ledgerPicker} ledgers={page==='tree'?dictionaryLedgers:data.ledgers} value={page==='tree'?dictionaryLedger?.id??'':ledger} onChoose={id=>{if(page==='tree')setCategoryLedger(id);else selectLedger(id);if(page==='ledgers')navigate('transactions');}} onClose={()=>setLedgerPicker(false)} onManage={()=>navigate('ledgers')}/>{recordSpec&&<RecordComposer key={recordSpec.key} onConfigure={recordSpec.transaction?()=>{const t=recordSpec.transaction;setRecordSpec(null);void configuration(t);}:undefined} spec={recordSpec} userId={user.id} workspace={workspace} ledgers={data.ledgers} categories={data.categories} admin={user.role==='super_admin'} offline={cached} onClose={()=>setRecordSpec(null)} onManage={id=>{setRecordSpec(null);setCategoryLedger(id);navigate('tree');}} onManageLedgers={()=>{setRecordSpec(null);navigate('ledgers');}} onCategoriesChanged={rows=>setData(d=>({...d,categories:rows.filter(c=>d.ledgers.some(l=>l.id===c.ledger_id)),dictionaryCategories:rows}))} onSave={saveRecord}/>}{page==='tree'&&workspace&&<CategoryManager userId={user.id} workspace={workspace} ledgerId={dictionaryLedger?.id??''} ledgers={dictionaryLedgers} admin={user.role==='super_admin'} offline={cached} onClose={()=>{navigate('ledgers');void load();}} onChanged={rows=>{setData(d=>({...d,categories:rows.filter(c=>d.ledgers.some(l=>l.id===c.ledger_id)),dictionaryCategories:rows}));void load();}}/>}{budgetTarget&&<BudgetEditor workspace={workspace} userId={user.id} admin={user.role==='super_admin'} offline={cached} target={budgetTarget} onClose={()=>setBudgetTarget(null)}/>}{confirmation&&<ConfirmActionModal action={confirmation} admin={user.role==='super_admin'} onClose={()=>setConfirmation(null)}/>}<FormModal spec={form} userId={user.id} onClose={()=>setForm(null)} onNavigate={()=>{setForm(null);setDrawer(true);}}/></SafeAreaView>;
}

