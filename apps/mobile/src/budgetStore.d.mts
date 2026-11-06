export type BudgetSnapshot={data:any;loading:boolean;error:string;stale:boolean};
export function createBudgetStore():{
  setAccount(id:string):void;
  subscribe(listener:()=>void):()=>void;
  snapshot(workspace:string,ledger:string,month:string):BudgetSnapshot;
  revision(workspace:string):number;
  invalidate(workspace:string):void;
  load(workspace:string,ledger:string,month:string,loader:()=>Promise<any>,force?:boolean):Promise<any>;
  clear():void;
};
export const budgetStore:ReturnType<typeof createBudgetStore>;
