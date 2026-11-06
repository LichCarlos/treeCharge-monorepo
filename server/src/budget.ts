import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { entity,pool,transaction,type DB } from './db.js';
import { access,authenticate,HttpError,params,query,uuid,name,money,date } from './http.js';
import { write,meta,visible,revise,category,positionCategory } from './ledger.js';
import {inferCategoryIcon} from '@charge/categories';
import {rebuildUsage} from './usage.js';
import {allocate,buildBudget,categoryBudgetChange,setCategoryLimit,readBudgetRows,saveBudgetRows} from './budgetCore.js';
import {readSalaryIncome,saveSalaryIncome,salaryTemplate} from './salaryIncome.js';
export {allocate} from './budgetCore.js';
const rule=z.object({key:z.string().min(1).max(100),name,mode:z.enum(['fixed','ratio','remainder']),fixedMinor:z.number().int().min(0).max(99999999999).nullable().optional(),ratioBps:z.number().int().min(0).max(10000).nullable().optional(),remainderBps:z.number().int().min(0).max(10000).nullable().optional(),weight:z.number().int().min(1).max(10000).nullable().optional(),purpose:z.enum(['expense_budget','savings_budget']).default('expense_budget'),categoryIds:z.array(uuid).max(1000).default([])}).strict();
const budgetBody=z.object({...meta,ledgerId:uuid,name,month:z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-01$/),baseMinor:money,salaryOccurredOn:date.optional(),rows:z.array(rule).min(1).max(200)}).strict();
export async function budgetRoutes(app:FastifyInstance) {
  write(app,'PUT','/categories/:id/limit',categoryBudgetChange.extend({...meta,expectedRevision:z.number().int().positive()}).strict(),async(db,req,w,b)=>{
    const id=uuid.parse(params(req).id);await visible(db,w,id,'category',b.expectedRevision);
    const result=await setCategoryLimit(db,w,await category(db,w,id),b);await revise(db,id);return result;
  });
  app.get('/v1/templates',{preHandler:authenticate},async req=>{
    return (await pool.query(`SELECT DISTINCT ON (id) id,version,name,ledger_type,config,workspace_id FROM ledger_templates t WHERE t.id='salary-allocation' AND t.ledger_type='expense' AND (workspace_id IS NULL OR has_workspace_access($1,workspace_id,false)) ORDER BY id,version DESC`,[req.actor.id])).rows;
  });
  write(app,'POST','/template-instances',z.object({...meta,templateId:z.string().min(1).max(100),version:z.number().int().positive(),name,parentId:uuid,month:date}).strict(),async(db,req,w,b)=>{
    if(b.templateId!=='salary-allocation')throw new HttpError(422,'仅支持工资分配模板，存款计划请使用自定义目标');
    await visible(db,w,b.parentId);
    const {rows:[t]}=await db.query('SELECT * FROM ledger_templates WHERE id=$1 AND version=$2 AND (workspace_id IS NULL OR workspace_id=$3)',[b.templateId,b.version,w]);
    if(!t) throw new HttpError(404,'模板不存在');
    const id=await entity(db,w,'ledger',b.parentId),c=t.config;
    await db.query('INSERT INTO ledgers(id,workspace_id,name,ledger_type) VALUES($1,$2,$3,$4)',[id,w,b.name,t.ledger_type]);
    const {rows:[instance]}=await db.query('INSERT INTO template_instances(workspace_id,ledger_id,template_id,template_version,name,snapshot,operation_id) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',[w,id,t.id,t.version,b.name,JSON.stringify(c),b.operationId]);
    const make=async(title:string,key:string)=>{
      const cid=await entity(db,w,'category',id);
      await db.query('INSERT INTO category_tags(id,workspace_id,ledger_id,name,allowed_directions,icon_id) VALUES($1,$2,$3,$4,$5,$6)',[cid,w,id,title,c.rows?['expense','refund']:[],inferCategoryIcon(title)]);
      await positionCategory(db,w,cid,id);
      await db.query('INSERT INTO template_entity_mappings VALUES($1,$2,$3,$4)',[w,instance.id,key,cid]);return cid;
    };
    if(c.rows) {
      const rows=[];
      for(const r of c.rows) {const cid=await make(r.name,r.key),ids=[cid];for(const child of r.children??[]) ids.push(await make(child,r.key+'/'+child)); rows.push({...r,categoryIds:ids,mode:r.mode,weight:r.weight??1});}
      // Template selection prepares the tree and draft only. Even example amounts are not activated until the user confirms.
      await buildBudget(db,w,{ledgerId:id,name:b.name+' · 月度预算',month:b.month,baseMinor:null,rows});
    } else {
      for(const title of c.categoryNames??[]) await make(title,title);
      const target=c.kind==='weekly_challenge'?c.defaults.weeks*(2*c.defaults.firstMinor+(c.defaults.weeks-1)*c.defaults.stepMinor)/2:c.defaults.monthlyEssentialMinor*c.defaults.coverageMonths;
      const gid=await entity(db,w,'goal');await db.query('INSERT INTO savings_goals(id,workspace_id,ledger_id,name,target_minor) VALUES($1,$2,$3,$4,$5)',[gid,w,id,b.name,target]);
    }
    return {id,instanceId:instance.id,planId:(await db.query('SELECT id FROM budget_plans WHERE ledger_id=$1',[id])).rows[0]?.id};
  });
  app.get('/v1/workspaces/:w/budgets/:id',{preHandler:authenticate},async req=>transaction(async db=>{
    const w=uuid.parse(params(req).w),id=uuid.parse(params(req).id);await access(req,db,w);await visible(db,w,id,'budget_plan');
    const {rows:[p]}=await db.query('SELECT p.*,e.revision entity_revision FROM budget_plans p JOIN entities e ON e.id=p.id WHERE p.id=$1',[id]);
    return {...p,salary_template:!!await salaryTemplate(db,w,p.ledger_id),salary_income:await readSalaryIncome(db,w,p.id),rows:await readBudgetRows(db,w,p)};
  }));
  write(app,'POST','/budgets',budgetBody,async(db,req,w,b)=>{
    if(!await salaryTemplate(db,w,b.ledgerId)&&b.rows.some((r:any)=>r.mode==='fixed'?r.fixedMinor==null:r.mode==='ratio'?r.ratioBps==null:false))throw new HttpError(422,'请完成各类别额度');
    const id=await buildBudget(db,w,b);const salaryIncomeId=await saveSalaryIncome(db,w,{id,ledger_id:b.ledgerId,month:b.month},b.baseMinor,b.salaryOccurredOn);
    return {id,salaryIncomeId};
  });
  write(app,'PUT','/budgets/:id',budgetBody.extend({expectedRevision:z.number().int().positive(),salaryOccurredOn:date.optional()}),async(db,req,w,b)=>{
    const id=uuid.parse(params(req).id);await visible(db,w,id,'budget_plan',b.expectedRevision);
    const {rows:[p]}=await db.query('SELECT * FROM budget_plans WHERE id=$1',[id]);
    if(p.ledger_id!==b.ledgerId||p.month!==b.month) throw new HttpError(422,'已有预算不能改账本或月份，请另建方案');
    const current=await readBudgetRows(db,w,p);
    const salary=(await db.query('SELECT 1 FROM template_instances WHERE ledger_id=$1 AND workspace_id=$2',[p.ledger_id,w])).rowCount;
    if(current.length!==b.rows.length||new Set(b.rows.map((r:any)=>r.key)).size!==current.length||current.some(row=>{
      const submitted=b.rows.find((r:any)=>r.key===row.key);
      return !submitted||salary&&(submitted.categoryIds.length!==row.categoryIds.length||row.categoryIds.some((cid:string)=>!submitted.categoryIds.includes(cid)));
    }))throw new HttpError(409,'类别已变化，请重新打开预算设置');
    const complete=b.rows.every((r:any)=>r.mode==='fixed'?r.fixedMinor!=null:r.mode==='ratio'?r.ratioBps!=null:true);
    if(!complete&&!salary)throw new HttpError(422,'请完成各类别额度');
    if(complete)allocate(b.rows,b.baseMinor);
    for(const row of b.rows)for(const cid of row.categoryIds)await category(db,w,cid,p.ledger_id);
    const rows=b.rows.map((r:any)=>({...r,name:current.find(row=>row.key===r.key)!.name}));
    await db.query("UPDATE budget_plans SET name=$2,management_mode='allocated' WHERE id=$1",[id,b.name]);
    await saveBudgetRows(db,w,p,rows,b.baseMinor,complete?'active':'draft','用户修订');
    const salaryIncomeId=await saveSalaryIncome(db,w,p,b.baseMinor,b.salaryOccurredOn);
    return {id,before:p,salaryIncomeId};
  });
  write(app,'POST','/budgets/:id/compensations',z.object({...meta,targetId:uuid,deductions:z.array(z.object({bucketId:uuid,amountMinor:money}).strict()).min(1).max(100),expectedRevision:z.number().int().positive()}).strict(),async(db,req,w,b)=>{
    const id=uuid.parse(params(req).id);await visible(db,w,id,'budget_plan',b.expectedRevision);
    const {rows:[r]}=await db.query('SELECT compensate_negative($1,$2,$3,$4,$5) result',[w,id,b.operationId,b.targetId,JSON.stringify(b.deductions)]);
    await revise(db,id);return {id,...r.result};
  });
  write(app,'POST','/budget-transfers/:id/reverse',z.object(meta).strict(),async(db,req,w,b)=>{
    const tid=uuid.parse(params(req).id);const {rows:[t]}=await db.query('SELECT plan_id FROM budget_transfers WHERE id=$1 AND workspace_id=$2',[tid,w]);
    if(!t) throw new HttpError(404,'扣额记录不存在');await visible(db,w,t.plan_id,'budget_plan');
    await db.query('SELECT reverse_budget_transfer($1,$2,$3)',[w,tid,b.operationId]);await revise(db,t.plan_id);return {id:t.plan_id};
  });
}
