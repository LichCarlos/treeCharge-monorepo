import type { FastifyInstance } from 'fastify';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import { transaction,type DB } from './db.js';
import { access,authenticate,HttpError,params,query,uuid } from './http.js';
import {dateFilter} from './dates.js';
import {addDays} from '@charge/calendar';
async function facts(db:DB,w:string,q:Record<string,string|undefined>) {
  if(q.ledgerId) uuid.parse(q.ledgerId);if(q.tagId) uuid.parse(q.tagId);if(q.categoryId)uuid.parse(q.categoryId);
  const range=dateFilter(q);
  return (await db.query(`SELECT t.*,c.name category_name,l.name ledger_name,l.ledger_type,
    (SELECT body FROM transaction_remarks r JOIN entities e ON e.id=r.id AND e.deleted_at IS NULL WHERE transaction_id=t.id) remark,
    (SELECT string_agg(a.name,', ') FROM entity_tag_bindings b JOIN auxiliary_tags a ON a.id=b.tag_id JOIN entities e ON e.id=a.id AND e.deleted_at IS NULL WHERE b.entity_id=t.id) tags
    FROM transactions t JOIN visible_tree_nodes v USING(id,workspace_id) JOIN category_tags c ON c.id=t.category_id JOIN ledgers l ON l.id=t.ledger_id
    WHERE t.workspace_id=$1 AND ($2::uuid IS NULL OR t.ledger_id=$2)
    AND ($3::date IS NULL OR t.occurred_on>=$3 AND t.occurred_on<$5::date)
    AND ($4::uuid IS NULL OR EXISTS(SELECT 1 FROM entity_tag_bindings b WHERE b.entity_id=t.id AND b.tag_id=$4))
    AND ($6::uuid IS NULL OR t.category_id=$6)
    ORDER BY t.occurred_on ASC,t.id ASC`,[w,q.ledgerId??null,range.start,q.tagId??null,range.endExclusive,q.categoryId??null])).rows;
}
export async function reportRoutes(app:FastifyInstance) {
  app.get('/v1/workspaces/:w/reports',{preHandler:authenticate},async req=>transaction(async db=>{
    const w=uuid.parse(params(req).w);await access(req,db,w);const rows=await facts(db,w,query(req));
    const totals={income:0,expense:0,refund:0,deposit:0,withdrawal:0,netExpense:0,balance:0};
    const categoryMap=new Map<string,any>(),days=new Map<string,number>(),range=dateFilter(query(req));
    if(range.start&&range.end)for(let day=range.start;day<=range.end;day=addDays(day,1))days.set(day,0);
    let expenseCount=0;
    for(const t of rows) {
      totals[t.direction as 'income']+=t.amount_minor;
      if(t.direction==='expense')expenseCount++;
      if(['expense','refund'].includes(t.direction)) {
        const amount=t.direction==='refund'?-t.amount_minor:t.amount_minor;
        const c=categoryMap.get(t.category_id)??{id:t.category_id,name:t.category_name,ledger_id:t.ledger_id,amountMinor:0};c.amountMinor+=amount;categoryMap.set(t.category_id,c);
        days.set(t.occurred_on,(days.get(t.occurred_on)??0)+amount);
      }
    }
    totals.netExpense=totals.expense-totals.refund;totals.balance=totals.income-totals.netExpense;
    const highest=[...days.entries()].sort((a,b)=>b[1]-a[1])[0];
    return {totals,categories:[...categoryMap.values()].sort((a,b)=>b.amountMinor-a.amountMinor),trend:[...days.entries()].sort().map(([day,amountMinor])=>({day,amountMinor})),count:rows.length,range,expenseCount,averageDailyExpense:days.size?Math.round(totals.netExpense/days.size):0,highestExpenseDay:highest?{day:highest[0],amountMinor:highest[1]}:null};
  }));
  app.get('/v1/workspaces/:w/export.xlsx',{preHandler:authenticate},async(req,reply)=>{
    const w=uuid.parse(params(req).w);
    const bytes=await transaction(async db=>{
      await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');await access(req,db,w);
      const q=query(req),range=dateFilter(q);
      const data=await facts(db,w,q);if(data.length>10000) throw new HttpError(422,'单次导出上限10000条，请缩小日期范围');
      const book=new ExcelJS.Workbook();book.creator='枝账';book.created=new Date();
      const sheet=book.addWorksheet('实际明细',{views:[{state:'frozen',ySplit:1}]});
      sheet.columns=[{header:'明细ID',key:'id',width:38},{header:'账本',key:'ledger_name',width:22},{header:'消费内容',key:'category_name',width:22},{header:'日期',key:'occurred_on',width:14},{header:'方向',key:'direction',width:14},{header:'金额',key:'amount',width:16},{header:'备注',key:'remark',width:40},{header:'标签',key:'tags',width:25}];
      for(const r of data) sheet.addRow({...r,amount:r.amount_minor/100});sheet.getColumn('amount').numFmt='#,##0.00';
      const budgets=book.addWorksheet('预算执行');budgets.addRow(['方案','月份','项目','初始额度','转入','转出','实际使用','余额','初始占比']);
      const {rows:balances}=await db.query("SELECT b.*,p.name plan_name,p.month,p.base_minor FROM budget_balances b JOIN budget_plans p ON p.id=b.plan_id JOIN entities e ON e.id=p.id AND e.deleted_at IS NULL WHERE b.workspace_id=$1 AND ($2::uuid IS NULL OR p.ledger_id=$2) AND ($3::date IS NULL OR p.month<$4::date AND p.month+interval '1 month'>$3::date)",[w,q.ledgerId??null,range.start,range.endExclusive]);
      for(const b of balances) budgets.addRow([b.plan_name,b.month,b.name,b.initial_minor===null?null:b.initial_minor/100,b.transferred_in_minor/100,b.transferred_out_minor/100,b.used_minor/100,b.available_minor===null?null:b.available_minor/100,b.base_minor?b.initial_minor/b.base_minor:null]);
      for(let c=4;c<=8;c++) budgets.getColumn(c).numFmt='#,##0.00';budgets.getColumn(9).numFmt='0.00%';budgets.columns.forEach(c=>c.width=20);
      const transfers=book.addWorksheet('tag扣额记录');transfers.addRow(['操作ID','来源','目标','金额','时间','撤销原事件']);
      const ts=(await db.query('SELECT t.*,f.name from_name,d.name to_name FROM budget_transfers t JOIN budget_buckets f ON f.id=t.from_bucket_id JOIN budget_buckets d ON d.id=t.to_bucket_id WHERE t.workspace_id=$1 AND t.plan_id=ANY($2::uuid[]) ORDER BY t.created_at',[w,[...new Set(balances.map(b=>b.plan_id))]])).rows;
      for(const t of ts) transfers.addRow([t.operation_id,t.from_name,t.to_name,t.amount_minor/100,t.created_at.toISOString(),t.reversal_of??'']);transfers.columns.forEach(c=>c.width=25);
      const info=book.addWorksheet('导出说明');info.addRows([['工作区',w],['时间',new Date().toISOString()],['日期范围',range.start?range.start+' 至 '+range.end:'全部'],['预算口径','展示与所选范围相交的完整月度预算；预算不会按天折算'],['金额单位','元；系统内部整数分'],['筛选',JSON.stringify(q)],['提示','Excel编辑不会回写系统；预算转移不改变实际收支']]);info.getColumn(1).width=20;info.getColumn(2).width=90;
      for(const s of book.worksheets) {s.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};s.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF244F43'}};}
      return Buffer.from(await book.xlsx.writeBuffer());
    });
    return reply.header('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').header('Content-Disposition','attachment; filename="charge-export.xlsx"').send(bytes);
  });
}
