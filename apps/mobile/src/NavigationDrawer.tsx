import React,{useEffect,useState} from 'react';
import {Modal,Platform,Pressable,ScrollView,Text,View,useWindowDimensions} from 'react-native';
import {SafeAreaProvider,SafeAreaView} from 'react-native-safe-area-context';
import {Icon,s,colors} from './ui';
import {layout,spacing,surfaces} from './theme';
import {navigationPath,navigationTree,type NavigationNode,type Page} from './navigation';

export function NavigationDrawer({visible,page,admin,onClose,onNavigate}:{visible:boolean;page:Page;admin:boolean;onClose:()=>void;onNavigate:(page:Page)=>void}){
  const {width}=useWindowDimensions();
  const [expanded,setExpanded]=useState<Set<string>>(()=>new Set(['home','overview']));
  const path=navigationPath(page),ancestorIds=path.map(n=>n.id);
  useEffect(()=>{if(visible)setExpanded(previous=>new Set([...previous,...navigationPath(page).slice(0,-1).map(n=>n.id)]));},[visible,page]);
  const toggle=(id:string)=>setExpanded(previous=>{const next=new Set(previous);next.has(id)?next.delete(id):next.add(id);return next;});
  function renderNode(node:NavigationNode,depth=0):React.ReactNode{
    if(node.adminOnly&&!admin||node.nativeOnly&&Platform.OS==='web')return null;
    const children=node.children?.filter(n=>(!n.adminOnly||admin)&&(!n.nativeOnly||Platform.OS!=='web'))??[],branch=children.length>0,open=expanded.has(node.id),selected=node.page===page,ancestor=ancestorIds.includes(node.id)&&!selected;
    const label=<><Icon name={node.icon} size={depth?18:20} color={selected||ancestor?colors.ink:colors.muted}/><View style={{flex:1,gap:3}}><Text style={[s.body,{fontSize:13,fontWeight:selected||ancestor?'700':'400',color:colors.ink}]}>{node.label}</Text>{node.badge&&<Text style={s.small}>{node.badge}</Text>}</View>{selected&&<View style={{width:5,height:5,borderRadius:3,backgroundColor:colors.ink}}/>}</>;
    return <View key={node.id}>
      <View style={{flexDirection:'row',alignItems:'center',borderRadius:12,backgroundColor:selected?colors.accent:'transparent',borderWidth:selected?colors.selectionBorderWidth:0,borderColor:colors.line,minHeight:layout.touchTarget}}>
        {node.page&&!node.disabled?<Pressable accessibilityRole="button" accessibilityLabel={'导航至'+node.label} aria-selected={selected} accessibilityState={{selected}} accessibilityHint={selected?'当前页面':ancestor?'当前页面的上级':undefined} onPress={()=>onNavigate(node.page!)} style={[s.row,{flex:1,gap:spacing.xs,minHeight:layout.touchTarget,paddingLeft:spacing.xs,paddingVertical:spacing.xs,paddingRight:spacing.xxs}]}>{label}</Pressable>:<Pressable disabled accessibilityRole="button" accessibilityLabel={node.label+'，二期待开发'} accessibilityState={{disabled:true}} style={[s.row,{flex:1,gap:9,paddingLeft:10,paddingVertical:9,opacity:.55}]}>{label}</Pressable>}
        {branch&&<Pressable accessibilityRole="button" accessibilityLabel={(open?'收起':'展开')+node.label+'子页面'} accessibilityState={{expanded:open}} onPress={()=>toggle(node.id)} style={{width:layout.touchTarget,minHeight:layout.touchTarget,alignItems:'center',justifyContent:'center'}}><Icon name={open?'chevron-down':'chevron-forward'} size={16} color={colors.muted}/></Pressable>}
      </View>
      {branch&&open&&<View style={{marginLeft:spacing.md,paddingLeft:spacing.xs,borderLeftWidth:1,borderColor:colors.line}}>{children.map(n=>renderNode(n,depth+1))}</View>}
    </View>;
  }
  return <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}><View style={{flex:1,flexDirection:'row',backgroundColor:surfaces.scrim}}>
    <SafeAreaProvider style={{width:Math.min(340,width-36),flexBasis:Math.min(340,width-36),flexGrow:0,flexShrink:0}}><SafeAreaView style={{flex:1,paddingTop:layout.safeGap,backgroundColor:colors.bg}}>
      <View style={[s.spread,{paddingHorizontal:layout.pageInset,paddingTop:spacing.xs,paddingBottom:spacing.sm}]}><View style={s.row}><Icon name="leaf"/><Text style={s.brand}>枝账</Text></View><Pressable accessibilityRole="button" accessibilityLabel="关闭导航" onPress={onClose} style={s.iconButton}><Icon name="close"/></Pressable></View>
      <ScrollView contentContainerStyle={{paddingHorizontal:layout.pageInset,paddingBottom:spacing.lg}}>{navigationTree.map(n=>renderNode(n))}</ScrollView>
      
    </SafeAreaView></SafeAreaProvider><Pressable accessibilityRole="button" accessibilityLabel="关闭抽屉" style={{flex:1}} onPress={onClose}/>
  </View></Modal>;
}
