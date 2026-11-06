import React,{useEffect,useRef,useState} from 'react';
import {ActivityIndicator,Keyboard,KeyboardAvoidingView,Modal,PanResponder,Platform,Pressable,ScrollView,StyleSheet,Text,TextInput,View} from 'react-native';
import {SafeAreaProvider,SafeAreaView} from 'react-native-safe-area-context';
import {categoryIcons,inferCategoryIcon,moveCategory,resolveCategoryIcon,categoryIconBindings} from '@charge/categories';
import {api,amount,minor,operationId,today} from './api';
import {Button,Icon,Select,colors,s} from './ui';
import {categoryIcon} from './categoryIcons';
import {categoryDirections} from './categoryForm';
import {useBudgetState} from './useBudgetState';
import {BudgetEditor} from './BudgetEditor';
import {categoryAllowanceIndex,categoryAllowanceKey} from './categoryAllowance.mjs';
import {CategoryAllowanceBar} from './CategoryAllowanceBar';
import {LedgerPicker} from './LedgerPicker';
import {ConfirmActionModal} from './ConfirmActionModal';
import {getCurrentThemeName,layout,spacing,radius,typography,surfaces,type ThemeName} from './theme';
import {fourColumnWidth} from './grid.mjs';
import {FormSteps,type FormStep} from './FormSteps';

type Props={userId?:string;budgetMonth?:string;workspace:string;ledgerId:string;ledgers:any[];direction?:string;admin:boolean;offline:boolean;onClose:()=>void;onChanged:(categories:any[])=>void;onCreated?:(category:any)=>void};
type Editor={category?:any;name:string;iconId:string;direction:string;ledgers:string[];limit:string;originalLimit:number|null;plan:any;shared:boolean;reason:string;operation:string};
function SortHandle({name,disabled,onMove,onDragging}:{name:string;disabled:boolean;onMove:(offset:number)=>void;onDragging:(v:boolean)=>void}){
  const latest=useRef({onMove,onDragging,disabled});latest.current={onMove,onDragging,disabled};
  const responder=useRef(PanResponder.create({onStartShouldSetPanResponder:()=>!latest.current.disabled,onMoveShouldSetPanResponder:()=>!latest.current.disabled,
    onPanResponderGrant:()=>latest.current.onDragging(true),onPanResponderRelease:(_e,g)=>{latest.current.onDragging(false);const offset=Math.round(g.dy/92);if(offset)latest.current.onMove(offset);},onPanResponderTerminate:()=>latest.current.onDragging(false),onShouldBlockNativeResponder:()=>true})).current;
  return <View {...responder.panHandlers} accessible accessibilityRole="adjustable" accessibilityLabel={'排序类别'+name} accessibilityHint="拖动调整顺序，或使用辅助功能上移下移" accessibilityActions={[{name:'increment',label:'下移'},{name:'decrement',label:'上移'}]} onAccessibilityAction={e=>!disabled&&onMove(e.nativeEvent.actionName==='increment'?1:-1)} style={cm.handle}><Icon name="reorder-three-outline" size={28}/></View>;
}

export function CategoryManager({userId='',budgetMonth,workspace,ledgerId,ledgers:initialLedgers,direction:initialDirection='expense',admin,offline,onClose,onChanged,onCreated}:Props){
  const [state,setState]=useState<any>(null),[ledger,setLedger]=useState(ledgerId),[direction,setDirection]=useState(initialDirection==='refund'?'expense':initialDirection),[editor,setEditor]=useState<Editor|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[picker,setPicker]=useState(false),[dragging,setDragging]=useState(false),[remove,setRemove]=useState<any>(null),[reason,setReason]=useState('');
  const [iconPage,setIconPage]=useState(0),[iconWidth,setIconWidth]=useState(0),[iconKind,setIconKind]=useState('all');
  const iconScroll=useRef<ScrollView>(null),saving=useRef(false),version=useRef(0),operation=useRef(operationId());
  const allLedgers=state?.ledgers??initialLedgers,current=allLedgers.find((l:any)=>l.id===ledger),savings=current?.ledger_type==='savings',month=(budgetMonth??today()).slice(0,7);
  const budgetState=useBudgetState(workspace,ledger,month);
  const [budgetEditor,setBudgetEditor]=useState(false);
  const allowances=categoryAllowanceIndex(budgetState.data?.budgets??[],budgetState.data?.balances??[]);
  const all:any[]=state?.categories??[],ledgerCategories=all.filter(c=>c.ledger_id===ledger),visible=ledgerCategories.filter(c=>!c.allowed_directions?.length||c.allowed_directions.includes(direction));
  const choices=savings?[['deposit','存入'],['withdrawal','取出']]:[['expense','支出'],['income','收入']];
  const bindings=categoryIconBindings(all,editor?.ledgers??[ledger]);
  const icons=categoryIcons.filter(i=>iconKind==='all'||(iconKind==='bound'?bindings.has(i.id):!bindings.has(i.id))),pages=Math.ceil(icons.length/20);
  useEffect(()=>{if(iconPage>0&&iconPage>=pages){setIconPage(0);iconScroll.current?.scrollTo({x:0,animated:false});}},[pages,iconPage]);
  async function load(notify=false){const own=++version.current;const result=await budgetState.refresh(true);if(own!==version.current)return;setState(result);if(notify)onChanged(result.categories);return result;}
  useEffect(()=>{if(budgetState.data)setState(budgetState.data);},[budgetState.data]);
  useEffect(()=>{setEditor(null);setError('');},[workspace,ledger,month]);
  useEffect(()=>{if(current&&!choices.some(([value])=>value===direction))setDirection(savings?'deposit':'expense');},[current?.id]);
  async function mutate(path:string,body:any,method='POST',id=operationId(),adminReason=reason){
    if(offline)throw new Error('当前离线，请联网后修改类别');
    if(admin&&!adminReason.trim())throw new Error('请填写管理员操作理由');
    return api(`/v1/workspaces/${workspace}${path}`,method,{...body,operationId:id,...(admin?{reason:adminReason}:{})});
  }
  async function openEditor(category?:any){setError('');setBusy(true);try{
    const fresh=await load();if(!fresh)return;
    const c=category?fresh.categories.find((x:any)=>x.id===category.id):undefined;
    if(category&&!c)throw new Error('类别已变化，请刷新后重新选择');
    const p=fresh.budgets.find((p:any)=>p.ledger_id===ledger&&p.status==='active')??fresh.budgets.find((p:any)=>p.ledger_id===ledger&&p.status==='draft');
    const b=fresh.balances.find((b:any)=>b.plan_id===p?.id&&b.category_ids?.includes(c?.id));
    const ds=c?.allowed_directions??[],kind=c?(ds.length===0||ds.includes(choices[0][0])&&ds.includes(choices[1][0])?'both':ds.includes('income')?'income':ds.includes('withdrawal')?'withdrawal':savings?'deposit':'expense'):direction;
    setEditor({category:c,name:c?.name??'',iconId:c?resolveCategoryIcon(c).id:inferCategoryIcon(''),direction:kind,ledgers:[ledger],limit:b?.initial_minor!=null?String(b.initial_minor/100):'',originalLimit:b?.initial_minor??null,plan:p,shared:p?.management_mode==='allocated'||(b?.category_ids?.length??0)>1,reason:'',operation:operationId()});
    setIconKind('all');const page=c?Math.floor(categoryIcons.findIndex(i=>i.id===resolveCategoryIcon(c).id)/20):0;setIconPage(Math.max(0,page));
    setTimeout(()=>iconScroll.current?.scrollTo({x:Math.max(0,page)*iconWidth,animated:false}),100);
  }catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  function update(p:Partial<Editor>){setEditor(e=>e?{...e,...p}:e);setError('');}
  async function save(){if(!editor||saving.current)return;const e=editor;setError('');try{
    if(!e.name.trim())throw new Error('请输入类别名称');if(e.name.trim().length>100)throw new Error('类别名称最多100字');if(!e.ledgers.length)throw new Error('请选择至少一个账本');
    saving.current=true;setBusy(true);Keyboard.dismiss();const limit=e.limit.trim()?minor(e.limit):null;
    const budget=!savings&&e.direction!=='income'&&!e.shared&&limit!==e.originalLimit?{month:month+'-01',limitMinor:limit,...(e.category?{planId:e.plan?.id??null,expectedPlanRevision:e.plan?.entity_revision??null}:{})}:undefined;
    const payload={name:e.name.trim(),iconId:e.iconId,allowedDirections:categoryDirections(e.direction),...(budget?{budget}:{})};
    const result=e.category?await mutate('/categories/'+e.category.id,{...payload,expectedRevision:e.category.revision},'PUT',e.operation,e.reason):await mutate('/categories/batch',{...payload,ledgerIds:e.ledgers},'POST',e.operation,e.reason);
    const fresh=await load(true);const created=fresh?.categories.find((c:any)=>c.id===result.categories?.find((c:any)=>c.ledgerId===ledger)?.id);
    if(created)onCreated?.(created);setEditor(null);
  }catch(err){setError((err as Error).message);}finally{saving.current=false;setBusy(false);}}
  async function reorder(c:any,offset:number){if(busy||!offset)return;setError('');setBusy(true);try{
    // Move among the displayed direction, retaining the other direction's slots.
    const ordered=moveCategory(visible,c.id,offset);let index=0;const ids=new Set(visible.map(c=>c.id));const merged=ledgerCategories.map(c=>ids.has(c.id)?ordered[index++]:c);
    if(merged.every((c,i)=>c.id===ledgerCategories[i].id))return;
    await mutate('/categories/reorder',{ledgerId:ledger,items:merged.map(c=>({id:c.id,expectedRevision:c.revision}))},'PUT');await load(true);
  }catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  async function confirmRemove(id:string,adminReason:string){if(!remove)return;await mutate('/entities/'+remove.id,{expectedRevision:remove.revision},'DELETE',id,adminReason);await load(true);}
  const editorSteps:FormStep[]=editor?[
    {key:'name',label:editor.category?'类别名称':'新建类别名称',required:true,input:true,review:editor.name,
      validate:()=>!editor.name.trim()?'请输入类别名称':undefined,
      render:next=><TextInput autoFocus accessibilityLabel="自定义类别名称" value={editor.name} maxLength={100} onChangeText={name=>update({name})} placeholder="输入类别名称" placeholderTextColor={colors.muted} style={s.input} returnKeyType="next" onSubmitEditing={next}/>},
    {key:'direction',label:savings?'计划用途':'收支用途',required:true,review:editor.direction==='both'?(savings?'存入和取出':'支出和收入'):choices.find(([key])=>key===editor.direction)?.[1]??'',
      render:()=> <Select value={editor.direction} onChange={value=>update({direction:value})} options={[...choices.map(([value,label])=>({value,label})),{value:'both',label:savings?'存入和取出':'支出和收入'}]}/>},
    ...(!editor.category?[{key:'ledgers',label:'所属账本',hint:'可选择多个账本，分别创建独立类别。',required:true,review:allLedgers.filter((l:any)=>editor.ledgers.includes(l.id)).map((l:any)=>l.name).join('、'),
      validate:()=>!editor.ledgers.length?'请选择至少一个账本':undefined,
      render:()=> <Select multiple value={editor.ledgers.join(',')} onChange={ids=>update({ledgers:ids.split(',').filter(Boolean)})} options={allLedgers.filter((l:any)=>l.ledger_type===current?.ledger_type).map((l:any)=>({value:l.id,label:l.name}))}/>}]:[]),
    ...(!savings&&editor.direction!=='income'&&!editor.shared?[{key:'limit',label:month+' 消费上限（元）',hint:'留空则不设置消费上限。',input:true,review:editor.limit.trim()?'¥'+editor.limit:'不设置上限',
      validate:()=>{try{if(editor.limit.trim())minor(editor.limit);}catch(e){return (e as Error).message;}},
      render:(next:()=>void)=><TextInput autoFocus accessibilityLabel="类别消费上限" keyboardType="decimal-pad" value={editor.limit} onChangeText={limit=>update({limit})} placeholder="留空不设置上限" style={s.input} returnKeyType="next" onSubmitEditing={next}/>}]:[]),
    {key:'icon',label:'选择图标',required:true,review:<View style={s.row}><Icon name={categoryIcon({icon_id:editor.iconId})} size={28}/><Text style={s.body}>{categoryIcons.find(i=>i.id===editor.iconId)?.label??'已选图标'}</Text></View>,render:()=> <View style={{gap:spacing.sm}}>
      <Text style={s.small}>100 个图标 · 可重复绑定类别</Text>
      <Select value={iconKind} onChange={kind=>{setIconKind(kind);setIconPage(0);iconScroll.current?.scrollTo({x:0,animated:false});}} options={[{value:'all',label:'全部'},{value:'bound',label:'已绑定'},{value:'unbound',label:'未绑定'}]}/>
      
      {!pages&&<Text style={[s.muted,{paddingVertical:24,textAlign:'center'}]}>当前账本还没有{iconKind==='bound'?'已绑定':'未绑定'}的图标</Text>}
      <View onLayout={e=>{const w=e.nativeEvent.layout.width;setIconWidth(w);iconScroll.current?.scrollTo({x:iconPage*w,animated:false});}}><ScrollView ref={iconScroll} horizontal pagingEnabled showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" onMomentumScrollEnd={e=>iconWidth&&setIconPage(Math.round(e.nativeEvent.contentOffset.x/iconWidth))}>
        {Array.from({length:pages},(_,p)=><View key={p} style={{width:iconWidth,flexDirection:'row',flexWrap:'wrap',rowGap:spacing.md,columnGap:layout.gutter}}>{icons.slice(p*20,p*20+20).map(icon=><Pressable key={icon.id} accessibilityRole="button" accessibilityLabel={'选择图标'+icon.label} accessibilityState={{selected:editor.iconId===icon.id}} onPress={()=>update({iconId:icon.id})} style={{width:fourColumnWidth(iconWidth,layout.gutter),minHeight:72,alignItems:'center',gap:spacing.xs}}><View style={[cm.circle,{width:48,height:48,backgroundColor:editor.iconId===icon.id?colors.accent:colors.input,borderColor:colors.line,borderWidth:editor.iconId===icon.id?3:2}]}><Icon name={categoryIcon({icon_id:icon.id})} size={25} color={colors.ink}/></View><Text numberOfLines={1} style={[s.small,{maxWidth:'100%'}]}>{icon.label}</Text></Pressable>)}</View>)}
      </ScrollView></View>
      <View style={{flexDirection:'row',justifyContent:'center',gap:10}}>{Array.from({length:pages},(_,p)=><Pressable key={p} accessibilityRole="button" accessibilityLabel={'图标第'+(p+1)+'页'} onPress={()=>{setIconPage(p);iconScroll.current?.scrollTo({x:p*iconWidth,animated:true});}} style={{minWidth:layout.touchTarget,minHeight:layout.touchTarget,alignItems:'center',justifyContent:'center'}}><View style={{width:7,height:7,borderRadius:4,backgroundColor:p===iconPage?colors.primaryStrong:colors.line}}/></Pressable>)}</View>
    </View>},
    ...(admin?[{key:'reason',label:'管理员操作理由',required:true,input:true,review:editor.reason,validate:()=>!editor.reason.trim()?'请填写管理员操作理由':undefined,
      render:(next:()=>void)=><TextInput autoFocus accessibilityLabel="类别编辑操作理由" value={editor.reason} onChangeText={reason=>update({reason})} style={s.input} returnKeyType="next" onSubmitEditing={next}/>}]:[]),
  ]:[];
  const back=()=>{if(busy)return;if(remove)setRemove(null);else if(editor){Keyboard.dismiss();setEditor(null);setError('');}else onClose();};
  return <Modal visible animationType="slide" statusBarTranslucent navigationBarTranslucent onRequestClose={back}><SafeAreaProvider><SafeAreaView style={[cm.page,{paddingTop:layout.safeGap}]}><KeyboardAvoidingView behavior={Platform.OS==='ios'?'padding':'height'} style={{flex:1}}>
    <View style={cm.header}><Pressable accessibilityRole="button" accessibilityLabel={editor?'返回类别管理':'返回记账页面'} onPress={back} disabled={busy} style={s.iconButton}><Icon name="chevron-back" size={26}/></Pressable><View style={{flex:1}}><Text style={s.small}>类别管理{editor?' / '+(editor.category?'编辑类别':'自定义类别'):''}</Text><Text style={s.h3}>{editor?'设定自定义分类':current?.name??'选择账本'}</Text></View>{!editor&&<Pressable accessibilityRole="button" accessibilityLabel="类别管理切换账本" disabled={busy} onPress={()=>setPicker(true)} style={s.iconButton}><Icon name="wallet-outline"/></Pressable>}</View>
    {!state?<View style={{padding:24}}>{error?<Text style={s.error}>{error}</Text>:<ActivityIndicator/>}<Button secondary title="重新读取" onPress={()=>void load().catch(e=>setError(e.message))}/></View>:<>
    {!editor&&<View style={cm.heading}><Text style={[s.h3,{flex:1}]}>{editor?'自定义类别':`当前共 ${visible.length} 个类别`}</Text><View style={s.row}>{choices.map(([value,label],i)=><React.Fragment key={value}>{i>0&&<Text style={s.muted}>/</Text>}<Pressable accessibilityRole="tab" accessibilityLabel={label+'类别'} accessibilityState={{selected:direction===value}} disabled={busy} onPress={()=>setDirection(value)} style={{padding:7}}><Text style={[s.h3,{color:direction===value?colors.ink:colors.muted}]}>{label}</Text></Pressable></React.Fragment>)}</View></View>}
    {!!error&&!editor&&<Text accessibilityRole="alert" style={[s.error,{marginHorizontal:layout.pageInset}]}>{error}</Text>}
    {editor?<FormSteps key={editor.operation} steps={editorSteps} busy={busy} error={error} onSubmit={()=>void save()} submitLabel="保存类别"
      actions={!savings&&editor.direction!=='income'&&editor.shared&&editor.category?<Button secondary title="设置消费上限" onPress={()=>setBudgetEditor(true)}/>:undefined}/>
    :<><ScrollView scrollEnabled={!dragging} contentContainerStyle={{paddingHorizontal:layout.pageInset,paddingBottom:20}}>
      {admin&&<TextInput accessibilityLabel="类别管理操作理由" placeholder="删除、排序前填写管理员操作理由" value={reason} onChangeText={setReason} style={[s.input,{marginBottom:10}]}/>}
      {visible.map(c=><View key={c.id} style={cm.categoryRow}><View><Pressable accessibilityRole="button" accessibilityLabel={'编辑类别'+c.name} disabled={busy} onPress={()=>void openEditor(c)} style={[cm.circle,{backgroundColor:colors.light}]}><Icon name={categoryIcon(c)} size={28}/></Pressable></View><Pressable accessibilityRole="button" accessibilityLabel={'管理类别'+c.name} disabled={busy} onPress={()=>void openEditor(c)} style={{flex:1,gap:5}}><Text numberOfLines={1} ellipsizeMode="tail" style={s.h3}>{c.name}</Text>{!savings&&direction!=='income'&&<CategoryAllowanceBar value={allowances.get(categoryAllowanceKey(ledger,c.id,month))} category={c.name} month={month}/>}</Pressable><Pressable accessibilityRole="button" accessibilityLabel={'删除类别'+c.name} disabled={busy} onPress={()=>{setRemove(c);operation.current=operationId();setError('');}} style={cm.removeBadge}><Icon name="trash-outline" size={20} color={colors.red}/></Pressable><SortHandle name={c.name} disabled={busy||!!remove} onDragging={setDragging} onMove={offset=>void reorder(c,offset)}/></View>)}
      {!visible.length&&<Text style={[s.muted,{paddingVertical:38,textAlign:'center'}]}>还没有{choices.find(c=>c[0]===direction)?.[1]}类别</Text>}
    </ScrollView><Pressable accessibilityRole="button" accessibilityLabel="自定义分类" disabled={busy||!current} onPress={()=>void openEditor()} style={[cm.add,{backgroundColor:colors.accent}]}>{busy?<ActivityIndicator/>:<><Icon name="add" size={26}/><Text style={s.h2}>自定义分类</Text></>}</Pressable></>}
    </>}
    {budgetEditor&&editor&&<BudgetEditor workspace={workspace} userId={userId} admin={admin} offline={offline} target={{ledgerId:ledger,month,categoryId:editor.category?.id,planId:editor.plan?.id}} onClose={()=>setBudgetEditor(false)} onSaved={()=>{setEditor(null);setBudgetEditor(false);void load(true).catch(e=>setError(e.message));}}/>}
    <LedgerPicker visible={picker} ledgers={allLedgers} value={ledger} onChoose={id=>{setLedger(id);setError('');}} onClose={()=>setPicker(false)} onManage={()=>setPicker(false)}/>
    {!!remove&&<ConfirmActionModal admin={admin} action={{title:'删除类别',message:'删除此类别及全部记录？',confirmLabel:'确认删除类别',danger:true,submit:confirmRemove}} onClose={()=>setRemove(null)}/>}
  </KeyboardAvoidingView></SafeAreaView></SafeAreaProvider></Modal>;
}
function createCategoryStyles(){return StyleSheet.create({page:{flex:1,backgroundColor:colors.bg},header:{flexDirection:'row',alignItems:'center',paddingHorizontal:layout.pageInset,paddingVertical:spacing.xxs,gap:spacing.xs},heading:{flexDirection:'row',alignItems:'center',paddingHorizontal:layout.pageInset,paddingVertical:spacing.sm,flexWrap:'wrap',gap:spacing.xs},circle:{width:48,height:48,borderRadius:radius.md,borderWidth:colors.borderWidth,borderColor:colors.line,alignItems:'center',justifyContent:'center'},categoryRow:{minHeight:92,paddingHorizontal:spacing.xs,borderWidth:colors.borderWidth,borderColor:colors.line,borderRadius:radius.lg,backgroundColor:colors.paper,paddingVertical:spacing.sm,flexDirection:'row',alignItems:'center',gap:spacing.xs},handle:{width:48,height:60,justifyContent:'center',alignItems:'center'},removeBadge:{width:layout.touchTarget,height:layout.touchTarget,borderRadius:radius.md,alignItems:'center',justifyContent:'center'},add:{minHeight:72,marginHorizontal:layout.pageInset,marginVertical:spacing.xs,borderWidth:colors.borderWidth,borderColor:colors.line,borderRadius:radius.lg,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:10},nameCard:{padding:layout.cardInset,borderRadius:radius.lg,borderWidth:colors.borderWidth,borderColor:colors.line,backgroundColor:colors.paper},confirm:{position:'absolute',inset:0,backgroundColor:surfaces.scrim,alignItems:'center',justifyContent:'center',padding:24},confirmBox:{width:'100%',maxWidth:430,borderWidth:colors.borderWidth,borderColor:colors.line,borderRadius:22,backgroundColor:colors.paper,padding:24,gap:18}});}
const categoryStyleCache=new Map<ThemeName,ReturnType<typeof createCategoryStyles>>();
const cm=new Proxy({} as ReturnType<typeof createCategoryStyles>,{get:(_target,key: keyof ReturnType<typeof createCategoryStyles>)=>{const name=getCurrentThemeName();let value=categoryStyleCache.get(name);if(!value){value=createCategoryStyles();categoryStyleCache.set(name,value);}return value[key];}});
