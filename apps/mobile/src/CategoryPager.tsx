import React,{useEffect,useRef,useState} from 'react';
import {Pressable,ScrollView,Text,View,useWindowDimensions} from 'react-native';
import {categoryIcon} from './categoryIcons';
import {Icon,colors} from './ui';
import {layout,spacing,typography} from './theme';
import {fourColumnWidth} from './grid.mjs';

// The parent supplies a finite viewport. Content never measures its own height.
export function CategoryPager({categories,value,disabled,height,onChoose,onAdd}:{categories:any[];value:string;disabled:boolean;height:number;onChoose:(id:string)=>void;onAdd:()=>void}){
  const scroll=useRef<ScrollView>(null);
  const [width,setWidth]=useState(0),[page,setPage]=useState(0);
  const {fontScale}=useWindowDimensions();
  const items=[...categories,{id:'category:add',name:'添加类别'}],count=Math.ceil(items.length/12);
  const rows=3,indicator=spacing.lg;
  const gridHeight=Math.max(0,height-indicator),rowHeight=gridHeight/rows;
  // Android can scale lineHeight beyond maxFontSizeMultiplier. Apply the same
  // bounded scale to the measured row and the rendered caption explicitly.
  const labelScale=Math.min(fontScale,rowHeight<layout.touchTarget?1:1.3);
  const circle=Math.max(8,Math.min(56,rowHeight-Math.ceil(typography.caption.lineHeight*labelScale)-spacing.xxs));
  const column=fourColumnWidth(width,layout.gutter);
  useEffect(()=>{
    const index=categories.findIndex(c=>c.id===value),target=index<0?0:Math.floor(index/12);
    setPage(target);scroll.current?.scrollTo({x:target*width,animated:false});
  },[value,categories.length,width]);
  return <View testID="category-pager" style={{height,minHeight:0,overflow:'hidden'}} onLayout={e=>setWidth(e.nativeEvent.layout.width)}>
    <ScrollView ref={scroll} testID="category-horizontal-pages" horizontal pagingEnabled directionalLockEnabled bounces={false} showsHorizontalScrollIndicator={false} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" style={{height:gridHeight,flexGrow:0}} contentContainerStyle={{height:gridHeight}} onScroll={e=>{if(width)setPage(Math.max(0,Math.min(count-1,Math.round(e.nativeEvent.contentOffset.x/width))));}} scrollEventThrottle={16}>
      {Array.from({length:count},(_,p)=><View key={p} testID={'category-page-'+p} style={{width,height:gridHeight,flexDirection:'row',flexWrap:'wrap',columnGap:layout.gutter,alignContent:'flex-start'}}>
        {items.slice(p*12,p*12+12).map(c=>{const add=c.id==='category:add',selected=!add&&c.id===value;return <Pressable key={c.id} accessibilityRole="button" accessibilityLabel={add?'添加类别':'选择类别'+c.name} accessibilityState={{selected,disabled}} disabled={disabled} onPress={()=>add?onAdd():onChoose(c.id)} style={({pressed})=>({width:column,height:rowHeight,alignItems:'center',justifyContent:'center',gap:spacing.xxs,opacity:pressed?.6:1})}>
          <View style={{width:circle,height:circle,borderRadius:circle/2,borderWidth:selected?2:colors.borderWidth,borderStyle:add?'dashed':'solid',borderColor:colors.line,backgroundColor:selected?colors.primary:colors.recordKey,alignItems:'center',justifyContent:'center'}}><Icon name={add?'add':categoryIcon(c)} size={Math.min(28,circle*.5)} color={colors.ink}/></View>
          <Text allowFontScaling={false} numberOfLines={1} ellipsizeMode="tail" style={{width:'100%',...typography.caption,fontSize:typography.caption.fontSize*labelScale,lineHeight:typography.caption.lineHeight*labelScale,textAlign:'center',color:colors.ink,fontWeight:selected?'700':'400'}}>{c.name}</Text>
        </Pressable>;})}
      </View>)}
    </ScrollView>
    <View testID="category-page-indicator" accessibilityLabel={`类别页码 ${page+1}/${count}`} accessibilityLiveRegion="polite" style={{height:indicator,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:spacing.xxs}}>{Array.from({length:count},(_,i)=><View key={i} style={{width:i===page?spacing.sm:spacing.xxs,height:spacing.xxs,borderRadius:spacing.xxs,backgroundColor:colors.ink,opacity:i===page?1:.28}}/>)}</View>
  </View>;
}
