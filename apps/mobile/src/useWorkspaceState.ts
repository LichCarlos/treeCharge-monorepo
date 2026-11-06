import {useCallback,useEffect,useSyncExternalStore} from 'react';
import {api} from './api';
import {budgetStore} from './budgetStore.mjs';

// Full dictionary/plan snapshot; shares mutation invalidation and account reset
// with monthly budgets, while keeping its own complete, unfiltered result.
export function useWorkspaceState(workspace:string){
  const get=useCallback(()=>budgetStore.snapshot(workspace,'workspace','all'),[workspace]);
  const state=useSyncExternalStore(budgetStore.subscribe,get,get);
  const refresh=useCallback((force=false)=>budgetStore.load(workspace,'workspace','all',()=>api(`/v1/workspaces/${workspace}/state`),force),[workspace]);
  useEffect(()=>{if(workspace&&state.stale)void refresh().catch(()=>{});},[workspace,state.stale,refresh]);
  return {...state,refresh};
}
