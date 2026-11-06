export type CategoryAllowance={limit:number|null;remaining:number|null;percentage:number;shared:boolean;pending:boolean};
export function categoryAllowanceKey(ledger:string,category:string,month:string):string;
export function categoryAllowanceIndex(plans:any[],balances:any[]):Map<string,CategoryAllowance>;
