import React,{createContext,useCallback,useContext,useEffect,useMemo,useRef,useState} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

// One spatial system for screens, sheets, and the four-column input grids (dp).
export const spacing={none:0,xxs:4,xs:8,sm:12,md:16,lg:24,xl:32,xxl:48} as const;
export const layout={columns:4,gutter:spacing.xs,pageInset:spacing.md,cardInset:spacing.md,touchTarget:48,contentMax:720,shellMax:1180,modalMax:580,safeGap:spacing.xs} as const;
export const radius={sm:8,md:12,lg:16,sheet:24,full:999} as const;
export const typography={
  title:{fontSize:30,lineHeight:38,fontWeight:'800' as const,letterSpacing:-.7},
  section:{fontSize:20,lineHeight:28,fontWeight:'700' as const,letterSpacing:-.3},
  headline:{fontSize:16,lineHeight:24,fontWeight:'600' as const},
  body:{fontSize:14,lineHeight:22},
  caption:{fontSize:12,lineHeight:18},
  amount:{fontSize:28,lineHeight:36,fontWeight:'700' as const,letterSpacing:-.7},
  amountCompact:{fontSize:22,lineHeight:28,fontWeight:'700' as const,letterSpacing:-.4},
  key:{fontSize:26,lineHeight:32,fontWeight:'500' as const},
} as const;
// Bright canvases, tonal cards and complementary actions share one palette.
export const surfaces={ink:'#151515',muted:'#303030',line:'#000000',outline:'#000000',positive:'#003C20',danger:'#78180F',dangerSoft:'#FFE2DC',scrim:'rgba(21,21,21,.48)'} as const;

export type ThemeColor='yellow'|'green'|'blue'|'coral'|'violet';
export type ThemeStyle='simple'|'contrast';
export type ThemeName=ThemeColor|`simple-${ThemeColor}`;
type ColorPalette={primary:string;primaryStrong:string;primarySoft:string;primaryPanel:string;onPrimary:string;field:string;accent:string;accentSoft:string};
export type ThemePalette=ColorPalette&{style:ThemeStyle;ink:string;muted:string;canvas:string;card:string;line:string;outline:string;action:string;onAction:string;borderWidth:number;buttonBorderWidth:number;iconButtonBorderWidth:number;iconButtonBackground:string;selectionBorderWidth:number;recordBackground:string;recordKey:string;panelBorderWidth:number;summary:string;summaryLabel:string;summaryNumber:string;summaryText:string};
const colorPalettes:Record<ThemeColor,ColorPalette>={
  yellow:{primary:'#FFDB07',primaryStrong:'#4D3900',primarySoft:'#FFF2B2',primaryPanel:'#FFDB07',onPrimary:'#151515',field:'#FFFAE2',accent:'#B6A1FF',accentSoft:'#E2D8FF'},
  green:{primary:'#1BE349',primaryStrong:'#00451D',primarySoft:'#DDF8DF',primaryPanel:'#1BE349',onPrimary:'#151515',field:'#F0FFEE',accent:'#FF99CB',accentSoft:'#FFD7E9'},
  blue:{primary:'#73BBFF',primaryStrong:'#003C76',primarySoft:'#E1EFFF',primaryPanel:'#73BBFF',onPrimary:'#151515',field:'#F0F7FF',accent:'#FFAC6B',accentSoft:'#FFD9BD'},
  coral:{primary:'#FF8868',primaryStrong:'#632112',primarySoft:'#FFE6DC',primaryPanel:'#FF8868',onPrimary:'#151515',field:'#FFF4EF',accent:'#80D9F7',accentSoft:'#D3F3FF'},
  violet:{primary:'#C79DFC',primaryStrong:'#462071',primarySoft:'#EFE3FF',primaryPanel:'#C79DFC',onPrimary:'#151515',field:'#F8F2FF',accent:'#C9F261',accentSoft:'#EBF9C7'}
};
// Original five-color catalog, verified against the 0.1.10 release bundle.
const simplePalettes:Record<ThemeColor,Pick<ColorPalette,'primary'|'primaryStrong'|'primarySoft'|'primaryPanel'|'onPrimary'>>={
  yellow:{primary:'#D8B82E',primaryStrong:'#806713',primarySoft:'#F5EDC6',primaryPanel:'#F2D775',onPrimary:'#203A32'},
  green:{primary:'#73936D',primaryStrong:'#315C49',primarySoft:'#E9F0DF',primaryPanel:'#DDE8D3',onPrimary:'#203A32'},
  blue:{primary:'#71A9B8',primaryStrong:'#15576B',primarySoft:'#E0F0F3',primaryPanel:'#C1E1E7',onPrimary:'#203A32'},
  coral:{primary:'#E59A8D',primaryStrong:'#A4493F',primarySoft:'#FAE9E4',primaryPanel:'#F4C9BE',onPrimary:'#203A32'},
  violet:{primary:'#A995BF',primaryStrong:'#5C4774',primarySoft:'#EFE9F5',primaryPanel:'#D9CEE5',onPrimary:'#203A32'}
};
const colorOptions:{id:ThemeColor;label:string}[]=[
  {id:'yellow',label:'暖黄'},
  {id:'green',label:'森林绿'},
  {id:'blue',label:'海蓝'},
  {id:'coral',label:'珊瑚'},
  {id:'violet',label:'紫藤'}
];
const palettes={} as Record<ThemeName,ThemePalette>;
for(const {id} of colorOptions){
  const p=colorPalettes[id];
  // Existing IDs retain the user's current contrast theme after an upgrade.
  palettes[id]={...p,style:'contrast',ink:surfaces.ink,muted:surfaces.muted,canvas:p.primary,card:p.primarySoft,line:surfaces.line,outline:surfaces.outline,action:p.accent,onAction:surfaces.ink,borderWidth:2,buttonBorderWidth:2,iconButtonBorderWidth:2,iconButtonBackground:p.accentSoft,selectionBorderWidth:2,recordBackground:p.accentSoft,recordKey:p.accentSoft,panelBorderWidth:2,summary:p.primarySoft,summaryLabel:surfaces.muted,summaryNumber:surfaces.ink,summaryText:surfaces.ink};
  const simple=simplePalettes[id];
  palettes[`simple-${id}`]={...simple,style:'simple',ink:'#203A32',muted:'#59675F',canvas:'#F8F8F4',card:'#FFFFFF',field:'#F7F9F5',accent:simple.primarySoft,accentSoft:simple.primarySoft,line:'#E2E5DC',outline:'#E2E5DC',action:simple.primaryStrong,onAction:'#FFFFFF',borderWidth:1,buttonBorderWidth:0,iconButtonBorderWidth:0,iconButtonBackground:'transparent',selectionBorderWidth:0,recordBackground:'#F8F8F4',recordKey:'#FFFFFF',panelBorderWidth:0,summary:simple.primaryStrong,summaryLabel:'#FFFFFF',summaryNumber:'#FFFFFF',summaryText:'#FFFFFF'};
}
export type ThemeOption={id:ThemeName;label:string;swatch:string;style:ThemeStyle};
export const themeGroups:{id:ThemeStyle;label:string;options:ThemeOption[]}[]=(['simple','contrast'] as const).map(style=>({id:style,label:style==='simple'?'简约':'撞色',options:colorOptions.map(({id,label})=>({id:style==='simple'?`simple-${id}`:id,label,swatch:(style==='simple'?simplePalettes:colorPalettes)[id].primary,style}))}));
export const themeOptions=themeGroups.flatMap(group=>group.options);
const storageKey='ui-theme:v1';
let currentName:ThemeName='yellow';
export function getCurrentThemeName(){return currentName;}
export function getCurrentTheme(){return palettes[currentName];}
export function getTheme(name:ThemeName){return palettes[name];}

type ThemeContextValue={themeName:ThemeName;setThemeName:(name:ThemeName)=>Promise<void>};
const ThemeContext=createContext<ThemeContextValue>({themeName:'yellow',setThemeName:async()=>{}});
export function ThemeProvider({children}:{children:React.ReactNode}){
  const [themeName,setThemeNameState]=useState<ThemeName>('yellow');
  const changedByUser=useRef(false);
  useEffect(()=>{let active=true;AsyncStorage.getItem(storageKey).then(value=>{
    if(active&&!changedByUser.current&&value&&Object.prototype.hasOwnProperty.call(palettes,value)){const name=value as ThemeName;currentName=name;setThemeNameState(name);}
  }).catch(()=>{});return()=>{active=false;};},[]);
  const setThemeName=useCallback(async(name:ThemeName)=>{
    changedByUser.current=true;currentName=name;setThemeNameState(name);
    try{await AsyncStorage.setItem(storageKey,name);}catch{}
  },[]);
  const value=useMemo(()=>({themeName,setThemeName}),[themeName,setThemeName]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
export function useTheme(){return useContext(ThemeContext);}
