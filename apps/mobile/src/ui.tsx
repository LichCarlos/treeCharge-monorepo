import React,{useEffect,useRef,useState} from 'react';
import {ActivityIndicator,Modal,Platform,Pressable,ScrollView,StyleSheet,Text,TextInput,View,KeyboardAvoidingView,type StyleProp,type ViewStyle} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {DateInput} from './DatePicker';
import {Ionicons} from '@expo/vector-icons';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {getCurrentTheme,getCurrentThemeName,spacing,layout,radius,typography,surfaces,type ThemeName} from './theme';
import {fourColumnWidth} from './grid.mjs';
import {FormSteps,type FormStep} from './FormSteps';
import {visibleFields,missingField,fieldSummary} from './formFlow.mjs';
export const colors={get bg(){return getCurrentTheme().canvas;},get paper(){return getCurrentTheme().card;},get input(){return getCurrentTheme().field;},get ink(){return getCurrentTheme().ink;},get muted(){return getCurrentTheme().muted;},get line(){return getCurrentTheme().line;},get outline(){return getCurrentTheme().outline;},get borderWidth(){return getCurrentTheme().borderWidth;},get buttonBorderWidth(){return getCurrentTheme().buttonBorderWidth;},get selectionBorderWidth(){return getCurrentTheme().selectionBorderWidth;},get recordKey(){return getCurrentTheme().recordKey;},get summaryText(){return getCurrentTheme().summaryText;},green:surfaces.positive,get action(){return getCurrentTheme().action;},get onAction(){return getCurrentTheme().onAction;},get accent(){return getCurrentTheme().accent;},get accentSoft(){return getCurrentTheme().accentSoft;},get light(){return getCurrentTheme().primarySoft;},get primary(){return getCurrentTheme().primary;},get primaryStrong(){return getCurrentTheme().primaryStrong;},get primaryPanel(){return getCurrentTheme().primaryPanel;},get onPrimary(){return getCurrentTheme().onPrimary;},get gold(){return getCurrentTheme().primary;},red:surfaces.danger};
export type Option={label:string;value:string};
export type Field={key:string;label:string;type?:'text'|'password'|'money'|'select'|'multiselect'|'textarea'|'date'|'month';maxDate?:string;options?:Option[];optionsFor?:(values:Record<string,string>)=>Option[];visibleWhen?:(values:Record<string,string>)=>boolean;placeholder?:string;required?:boolean;hint?:string;hintFor?:(values:Record<string,string>)=>string;labelFor?:(values:Record<string,string>)=>string};
function validSelections(values:Record<string,string>,fields:Field[]){
  const next={...values};
  for(const f of fields)if(f.optionsFor){const allowed=new Set(f.optionsFor(next).map(o=>o.value));next[f.key]=(next[f.key]??'').split(',').filter(v=>allowed.has(v)).join(',');}
  return next;
}
export type FormSpec={key:string;title:string;subtitle?:string;fields:Field[];initial?:Record<string,string>;submit:(v:Record<string,string>,operationId:string)=>Promise<void>;operationId:string;destructive?:boolean;summary?:(values:Record<string,string>)=>React.ReactNode;stepSummary?:(values:Record<string,string>)=>React.ReactNode;pinSummary?:boolean;actions?:{title:string;onPress:()=>void}[]};
export function Icon({name,size=21,color=colors.ink}:{name:React.ComponentProps<typeof Ionicons>['name'];size?:number;color?:string}){return <Ionicons name={name} size={size} color={color}/>;}
export function Button({title,onPress,secondary=false,danger=false,disabled=false,loading=false,icon,style,variant}:{title:string;onPress:()=>void;secondary?:boolean;danger?:boolean;disabled?:boolean;loading?:boolean;style?:StyleProp<ViewStyle>;variant?:'primary'|'secondary'|'ghost'|'destructive';icon?:React.ComponentProps<typeof Ionicons>['name']}){
  const intent=variant??(danger?'destructive':secondary?'secondary':'primary'),quiet=intent==='secondary'||intent==='ghost',ink=intent==='destructive'?'#FFFFFF':quiet?colors.ink:colors.onAction;
  return <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityState={{disabled:disabled||loading,busy:loading}} disabled={disabled||loading} onPress={onPress} style={({pressed})=>[s.button,intent==='secondary'&&s.secondary,intent==='ghost'&&{backgroundColor:'transparent'},intent==='destructive'&&{backgroundColor:colors.red},(pressed||disabled||loading)&&{opacity:.6},style]}>{loading?<ActivityIndicator color={ink}/>:icon&&<Icon name={icon} size={20} color={ink}/>}<Text style={[s.buttonText,{color:ink}]}>{title}</Text></Pressable>;
}
export function ModalPanel({children,onClose,onShow,animation='slide'}:{children:React.ReactNode;onClose:()=>void;onShow?:()=>void;animation?:'slide'|'fade'}){
  const insets=useSafeAreaInsets();
  return <Modal transparent animationType={animation} visible onShow={onShow} onRequestClose={onClose}><KeyboardAvoidingView behavior={Platform.OS==='ios'?'padding':'height'} style={{flex:1}}><View style={[s.modalShade,{paddingTop:insets.top+layout.pageInset,paddingBottom:insets.bottom+layout.pageInset}]}><View style={s.modalBox}>{children}</View></View></KeyboardAvoidingView></Modal>;
}
export function Card({children,style}:{children:React.ReactNode;style?:any}){return <View style={[s.card,style]}>{children}</View>;}
export function FourColumnGrid({children}:{children:React.ReactNode}){
  const [width,setWidth]=useState(0);
  return <View onLayout={e=>setWidth(e.nativeEvent.layout.width)} style={{flexDirection:'row',flexWrap:'wrap',gap:layout.gutter}}>{React.Children.map(children,child=><View style={{width:fourColumnWidth(width,layout.gutter)}}>{child}</View>)}</View>;
}
export function Empty({title,detail,action}:{title:string;detail:string;action?:React.ReactNode}){return <Card style={{alignItems:'center',paddingVertical:spacing.lg,gap:spacing.sm}}><View style={s.iconCircle}><Icon name="leaf-outline" size={30}/></View><Text style={s.h3}>{title}</Text>{action}</Card>;}
export function Select({value,onChange,options,multiple=false}:{value:string;onChange:(value:string)=>void;options:Option[];multiple?:boolean}){const selected=value?value.split(','):[];return <View style={s.chips}>{options.map(o=><Pressable key={o.value} accessibilityRole={multiple?'checkbox':'button'} accessibilityLabel={o.label} aria-checked={multiple?selected.includes(o.value):undefined} accessibilityState={multiple?{checked:selected.includes(o.value)}:{selected:selected.includes(o.value)}} onPress={()=>onChange(multiple?(selected.includes(o.value)?selected.filter(x=>x!==o.value):[...selected,o.value]).join(','):o.value)} style={[s.chip,{flexDirection:'row',alignItems:'center',gap:6},selected.includes(o.value)&&s.chipOn]}>{multiple&&<Icon name={selected.includes(o.value)?'checkbox-outline':'square-outline'} size={16} color={selected.includes(o.value)?colors.onAction:colors.muted}/>}<Text style={[s.chipText,selected.includes(o.value)&&{color:colors.onAction}]}>{o.label}</Text></Pressable>)}</View>;}
export function SegmentedControl({value,onChange,options}:{value:string;onChange:(value:string)=>void;options:Option[]}){
  const dense=options.length>=4;
  return <View style={{flexDirection:'row',gap:spacing.xxs,padding:spacing.xxs,borderRadius:radius.md,backgroundColor:colors.input,borderWidth:colors.borderWidth,borderColor:colors.line}}>{options.map(o=><Pressable key={o.value} accessibilityRole="button" accessibilityLabel={o.label} aria-selected={value===o.value} accessibilityState={{selected:value===o.value}} onPress={()=>onChange(o.value)} style={({pressed})=>({flex:1,minWidth:0,minHeight:layout.touchTarget,justifyContent:'center',alignItems:'center',padding:dense?spacing.xxs:spacing.xs,borderRadius:radius.sm,backgroundColor:value===o.value?colors.accent:'transparent',borderWidth:value===o.value?colors.selectionBorderWidth:0,borderColor:colors.line,opacity:pressed?.65:1})}><Text maxFontSizeMultiplier={dense?1.3:undefined} numberOfLines={1} adjustsFontSizeToFit style={[s.label,dense&&{fontSize:12}, {textAlign:'center',color:value===o.value?colors.onPrimary:colors.muted}]}>{o.label}</Text></Pressable>)}</View>;
}
export function FormModal({spec,onClose,onNavigate,userId,presentation='auto'}:{spec:FormSpec|null;onClose:()=>void;onNavigate?:()=>void;userId:string;presentation?:'auto'|'form'}) {
  const [values,setValues]=useState<Record<string,string>>({}),[busy,setBusy]=useState(false),[error,setError]=useState(''),[loaded,setLoaded]=useState(false);
  const revision=useRef(0),operation=useRef(''),saving=useRef(false),inputRef=useRef<TextInput>(null);
  const draftKey=`draft:${userId}:${spec?.key}`;
  useEffect(()=>{revision.current++;setError('');setLoaded(false);setValues(spec?validSelections(spec.initial??{},spec.fields):{});operation.current=spec?.operationId??'';if(!spec)return;const own=revision.current;
    const sensitive=spec.destructive||spec.fields.some(f=>f.type==='password');
    (sensitive?Promise.resolve(null):AsyncStorage.getItem(draftKey)).then(d=>{if(own===revision.current){if(d)try{const draft=JSON.parse(d);setValues(validSelections({...spec.initial,...draft.values},spec.fields));operation.current=draft.operationId||spec.operationId;}catch{}setLoaded(true);}});
  },[spec?.key,userId]);
  useEffect(()=>{if(loaded&&spec&&!spec.destructive&&!spec.fields.some(f=>f.type==='password')) void AsyncStorage.setItem(draftKey,JSON.stringify({values,operationId:operation.current}));},[values,loaded]);
  if(!spec)return null;
  const save=async()=>{
    if(saving.current||!loaded)return;
    setError('');const missing=missingField(spec.fields,values);if(missing){setError('请填写'+(missing.labelFor?.(values)??missing.label));return;}
    saving.current=true;setBusy(true);
    try{await spec.submit(values,operation.current);await AsyncStorage.removeItem(draftKey);onClose();}catch(e){setError((e as Error).message);}finally{saving.current=false;setBusy(false);}
  };
  const summary=spec.summary?.(values),wizard=presentation!=='form'&&!spec.destructive&&spec.fields.length>1;
  const change=(f:Field,v:string)=>{setError('');setValues(validSelections({...values,[f.key]:v},spec.fields));};
  const control=(f:Field,next?:()=>void)=>{
    const label=f.labelFor?.(values)??f.label;
    return f.type==='date'||f.type==='month'?<DateInput label={label} value={values[f.key]??''} onChange={v=>change(f,v)} monthOnly={f.type==='month'} maxDate={f.maxDate} optional={!f.required}/>:f.type==='select'||f.type==='multiselect'?<Select value={values[f.key]??''} onChange={v=>change(f,v)} options={f.optionsFor?f.optionsFor(values):f.options??[]} multiple={f.type==='multiselect'}/>:<TextInput ref={inputRef} key={f.key} accessibilityLabel={label} style={[s.input,f.type==='textarea'&&{minHeight:96,textAlignVertical:'top'}]} value={values[f.key]??''} onChangeText={v=>change(f,v)} placeholder={f.placeholder??'请输入'} placeholderTextColor={colors.muted} secureTextEntry={f.type==='password'} multiline={f.type==='textarea'} keyboardType={f.type==='money'?'decimal-pad':'default'} autoCapitalize="none" autoFocus={wizard} returnKeyType={wizard?'next':'done'} onSubmitEditing={f.type==='textarea'?undefined:next}/>;
  };
  const fields=visibleFields(spec.fields,values),actions=spec.actions?.map(action=><Button key={action.title} secondary title={action.title} onPress={action.onPress} disabled={busy}/>);
  const steps:FormStep[]=fields.map(f=>({key:f.key,label:f.labelFor?.(values)??f.label,hint:f.hintFor?.(values)??f.hint,required:f.required,input:!['date','month','select','multiselect'].includes(f.type??'text'),render:next=>control(f,next),review:fieldSummary(f,values),validate:()=>f.required&&!values[f.key]?.trim()?'请填写'+(f.labelFor?.(values)??f.label):undefined}));
  return <ModalPanel onClose={()=>!busy&&onClose()} onShow={()=>{if(wizard)inputRef.current?.focus();}}><View style={[s.modalHeader,wizard&&{paddingVertical:spacing.xxs}]}><View style={{flex:1}}><Text style={s.h2}>{spec.title}</Text></View>{onNavigate&&<Pressable accessibilityRole="button" accessibilityLabel="保留草稿并打开抽屉" disabled={busy} onPress={onNavigate} style={s.iconButton}><Icon name="menu-outline"/></Pressable>}<Pressable accessibilityRole="button" accessibilityLabel="关闭表单并保留草稿" disabled={busy} onPress={onClose} style={s.iconButton}><Icon name="close"/></Pressable></View>
    {wizard?<FormSteps key={spec.key} steps={steps} busy={busy} disabled={!loaded} error={error} onSubmit={()=>void save()} summary={spec.stepSummary?.(values)} overview={summary} actions={actions}/>:<>
    {spec.pinSummary&&!!summary&&<View style={{paddingHorizontal:layout.cardInset,paddingVertical:spacing.sm,flexShrink:0}}>{summary}</View>}
    <ScrollView style={{flexShrink:1,minHeight:0}} keyboardShouldPersistTaps="handled" contentContainerStyle={{padding:layout.cardInset,gap:spacing.md}}>{!spec.pinSummary&&summary}{fields.map(f=>{const hint=f.hintFor?.(values)??f.hint;return <View key={f.key} style={{gap:8}}><Text style={s.label}>{f.labelFor?.(values)??f.label}{f.required?' *':''}</Text>{control(f)}{!!hint&&<Text style={s.small}>{hint}</Text>}</View>;})}{actions}{!!error&&<Text accessibilityRole="alert" style={s.error}>{error}</Text>}<Button title={busy?'正在保存…':spec.destructive?'确认删除':'确认保存'} onPress={()=>void save()} danger={spec.destructive} disabled={busy||!loaded}/></ScrollView></>}
  </ModalPanel>;
}
function createStyles(){
  const theme=getCurrentTheme();
  return StyleSheet.create({
    page:{flex:1,backgroundColor:colors.bg},
    shell:{flex:1,width:'100%',maxWidth:layout.shellMax,alignSelf:'center'},
    header:{paddingHorizontal:layout.pageInset,paddingVertical:spacing.xxs,flexDirection:'row',alignItems:'center',gap:spacing.xs,borderBottomWidth:1,borderColor:colors.line,backgroundColor:colors.bg},
    brand:{...typography.headline,fontSize:20,fontWeight:'800',letterSpacing:-.5,color:colors.ink},
    iconButton:{width:layout.touchTarget,height:layout.touchTarget,alignItems:'center',justifyContent:'center',borderRadius:radius.md,flexShrink:0,borderWidth:theme.iconButtonBorderWidth,borderColor:colors.line,backgroundColor:theme.iconButtonBackground},
    h1:{...typography.title,color:colors.ink},h2:{...typography.section,color:colors.ink},h3:{...typography.headline,color:colors.ink},
    muted:{...typography.body,color:colors.muted},small:{...typography.caption,color:colors.muted},label:{...typography.body,color:colors.ink,fontWeight:'600'},body:{...typography.body,color:colors.ink},
    featureCard:{backgroundColor:theme.accent,padding:spacing.lg,gap:spacing.md,borderColor:colors.line},
    featureIcon:{backgroundColor:colors.ink,borderRadius:radius.md,padding:spacing.sm},
    featureTitle:{...typography.title,color:theme.onPrimary},
    featureText:{...typography.caption,color:theme.onPrimary,fontWeight:'600'},
    navSelected:{backgroundColor:theme.style==='simple'?theme.primarySoft:theme.accent,borderRadius:radius.md,borderWidth:theme.selectionBorderWidth,borderColor:colors.line},
    card:{backgroundColor:colors.paper,borderRadius:radius.lg,padding:layout.cardInset,borderWidth:colors.borderWidth,borderColor:colors.line},
    row:{flexDirection:'row',alignItems:'center',gap:spacing.xs},
    spread:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:spacing.xs},stack:{gap:spacing.md},
    wrap:{flexDirection:'row',flexWrap:'wrap',alignItems:'center',gap:spacing.xs},
    button:{minHeight:layout.touchTarget,paddingHorizontal:spacing.md,paddingVertical:spacing.sm,borderRadius:radius.md,borderWidth:theme.buttonBorderWidth,borderColor:colors.line,backgroundColor:colors.action,flexDirection:'row',justifyContent:'center',alignItems:'center',gap:spacing.xs},
    secondary:{backgroundColor:theme.accentSoft},buttonText:{...typography.body,fontWeight:'700',color:colors.onAction,flexShrink:1,textAlign:'center'},
    input:{minHeight:layout.touchTarget,backgroundColor:colors.input,borderWidth:colors.borderWidth,borderColor:colors.outline,borderRadius:radius.md,paddingHorizontal:spacing.sm,paddingVertical:spacing.sm,color:colors.ink,...typography.body},
    chips:{flexDirection:'row',flexWrap:'wrap',gap:spacing.xs},
    chip:{minHeight:layout.touchTarget,justifyContent:'center',borderWidth:colors.borderWidth,borderColor:colors.outline,paddingHorizontal:spacing.sm,paddingVertical:spacing.xs,borderRadius:radius.md,backgroundColor:colors.paper,maxWidth:'100%'},
    chipOn:{backgroundColor:colors.action,borderColor:colors.line},chipText:{...typography.body,color:colors.ink,flexShrink:1},
    iconCircle:{backgroundColor:theme.primarySoft,borderWidth:theme.iconButtonBorderWidth,borderColor:colors.line,borderRadius:radius.md,width:48,height:48,flexShrink:0,alignItems:'center',justifyContent:'center'},
    error:{...typography.body,color:colors.red,backgroundColor:surfaces.dangerSoft,padding:spacing.sm,borderRadius:radius.md},
    modalShade:{flex:1,backgroundColor:surfaces.scrim,justifyContent:'center',alignItems:'center',padding:layout.pageInset},
    modalBox:{maxWidth:layout.modalMax,width:'100%',maxHeight:'100%',backgroundColor:colors.paper,borderRadius:radius.sheet,borderWidth:theme.panelBorderWidth,borderColor:colors.line,overflow:'hidden'},
    modalHeader:{padding:layout.cardInset,borderBottomWidth:1,borderColor:colors.line,flexDirection:'row',alignItems:'center',gap:spacing.xs},
    amount:{...typography.amount,color:colors.ink,fontVariant:['tabular-nums']},
    pill:{borderWidth:theme.buttonBorderWidth,borderColor:colors.line,minHeight:layout.touchTarget,justifyContent:'center',paddingHorizontal:spacing.sm,paddingVertical:spacing.xs,borderRadius:radius.md,backgroundColor:theme.accentSoft},
    divider:{height:1,backgroundColor:colors.line},item:{paddingVertical:spacing.md,borderBottomWidth:1,borderColor:colors.line},
    link:{...typography.body,color:theme.primaryStrong,fontWeight:'600'},badge:{...typography.caption,color:theme.primaryStrong},busy:{padding:spacing.lg,alignItems:'center'},
    footer:{backgroundColor:colors.paper,paddingHorizontal:layout.pageInset,paddingVertical:spacing.xs,borderTopWidth:colors.borderWidth,borderColor:colors.line,flexDirection:'row',justifyContent:'space-around',gap:spacing.xxs},
    tab:{minHeight:56,minWidth:48,alignItems:'center',justifyContent:'center',paddingVertical:spacing.xxs,gap:spacing.xxs},
    content:{padding:layout.pageInset,gap:spacing.lg,paddingBottom:layout.pageInset,maxWidth:layout.contentMax,width:'100%',alignSelf:'center'},
    summary:{backgroundColor:theme.summary,borderWidth:theme.panelBorderWidth,borderColor:colors.line,borderRadius:radius.lg,padding:layout.cardInset,gap:spacing.md},
    summaryLabel:{...typography.caption,color:theme.summaryLabel},summaryNumber:{...typography.amount,color:theme.summaryNumber,fontVariant:['tabular-nums']},
    sectionHeader:{paddingTop:spacing.lg,paddingBottom:spacing.xs,backgroundColor:colors.bg,flexDirection:'row',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:spacing.xs},
  });
}

type SharedStyles=ReturnType<typeof createStyles>;
const styleCache=new Map<ThemeName,SharedStyles>();
function stylesForTheme(){const name=getCurrentThemeName();let styles=styleCache.get(name);if(!styles){styles=createStyles();styleCache.set(name,styles);}return styles;}
export const s=new Proxy({} as SharedStyles,{get:(_target,key: keyof SharedStyles)=>stylesForTheme()[key]});

