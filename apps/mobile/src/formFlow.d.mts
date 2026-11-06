type FlowField = {key:string;required?:boolean;type?:string;visibleWhen?:(v:Record<string,string>)=>boolean;options?:{value:string;label:string}[];optionsFor?:(v:Record<string,string>)=>{value:string;label:string}[]};
export function visibleFields<T extends FlowField>(fields:T[],values:Record<string,string>):T[];
export function missingField<T extends FlowField>(fields:T[],values:Record<string,string>):T|undefined;
export function fieldSummary(field:FlowField,values:Record<string,string>):string;
