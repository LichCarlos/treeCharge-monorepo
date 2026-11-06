import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import type pg from 'pg';

// Run against the pre-010 schema, then check the same IDs after the migration.
export async function legacyHierarchy(sql:pg.Client){
  const w=randomUUID();
  await sql.query('BEGIN');
  await sql.query("INSERT INTO charge.workspaces(id,name) VALUES($1,'legacy hierarchy fixture')",[w]);
  async function node(kind:string,parent?:string){
    const id=randomUUID();
    await sql.query('INSERT INTO charge.entities(id,workspace_id,kind) VALUES($1,$2,$3)',[id,w,kind]);
    if(parent||kind==='root')await sql.query('INSERT INTO charge.tree_nodes(id,workspace_id,parent_id) VALUES($1,$2,$3)',[id,w,parent??null]);
    return id;
  }
  const root=await node('root'),ledger=await node('ledger',root);
  await sql.query("INSERT INTO charge.ledgers(id,workspace_id,name,ledger_type) VALUES($1,$2,'旧账本','expense')",[ledger,w]);
  async function content(name:string,parent:string){
    const id=await node('category',parent);
    await sql.query('INSERT INTO charge.category_tags(id,workspace_id,ledger_id,name) VALUES($1,$2,$3,$4)',[id,w,ledger,name]);return id;
  }
  const parent=await content('旧父分类',ledger),child=await content('交通',parent);
  const deleted=await content('已删除父分类',ledger),hidden=await content('仍应隐藏',deleted);
  const plan=await node('budget_plan'),item=await node('budget_item');
  await sql.query("INSERT INTO charge.budget_plans(id,workspace_id,ledger_id,month,name,base_minor) VALUES($1,$2,$3,date_trunc('month',current_date),'旧预算',2000)",[plan,w,ledger]);
  await sql.query("INSERT INTO charge.budget_items(id,workspace_id,plan_id,name,purpose,mode,fixed_minor) VALUES($1,$2,$3,'交通','expense_budget','fixed',2000)",[item,w,plan]);
  const bucket=(await sql.query("INSERT INTO charge.budget_buckets(workspace_id,plan_id,item_id,name,initial_minor) VALUES($1,$2,$3,'交通',2000) RETURNING id",[w,plan,item])).rows[0].id;
  await sql.query('INSERT INTO charge.budget_category_mappings VALUES($1,$2,$3,$4,$5)',[w,plan,ledger,child,bucket]);
  await sql.query("UPDATE charge.budget_plans SET status='active' WHERE id=$1",[plan]);
  const transaction=await node('transaction',child),remark=await node('remark',transaction);
  await sql.query("INSERT INTO charge.transactions VALUES($1,$2,$3,$4,'expense',1234,current_date)",[transaction,w,ledger,child]);
  await sql.query("INSERT INTO charge.transaction_remarks VALUES($1,$2,$3,'原备注')",[remark,w,transaction]);
  await sql.query('UPDATE charge.entities SET deleted_at=now() WHERE id=$1',[deleted]);
  await sql.query('COMMIT');
  return async()=>{
    const categories=(await sql.query('SELECT t.parent_id,e.deleted_at FROM charge.category_tags c JOIN charge.tree_nodes t USING(id) JOIN charge.entities e USING(id) WHERE c.workspace_id=$1',[w])).rows;
    assert(categories.every(c=>c.parent_id===ledger));
    assert.equal((await sql.query('SELECT body FROM charge.transaction_remarks WHERE id=$1',[remark])).rows[0].body,'原备注');
    const t=(await sql.query('SELECT * FROM charge.transactions WHERE id=$1',[transaction])).rows[0];
    assert.equal(t.category_id,child);assert.equal(t.ledger_id,ledger);assert.equal(Number(t.amount_minor),1234);
    assert.equal((await sql.query('SELECT bucket_id FROM charge.budget_category_mappings WHERE category_id=$1',[child])).rows[0].bucket_id,bucket);
    assert.equal(Number((await sql.query('SELECT used_minor FROM charge.budget_balances WHERE id=$1',[bucket])).rows[0].used_minor),1234);
    assert.equal((await sql.query('SELECT 1 FROM charge.visible_tree_nodes WHERE id=$1',[hidden])).rowCount,0);
    assert((await sql.query('SELECT deleted_at FROM charge.entities WHERE id=$1',[hidden])).rows[0].deleted_at);
    // The database itself also rejects nesting even when an API is bypassed.
    await sql.query('BEGIN');
    await sql.query('UPDATE charge.tree_nodes SET parent_id=$1 WHERE id=$2',[parent,child]);
    await assert.rejects(sql.query('SET CONSTRAINTS ALL IMMEDIATE'),(e:any)=>e.code==='23514');
    await sql.query('ROLLBACK');
  };
}
