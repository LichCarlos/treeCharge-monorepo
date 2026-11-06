import type {DB} from './db.js';
// Rebuild derived usage from facts after either facts or allocation mappings change.
export async function rebuildUsage(db:DB,w:string){
  await db.query("DELETE FROM budget_usage_links WHERE workspace_id=$1 AND usage_kind IN ('consume','refund')",[w]);
  await db.query("INSERT INTO budget_usage_links(workspace_id,plan_id,bucket_id,transaction_id,usage_kind,amount_minor) SELECT t.workspace_id,p.id,m.bucket_id,t.id,'consume',t.amount_minor FROM transactions t JOIN budget_plans p ON p.ledger_id=t.ledger_id AND p.status IN ('active','draft') JOIN entities pe ON pe.id=p.id AND pe.deleted_at IS NULL JOIN budget_category_mappings m ON m.plan_id=p.id AND m.category_id=t.category_id JOIN budget_buckets b ON b.id=m.bucket_id AND b.initial_minor IS NOT NULL WHERE t.workspace_id=$1 AND t.direction='expense' AND p.month=date_trunc('month',t.occurred_on)::date",[w]);
  await db.query("INSERT INTO budget_usage_links(workspace_id,plan_id,bucket_id,transaction_id,usage_kind,amount_minor) SELECT f.workspace_id,u.plan_id,u.bucket_id,f.id,'refund',f.amount_minor FROM transaction_refund_links r JOIN transactions f ON f.id=r.refund_id JOIN budget_usage_links u ON u.transaction_id=r.original_id AND u.usage_kind='consume' WHERE f.workspace_id=$1",[w]);
}
