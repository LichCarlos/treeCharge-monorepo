import type {DB} from './db.js';
import { HttpError } from './http.js';
export async function deleteOwned(db:DB, w:string, old:any) {
    let owner = old.id;
    // A savings goal is the UI entry for its ledger, so both entry points delete
    // the same owned aggregate, including categories, facts and remarks.
    if (old.kind === 'goal') {
        const { rows: [goal] } = await db.query('SELECT ledger_id FROM savings_goals WHERE id=$1 AND workspace_id=$2', [old.id, w]);
        if (!goal)
            throw new HttpError(404, '存款计划不存在');
        owner = goal.ledger_id;
    }
    const {rows:[summary]}=await db.query(`SELECT g.name,g.target_minor,g.deadline,
      coalesce((SELECT sum(CASE WHEN t.direction='deposit' THEN t.amount_minor ELSE -t.amount_minor END)
        FROM transactions t JOIN visible_tree_nodes v ON v.id=t.id WHERE t.ledger_id=g.ledger_id),0)::bigint saved_minor
      FROM savings_goals g WHERE g.ledger_id=$1 AND g.workspace_id=$2`,[owner,w]);
    const snapshot={...old,...(summary?{savings:summary}:{})};
    const { rows: [batch] } = await db.query('INSERT INTO deletion_batches(workspace_id,root_id,snapshot) VALUES($1,$2,$3) RETURNING id', [w, old.id, JSON.stringify(snapshot)]);
    const changed = await db.query(`WITH removed AS (
    UPDATE entities SET deleted_at=now() WHERE workspace_id=$1 AND deleted_at IS NULL
      AND id IN (SELECT id FROM owned_entity_ids($1,$2)) RETURNING id,revision
  ) INSERT INTO deletion_batch_members(batch_id,workspace_id,entity_id,deleted_revision)
    SELECT $3,$1,id,revision FROM removed RETURNING entity_id`, [w, owner, batch.id]);
    return { id: old.id, before: old, deletedCount: changed.rowCount, batchId: batch.id, invalidatedIds:[old.id,owner] };
}

export async function purgeSavings(db:DB,w:string,id:string,revision:number){
    const {rows:[old]}=await db.query('SELECT * FROM entities WHERE id=$1 AND workspace_id=$2 FOR UPDATE',[id,w]);
    if(!old)throw new HttpError(404,'计划不存在或已永久删除');
    if(!old.deleted_at)throw new HttpError(409,'请先删除此计划');
    if(old.revision!==revision)throw new HttpError(409,'计划已变化，请刷新后重试');
    if(!['goal','ledger'].includes(old.kind))throw new HttpError(422,'仅已删除的存款计划可永久删除');
    const {rows:[ancestor]}=await db.query(`SELECT b.root_id FROM deletion_batch_members m JOIN deletion_batches b ON b.id=m.batch_id
      JOIN entities e ON e.id=b.root_id AND e.deleted_at IS NOT NULL
      WHERE m.entity_id=$1 AND b.workspace_id=$2 AND b.restored_at IS NULL AND b.root_id<>$1 LIMIT 1`,[id,w]);
    if(ancestor)throw new HttpError(409,'请从所属已删除计划操作');
    return (await db.query('SELECT purge_deleted_savings($1,$2) result',[w,id])).rows[0].result;
}
export async function restoreOwned(db:DB, w:string, old:any) {
    const { rows: [parentBatch] } = await db.query(`SELECT b.root_id FROM deletion_batch_members m JOIN deletion_batches b ON b.id=m.batch_id
    WHERE m.entity_id=$1 AND b.restored_at IS NULL AND b.root_id<>$1
    AND EXISTS(SELECT 1 FROM entities e WHERE e.id=b.root_id AND e.deleted_at IS NOT NULL) LIMIT 1`, [old.id]);
    if (parentBatch)
        throw new HttpError(409, '请先恢复所属账本或计划，再恢复此记录');
    const { rows: [batch] } = await db.query('SELECT * FROM deletion_batches WHERE workspace_id=$1 AND root_id=$2 AND restored_at IS NULL ORDER BY created_at DESC LIMIT 1 FOR UPDATE', [w, old.id]);
    const ids = batch ? (await db.query('SELECT entity_id FROM deletion_batch_members WHERE batch_id=$1', [batch.id])).rows.map(r => r.entity_id) : [];
    if (!ids.length)
        ids.push(old.id);
    // Validate the entire final ownership state, including non-tree goal/plan IDs.
    const { rows: [blocked] } = await db.query(`SELECT e.id FROM entities e WHERE e.workspace_id=$1 AND e.deleted_at IS NOT NULL
    AND NOT(e.id=ANY($2::uuid[])) AND EXISTS(
      SELECT 1 FROM owned_entity_ids($1,e.id) child WHERE child.id=ANY($2::uuid[])) LIMIT 1`, [w, ids]);
    if (blocked)
        throw new HttpError(409, '所属账本或上级内容已删除，请先恢复上级');
    if (batch) {
        const { rows: [changed] } = await db.query(`SELECT e.id FROM deletion_batch_members m JOIN entities e ON e.id=m.entity_id
      WHERE m.batch_id=$1 AND (e.deleted_at IS NULL OR e.revision<>m.deleted_revision) LIMIT 1`, [batch.id]);
        if (changed)
            throw new HttpError(409, '删除批次已有变化，请刷新后重试');
    }
    await db.query('UPDATE entities SET deleted_at=NULL WHERE workspace_id=$1 AND id=ANY($2::uuid[])', [w, ids]);
    if (batch)
        await db.query('UPDATE deletion_batches SET restored_at=now() WHERE id=$1', [batch.id]);
    return { id: old.id, before: old, restoredCount: ids.length };
}
