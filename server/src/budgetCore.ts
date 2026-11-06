import {z} from 'zod';
import {entity,type DB} from './db.js';
import {uuid,HttpError} from './http.js';
import {visible,revise} from './entities.js';
import {rebuildUsage} from './usage.js';
import {saveSalaryIncome,salaryTemplate} from './salaryIncome.js';
export const categoryBudgetCreate=z.object({month:z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-01$/),limitMinor:z.number().int().min(0).max(99999999999)}).strict();
export const categoryBudgetChange=categoryBudgetCreate.extend({limitMinor:categoryBudgetCreate.shape.limitMinor.nullable(),planId:uuid.nullable(),expectedPlanRevision:z.number().int().positive().nullable(),baseMinor:z.number().int().min(1).max(99999999999).optional()}).strict();
export type Rule={key:string;name:string;mode:'fixed'|'ratio'|'remainder';fixedMinor?:number|null;ratioBps?:number|null;remainderBps?:number|null;weight?:number|null;purpose?:string;categoryIds?:string[]};
async function expenseCategory(db:DB,w:string,id:string,ledger:string){
  await visible(db,w,id,'category');
  const c=(await db.query('SELECT ledger_id,allowed_directions FROM category_tags WHERE id=$1 AND workspace_id=$2',[id,w])).rows[0];
  if(c.ledger_id!==ledger)throw new HttpError(422,'消费类别不属于当前账本');
  if(c.allowed_directions.length&&!c.allowed_directions.includes('expense'))throw new HttpError(422,'收入类别无需设置消费额度');
}
export function allocate(rows:Rule[],base:number,allowUnavailableRemainder=false) {
  if(!Number.isSafeInteger(base)||base<=0||base>99999999999) throw new HttpError(422,'可支配金额无效');
  const amounts=new Map<string,number>();let allocated=0;
  for(const r of rows) {
    let value=0;
    if(r.mode==='fixed') { if(r.fixedMinor===null||r.fixedMinor===undefined) throw new HttpError(422,`请设置${r.name}的预算`); value=r.fixedMinor; }
    if(r.mode==='ratio') { if(r.ratioBps===null||r.ratioBps===undefined) throw new HttpError(422,'请设置百分比');value=Number((BigInt(base)*BigInt(r.ratioBps)*2n+10000n)/20000n); }
    if(r.mode!=='remainder') { allocated+=value;amounts.set(r.key,value); }
  }
  const remainder=rows.filter(r=>r.mode==='remainder');
  if(remainder.length) {
    const explicit=remainder.some(r=>r.remainderBps!=null),total=remainder.reduce((s,r)=>s+(r.remainderBps??0),0);
    if(explicit&&remainder.some(r=>!Number.isInteger(r.remainderBps)||r.remainderBps!<0||r.remainderBps!>10000))throw new HttpError(422,'剩余分配比例请输入0–100');
    if(total>10000)throw new HttpError(422,'剩余分配比例合计不能超过100%');
    if(allocated>base&&(!explicit||total>0)&&!allowUnavailableRemainder)throw new HttpError(422,'固定金额和总额百分比已超出计划，不可完成剩余分配');
    const weight=explicit?10000:remainder.reduce((s,r)=>s+(r.weight??1),0),left=Math.max(0,base-allocated);
    const parts=remainder.map((r,index)=>({r,index,amount:Number(BigInt(left)*BigInt(explicit?r.remainderBps!:r.weight??1)/BigInt(weight)),rest:BigInt(left)*BigInt(explicit?r.remainderBps!:r.weight??1)%BigInt(weight)}));
    const order=[...parts].sort((a,b)=>a.rest===b.rest?a.index-b.index:a.rest>b.rest?-1:1);
    const target=explicit?Number((BigInt(left)*BigInt(total)*2n+10000n)/20000n):left;
    for(let i=0,n=target-parts.reduce((s,r)=>s+r.amount,0);i<n;i++) order[i].amount++;
    for(const p of parts) amounts.set(p.r.key,p.amount);
  }
  return rows.map(r=>({...r,amountMinor:amounts.get(r.key)??0}));
}
export async function buildBudget(db:DB,w:string,b:any) {
  await visible(db,w,b.ledgerId,'ledger');
  if((await db.query('SELECT ledger_type FROM ledgers WHERE id=$1',[b.ledgerId])).rows[0].ledger_type!=='expense') throw new HttpError(422,'消费预算需使用收支账本');
  const active=b.baseMinor!=null&&b.rows.every((r:Rule)=>r.mode==='fixed'?r.fixedMinor!=null:r.mode==='ratio'?r.ratioBps!=null:true);
  const allocated=b.baseMinor==null?b.rows.map((r:Rule)=>({...r,amountMinor:r.mode==='fixed'?r.fixedMinor??null:null})):
    allocate(b.rows.map((r:Rule)=>({...r,...(r.mode==='fixed'&&r.fixedMinor==null?{fixedMinor:0}:{}),...(r.mode==='ratio'&&r.ratioBps==null?{ratioBps:0}:{})})),b.baseMinor)
      .map((r,index)=>({...b.rows[index],amountMinor:b.rows[index].mode==='fixed'&&b.rows[index].fixedMinor==null||b.rows[index].mode==='ratio'&&b.rows[index].ratioBps==null?null:r.amountMinor}));
  const id=await entity(db,w,'budget_plan');
  await db.query(`INSERT INTO budget_plans(id,workspace_id,ledger_id,month,name,base_minor) VALUES($1,$2,$3,$4,$5,$6)`,[id,w,b.ledgerId,b.month,b.name,b.baseMinor]);
  const keys=new Set<string>(),categoryIds=new Set<string>();
  for(const row of allocated) {
    if(keys.has(row.key)) throw new HttpError(422,'预算项标识重复');keys.add(row.key);
    const itemId=await entity(db,w,'budget_item');
    await db.query(`INSERT INTO budget_items(id,workspace_id,plan_id,name,purpose,mode,fixed_minor,ratio_bps,remainder_weight,remainder_bps)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[itemId,w,id,row.name,row.purpose??'expense_budget',row.mode,row.fixedMinor??null,row.ratioBps??null,row.weight??1,row.remainderBps??null]);
    const {rows:[bucket]}=await db.query('INSERT INTO budget_buckets(workspace_id,plan_id,item_id,name,initial_minor) VALUES($1,$2,$3,$4,$5) RETURNING id',[w,id,itemId,row.name,row.amountMinor]);
    for(const cid of row.categoryIds??[]) {
      if(categoryIds.has(cid)) throw new HttpError(422,'同一分类只能映射一个预算桶');categoryIds.add(cid);
      await expenseCategory(db,w,cid,b.ledgerId);
      await db.query('INSERT INTO budget_category_mappings VALUES($1,$2,$3,$4,$5)',[w,id,b.ledgerId,cid,bucket.id]);
    }
  }
  await db.query('UPDATE budget_plans SET status=$2 WHERE id=$1',[id,active?'active':'draft']);
  await db.query('INSERT INTO budget_revisions VALUES($1,1,$2,$3,now())',[id,JSON.stringify(b),'创建预算']);await rebuildUsage(db,w);return id;
}
// Template snapshots only seed categories. All later editing uses live ledger IDs.
export async function readBudgetRows(db:DB,w:string,p:any){
  const {rows}=await db.query(`SELECT i.id AS key,i.name,i.purpose,i.mode,i.fixed_minor "fixedMinor",i.ratio_bps "ratioBps",i.remainder_weight weight,i.remainder_bps "remainderBps",
    b.id bucket_id,b.initial_minor,b.available_minor,
    (SELECT min(v.position) FROM budget_category_mappings m JOIN visible_tree_nodes v ON v.id=m.category_id WHERE m.bucket_id=b.id) sort_position,
    (SELECT count(*)::int FROM budget_category_mappings m WHERE m.bucket_id=b.id) mapping_count,
    coalesce((SELECT jsonb_agg(c.id ORDER BY v.position,c.id) FROM budget_category_mappings m
      JOIN category_tags c ON c.id=m.category_id AND c.ledger_id=$3 AND (cardinality(c.allowed_directions)=0 OR 'expense'=ANY(c.allowed_directions)) JOIN visible_tree_nodes v ON v.id=c.id
      WHERE m.bucket_id=b.id),'[]') "categoryIds",
    (SELECT c.name FROM budget_category_mappings m JOIN category_tags c ON c.id=m.category_id AND c.ledger_id=$3
      JOIN visible_tree_nodes v ON v.id=c.id WHERE m.bucket_id=b.id AND (cardinality(c.allowed_directions)=0 OR 'expense'=ANY(c.allowed_directions)) ORDER BY v.position,c.id LIMIT 1) live_name
    FROM budget_items i JOIN entities e ON e.id=i.id AND e.deleted_at IS NULL
    JOIN budget_balances b ON b.item_id=i.id WHERE i.plan_id=$1 AND i.workspace_id=$2 ORDER BY sort_position NULLS LAST,e.created_at,i.id`,[p.id,w,p.ledger_id]);
  const current=rows.filter(r=>r.mapping_count===0||r.categoryIds.length>0).map(r=>({...r,name:r.categoryIds.length===1?r.live_name:r.name}));
  if(p.management_mode!=='category_caps'&&(await db.query('SELECT 1 FROM template_instances WHERE ledger_id=$1 AND workspace_id=$2',[p.ledger_id,w])).rowCount){
    const linked=new Set(current.flatMap(r=>r.categoryIds));
    const {rows:categories}=await db.query(`SELECT c.id,c.name FROM category_tags c JOIN visible_tree_nodes v ON v.id=c.id
      WHERE c.workspace_id=$1 AND c.ledger_id=$2 AND (cardinality(c.allowed_directions)=0 OR 'expense'=ANY(c.allowed_directions))
      ORDER BY v.position,c.id`,[w,p.ledger_id]);
    for(const c of categories)if(!linked.has(c.id))current.push({key:c.id,name:c.name,purpose:'expense_budget',mode:'fixed',fixedMinor:p.status==='draft'?null:0,ratioBps:null,weight:1,categoryIds:[c.id],initial_minor:null,available_minor:null});
  }
  return current;
}
export async function saveBudgetRows(db:DB,w:string,p:any,rows:Rule[],base:number|null,status:'draft'|'active',reason:string,allowUnavailableRemainder=false){
  const calculated=base==null?rows.map(r=>({...r,amountMinor:r.mode==='fixed'?r.fixedMinor??null:null})):allocate(rows.map(r=>({...r,
    ...(r.mode==='fixed'&&r.fixedMinor==null?{fixedMinor:0}:{}),...(r.mode==='ratio'&&r.ratioBps==null?{ratioBps:0}:{})})),base,allowUnavailableRemainder)
    .map((r,index)=>({...rows[index],amountMinor:status==='draft'&&(rows[index].mode==='fixed'&&rows[index].fixedMinor==null||rows[index].mode==='ratio'&&rows[index].ratioBps==null)?null:r.amountMinor}));
  const {rows:existing}=await db.query('SELECT id FROM budget_items WHERE plan_id=$1',[p.id]);
  // Retired category budgets remain recoverable history, but no longer reserve salary.
  const retired=existing.filter(e=>!rows.some(r=>r.key===e.id)).map(e=>e.id);
  await db.query("UPDATE budget_items SET mode='fixed',fixed_minor=0,ratio_bps=NULL WHERE id=ANY($1::uuid[])",[retired]);
  await db.query('UPDATE budget_buckets SET initial_minor=0 WHERE item_id=ANY($1::uuid[])',[retired]);
  const categoryIds=rows.flatMap(r=>r.categoryIds??[]);
  if(new Set(categoryIds).size!==categoryIds.length)throw new HttpError(422,'同一类别只能分配一次');
  await db.query(`DELETE FROM budget_category_mappings WHERE plan_id=$1 AND (category_id=ANY($2::uuid[])
    OR bucket_id IN (SELECT id FROM budget_buckets WHERE item_id=ANY($3::uuid[])))`,[p.id,categoryIds,existing.filter(e=>rows.some(r=>r.key===e.id)).map(e=>e.id)]);
  for(const r of calculated){
    const key=existing.some(e=>e.id===r.key)?r.key:await entity(db,w,'budget_item');
    if(key!==r.key)await db.query(`INSERT INTO budget_items(id,workspace_id,plan_id,name,purpose,mode) VALUES($1,$2,$3,$4,$5,$6)`,[key,w,p.id,r.name,r.purpose??'expense_budget',r.mode]);
    await db.query('UPDATE budget_items SET name=$2,purpose=$3,mode=$4,fixed_minor=$5,ratio_bps=$6,remainder_weight=$7,remainder_bps=$8 WHERE id=$1',[key,r.name,r.purpose??'expense_budget',r.mode,r.fixedMinor??null,r.ratioBps??null,r.weight??1,r.remainderBps??null]);
    const {rows:[bucket]}=await db.query(`INSERT INTO budget_buckets(workspace_id,plan_id,item_id,name,initial_minor) VALUES($1,$2,$3,$4,$5)
      ON CONFLICT(item_id) DO UPDATE SET name=EXCLUDED.name,initial_minor=EXCLUDED.initial_minor RETURNING id`,[w,p.id,key,r.name,r.amountMinor]);
    for(const cid of r.categoryIds??[]){
      await expenseCategory(db,w,cid,p.ledger_id);
      await db.query('INSERT INTO budget_category_mappings VALUES($1,$2,$3,$4,$5)',[w,p.id,p.ledger_id,cid,bucket.id]);
    }
  }
  await db.query('UPDATE budget_plans SET base_minor=$2,status=$3,revision=revision+1 WHERE id=$1',[p.id,base,status]);
  await db.query('INSERT INTO budget_revisions(plan_id,revision,snapshot,reason) SELECT id,revision,$2,$3 FROM budget_plans WHERE id=$1',[p.id,JSON.stringify({baseMinor:base,rows:calculated}),reason]);
  await rebuildUsage(db,w);await revise(db,p.id);
}
export async function setCategoryLimit(db:DB,w:string,c:any,b:z.infer<typeof categoryBudgetCreate>|z.infer<typeof categoryBudgetChange>){
    const id=c.id;
    if(!b.month.endsWith('-01'))throw new HttpError(422,'请选择完整预算月份');
    if((await db.query('SELECT ledger_type FROM ledgers WHERE id=$1',[c.ledger_id])).rows[0].ledger_type!=='expense')throw new HttpError(422,'存钱类别不设置消费上限');
    if(b.limitMinor!==null)await expenseCategory(db,w,id,c.ledger_id);
    let p=(await db.query(`SELECT p.*,e.revision entity_revision FROM budget_plans p JOIN entities e ON e.id=p.id AND e.deleted_at IS NULL
      WHERE p.ledger_id=$1 AND p.month=$2 AND p.status IN ('active','draft') ORDER BY (p.status='active') DESC,e.created_at LIMIT 1`,[c.ledger_id,b.month])).rows[0];
    if('planId' in b&&((p?.id??null)!==b.planId||(p?.entity_revision??null)!==b.expectedPlanRevision))throw new HttpError(409,'预算已变化，请刷新后设置上限');
    if(p)await visible(db,w,p.id,'budget_plan','expectedPlanRevision' in b?b.expectedPlanRevision??undefined:undefined);
    // Creation with a budget cannot silently partially activate a salary template.
    if(p?.status==='draft'&&!('planId' in b))throw new HttpError(422,'请先设置工资分配');
    if(!p){
      if(b.limitMinor===null)return {id};
      if(await salaryTemplate(db,w,c.ledger_id)){
        const categories=(await db.query(`SELECT c.id,c.name FROM category_tags c JOIN visible_tree_nodes v ON v.id=c.id
          WHERE c.workspace_id=$1 AND c.ledger_id=$2 AND (cardinality(c.allowed_directions)=0 OR 'expense'=ANY(c.allowed_directions)) ORDER BY v.position,c.id`,[w,c.ledger_id])).rows;
        const planId=await buildBudget(db,w,{ledgerId:c.ledger_id,name:b.month.slice(0,7)+'月度预算',month:b.month,baseMinor:null,rows:categories.map(c=>({key:c.id,name:c.name,mode:'fixed',fixedMinor:null,categoryIds:[c.id]}))});
        p=(await db.query('SELECT * FROM budget_plans WHERE id=$1',[planId])).rows[0];
      }else{
      const planId=await buildBudget(db,w,{ledgerId:c.ledger_id,name:b.month.slice(0,7)+'消费上限',month:b.month,baseMinor:Math.max(1,b.limitMinor),rows:[{key:id,name:c.name,purpose:'expense_budget',mode:'fixed',fixedMinor:b.limitMinor,categoryIds:[id]}]});
      await db.query("UPDATE budget_plans SET management_mode='category_caps' WHERE id=$1",[planId]);return {id,planId};
      }
    }
    const items=await readBudgetRows(db,w,p);
    let row=items.find(r=>r.categoryIds.includes(id));
    if(row&&row.categoryIds.length>1){row.categoryIds=row.categoryIds.filter((cid:string)=>cid!==id);row=undefined;}
    if(b.limitMinor===null){
      if(p.management_mode!=='category_caps')throw new HttpError(422,'分配模板请通过预算设置修改额度');
      if(row){
        if((await db.query('SELECT 1 FROM budget_transfers WHERE from_bucket_id=$1 OR to_bucket_id=$1 LIMIT 1',[row.bucket_id])).rowCount)throw new HttpError(422,'此上限已有扣额历史，请保留额度或在预算中调整');
        await db.query('DELETE FROM budget_category_mappings WHERE plan_id=$1 AND category_id=$2',[p.id,id]);
        row.fixedMinor=0;row.categoryIds=[];
      }
    }else if(row){row.mode='fixed';row.fixedMinor=b.limitMinor;row.ratioBps=null;}
    else{
      items.push({key:id,name:c.name,purpose:'expense_budget',mode:'fixed',fixedMinor:b.limitMinor,categoryIds:[id]});
    }
    const base=p.management_mode==='category_caps'?Math.max(1,items.reduce((sum,r)=>sum+Number(r.fixedMinor??0),0)):
      p.status==='draft'&&'baseMinor' in b?b.baseMinor??p.base_minor:p.base_minor;
    const complete=base!=null&&items.every(r=>r.mode==='fixed'?r.fixedMinor!=null:r.mode==='ratio'?r.ratioBps!=null:true);
    // Each explicit category cap can be saved independently, even before wage entry.
    // A derived residual pool becomes zero when fixed caps exceed the wage.
    await saveBudgetRows(db,w,p,items,base,complete?'active':'draft','修改类别消费上限',true);
    if('baseMinor' in b&&b.baseMinor!=null)await saveSalaryIncome(db,w,p,b.baseMinor);
    return {id,planId:p.id};
}

export async function updateLinkedSalary(db:DB,w:string,id:string,b:any){
  const {rows:[p]}=await db.query(`SELECT p.* FROM salary_income_links s JOIN budget_plans p ON p.id=s.plan_id
    JOIN entities e ON e.id=p.id AND e.deleted_at IS NULL WHERE s.workspace_id=$1 AND s.transaction_id=$2`,[w,id]);
  if(!p)return;
  await visible(db,w,p.id,'budget_plan');
  if(b.direction!=='income'||b.ledgerId!==p.ledger_id||b.occurredOn.slice(0,7)!==p.month.slice(0,7)){
    // Moving a fact does not move or delete its former category budgets.
    await db.query('DELETE FROM salary_income_links WHERE workspace_id=$1 AND transaction_id=$2',[w,id]);
    await revise(db,p.id);return;
  }
  if(b.amountMinor!==p.base_minor)await saveBudgetRows(db,w,p,await readBudgetRows(db,w,p),b.amountMinor,p.status,'修改工资收入',true);
  else await revise(db,p.id);
}
