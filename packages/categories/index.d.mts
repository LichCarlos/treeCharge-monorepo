export type CategoryIcon={id:string;label:string;glyph:string;group:string};
export const categoryIcons:readonly CategoryIcon[];
export const categoryIconIds:readonly string[];
export const defaultIconRules:readonly [string,string][];
export function inferCategoryIcon(name?:string):string;
export function resolveCategoryIcon(category:any):CategoryIcon;
export function moveCategory<T extends {id:string}>(categories:readonly T[],id:string,offset:number):T[];

export function categoryIconBindings(categories:readonly any[],ledgerIds:readonly string[]):Map<string,number>;
