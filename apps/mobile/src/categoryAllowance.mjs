export const categoryAllowanceKey=(ledger,category,month)=>`${ledger}:${category}:${month.slice(0,7)}`;

export function categoryAllowanceIndex(plans,balances){
  const plansById=new Map(plans.filter(p=>p.status==='active'||p.status==='draft').map(p=>[p.id,p]));
  const index=new Map();
  for(const b of balances){
    const plan=plansById.get(b.plan_id);if(!plan)continue;
    const pending=b.initial_minor==null||b.available_minor==null;
    const limit=pending?null:b.initial_minor+(b.transferred_in_minor??0)-(b.transferred_out_minor??0);
    const remaining=pending?null:b.available_minor;
    const percentage=pending||limit<=0?0:Math.max(0,Math.min(100,remaining/limit*100));
    const allowance={limit,remaining,percentage,shared:new Set(b.category_ids??[]).size>1,pending};
    for(const id of new Set(b.category_ids??[])){
      const key=categoryAllowanceKey(plan.ledger_id,id,plan.month);
      if(!index.has(key)||index.get(key).pending&&!pending)index.set(key,allowance);
    }
  }
  return index;
}
