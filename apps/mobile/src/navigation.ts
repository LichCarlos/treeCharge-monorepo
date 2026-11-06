import type {ComponentProps} from 'react';
import type {Icon} from './ui';

export type Page='home'|'overview'|'ledgers'|'tree'|'transactions'|'plans'|'savings'|'deletedSavings'|'templates'|'configuration'|'reports'|'trash'|'admin'|'settings';
export type NavigationNode={
  id:string;label:string;title?:string;icon:ComponentProps<typeof Icon>['name'];page?:Page;
  disabled?:boolean;adminOnly?:boolean;nativeOnly?:boolean;badge?:string;children?:NavigationNode[];
};

// Drawer nesting, breadcrumb ancestors and parent navigation share this tree.
// Phase two can enable a notes node by assigning its page and removing disabled.
export const navigationTree:NavigationNode[]=[{
  id:'home',page:'home',label:'模块首页',title:'选择你的空间',icon:'home-outline',children:[
    {id:'overview',page:'overview',label:'账本管理',title:'账本管理',icon:'wallet-outline',children:[
      {id:'ledgers',page:'ledgers',label:'选择账本',icon:'albums-outline',children:[
        {id:'tree',page:'tree',label:'类别管理',icon:'git-network-outline'},
        {id:'templates',page:'templates',label:'模板库',icon:'copy-outline'}
      ]},
      {id:'transactions',page:'transactions',label:'收支明细',icon:'receipt-outline'},
      {id:'reports',page:'reports',label:'统计分析',icon:'bar-chart-outline'},
      {id:'plans',page:'plans',label:'计划账目',icon:'calendar-outline'},
      {id:'savings',page:'savings',label:'存款计划',icon:'trending-up-outline',children:[
        {id:'deletedSavings',page:'deletedSavings',label:'已删除计划',icon:'trash-outline',nativeOnly:true}
      ]},
      {id:'configuration',page:'configuration',label:'标签与字段',icon:'pricetags-outline'},
      {id:'trash',page:'trash',label:'回收站',icon:'trash-outline',nativeOnly:true}
    ]},
    {id:'notes',label:'笔记管理',icon:'book-outline',disabled:true,badge:'二期待开发',children:[
      {id:'notes-memo',label:'备忘录',icon:'document-text-outline',disabled:true},
      {id:'notes-schedule',label:'日程规划',icon:'calendar-outline',disabled:true},
      {id:'notes-study',label:'学习笔记',icon:'school-outline',disabled:true}
    ]},
    {id:'settings',page:'settings',label:'我的',icon:'person-outline'},
    {id:'admin',page:'admin',label:'系统管理',icon:'shield-checkmark-outline',adminOnly:true}
  ]
}];

export function navigationPath(page:Page,nodes=navigationTree):NavigationNode[]{
  for(const node of nodes){
    if(node.page===page)return [node];
    const nested=navigationPath(page,node.children??[]);
    if(nested.length)return [node,...nested];
  }
  return [];
}
function titleEntries(nodes:NavigationNode[]):[Page,string][]{
  return nodes.flatMap(node=>[...(node.page?[[node.page,node.title??node.label] as [Page,string]]:[]),...titleEntries(node.children??[])]);
}
export const pageTitles=Object.fromEntries(titleEntries(navigationTree)) as Record<Page,string>;
