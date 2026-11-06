import type { FastifyInstance,FastifyRequest } from 'fastify';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { pool,transaction,entity,type DB } from './db.js';
import { authenticate,access,audit,HttpError,params,query,uuid,name,money,date } from './http.js';
import { canonical,digest } from './security.js';
import {dateFilter} from './dates.js';
import {rebuildUsage} from './usage.js';
import {visible,revise} from './entities.js';
import {categoryBudgetCreate,categoryBudgetChange,setCategoryLimit,updateLinkedSalary} from './budgetCore.js';
import {categoryIconIds,inferCategoryIcon} from '@charge/categories';
import {deleteOwned,restoreOwned,purgeSavings} from './deletion.js';
const iconId=z.string().refine(id=>categoryIconIds.includes(id),'请选择有效的类别图标');
export async function positionCategory(db:DB,w:string,id:string,ledgerId:string){
  await db.query('UPDATE tree_nodes SET position=(SELECT coalesce(max(position),-1)+1 FROM tree_nodes WHERE workspace_id=$2 AND parent_id=$3 AND id<>$1) WHERE id=$1',[id,w,ledgerId]);
}
export const meta={operationId:uuid,reason:z.string().trim().max(500).optional(),expectedRevision:z.number().int().positive().optional()};
type WriteFn=(db:DB,req:FastifyRequest,w:string,b:any)=>Promise<any>;
export function write(app:FastifyInstance,method:'POST'|'PUT'|'PATCH'|'DELETE',path:string,schema:z.ZodType,fn:WriteFn) {
  app.route({method,url:'/v1/workspaces/:w'+path,preHandler:authenticate,handler:async req=>{
    const b=schema.parse(req.body) as any,w=uuid.parse(params(req).w);
    return transaction(async db=>{
      await access(req,db,w,true);
      if(req.actor.system_role==='super_admin'&&!b.reason?.trim()) throw new HttpError(422,'管理员操作请填写理由');
      const fingerprint=digest(canonical({method,path:req.url,body:b}));
      const {rows:[previous]}=await db.query('SELECT * FROM api_operations WHERE workspace_id=$1 AND operation_id=$2',[w,b.operationId]);
      if(previous) {
        if(previous.request_hash!==fingerprint||previous.actor_id!==req.actor.id) throw new HttpError(409,'操作编号已用于其他请求');
        return previous.response;
      }
      await db.query('INSERT INTO api_operations(workspace_id,operation_id,actor_id,request_hash,operation_type) VALUES($1,$2,$3,$4,$5)',[w,b.operationId,req.actor.id,fingerprint,method+' '+path]);
      const result=await fn(db,req,w,b);
      if(result.id) await audit(db,req,w,result.id,method+' '+path,result.before??null,result,b.reason);
      await db.query('UPDATE api_operations SET response=$3,completed_at=now() WHERE workspace_id=$1 AND operation_id=$2',[w,b.operationId,JSON.stringify(result)]);
      return result;
    });
  }});
}
export {visible,revise} from './entities.js';
export async function category(db:DB,w:string,id:string,ledger?:string) {
  await visible(db,w,id,'category');
  const {rows:[c]}=await db.query('SELECT * FROM category_tags WHERE id=$1 AND workspace_id=$2',[id,w]);
  if(ledger&&c.ledger_id!==ledger) throw new HttpError(422,'消费内容不属于当前账本');return c;
}
async function recordDeficits(db:DB,w:string,b:any){
  return (await db.query(`SELECT balance.* FROM budget_balances balance JOIN budget_plans p ON p.id=balance.plan_id
    WHERE balance.workspace_id=$1 AND p.ledger_id=$2 AND p.month=date_trunc('month',$3::date) AND p.status IN ('active','draft')
    AND balance.available_minor<0 AND EXISTS(SELECT 1 FROM budget_category_mappings m WHERE m.bucket_id=balance.id AND m.category_id=$4)`,[w,b.ledgerId,b.occurredOn,b.categoryId])).rows;
}
const transactionBody=z.object({...meta,ledgerId:uuid,categoryId:uuid,direction:z.enum(['income','expense','deposit','withdrawal','refund']),amountMinor:money,occurredOn:date,remark:z.string().max(5000).default(''),originalId:uuid.optional()}).strict();
export async function postTransaction(db:DB,w:string,b:any,existing?:string) {
  await visible(db,w,b.ledgerId,'ledger');await category(db,w,b.categoryId,b.ledgerId);
  const id=existing??await entity(db,w,'transaction',b.categoryId);
  if(existing) {
    await db.query('UPDATE tree_nodes SET parent_id=$2 WHERE id=$1',[id,b.categoryId]);
    await db.query('UPDATE transactions SET ledger_id=$2,category_id=$3,direction=$4,amount_minor=$5,occurred_on=$6 WHERE id=$1',[id,b.ledgerId,b.categoryId,b.direction,b.amountMinor,b.occurredOn]);
    await revise(db,id);
  } else await db.query('INSERT INTO transactions VALUES($1,$2,$3,$4,$5,$6,$7)',[id,w,b.ledgerId,b.categoryId,b.direction,b.amountMinor,b.occurredOn]);
  const {rows:[old]}=await db.query('SELECT id FROM transaction_remarks WHERE transaction_id=$1',[id]);
  if(b.remark) {
    const rid=old?.id??await entity(db,w,'remark',id);
    if(old) {await db.query('UPDATE transaction_remarks SET body=$2 WHERE id=$1',[rid,b.remark]);await db.query('UPDATE entities SET deleted_at=NULL WHERE id=$1',[rid]);}
    else await db.query('INSERT INTO transaction_remarks VALUES($1,$2,$3,$4)',[rid,w,id,b.remark]);
  } else if(old) await db.query('UPDATE entities SET deleted_at=now() WHERE id=$1',[old.id]);
  await db.query('DELETE FROM transaction_refund_links WHERE refund_id=$1',[id]);
    if (b.direction === 'refund') {
        if (!b.originalId)
            throw new HttpError(422, '退款请选择原支出');
        await visible(db, w, b.originalId, 'transaction');
        await db.query('INSERT INTO transaction_refund_links VALUES($1,$2,$3)', [w, id, b.originalId]);
    }
  // Explicit refunds release the original expense bucket, even across months.
  await db.query("DELETE FROM budget_usage_links WHERE transaction_id=$1 AND usage_kind='refund'",[id]);
  if(b.direction==='refund') await db.query(`INSERT INTO budget_usage_links(workspace_id,plan_id,bucket_id,transaction_id,usage_kind,amount_minor)
    SELECT workspace_id,plan_id,bucket_id,$1,'refund',$2 FROM budget_usage_links WHERE transaction_id=$3 AND usage_kind='consume'`,[id,b.amountMinor,b.originalId]);
  await rebuildUsage(db,w);return id;
}
export async function ledgerRoutes(app:FastifyInstance) {
  app.get('/v1/workspaces/:w/categories/:id/remark-suggestions',{preHandler:authenticate},async req=>transaction(async db=>{
    const w=uuid.parse(params(req).w),id=uuid.parse(params(req).id);await access(req,db,w);
    const c=await category(db,w,id);await visible(db,w,c.ledger_id,'ledger');
    const direction=z.enum(['income','expense','deposit','withdrawal','refund']).parse(query(req).direction);
    const excludeId=query(req).excludeId?uuid.parse(query(req).excludeId):null;
    // Suggestions come from saved, visible records across all dates, scoped to this
    // category and direction. Drafts, removed records and other users never contribute.
    const {rows}=await db.query(`SELECT btrim(r.body) AS remark,count(*)::int AS uses,max(t.occurred_on) AS last_used
      FROM transactions t JOIN visible_tree_nodes v ON v.id=t.id AND v.workspace_id=t.workspace_id
      JOIN transaction_remarks r ON r.transaction_id=t.id AND r.workspace_id=t.workspace_id
      JOIN entities re ON re.id=r.id AND re.deleted_at IS NULL
      WHERE t.workspace_id=$1 AND t.ledger_id=$2 AND t.category_id=$3 AND t.direction=$4
      AND ($5::uuid IS NULL OR t.id<>$5) AND btrim(r.body)<>''
      GROUP BY btrim(r.body) ORDER BY uses DESC,last_used DESC,remark ASC LIMIT 12`,[w,c.ledger_id,id,direction,excludeId]);
    return rows;
  }));
  app.get('/v1/workspaces/:w/savings-plans/:id/records',{preHandler:authenticate},async req=>transaction(async db=>{
    const w=uuid.parse(params(req).w),id=uuid.parse(params(req).id);await access(req,db,w);
    await visible(db,w,id,'goal');
    const {rows:[goal]}=await db.query('SELECT ledger_id FROM savings_goals WHERE id=$1 AND workspace_id=$2',[id,w]);
    await visible(db,w,goal.ledger_id,'ledger');
    const {rows:transactions}=await db.query(`SELECT t.*,e.revision,c.name category_name,
      (SELECT r.body FROM transaction_remarks r JOIN entities re ON re.id=r.id AND re.deleted_at IS NULL WHERE r.transaction_id=t.id) remark
      FROM transactions t JOIN visible_tree_nodes v USING(id,workspace_id) JOIN entities e USING(id,workspace_id)
      JOIN category_tags c ON c.id=t.category_id
      WHERE t.workspace_id=$1 AND t.ledger_id=$2
      ORDER BY t.occurred_on DESC,e.created_at DESC,t.id`,[w,goal.ledger_id]);
    const totals={deposit:0,withdrawal:0};
    for(const record of transactions)totals[record.direction as 'deposit'|'withdrawal']+=record.amount_minor;
    return {transactions,totals};
  }));
  app.get('/v1/workspaces/:w/state',{preHandler:authenticate},async req=>transaction(async db=>{
    const w=uuid.parse(params(req).w);await access(req,db,w);
    const ledgerId=query(req).ledgerId; if(ledgerId) uuid.parse(ledgerId);
    const categoryId=query(req).categoryId;if(categoryId)uuid.parse(categoryId);
    const range=dateFilter(query(req));
    const {rows:ledgers}=await db.query(`SELECT l.*,e.revision,t.parent_id,
      EXISTS(SELECT 1 FROM template_instances ti WHERE ti.workspace_id=l.workspace_id AND ti.ledger_id=l.id AND ti.template_id='salary-allocation') AS salary_template
      FROM ledgers l JOIN entities e USING(id,workspace_id)
      JOIN visible_tree_nodes t USING(id,workspace_id) WHERE l.workspace_id=$1 ORDER BY e.created_at`,[w]);
    const {rows:groups}=await db.query(`SELECT g.*,t.parent_id,e.revision FROM ledger_groups g JOIN visible_tree_nodes t USING(id,workspace_id)
      JOIN entities e USING(id,workspace_id) WHERE g.workspace_id=$1 ORDER BY t.position,g.name LIMIT 5000`,[w]);
    const {rows:categories}=await db.query(`SELECT c.*,t.parent_id,t.position,e.revision FROM category_tags c JOIN visible_tree_nodes t USING(id,workspace_id)
      JOIN entities e USING(id,workspace_id) WHERE c.workspace_id=$1 ORDER BY t.position,c.name,c.id`,[w]);
    const {rows:transactions}=await db.query(`SELECT t.*,e.revision,c.name category_name,c.icon_id category_icon_id,l.name ledger_name,
      (SELECT r.body FROM transaction_remarks r JOIN entities re ON re.id=r.id AND re.deleted_at IS NULL WHERE r.transaction_id=t.id) remark,
      (SELECT original_id FROM transaction_refund_links WHERE refund_id=t.id) original_id
      FROM transactions t JOIN visible_tree_nodes v USING(id,workspace_id) JOIN entities e USING(id,workspace_id)
      JOIN category_tags c ON c.id=t.category_id JOIN ledgers l ON l.id=t.ledger_id
      WHERE t.workspace_id=$1 AND ($2::uuid IS NULL OR t.ledger_id=$2) AND ($3::date IS NULL OR t.occurred_on>=$3 AND t.occurred_on<$4::date)
      AND ($5::uuid IS NULL OR t.category_id=$5)
      ORDER BY t.occurred_on ASC,e.created_at ASC,t.id ASC`,[w,ledgerId??null,range.start,range.endExclusive,categoryId??null]);
    const {rows:budgets}=await db.query(`SELECT p.*,e.revision entity_revision,
      EXISTS(SELECT 1 FROM template_instances ti WHERE ti.workspace_id=p.workspace_id AND ti.ledger_id=p.ledger_id AND ti.template_id='salary-allocation') AS salary_template
      FROM budget_plans p JOIN entities e ON e.id=p.id AND e.deleted_at IS NULL
      JOIN visible_tree_nodes owner ON owner.id=p.ledger_id
      WHERE p.workspace_id=$1 AND ($2::uuid IS NULL OR p.ledger_id=$2) AND ($3::date IS NULL OR p.month<$4::date AND p.month+interval '1 month'>$3::date) ORDER BY p.month DESC`,[w,ledgerId??null,range.start,range.endExclusive]);
    const {rows:balances}=await db.query(`SELECT b.*,i.purpose,
      coalesce((SELECT jsonb_agg(m.category_id) FROM budget_category_mappings m JOIN visible_tree_nodes v ON v.id=m.category_id WHERE m.bucket_id=b.id),'[]') category_ids
      FROM budget_balances b JOIN budget_items i ON i.id=b.item_id WHERE b.workspace_id=$1 AND b.plan_id=ANY($2::uuid[])
      AND (NOT EXISTS(SELECT 1 FROM budget_category_mappings m WHERE m.bucket_id=b.id)
        OR EXISTS(SELECT 1 FROM budget_category_mappings m JOIN visible_tree_nodes v ON v.id=m.category_id WHERE m.bucket_id=b.id))`,[w,budgets.map(p=>p.id)]);
    const {rows:plans}=await db.query(`SELECT p.*,e.revision,c.name category_name,l.name ledger_name FROM planned_transactions p
      JOIN entities e ON e.id=p.id AND e.deleted_at IS NULL JOIN category_tags c ON c.id=p.category_id JOIN ledgers l ON l.id=p.ledger_id
      JOIN visible_tree_nodes owner ON owner.id=p.category_id
      WHERE p.workspace_id=$1 AND ($2::uuid IS NULL OR p.ledger_id=$2) AND ($3::date IS NULL OR p.planned_on>=$3 AND p.planned_on<$4::date) ORDER BY p.planned_on DESC LIMIT 200`,[w,ledgerId??null,range.start,range.endExclusive]);
    const {rows:goals}=await db.query(`SELECT g.*,e.revision,coalesce((SELECT sum(CASE WHEN t.direction='deposit' THEN t.amount_minor ELSE -t.amount_minor END)
      FROM transactions t JOIN visible_tree_nodes v ON v.id=t.id WHERE t.ledger_id=g.ledger_id),0)::bigint saved_minor
      FROM savings_goals g JOIN entities e ON e.id=g.id AND e.deleted_at IS NULL
      JOIN visible_tree_nodes owner ON owner.id=g.ledger_id WHERE g.workspace_id=$1`,[w]);
    const {rows:tags}=await db.query('SELECT t.*,e.revision FROM auxiliary_tags t JOIN entities e ON e.id=t.id AND e.deleted_at IS NULL WHERE t.workspace_id=$1',[w]);
    const {rows:fields}=await db.query('SELECT f.*,e.revision FROM field_definitions f JOIN entities e ON e.id=f.id AND e.deleted_at IS NULL WHERE f.workspace_id=$1',[w]);
    const {rows:relations}=await db.query('SELECT r.*,e.revision FROM relation_definitions r JOIN entities e ON e.id=r.id AND e.deleted_at IS NULL WHERE r.workspace_id=$1',[w]);
        const { rows: trash } = await db.query(`SELECT e.id,e.kind,e.deleted_at,e.revision,coalesce(l.name,c.name,g.name,sg.name,t.amount_minor::text) AS name,
      owner.id ledger_id,owner.ledger_type,savings_owner.target_minor,savings_owner.deadline,
      coalesce(batch.snapshot->'savings'->>'name',savings_owner.name) AS plan_name,
      coalesce((batch.snapshot->'savings'->>'saved_minor')::bigint,
        (SELECT coalesce(sum(CASE WHEN tx.direction='deposit' THEN tx.amount_minor ELSE -tx.amount_minor END),0)::bigint
         FROM transactions tx JOIN entities te ON te.id=tx.id WHERE tx.ledger_id=owner.id AND te.deleted_at=e.deleted_at)) AS saved_minor,
      batch.id AS deletion_batch_id
      FROM entities e LEFT JOIN ledgers l USING(id) LEFT JOIN category_tags c USING(id) LEFT JOIN ledger_groups g USING(id)
      LEFT JOIN transactions t USING(id) LEFT JOIN savings_goals sg USING(id) LEFT JOIN planned_transactions p USING(id)
      LEFT JOIN ledgers owner ON owner.id=coalesce(l.id,c.ledger_id,t.ledger_id,sg.ledger_id,p.ledger_id)
      LEFT JOIN LATERAL (SELECT b.id,b.snapshot FROM deletion_batches b WHERE b.workspace_id=e.workspace_id
        AND b.root_id=e.id AND b.restored_at IS NULL ORDER BY b.created_at DESC LIMIT 1) batch ON true
      LEFT JOIN savings_goals savings_owner ON savings_owner.ledger_id=owner.id
      WHERE e.workspace_id=$1 AND e.deleted_at IS NOT NULL AND NOT EXISTS(
        SELECT 1 FROM deletion_batch_members m JOIN deletion_batches b ON b.id=m.batch_id
        JOIN entities root ON root.id=b.root_id AND root.deleted_at IS NOT NULL
        WHERE m.entity_id=e.id AND b.restored_at IS NULL AND b.root_id<>e.id)
      AND (e.kind IN ('ledger','goal') OR owner.id IS NULL OR EXISTS(SELECT 1 FROM visible_tree_nodes WHERE id=owner.id))
      ORDER BY e.deleted_at DESC,e.id`, [w]);
    const {rows:transfers}=await db.query(`SELECT t.*,f.name from_name,d.name to_name FROM budget_transfers t JOIN budget_buckets f ON f.id=t.from_bucket_id
      JOIN budget_buckets d ON d.id=t.to_bucket_id WHERE t.workspace_id=$1 AND t.plan_id=ANY($2::uuid[]) ORDER BY t.created_at DESC LIMIT 200`,[w,budgets.map(p=>p.id)]);
    return {ledgers,groups,categories,transactions,budgets,balances,plans,goals,tags,fields,relations,trash,transfers,range};
  }));
  app.get('/v1/workspaces/:w/operations/:id',{preHandler:authenticate},async req=>transaction(async db=>{
    const w=uuid.parse(params(req).w);await access(req,db,w);
    const {rows:[op]}=await db.query('SELECT response,completed_at FROM api_operations WHERE workspace_id=$1 AND operation_id=$2 AND actor_id=$3',[w,uuid.parse(params(req).id),req.actor.id]);
    if(!op) throw new HttpError(404,'尚无此操作记录');return op;
  }));
  write(app,'POST','/groups',z.object({...meta,name,parentId:uuid}).strict(),async(db,req,w,b)=>{
    await visible(db,w,b.parentId);const id=await entity(db,w,'group',b.parentId);
    await db.query('INSERT INTO ledger_groups(id,workspace_id,name) VALUES($1,$2,$3)',[id,w,b.name]);return {id};
  });
  write(app,'POST','/ledgers',z.object({...meta,name,parentId:uuid,ledgerType:z.enum(['expense','savings'])}).strict(),async(db,req,w,b)=>{
    await visible(db,w,b.parentId);const id=await entity(db,w,'ledger',b.parentId);
    await db.query('INSERT INTO ledgers(id,workspace_id,name,ledger_type) VALUES($1,$2,$3,$4)',[id,w,b.name,b.ledgerType]);return {id};
  });
  const directionList=z.array(z.enum(['income','expense','deposit','withdrawal','refund'])).max(5);
  async function validateDirections(db:DB,ledger:string,values:string[]){
    const lt=(await db.query('SELECT ledger_type FROM ledgers WHERE id=$1',[ledger])).rows[0].ledger_type;
    const allowed=lt==='savings'?['deposit','withdrawal']:['expense','income','refund'];
    if(values.some(d=>!allowed.includes(d))) throw new HttpError(422,'类别的收支方向与账本类型不符');
  }
  write(app,'POST','/categories',z.object({...meta,name,iconId:iconId.optional(),ledgerId:uuid,parentId:uuid.optional(),allowedDirections:directionList.default([]),budget:categoryBudgetCreate.optional()}).strict(),async(db,req,w,b)=>{
    await visible(db,w,b.ledgerId,'ledger');
    if(b.parentId&&b.parentId!==b.ledgerId) throw new HttpError(422,'消费内容必须直接归属所选账本，不能放在其他消费内容下');
    await validateDirections(db,b.ledgerId,b.allowedDirections);
    const id=await entity(db,w,'category',b.ledgerId);
    await db.query('INSERT INTO category_tags(id,workspace_id,ledger_id,name,allowed_directions,icon_id) VALUES($1,$2,$3,$4,$5,$6)',[id,w,b.ledgerId,b.name,b.allowedDirections,b.iconId??inferCategoryIcon(b.name)]);
    await positionCategory(db,w,id,b.ledgerId);
    const budget=b.budget?await setCategoryLimit(db,w,{id,ledger_id:b.ledgerId,name:b.name},b.budget):undefined;
    return {id,...(budget?{budget}:{})};
  });
  write(app,'POST','/categories/batch',z.object({...meta,name,iconId:iconId.optional(),ledgerIds:z.array(uuid).min(1).max(100).refine(ids=>new Set(ids).size===ids.length,'账本不能重复选择'),allowedDirections:directionList.default([]),budget:categoryBudgetCreate.optional()}).strict(),async(db,req,w,b)=>{
    // Lock in a stable order and validate the whole selection before creating any nodes.
    for(const ledgerId of [...b.ledgerIds].sort()){
      await visible(db,w,ledgerId,'ledger');
      await validateDirections(db,ledgerId,b.allowedDirections);
    }
    const categories=[];
    for(const ledgerId of b.ledgerIds){
      const id=await entity(db,w,'category',ledgerId);
      await db.query('INSERT INTO category_tags(id,workspace_id,ledger_id,name,allowed_directions,icon_id) VALUES($1,$2,$3,$4,$5,$6)',[id,w,ledgerId,b.name,b.allowedDirections,b.iconId??inferCategoryIcon(b.name)]);
      await positionCategory(db,w,id,ledgerId);
      const budget=b.budget?await setCategoryLimit(db,w,{id,ledger_id:ledgerId,name:b.name},b.budget):undefined;
      const created={id,ledgerId,name:b.name,iconId:b.iconId??inferCategoryIcon(b.name),allowedDirections:b.allowedDirections,...(budget?{budget}:{})};
      await audit(db,req,w,id,'POST /categories/batch',null,created,b.reason);
      categories.push(created);
    }
    return {categories};
  });
  write(app,'PUT','/categories/reorder',z.object({...meta,ledgerId:uuid,items:z.array(z.object({id:uuid,expectedRevision:z.number().int().positive()}).strict()).max(10000)}).strict(),async(db,req,w,b)=>{
    await visible(db,w,b.ledgerId,'ledger');
    const {rows:existing}=await db.query('SELECT c.id FROM category_tags c JOIN visible_tree_nodes v USING(id,workspace_id) WHERE c.workspace_id=$1 AND c.ledger_id=$2',[w,b.ledgerId]);
    const ids=new Set(b.items.map((i:any)=>i.id));
    if(ids.size!==b.items.length||existing.length!==ids.size||existing.some(c=>!ids.has(c.id)))throw new HttpError(409,'类别列表已变化，请刷新后重新排序');
    for(const item of [...b.items].sort((a:any,b:any)=>a.id.localeCompare(b.id)))await visible(db,w,item.id,'category',item.expectedRevision);
    for(const [position,item] of b.items.entries()){
      await db.query('UPDATE tree_nodes SET position=$2 WHERE id=$1',[item.id,position]);await revise(db,item.id);
    }
    return {id:b.ledgerId,order:b.items.map((i:any)=>i.id)};
  });
  write(app,'PUT','/categories/:id',z.object({...meta,expectedRevision:z.number().int().positive(),name,iconId:iconId.optional(),allowedDirections:directionList,budget:categoryBudgetChange.optional()}).strict(),async(db,req,w,b)=>{
    const id=uuid.parse(params(req).id),before=await visible(db,w,id,'category',b.expectedRevision);
    const c=await category(db,w,id);await validateDirections(db,c.ledger_id,b.allowedDirections);
    await db.query('UPDATE category_tags SET name=$2,allowed_directions=$3,icon_id=$4 WHERE id=$1',[id,b.name,b.allowedDirections,b.iconId??c.icon_id]);
    const budget=b.budget?await setCategoryLimit(db,w,{...c,name:b.name,allowed_directions:b.allowedDirections},b.budget):undefined;
    await revise(db,id);return {id,before,...(budget?{budget}:{})};
  });
  write(app,'PATCH','/entities/:id',z.object({...meta,expectedRevision:z.number().int().positive(),name:name.optional(),parentId:uuid.optional()}).strict(),async(db,req,w,b)=>{
    const id=uuid.parse(params(req).id),old=await visible(db,w,id,undefined,b.expectedRevision);
    const tables:Record<string,string>={ledger:'ledgers',group:'ledger_groups',category:'category_tags'};
    if(!tables[old.kind]) throw new HttpError(422,'此实体请使用专用编辑接口');
    if(b.name) await db.query(`UPDATE ${tables[old.kind]} SET name=$2 WHERE id=$1`,[id,b.name]);
    if(b.parentId) {
      const p=await visible(db,w,b.parentId);
      if(old.kind==='category') {
        const source=(await category(db,w,id)).ledger_id;
        if(p.kind!=='ledger') throw new HttpError(422,'消费内容只能直接归属账本');
        if(b.parentId!==source) throw new HttpError(422,'消费内容须保留在所属账本，跨账本移动需处理流水与预算关联');
      }
      await db.query('UPDATE tree_nodes SET parent_id=$2 WHERE id=$1',[id,b.parentId]);
    }
    await revise(db,id);return {id,before:old};
  });
  write(app,'POST','/transactions',transactionBody,async(db,req,w,b)=>{
    const id=await postTransaction(db,w,b);
    return {id,negative:await recordDeficits(db,w,b)};
  });
  write(app,'PUT','/transactions/:id',transactionBody.extend({expectedRevision:z.number().int().positive()}),async(db,req,w,b)=>{
    const id=uuid.parse(params(req).id);await visible(db,w,id,'transaction',b.expectedRevision);
    const old=(await db.query('SELECT * FROM transactions WHERE id=$1',[id])).rows[0];
    await postTransaction(db,w,b,id);await updateLinkedSalary(db,w,id,b);return {id,before:old,negative:await recordDeficits(db,w,b)};
  });
    write(app, 'DELETE', '/entities/:id', z.object({ ...meta, expectedRevision: z.number().int().positive() }).strict(), async (db, req, w, b) => {
        const id = uuid.parse(params(req).id), old = await visible(db, w, id, undefined, b.expectedRevision);
        if (old.kind === 'root')
            throw new HttpError(422, '工作区根节点不能删除');
        if (['budget_plan', 'budget_item'].includes(old.kind))
            throw new HttpError(422, '预算请归档并处理使用映射后删除');
        if (old.kind === 'plan') {
            const p = (await db.query('SELECT status FROM planned_transactions WHERE id=$1', [id])).rows[0];
            if (p?.status === 'confirmed')
                throw new HttpError(422, '已执行计划需保留与实际账单的关联');
        }
        return deleteOwned(db, w, old);
    });
    write(app,'DELETE','/savings-plans/:id/permanent',z.object({...meta,expectedRevision:z.number().int().positive()}).strict(),async(db,req,w,b)=>
      purgeSavings(db,w,uuid.parse(params(req).id),b.expectedRevision));
    write(app, 'POST', '/entities/:id/restore', z.object(meta).strict(), async (db, req, w, b) => {
        const id = uuid.parse(params(req).id);
        const { rows: [old] } = await db.query('SELECT * FROM entities WHERE id=$1 AND workspace_id=$2 AND deleted_at IS NOT NULL FOR UPDATE', [id, w]);
        if (!old)
            throw new HttpError(404, '回收站中无此记录');
        if(b.expectedRevision!==undefined&&b.expectedRevision!==old.revision)throw new HttpError(409,'内容已变化，请刷新后重试');
        return restoreOwned(db, w, old);
    });
  write(app,'POST','/plans',transactionBody.omit({occurredOn:true,originalId:true}).extend({plannedOn:date}),async(db,req,w,b)=>{
    await category(db,w,b.categoryId,b.ledgerId);const id=await entity(db,w,'plan');
    await db.query(`INSERT INTO planned_transactions(id,workspace_id,ledger_id,category_id,direction,amount_minor,planned_on,remark)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[id,w,b.ledgerId,b.categoryId,b.direction,b.amountMinor,b.plannedOn,b.remark]);return {id};
  });
  write(app,'POST','/plans/:id/confirm',z.object({...meta,occurredOn:date,amountMinor:money}).strict(),async(db,req,w,b)=>{
    const id=uuid.parse(params(req).id);await visible(db,w,id,'plan');
    const {rows:[p]}=await db.query('SELECT * FROM planned_transactions WHERE id=$1 FOR UPDATE',[id]);
    if(p.status==='confirmed') return {id,transactionId:p.actual_transaction_id};
    if(p.status!=='pending') throw new HttpError(409,'计划已取消');
    const tid=await postTransaction(db,w,{ledgerId:p.ledger_id,categoryId:p.category_id,direction:p.direction,amountMinor:b.amountMinor,occurredOn:b.occurredOn,remark:p.remark});
    await db.query("UPDATE planned_transactions SET status='confirmed',actual_transaction_id=$2 WHERE id=$1",[id,tid]);await revise(db,id);return {id,transactionId:tid};
  });
  write(app,'POST','/savings-plans',z.object({...meta,parentId:uuid,name,targetMinor:money,deadline:date.nullable().optional()}).strict(),async(db,req,w,b)=>{
    await visible(db,w,b.parentId,'root');
    const ledgerId=await entity(db,w,'ledger',b.parentId);
    await db.query("INSERT INTO ledgers(id,workspace_id,name,ledger_type) VALUES($1,$2,$3,'savings')",[ledgerId,w,b.name]);
    const categoryId=await entity(db,w,'category',ledgerId);
    await db.query("INSERT INTO category_tags(id,workspace_id,ledger_id,name,allowed_directions,icon_id) VALUES($1,$2,$3,'存款',ARRAY['deposit','withdrawal']::text[],'savings')",[categoryId,w,ledgerId]);
    const id=await entity(db,w,'goal');
    await db.query('INSERT INTO savings_goals VALUES($1,$2,$3,$4,$5,$6)',[id,w,ledgerId,b.name,b.targetMinor,b.deadline??null]);
    return {id,ledgerId,categoryId};
  });
  write(app,'POST','/goals',z.object({...meta,ledgerId:uuid,name,targetMinor:money,deadline:date.nullable().optional()}).strict(),async(db,req,w,b)=>{
    await visible(db,w,b.ledgerId,'ledger');
    if((await db.query('SELECT ledger_type FROM ledgers WHERE id=$1',[b.ledgerId])).rows[0].ledger_type!=='savings') throw new HttpError(422,'存钱目标必须关联存钱账本');
    const id=await entity(db,w,'goal');await db.query('INSERT INTO savings_goals VALUES($1,$2,$3,$4,$5,$6)',[id,w,b.ledgerId,b.name,b.targetMinor,b.deadline??null]);return {id};
  });
  write(app,'PUT','/goals/:id',z.object({...meta,expectedRevision:z.number().int().positive(),name,targetMinor:money,deadline:date.nullable().optional()}).strict(),async(db,req,w,b)=>{
    const id=uuid.parse(params(req).id);await visible(db,w,id,'goal',b.expectedRevision);
    await db.query('UPDATE savings_goals SET name=$2,target_minor=$3,deadline=$4 WHERE id=$1',[id,b.name,b.targetMinor,b.deadline??null]);await revise(db,id);return {id};
  });
}
