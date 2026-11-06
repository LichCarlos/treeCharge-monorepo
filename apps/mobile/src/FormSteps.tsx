import React,{useEffect,useRef,useState} from 'react';
import {Keyboard,PanResponder,Pressable,ScrollView,Text,View} from 'react-native';
import {Button,Icon,colors,s} from './ui';
import {layout,spacing,radius} from './theme';

export type FormStep={key:string;label:string;hint?:string;required?:boolean;input?:boolean;render:(next:()=>void)=>React.ReactNode;review:React.ReactNode;validate?:()=>string|undefined};
/** Shared field flow for modal forms and the full-screen category editor. */
export function FormSteps({steps,busy=false,disabled=false,error='',onSubmit,summary,overview,actions,submitLabel='确认保存'}:{steps:FormStep[];busy?:boolean;disabled?:boolean;error?:string;onSubmit:()=>void;summary?:React.ReactNode;overview?:React.ReactNode;actions?:React.ReactNode;submitLabel?:string}){
  const [active,setActive]=useState(steps[0]?.key??''),[review,setReview]=useState(false),[editing,setEditing]=useState(false),[localError,setLocalError]=useState('');
  const [keyboardVisible,setKeyboardVisible]=useState(Keyboard.isVisible());
  const index=Math.max(0,steps.findIndex(step=>step.key===active)),step=steps[index],scroll=useRef<ScrollView>(null);
  const latest=useRef({move:(_direction:number)=>{}});
  function go(key:string){setActive(key);setLocalError('');scroll.current?.scrollTo({y:0,animated:false});}
  function move(direction:number){
    if(busy||disabled||!step)return;
    if(review){if(direction<0){setReview(false);setEditing(false);go(steps[steps.length-1].key);}return;}
    if(direction>0){const invalid=step.validate?.();if(invalid){setLocalError(invalid);return;}if(editing||index===steps.length-1){Keyboard.dismiss();setReview(true);setEditing(false);setLocalError('');return;}}
    const target=steps[index+direction];if(target)go(target.key);
  }
  latest.current={move};
  // Restrict gestures to the field heading so swiping a selection grid or a
  // text cursor cannot accidentally advance a field. Buttons work everywhere.
  const swipe=useRef(PanResponder.create({onStartShouldSetPanResponder:()=>true,onStartShouldSetPanResponderCapture:()=>true,onPanResponderTerminationRequest:()=>false,onPanResponderRelease:(_e,g)=>{if(Math.abs(g.dx)>48&&Math.abs(g.dx)>Math.abs(g.dy)*1.5)latest.current.move(g.dx<0?1:-1);}})).current;
  useEffect(()=>{if(!step?.input||review)Keyboard.dismiss();},[step?.key,review]);
  useEffect(()=>{const show=Keyboard.addListener('keyboardDidShow',()=>{setKeyboardVisible(true);scroll.current?.scrollToEnd({animated:false});}),hide=Keyboard.addListener('keyboardDidHide',()=>setKeyboardVisible(false));return()=>{show.remove();hide.remove();};},[]);
  useEffect(()=>{if(localError&&!step?.validate?.())setLocalError('');},[step?.review]);
  useEffect(()=>{if(!steps.some(item=>item.key===active)&&steps[0])go(steps[0].key);},[steps.map(item=>item.key).join('|')]);
  function submit(){if(busy||disabled)return;const invalid=steps.find(item=>item.validate?.());if(invalid){setReview(false);setEditing(true);go(invalid.key);setLocalError(invalid.validate?.()??'');return;}onSubmit();}
  if(!step)return null;
  return <View testID="form-steps" style={{flexShrink:1,minHeight:0}}>
    <View {...swipe.panHandlers} testID="form-step-heading" style={{paddingHorizontal:layout.pageInset,paddingTop:keyboardVisible?spacing.xxs:spacing.sm,paddingBottom:keyboardVisible?spacing.xxs:spacing.xs,gap:keyboardVisible?spacing.xxs:spacing.xs}}>
      {keyboardVisible&&!review?<View style={s.row}><Text accessibilityRole="header" style={[s.h3,{flex:1}]}>{step.label}</Text><Text style={s.small}>{index+1}/{steps.length}</Text></View>:<View style={s.spread}><Text style={s.label}>{review?'填写总览':`第 ${index+1} / ${steps.length} 项`}</Text><Text style={s.small}>{review?'确认后保存':step.required?'必填':'选填'}</Text></View>}
      <View accessibilityRole="progressbar" accessibilityValue={{min:0,max:steps.length,now:review?steps.length:index+1}} style={{height:spacing.xxs,backgroundColor:colors.input,borderRadius:radius.sm,overflow:'hidden'}}><View style={{height:'100%',width:`${100*(review?steps.length:index+1)/steps.length}%`,backgroundColor:colors.ink}}/></View>
      {!review&&!keyboardVisible&&<Text accessibilityRole="header" style={s.h2}>{step.label}</Text>}
    </View>
    {!review&&!keyboardVisible&&summary&&<View style={{paddingHorizontal:layout.pageInset,paddingBottom:spacing.xs}}>{summary}</View>}
    <ScrollView ref={scroll} onLayout={()=>{if(keyboardVisible&&step.input)scroll.current?.scrollToEnd({animated:false});}} onContentSizeChange={()=>{if(keyboardVisible&&step.input)scroll.current?.scrollToEnd({animated:false});}} style={{flexShrink:1,minHeight:keyboardVisible&&step.input?layout.touchTarget:0}} keyboardShouldPersistTaps="handled" contentContainerStyle={{paddingHorizontal:layout.pageInset,paddingTop:keyboardVisible?0:spacing.xs,paddingBottom:keyboardVisible?0:spacing.sm,gap:spacing.sm}}>
      {review?<>{overview}{steps.map(item=><Pressable key={item.key} accessibilityRole="button" accessibilityLabel={'修改'+item.label} disabled={busy} onPress={()=>{setReview(false);setEditing(true);go(item.key);}} style={[s.item,s.row,{paddingVertical:spacing.sm}]}><View style={{flex:1,gap:spacing.xxs}}><Text style={s.small}>{item.label}</Text>{typeof item.review==='string'?<Text style={s.body}>{item.review}</Text>:item.review}</View><Icon name="pencil-outline" size={20} color={colors.primaryStrong}/></Pressable>)}{actions}</>:<View key={step.key} style={{gap:spacing.xs}}>{!!step.hint&&<Text style={s.small}>{step.hint}</Text>}{keyboardVisible&&!!(localError||error)&&<Text accessibilityRole="alert" style={s.error}>{localError||error}</Text>}{step.render(()=>move(1))}</View>}
    </ScrollView>
    <View style={{paddingHorizontal:layout.pageInset,paddingTop:keyboardVisible?spacing.xxs:spacing.xs,paddingBottom:keyboardVisible?spacing.xs:spacing.sm,gap:spacing.xs,borderTopWidth:1,borderColor:colors.line}}>
      {!keyboardVisible&&!!(localError||error)&&<Text accessibilityRole="alert" style={s.error}>{localError||error}</Text>}
      <View style={s.row}><Button title={review?'返回填写':'上一项'} icon="chevron-back" secondary disabled={busy||disabled||!review&&index===0} onPress={()=>move(-1)} style={{flex:1}}/><Button title={busy?'正在保存…':review?submitLabel:editing||index===steps.length-1?'查看总览':'下一项'} icon={review?'checkmark':'chevron-forward'} loading={busy} disabled={busy||disabled} onPress={review?submit:()=>move(1)} style={{flex:1}}/></View>
    </View>
  </View>;
}
