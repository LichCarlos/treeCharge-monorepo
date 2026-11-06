import React,{useEffect,useState} from 'react';
import {Modal,Pressable,ScrollView,StyleSheet,Text,View} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {calendarRows,localToday,monthShift,monthStart,periodLabel,periodRange,shiftPeriod,parseDay,type PeriodSelection,type PeriodMode} from '@charge/calendar';
import {getCurrentTheme,getCurrentThemeName,layout,spacing,radius,surfaces,type ThemeName} from './theme';

const c={get ink(){return getCurrentTheme().ink;},get muted(){return getCurrentTheme().muted;},get line(){return getCurrentTheme().line;},get green(){return getCurrentTheme().primaryStrong;},get light(){return getCurrentTheme().primarySoft;}};
const modes:PeriodMode[]=['week','month','year'];
const names={week:'按周',month:'按月',year:'按年'};
function Glyph({name}:{name:React.ComponentProps<typeof Ionicons>['name']}){return <Ionicons name={name} color={c.ink} size={21}/>;}
function Action({label,onPress,children,disabled=false}:{label:string;onPress:()=>void;children:React.ReactNode;disabled?:boolean}){
  return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} style={[d.action,disabled&&{opacity:.25}]}>{children}</Pressable>;
}
type SheetProps={visible:boolean;value:PeriodSelection;onChange:(value:PeriodSelection)=>void;onClose:()=>void;dayOnly?:boolean;monthOnly?:boolean;maxDate?:string;optional?:boolean;onClear?:()=>void};
function DateSheet({visible,value,onChange,onClose,dayOnly=false,monthOnly=false,maxDate,optional,onClear}:SheetProps){
  const insets=useSafeAreaInsets();
  const [mode,setMode]=useState<PeriodMode>(value.mode),[cursor,setCursor]=useState(monthStart(value.anchor)),[years,setYears]=useState(false);
  useEffect(()=>{if(visible){setMode(value.mode);setCursor(monthStart(value.anchor));setYears(false);}},[visible]);
  const y=Number(cursor.slice(0,4)),decade=Math.floor(y/12)*12;
  const selected=periodRange(dayOnly?{mode:'day',anchor:value.anchor}:value);
  const choose=(anchor:string)=>{onChange({mode,anchor});onClose();};
  const showingYears=years||mode==='year'&&!dayOnly;
  const flip=(delta:number)=>{const next=monthShift(cursor,showingYears?delta*144:mode==='month'&&!dayOnly?delta*12:delta);if(next>='1900-01-01'&&next<='2199-12-01')setCursor(next);};
  const heading=showingYears?decade+' — '+(decade+11)+'年':mode==='month'&&!dayOnly?y+'年':y+'年'+Number(cursor.slice(5,7))+'月';
  const cells=calendarRows(cursor);
  return <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
    <View style={d.shade}><Pressable accessibilityRole="button" accessibilityLabel="关闭日期选择" onPress={onClose} style={StyleSheet.absoluteFill}/>
      <View accessibilityViewIsModal style={[d.sheet,{paddingBottom:Math.max(spacing.lg,insets.bottom+spacing.sm),maxHeight:'90%'}]}>
        <View style={d.handle}/><View style={d.top}><Text style={d.title}>{dayOnly?'选择日期':'选择统计日期'}</Text><Action label="关闭日期面板" onPress={onClose}><Glyph name="close"/></Action></View>
        {!dayOnly&&!monthOnly&&<View style={d.tabs}>{modes.map(m=><Pressable key={m} accessibilityRole="tab" accessibilityLabel={names[m]} accessibilityState={{selected:mode===m}} onPress={()=>{setMode(m);setYears(m==='year');}} style={[d.tab,mode===m&&d.tabOn]}><Text style={[d.tabText,mode===m&&{color:c.green}]}>{names[m]}</Text></Pressable>)}</View>}
        <View style={d.navigation}><Action label="上一页日期" onPress={()=>flip(-1)}><Glyph name="chevron-back"/></Action><Action label="选择年份" onPress={()=>setYears(!years)}><Text style={d.title}>{heading}</Text><Glyph name="chevron-down"/></Action><Action label="下一页日期" onPress={()=>flip(1)}><Glyph name="chevron-forward"/></Action></View>
        <ScrollView style={{maxHeight:360}} contentContainerStyle={{paddingBottom:12}}>
          {years||mode==='year'&&!dayOnly?<View style={d.grid}>{Array.from({length:12},(_,i)=>decade+i).map(year=>{
            const anchor=year+'-01-01',disabled=year<1900||year>2199||!!maxDate&&anchor>maxDate,on=Number(value.anchor.slice(0,4))===year;
            return <Pressable key={year} accessibilityRole="button" accessibilityLabel={year+'年'} accessibilityState={{selected:on,disabled}} disabled={disabled} onPress={()=>{if(mode==='year'&&!dayOnly)choose(anchor);else{setCursor(year+cursor.slice(4));setYears(false);}}} style={[d.cell,on&&d.selected,disabled&&d.disabled]}><Text style={[d.cellText,on&&d.selectedText]}>{year}年</Text></Pressable>;
          })}</View>:mode==='month'&&!dayOnly?<View style={d.grid}>{Array.from({length:12},(_,i)=>i+1).map(m=>{
            const anchor=y+'-'+String(m).padStart(2,'0')+'-01',on=value.mode==='month'&&value.anchor.slice(0,7)===anchor.slice(0,7),disabled=!!maxDate&&anchor>maxDate;
            return <Pressable key={m} accessibilityRole="button" accessibilityLabel={y+'年'+m+'月'} accessibilityState={{selected:on,disabled}} disabled={disabled} onPress={()=>choose(anchor)} style={[d.cell,on&&d.selected,disabled&&d.disabled]}><Text style={[d.cellText,on&&d.selectedText]}>{m}月</Text></Pressable>;
          })}</View>:<View style={{gap:5}}>
            <View style={d.week}>{['一','二','三','四','五','六','日'].map(day=><Text key={day} style={d.weekLabel}>{day}</Text>)}</View>
            {cells.map(row=>{
              const onWeek=!dayOnly&&value.mode==='week'&&row[0]===selected.start;
              return <View key={row[0]} style={[d.week,onWeek&&d.weekOn]}>{row.map(day=>{
                const on=dayOnly&&day===value.anchor,disabled=day<'1900-01-01'||day>'2199-12-31'||!!maxDate&&day>maxDate;
                return <Pressable key={day} accessibilityRole="button" accessibilityLabel={dayOnly?day:'选择 '+row[0]+' 至 '+row[6]} accessibilityState={{selected:on||onWeek,disabled}} disabled={disabled} onPress={()=>choose(day)} style={[d.day,on&&d.selected,disabled&&d.disabled]}><Text style={[d.dayText,day.slice(0,7)!==cursor.slice(0,7)&&{color:c.muted},on&&d.selectedText]}>{Number(day.slice(8))}</Text>{day===localToday()&&<View style={[d.dot,on&&{backgroundColor:c.ink}]}/>}</Pressable>;
              })}</View>;
            })}
          </View>}
        </ScrollView>
        <View style={d.bottom}><Action label={dayOnly?'选择今天':mode==='week'?'选择本周':mode==='month'?'选择本月':'选择本年'} onPress={()=>choose(localToday())}><Text style={d.shortcut}>{dayOnly?'今天':mode==='week'?'本周':mode==='month'?'本月':'本年'}</Text></Action><Text style={d.hint}>{dayOnly?'点选日期即可使用':'点选即生效，数据同步切换'}</Text>{optional&&<Action label="清除日期" onPress={()=>{onClear?.();onClose();}}><Text style={d.shortcut}>清除</Text></Action>}</View>
      </View>
    </View>
  </Modal>;
}
export function PeriodPicker({value,onChange,monthOnly=false}:{value:PeriodSelection;onChange:(v:PeriodSelection)=>void;monthOnly?:boolean}){
  const [visible,setVisible]=useState(false);
  const shift=(delta:number)=>{const v=shiftPeriod(value,delta);if(v.anchor>='1900-01-01'&&v.anchor<='2199-12-31')onChange(v);};
  return <View><View style={d.trigger}><Action label="上一统计周期" onPress={()=>shift(-1)}><Glyph name="chevron-back"/></Action><Pressable accessibilityRole="button" accessibilityLabel="选择统计日期" onPress={()=>setVisible(true)} style={d.period}><Glyph name="calendar-outline"/><View style={{gap:3,flex:1}}><Text style={d.periodLabel}>{periodLabel(value)}</Text><Text style={d.hint}>{names[value.mode]} · 点击切换</Text></View><Glyph name="chevron-down"/></Pressable><Action label="下一统计周期" onPress={()=>shift(1)}><Glyph name="chevron-forward"/></Action></View><DateSheet visible={visible} value={value} onChange={onChange} monthOnly={monthOnly} onClose={()=>setVisible(false)}/></View>;
}
export function DateInput({value,onChange,label,monthOnly=false,maxDate,optional=false,compact=false}:{value:string;onChange:(v:string)=>void;label:string;monthOnly?:boolean;maxDate?:string;optional?:boolean;compact?:boolean}){
  const [visible,setVisible]=useState(false);let anchor=localToday();try{parseDay(value);anchor=value;}catch{}
  return <><Pressable accessibilityRole="button" accessibilityLabel={label} onPress={()=>setVisible(true)} style={[d.input,compact&&{width:'100%',minWidth:0,borderWidth:0,backgroundColor:'transparent',paddingHorizontal:2,gap:3,minHeight:layout.touchTarget}]}><Glyph name="calendar-outline"/><Text maxFontSizeMultiplier={compact?1.3:undefined} numberOfLines={1} style={[d.periodLabel,{flex:1},compact&&{fontSize:12,textAlign:'center'}]}>{compact?(value===localToday()?'今天':value.slice(5)):value?(monthOnly?periodLabel({mode:'month',anchor}):value===localToday()?'今天 · '+value:value):'点击选择日期'}</Text>{!compact&&<Glyph name="chevron-down"/>}</Pressable><DateSheet visible={visible} value={{mode:'month',anchor}} onChange={v=>onChange(monthOnly?monthStart(v.anchor):v.anchor)} dayOnly={!monthOnly} monthOnly={monthOnly} onClose={()=>setVisible(false)} maxDate={maxDate} optional={optional} onClear={()=>onChange('')}/></>;
}
function createDateStyles(){return StyleSheet.create({
  shade:{flex:1,backgroundColor:surfaces.scrim,justifyContent:'flex-end',alignItems:'center'},
  sheet:{width:'100%',maxWidth:layout.modalMax,borderWidth:getCurrentTheme().panelBorderWidth,borderColor:c.line,borderTopLeftRadius:radius.sheet,borderTopRightRadius:radius.sheet,backgroundColor:getCurrentTheme().card,paddingHorizontal:layout.pageInset,paddingBottom:spacing.lg,paddingTop:spacing.xs},
  handle:{width:38,height:4,borderRadius:3,backgroundColor:c.line,alignSelf:'center',marginBottom:8},
  top:{flexDirection:'row',justifyContent:'space-between',alignItems:'center'},title:{fontSize:20,fontWeight:'700',color:c.ink},
  tabs:{flexDirection:'row',marginTop:12,borderBottomWidth:1,borderColor:c.line},tab:{flex:1,alignItems:'center',paddingVertical:spacing.md,borderBottomWidth:3,borderBottomColor:'transparent'},tabOn:{borderBottomColor:c.ink},tabText:{fontSize:16,fontWeight:'700',color:c.muted},
  navigation:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',marginVertical:spacing.md},action:{minWidth:layout.touchTarget,minHeight:layout.touchTarget,justifyContent:'center',alignItems:'center',flexDirection:'row',gap:6},
  grid:{flexDirection:'row',flexWrap:'wrap',gap:8},cell:{width:'31%',flexGrow:1,alignItems:'center',justifyContent:'center',height:64,borderRadius:14},cellText:{fontSize:18,fontWeight:'600',color:c.ink},selected:{backgroundColor:getCurrentTheme().accent,borderWidth:getCurrentTheme().borderWidth,borderColor:c.line},selectedText:{color:c.ink},disabled:{opacity:.3},
  week:{flexDirection:'row',borderRadius:12},weekOn:{backgroundColor:c.light},weekLabel:{width:'14.2857%',textAlign:'center',color:c.muted,fontSize:12,paddingVertical:8},day:{width:'14.2857%',height:48,alignItems:'center',justifyContent:'center',borderRadius:12},dayText:{color:c.ink,fontSize:14,fontWeight:'500'},dot:{position:'absolute',bottom:3,width:4,height:4,borderRadius:2,backgroundColor:c.green},
  bottom:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',borderTopWidth:1,borderColor:c.line,paddingTop:10},hint:{fontSize:12,lineHeight:18,color:c.muted},shortcut:{fontSize:14,fontWeight:'700',color:c.green},
  trigger:{flexDirection:'row',alignItems:'center',backgroundColor:getCurrentTheme().card,borderWidth:getCurrentTheme().borderWidth,borderColor:c.line,borderRadius:16,padding:4},period:{flex:1,flexDirection:'row',alignItems:'center',gap:10,minHeight:52,paddingHorizontal:4},periodLabel:{fontSize:14,fontWeight:'600',color:c.ink},input:{flexDirection:'row',alignItems:'center',gap:12,minHeight:48,borderRadius:12,borderWidth:getCurrentTheme().borderWidth,borderColor:c.line,backgroundColor:getCurrentTheme().field,paddingHorizontal:spacing.sm}
});}
const dateStyleCache=new Map<ThemeName,ReturnType<typeof createDateStyles>>();
const d=new Proxy({} as ReturnType<typeof createDateStyles>,{get:(_target,key: keyof ReturnType<typeof createDateStyles>)=>{const name=getCurrentThemeName();let value=dateStyleCache.get(name);if(!value){value=createDateStyles();dateStyleCache.set(name,value);}return value[key];}});
