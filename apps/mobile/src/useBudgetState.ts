import {useCallback,useEffect,useSyncExternalStore} from 'react';
import {api} from './api';
import {budgetStore} from './budgetStore.mjs';

export function useWorkspaceRevision(workspace:string){
  const snapshot=useCallback(()=>budgetStore.revision(workspace),[workspace]);
  return useSyncExternalStore(budgetStore.subscribe,snapshot,snapshot);
}
export function useBudgetState(workspace:string,ledger:string,month:string,enabled=true){
  const period=month.slice(0,7);
  const get=useCallback(()=>budgetStore.snapshot(workspace,ledger,period),[workspace,ledger,period]);
  const snapshot=useSyncExternalStore(budgetStore.subscribe,get,get);
  const refresh=useCallback((force=false)=>budgetStore.load(workspace,ledger,period,
    ()=>api(`/v1/workspaces/${workspace}/state?ledgerId=${ledger}&month=${period}`),force),[workspace,ledger,period]);
  useEffect(()=>{if(enabled&&workspace&&ledger&&snapshot.stale)void refresh().catch(()=>{});},[enabled,workspace,ledger,period,snapshot.stale,refresh]);
  return {...snapshot,refresh};
}
