import type {DB} from './db.js';
import {uuid,HttpError} from './http.js';
export async function visible(db:DB,w:string,id:string,kind?:string,revision?:number) {
  uuid.parse(id);
  const {rows:[e]}=await db.query(`SELECT e.* FROM entities e WHERE e.id=$1 AND e.workspace_id=$2 AND e.deleted_at IS NULL
    AND (e.kind NOT IN ('root','group','ledger','category','transaction','remark') OR EXISTS(SELECT 1 FROM visible_tree_nodes v WHERE v.id=e.id))
    AND (e.kind<>'goal' OR EXISTS(SELECT 1 FROM savings_goals g JOIN visible_tree_nodes v ON v.id=g.ledger_id WHERE g.id=e.id))
    AND (e.kind<>'plan' OR EXISTS(SELECT 1 FROM planned_transactions p JOIN visible_tree_nodes v ON v.id=p.category_id WHERE p.id=e.id))
    AND (e.kind<>'budget_plan' OR EXISTS(SELECT 1 FROM budget_plans p JOIN visible_tree_nodes v ON v.id=p.ledger_id WHERE p.id=e.id)) FOR UPDATE OF e`,[id,w]);
  if(!e||kind&&e.kind!==kind) throw new HttpError(404,'记录不存在或已删除');
  if(revision!==undefined&&revision!==e.revision) throw new HttpError(409,'记录已被修改，请刷新后再编辑');
  return e;
}
export async function revise(db:DB,id:string) { await db.query('UPDATE entities SET updated_at=now() WHERE id=$1',[id]); }
