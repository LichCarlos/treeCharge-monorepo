// One snapshot per workspace / ledger / month, shared by all budget consumers.
// A completed mutation invalidates every month, including cross-month refunds.
export function createBudgetStore(){
  let account='';
  const entries=new Map(),listeners=new Set(),revisions=new Map();
  const emit=()=>{for(const listener of listeners)listener();};
  const key=(workspace,ledger,month)=>`${account}:${workspace}:${ledger}:${month.slice(0,7)}`;
  function entry(workspace,ledger,month){
    const id=key(workspace,ledger,month);
    if(!entries.has(id))entries.set(id,{workspace,generation:0,promise:null,snapshot:{data:null,loading:false,error:'',stale:true}});
    return entries.get(id);
  }
  return {
    setAccount(id){if(account!==id){account=id;entries.clear();revisions.clear();emit();}},
    subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);},
    snapshot(workspace,ledger,month){return entry(workspace,ledger,month).snapshot;},
    revision(workspace){return revisions.get(workspace)??0;},
    invalidate(workspace){
      revisions.set(workspace,(revisions.get(workspace)??0)+1);
      for(const e of entries.values())if(e.workspace===workspace){e.generation++;e.promise=null;e.snapshot={...e.snapshot,loading:false,error:'',stale:true};}
      emit();
    },
    async load(workspace,ledger,month,loader,force=false){
      const e=entry(workspace,ledger,month);
      if(e.promise)return e.promise;
      if(!force&&!e.snapshot.stale)return e.snapshot.data;
      const generation=++e.generation;
      e.snapshot={...e.snapshot,loading:true,error:'',stale:false};emit();
      const promise=Promise.resolve().then(loader).then(data=>{
        if(e.generation===generation){e.snapshot={data,loading:false,error:'',stale:false};emit();}
        return data;
      }).catch(error=>{
        if(e.generation===generation){e.snapshot={...e.snapshot,loading:false,error:error.message??'额度读取失败',stale:false};emit();}
        throw error;
      }).finally(()=>{if(e.generation===generation)e.promise=null;});
      e.promise=promise;return promise;
    },
    clear(){entries.clear();revisions.clear();emit();}
  };
}
export const budgetStore=createBudgetStore();
