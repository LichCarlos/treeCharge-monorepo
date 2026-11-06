import React,{useEffect,useRef,useState} from 'react';
import {ActivityIndicator,Keyboard,KeyboardAvoidingView,Modal,Platform,Pressable,ScrollView,StyleSheet,Text,TextInput,View,useWindowDimensions} from 'react-native';
import {SafeAreaProvider,SafeAreaView} from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {api,amount,operationId,today} from './api';
import {DateInput} from './DatePicker';
import {LedgerPicker} from './LedgerPicker';
import {CategoryPager} from './CategoryPager';
import {calculatorPress,evaluateAmount} from './calculator.mjs';
import {FormModal,Icon,s,colors,type FormSpec} from './ui';
import {useBudgetState} from './useBudgetState';
import {BudgetEditor} from './BudgetEditor';
import {categoryAllowanceIndex,categoryAllowanceKey} from './categoryAllowance.mjs';
import {CategoryAllowanceBar} from './CategoryAllowanceBar';
import {CategoryManager} from './CategoryManager';
import {getCurrentTheme,getCurrentThemeName,layout,spacing,radius,typography,type ThemeName} from './theme';
import {fourColumnWidth} from './grid.mjs';

export type RecordDraft={ledger:string;category:string;direction:string;expression:string;date:string;remark:string;original:string;reason:string};
export type RecordSpec={key:string;initial:RecordDraft;transaction?:any;lockLedger?:boolean};
type Props={onConfigure?:()=>void;spec:RecordSpec;userId:string;workspace:string;ledgers:any[];categories:any[];admin:boolean;offline:boolean;onClose:()=>void;onManage:(ledger:string)=>void;onManageLedgers:()=>void;onCategoriesChanged:(categories:any[])=>void;onSave:(v:RecordDraft,cents:number,id:string)=>Promise<void>};
export function RecordComposer({onConfigure,spec,userId,workspace,ledgers,categories,admin,offline,onClose,onManage,onManageLedgers,onCategoriesChanged,onSave}:Props){
  const {height,fontScale}=useWindowDimensions();const compact=height<740;
  const [keypadSize,setKeypadSize]=useState({width:0,height:0});
  const [frameHeight,setFrameHeight]=useState(height),[headerHeight,setHeaderHeight]=useState(compact?56:112);
  const restingCategoryHeight=useRef(0);
  const keyWidth=fourColumnWidth(keypadSize.width,layout.gutter);
  const keyHeight=Math.max(0,(keypadSize.height-layout.gutter*3)/4);
  const [draft,setDraft]=useState(spec.initial),[ready,setReady]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[picker,setPicker]=useState(false);
  const [categoryManager,setCategoryManager]=useState(false),[detailsForm,setDetailsForm]=useState<FormSpec|null>(null),[localCategories,setLocalCategories]=useState(categories),[budgetEditor,setBudgetEditor]=useState(false);
  const op=useRef(operationId()),saving=useRef(false);
  const remarkInput=useRef<TextInput>(null);
  const [remarkFocused,setRemarkFocused]=useState(false),[keyboardVisible,setKeyboardVisible]=useState(false);
  const [remarkSuggestions,setRemarkSuggestions]=useState<{remark:string}[]>([]),[suggestionScope,setSuggestionScope]=useState('');
  const suggestionKey=`${draft.ledger}:${draft.category}:${draft.direction}`;
  const textMode=remarkFocused||keyboardVisible;
  useEffect(()=>{
    const show=Keyboard.addListener('keyboardDidShow',e=>{setKeyboardVisible(true);});
    const hide=Keyboard.addListener('keyboardDidHide',()=>{setKeyboardVisible(false);setRemarkFocused(false);remarkInput.current?.blur();});
    return()=>{show.remove();hide.remove();};
  },[]);
  const storageKey=`record-draft:v2:${userId}:${workspace}:${spec.transaction?.id??(spec.lockLedger?'plan:'+spec.initial.ledger:'expense')}`;
  const current=ledgers.find(l=>l.id===draft.ledger),isSavings=current?.ledger_type==='savings';
  const choices=isSavings?[{value:'deposit',label:'存入'},{value:'withdrawal',label:'取出'}]:[{value:'expense',label:'支出'},{value:'income',label:'收入'}];
  if(spec.initial.direction==='refund'&&!isSavings)choices.push({value:'refund',label:'退款'});
  function change(p:Partial<RecordDraft>){setDraft(v=>({...v,...p}));setError('');}
  useEffect(()=>{let mounted=true;AsyncStorage.getItem(storageKey).then(text=>{if(!mounted)return;if(text)try{const d=JSON.parse(text);const restored={...spec.initial,...d.values};if(ledgers.some(l=>l.id===restored.ledger)&&(!spec.lockLedger||restored.ledger===spec.initial.ledger)){if(spec.initial.category&&!spec.transaction){restored.ledger=spec.initial.ledger;restored.category=spec.initial.category;}setDraft(restored);op.current=d.operationId??op.current;}}catch{}setReady(true);}).catch(()=>{if(mounted)setReady(true);});return()=>{mounted=false;};},[]);
  useEffect(()=>{if(ready)void AsyncStorage.setItem(storageKey,JSON.stringify({values:draft,operationId:op.current}));},[draft,ready]);
  useEffect(()=>{setLocalCategories(categories);},[categories]);
  const budget=useBudgetState(workspace,draft.ledger,draft.date.slice(0,7),ready);
  const scopeState=budget.data,loading=budget.loading,scopeError=budget.error;
  useEffect(()=>{if(scopeState)setLocalCategories(scopeState.categories);},[scopeState]);
  useEffect(()=>{if(ready&&scopeState&&!budget.loading&&!budget.stale&&draft.category&&!scopeState.categories.some((c:any)=>c.id===draft.category))change({category:''});},[ready,scopeState,budget.loading,budget.stale,draft.category]);
  useEffect(()=>{if(!ready||!scopeState||budget.loading||budget.stale||busy)return;
    if(!scopeState.ledgers.some((l:any)=>l.id===draft.ledger)){onClose();return;}
    if(spec.transaction&&draft.date.slice(0,7)===spec.transaction.occurred_on.slice(0,7)&&draft.ledger===spec.transaction.ledger_id&&!scopeState.transactions.some((t:any)=>t.id===spec.transaction.id))onClose();
  },[ready,scopeState,budget.loading,budget.stale,busy]);
  useEffect(()=>{
    if(!ready||!draft.category)return;
    let live=true;
    api<{remark:string}[]>(`/v1/workspaces/${workspace}/categories/${draft.category}/remark-suggestions?direction=${draft.direction}${spec.transaction?'&excludeId='+spec.transaction.id:''}`)
      .then(rows=>{if(live){setRemarkSuggestions(rows);setSuggestionScope(suggestionKey);}})
      .catch(()=>{if(live){setRemarkSuggestions([]);setSuggestionScope(suggestionKey);}});
    return()=>{live=false;};
  },[ready,workspace,suggestionKey,spec.transaction?.id]);
  const available=localCategories.filter(c=>c.ledger_id===draft.ledger&&(!c.allowed_directions?.length||c.allowed_directions.includes(draft.direction)));
  const selected=available.find(c=>c.id===draft.category);
  const allowance=categoryAllowanceIndex(scopeState?.budgets??[],scopeState?.balances??[]).get(categoryAllowanceKey(draft.ledger,draft.category,draft.date));
  let preview:number|null=null;try{preview=evaluateAmount(draft.expression);}catch{}
  function switchLedger(id:string){const l=ledgers.find(l=>l.id===id);change({ledger:id,category:'',direction:l?.ledger_type==='savings'?'deposit':'expense',original:''});}
  function switchDirection(direction:string){Keyboard.dismiss();change({direction,category:'',original:''});}
  async function save(){if(saving.current)return;Keyboard.dismiss();setError('');try{
    if(!selected)throw new Error('请先选择一个类别');
    if(!ledgers.some(l=>l.id===draft.ledger))throw new Error('请先选择账本');
    const cents=evaluateAmount(draft.expression);if(cents<=0)throw new Error('记账金额需要大于0');
    if(draft.direction==='refund'&&!draft.original)throw new Error('请选择退款对应的原支出');
    if(admin&&!draft.reason.trim())throw new Error('请填写管理员操作理由');
    if(offline)throw new Error('当前离线，已保留草稿，联网后可完成记账');
    saving.current=true;setBusy(true);await onSave(draft,cents,op.current);await AsyncStorage.removeItem(storageKey);onClose();
  }catch(e){setError((e as Error).message);}finally{saving.current=false;setBusy(false);}}
  function addCategory(){Keyboard.dismiss();setCategoryManager(true);}
  function editDetails(){setDetailsForm({key:`${workspace}:record-details:${spec.key}`,title:'记录信息',operationId:operationId(),initial:{original:draft.original,reason:draft.reason},fields:[
    ...(draft.direction==='refund'?[{key:'original',label:'退款对应的原支出',type:'select' as const,required:true,options:(scopeState?.transactions??[]).filter((t:any)=>t.direction==='expense').map((t:any)=>({value:t.id,label:t.category_name+' ¥'+amount(t.amount_minor)+' · '+t.occurred_on}))}]:[]),
    ...(admin?[{key:'reason',label:'管理员操作理由',type:'textarea' as const,required:true}]:[])
  ],submit:async v=>{change({original:v.original??'',reason:v.reason??''});}});}
  const choose=(id:string)=>{Keyboard.dismiss();change({category:id});};
  function finishRemark(){remarkInput.current?.blur();Keyboard.dismiss();setRemarkFocused(false);setKeyboardVisible(false);}
  const hasSuggestions=!!selected&&textMode&&suggestionScope===suggestionKey&&remarkSuggestions.length>0;
  const remarkHeight=Math.max(50,Math.ceil(typography.body.lineHeight*(textMode?fontScale:Math.min(fontScale,1.3)))+spacing.md);
  const errorHeight=error||offline?Math.ceil(typography.caption.lineHeight*Math.min(fontScale,1.3))*2+spacing.xs:0;
  const inlineSuggestions=hasSuggestions&&compact&&frameHeight-headerHeight<layout.touchTarget*3+spacing.lg+remarkHeight+56+spacing.xs*2+errorHeight;
  // The note dock replaces only the number pad. Categories retain all three rows.
  const calculatorHeight=textMode
    ?remarkHeight+spacing.xs+(hasSuggestions&&!inlineSuggestions?56+spacing.xs:0)+errorHeight
    :Math.max(frameHeight<560?306:338,Math.min(392,(frameHeight-headerHeight)*.48))+errorHeight;
  const availableCategoryHeight=Math.max(0,frameHeight-headerHeight-calculatorHeight);
  if(!textMode)restingCategoryHeight.current=availableCategoryHeight;
  const categoryHeight=textMode?Math.min(restingCategoryHeight.current,availableCategoryHeight):availableCategoryHeight;
  const suggestionChips=(inline=false)=><ScrollView horizontal keyboardShouldPersistTaps="always" showsHorizontalScrollIndicator={false} style={[r.suggestions,inline&&{flexGrow:1,flexShrink:1,flexBasis:0,minWidth:0,height:layout.touchTarget}]} contentContainerStyle={r.suggestionContent} accessibilityLabel="当前类别常用备注">
    {remarkSuggestions.map(({remark})=><Pressable key={remark} accessibilityRole="button" accessibilityLabel={'使用常用备注'+remark} accessibilityState={{selected:draft.remark===remark}} disabled={busy} onPress={()=>change({remark})} style={[r.suggestion,draft.remark===remark&&r.suggestionOn]}><Text maxFontSizeMultiplier={1.3} numberOfLines={1} style={[r.suggestionText,draft.remark===remark&&{color:colors.primaryStrong,fontWeight:'700'}]}>{remark}</Text></Pressable>)}
  </ScrollView>;
  const directionTabs=(inline=false)=><View testID="record-direction-tabs" style={inline?r.inlineTabs:r.tabs}>{choices.map(d=><Pressable key={d.value} accessibilityRole="tab" accessibilityLabel={d.label} accessibilityState={{selected:draft.direction===d.value}} disabled={busy} onPress={()=>switchDirection(d.value)} style={[r.tab,inline&&{paddingHorizontal:spacing.xxs},draft.direction===d.value&&r.activeTab]}><Text maxFontSizeMultiplier={1.3} numberOfLines={1} style={[inline?r.inlineTabLabel:r.tabLabel,draft.direction===d.value&&{color:colors.ink}]}>{d.label}</Text></Pressable>)}</View>;
  // Only compensate for Android's keyboard while it is actually visible.
  return <Modal visible animationType="slide" statusBarTranslucent navigationBarTranslucent onRequestClose={()=>!busy&&onClose()}><SafeAreaProvider><SafeAreaView style={[r.page,{paddingTop:layout.safeGap}]}><KeyboardAvoidingView style={r.page} behavior={Platform.OS==='ios'?'padding':keyboardVisible?'height':undefined}><View testID="record-viewport" style={r.shell} onLayout={e=>setFrameHeight(e.nativeEvent.layout.height)}>
    <View onLayout={e=>setHeaderHeight(e.nativeEvent.layout.height)}><View style={[r.header,compact&&{paddingVertical:0}]}><Pressable accessibilityRole="button" accessibilityLabel="关闭记录页并保留草稿" disabled={busy} onPress={onClose} style={s.iconButton}><Icon name="chevron-back" size={26}/></Pressable>{compact?(inlineSuggestions?suggestionChips(true):directionTabs(true)):<Text maxFontSizeMultiplier={1.3} numberOfLines={1} style={r.title}>{spec.transaction?'编辑记录':isSavings?'记录存取':'记一笔'}</Text>}{!compact&&<View style={{flex:1}}/>}<Pressable accessibilityRole="button" accessibilityLabel="记录页切换账本" disabled={busy||spec.lockLedger} onPress={()=>setPicker(true)} style={[r.ledger,compact&&{maxWidth:'40%'}]}><Text maxFontSizeMultiplier={1.3} numberOfLines={1} style={r.ledgerName}>{current?.name??'选择账本'}</Text>{!compact&&<Icon name="wallet-outline" size={21}/>}<Icon name="chevron-down" size={15}/></Pressable></View>{!compact&&directionTabs()}</View>
    <View testID="record-category-panel" style={r.categoryPanel}>{!ready?<ActivityIndicator/>:<CategoryPager key={draft.ledger+':'+draft.direction} height={categoryHeight} categories={available} value={draft.category} disabled={busy||!current} onChoose={choose} onAdd={addCategory}/>}</View>
    {textMode&&<View style={{flex:1,minHeight:0}}/>}
    <View testID="record-calculator" pointerEvents={busy?'none':'auto'} style={[r.calculator,{height:calculatorHeight}]}>
      {hasSuggestions&&!inlineSuggestions&&suggestionChips()}
      {!textMode&&<View style={[s.spread,{minHeight:layout.touchTarget}]}><Text maxFontSizeMultiplier={1.3} numberOfLines={1} style={[s.label,{flex:1}]}>{selected?.name??'请选择类别'}</Text>{selected&&!isSavings&&draft.direction!=='income'&&<Pressable accessibilityRole="button" accessibilityLabel="设置当前类别消费上限" disabled={busy||offline||loading} onPress={()=>{Keyboard.dismiss();setBudgetEditor(true);}} style={{flex:1,maxWidth:'65%',flexDirection:'row',alignItems:'center',gap:spacing.xs,minHeight:layout.touchTarget}}>{loading?<Text style={s.small}>读取上限…</Text>:scopeError?<Text maxFontSizeMultiplier={1.3} style={[s.small,{color:colors.red}]}>上限读取失败</Text>:<CategoryAllowanceBar compact value={allowance} category={selected.name} month={draft.date.slice(0,7)}/>}<Icon name="create-outline" size={17} color={colors.primaryStrong}/></Pressable>}{(admin||draft.direction==='refund')&&<Pressable accessibilityRole="button" accessibilityLabel="编辑记录信息" onPress={editDetails} style={s.iconButton}><Icon name="ellipsis-horizontal"/></Pressable>}</View>}
      {(!!error||offline)&&<Text maxFontSizeMultiplier={1.3} numberOfLines={2} accessibilityRole="alert" style={[s.small,{color:colors.red}]}>{error||'离线草稿 · 联网后完成记账'}</Text>}
      <View testID="record-remark-bar" style={[r.amountBar,{height:remarkHeight}]}><TextInput ref={remarkInput} accessibilityLabel="记账备注" maxFontSizeMultiplier={textMode?undefined:1.3} placeholder="点击填写备注…" placeholderTextColor={colors.muted} value={draft.remark} onChangeText={remark=>change({remark})} onFocus={()=>setRemarkFocused(true)} multiline scrollEnabled submitBehavior="blurAndSubmit" returnKeyType="done" onSubmitEditing={finishRemark} editable={!busy} style={[r.remark,{height:remarkHeight-2*colors.borderWidth,maxHeight:remarkHeight-2*colors.borderWidth,minHeight:0}]} maxLength={5000}/><Pressable accessibilityRole="button" accessibilityLabel="返回金额键盘" onPress={finishRemark} style={{alignItems:'flex-end',justifyContent:'center',minHeight:layout.touchTarget,maxWidth:'45%',flexShrink:1}}>{/[+-]/.test(draft.expression)&&<Text maxFontSizeMultiplier={1.3} numberOfLines={1} style={s.small}>{draft.expression}</Text>}<Text maxFontSizeMultiplier={1.3} accessibilityLabel="计算金额" numberOfLines={1} adjustsFontSizeToFit style={r.amount}>¥ {preview!==null?amount(preview):draft.expression||'0.00'}</Text></Pressable></View>
      {!textMode&&<View onLayout={e=>{const {width,height}=e.nativeEvent.layout;setKeypadSize(old=>old.width===width&&old.height===height?old:{width,height});}} style={r.keypad}>{['7','8','9','date','4','5','6','+','1','2','3','-','.','0','backspace','done'].map(key=><View key={key} style={[r.keyCell,{width:keyWidth,height:keyHeight}]}>{key==='date'?<View style={[r.key,r.dateKey]}><DateInput compact label="记账日期" value={draft.date} onChange={date=>change({date})} maxDate={today()}/></View>:<Pressable accessibilityRole="button" accessibilityLabel={key==='backspace'?'退格':key==='done'?'完成记账':key==='+'?'加':key==='-'?'减':key==='.'?'小数点':'数字'+key} disabled={busy||!ready} onPress={()=>{Keyboard.dismiss();if(key==='done')void save();else change({expression:calculatorPress(draft.expression,key)});}} onLongPress={key==='backspace'?()=>change({expression:''}):undefined} style={({pressed})=>[r.key,key==='done'&&r.done,pressed&&{opacity:.65}]}>{key==='backspace'?<Icon name="backspace-outline" size={25}/>:busy&&key==='done'?<ActivityIndicator color={colors.onAction}/>:<Text maxFontSizeMultiplier={1.3} style={[r.keyText,key==='done'&&{fontSize:19,color:colors.onAction}]}>{key==='done'?'完成':key}</Text>}</Pressable>}</View>)}</View>}
    </View>
    <LedgerPicker visible={picker} ledgers={ledgers} value={draft.ledger} onChoose={switchLedger} onClose={()=>setPicker(false)} onManage={onManageLedgers}/>
    {categoryManager&&<CategoryManager budgetMonth={draft.date.slice(0,7)} userId={userId} workspace={workspace} ledgerId={draft.ledger} ledgers={ledgers} direction={draft.direction} admin={admin} offline={offline} onClose={()=>{setCategoryManager(false);}} onChanged={rows=>{setLocalCategories(rows);onCategoriesChanged(rows);}} onCreated={c=>change({ledger:c.ledger_id,category:c.id,direction:c.allowed_directions?.includes(draft.direction)||!c.allowed_directions?.length?draft.direction:c.allowed_directions[0],original:''})}/>}
    {budgetEditor&&selected&&<BudgetEditor workspace={workspace} userId={userId} admin={admin} offline={offline} target={{ledgerId:draft.ledger,categoryId:selected.id,month:draft.date.slice(0,7)}} onClose={()=>setBudgetEditor(false)}/>}
    <FormModal spec={detailsForm} userId={userId} onClose={()=>setDetailsForm(null)} presentation="form"/>
  </View></KeyboardAvoidingView></SafeAreaView></SafeAreaProvider></Modal>;
}
function createRecordStyles(){const theme=getCurrentTheme();return StyleSheet.create({
  suggestions:{flexGrow:0,flexShrink:0,height:56},suggestionContent:{gap:spacing.xs,alignItems:'center'},
  suggestion:{maxWidth:156,minHeight:layout.touchTarget,justifyContent:'center',paddingHorizontal:spacing.md,paddingVertical:spacing.xs,borderRadius:radius.full,borderWidth:theme.borderWidth,borderColor:colors.outline,backgroundColor:theme.recordKey},
  suggestionOn:{borderColor:colors.line,backgroundColor:theme.primarySoft},suggestionText:{...typography.body,color:colors.ink},
  page:{flex:1,minHeight:0,overflow:'hidden',backgroundColor:theme.recordBackground},
  shell:{flex:1,minHeight:0,overflow:'hidden',width:'100%',maxWidth:layout.contentMax,alignSelf:'center'},
  header:{flexDirection:'row',alignItems:'center',paddingHorizontal:layout.pageInset,paddingVertical:spacing.xxs,gap:spacing.xs},
  inlineTabs:{flex:1,flexDirection:'row',gap:spacing.xxs},inlineTabLabel:{...typography.body,fontWeight:'700',color:colors.muted},
  title:{...typography.headline,color:colors.ink},ledger:{minHeight:layout.touchTarget,flexDirection:'row',alignItems:'center',gap:spacing.xs,maxWidth:'56%',flexShrink:1,paddingVertical:spacing.xxs},
  ledgerName:{...typography.body,fontWeight:'600',color:colors.ink,flexShrink:1},
  tabs:{flexDirection:'row',paddingHorizontal:layout.pageInset,gap:layout.gutter,paddingBottom:spacing.xxs},
  tab:{flex:1,minHeight:layout.touchTarget,alignItems:'center',justifyContent:'center',paddingVertical:spacing.xxs,borderBottomWidth:3,borderBottomColor:'transparent'},
  activeTab:{borderBottomColor:colors.ink},tabLabel:{...typography.section,color:colors.muted},
  categoryPanel:{flexGrow:0,flexShrink:0,paddingHorizontal:layout.pageInset},
  calculator:{flexGrow:0,flexShrink:0,minHeight:0,paddingHorizontal:layout.pageInset,paddingVertical:spacing.xxs,gap:spacing.xs,backgroundColor:theme.primaryPanel,borderWidth:theme.panelBorderWidth,borderColor:colors.line,borderTopLeftRadius:radius.sheet,borderTopRightRadius:radius.sheet},
  amountBar:{minHeight:50,backgroundColor:theme.recordKey,borderWidth:theme.borderWidth,borderColor:colors.line,borderRadius:radius.md,paddingHorizontal:spacing.sm,paddingVertical:0,flexDirection:'row',alignItems:'center',gap:spacing.xs},
  remark:{flex:1,minWidth:64,minHeight:48,maxHeight:132,...typography.body,fontSize:16,color:colors.ink,paddingVertical:spacing.xs,textAlignVertical:'top'},
  amount:{...typography.amount,color:colors.ink,fontVariant:['tabular-nums']},
  keypad:{flex:1,minHeight:0,flexDirection:'row',flexWrap:'wrap',gap:layout.gutter},keyCell:{flexGrow:0,flexShrink:0},
  key:{flex:1,minHeight:0,borderRadius:radius.md,backgroundColor:theme.recordKey,borderWidth:theme.borderWidth,borderColor:colors.line,alignItems:'center',justifyContent:'center'},
  dateKey:{paddingHorizontal:0},keyText:{...typography.key,color:colors.ink},done:{backgroundColor:colors.action,borderColor:colors.line,borderWidth:theme.buttonBorderWidth}
});}
const recordStyleCache=new Map<ThemeName,ReturnType<typeof createRecordStyles>>();
const r=new Proxy({} as ReturnType<typeof createRecordStyles>,{get:(_target,key: keyof ReturnType<typeof createRecordStyles>)=>{const name=getCurrentThemeName();let value=recordStyleCache.get(name);if(!value){value=createRecordStyles();recordStyleCache.set(name,value);}return value[key];}});
