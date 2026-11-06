import type {Field} from './ui';

export function categoryBudgetFields(month:string,required=false):Field[]{
  return [{key:'limit',label:month+'预算额度（元）',type:'money',required,placeholder:'例如：800',hint:required?'修改后按原规则重新分配，账本预算总额不变。':'留空不设置上限；0表示不预留额度。仅实际支出扣减额度。'}];
}

export function categoryFormFields(savings:boolean):Field[]{
  return [
    {key:'name',label:'类别名称',required:true,placeholder:savings?'例如：工资结余、奖金存入':'例如：交通、餐饮、工资'},
    {key:'direction',label:'类别用途',type:'select',required:true,options:savings?
      [{value:'both',label:'存入 / 取出'},{value:'deposit',label:'仅存入'},{value:'withdrawal',label:'仅取出'}]:
      [{value:'expense',label:'支出类别'},{value:'income',label:'收入类别'},{value:'both',label:'收支通用'}]}
  ];
}

export function categoryDirections(value:string):string[]{
  return value==='both'?[]:value==='expense'?['expense','refund']:[value];
}
