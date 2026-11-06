import pg, { type PoolClient } from 'pg';
// Bigints are constrained to < 1e11 for money. SQL SUM aggregates are validated at the API boundary.
pg.types.setTypeParser(20, value => { const n=Number(value); if (!Number.isSafeInteger(n)) throw new Error('统计超出安全整数范围'); return n; });
pg.types.setTypeParser(1082, value => value);
export const pool = new pg.Pool({ max: 8, options: '-c search_path=charge,pg_catalog',
  connectionTimeoutMillis: 8000, statement_timeout: 15000 });
export type DB = PoolClient;
export async function transaction<T>(fn:(db:DB)=>Promise<T>):Promise<T> {
  const db=await pool.connect();
  try { await db.query('BEGIN'); const result=await fn(db); await db.query('COMMIT'); return result; }
  catch(error) { await db.query('ROLLBACK'); throw error; } finally { db.release(); }
}
export async function entity(db:DB, workspace:string, kind:string, parent?:string):Promise<string> {
  const {rows:[row]}=await db.query('INSERT INTO entities(workspace_id,kind) VALUES($1,$2) RETURNING id',[workspace,kind]);
  if(parent) await db.query('INSERT INTO tree_nodes(id,workspace_id,parent_id) VALUES($1,$2,$3)',[row.id,workspace,parent]);
  return row.id;
}
