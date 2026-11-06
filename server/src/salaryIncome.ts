import {entity,type DB} from './db.js';
import {HttpError} from './http.js';
import {visible,revise} from './entities.js';

export async function salaryTemplate(db:DB,w:string,ledger:string){
  return (await db.query("SELECT * FROM template_instances WHERE workspace_id=$1 AND ledger_id=$2 AND template_id='salary-allocation' ORDER BY created_at LIMIT 1",[w,ledger])).rows[0];
}
export async function readSalaryIncome(db:DB,w:string,plan:string){
  return (await db.query(`SELECT t.*,e.revision FROM salary_income_links s JOIN transactions t ON t.id=s.transaction_id
    JOIN visible_tree_nodes v ON v.id=t.id JOIN entities e ON e.id=t.id
    WHERE s.workspace_id=$1 AND s.plan_id=$2`,[w,plan])).rows[0]??null;
}
export async function saveSalaryIncome(db:DB,w:string,p:any,amount:number,occurredOn?:string){
  const template=await salaryTemplate(db,w,p.ledger_id);if(!template)return null;
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1::text,0))',[w+':'+p.ledger_id+':'+p.month]);
  const {rows:[link]}=await db.query('SELECT plan_id FROM salary_income_links WHERE workspace_id=$1 AND ledger_id=$2 AND month=$3',[w,p.ledger_id,p.month]);
  const current=link?await readSalaryIncome(db,w,link.plan_id):null;
  const actualDate=occurredOn??current?.occurred_on??(await db.query(`SELECT CASE WHEN to_char(now() AT TIME ZONE timezone,'YYYY-MM')=$2
    THEN (now() AT TIME ZONE timezone)::date ELSE $3::date END AS date FROM workspaces WHERE id=$1`,[w,p.month.slice(0,7),p.month])).rows[0].date;
  if(actualDate.slice(0,7)!==p.month.slice(0,7))throw new HttpError(422,'工资日期须在当前月份');
  if((await db.query("SELECT $1::date>(now() AT TIME ZONE timezone)::date AS future FROM workspaces WHERE id=$2",[actualDate,w])).rows[0].future)throw new HttpError(422,'工资收入日期不能晚于今天');
  if(current){
    await visible(db,w,current.id,'transaction');
    if(current.amount_minor!==amount||current.occurred_on!==actualDate){
      await db.query('UPDATE transactions SET amount_minor=$2,occurred_on=$3 WHERE id=$1',[current.id,amount,actualDate]);await revise(db,current.id);
    }
    await db.query('UPDATE salary_income_links SET plan_id=$2 WHERE transaction_id=$1',[current.id,p.id]);return current.id;
  }
  // The binding is an ID mapping. A same-named user category is never reused.
  let category=(await db.query(`SELECT c.id FROM template_entity_mappings m JOIN category_tags c ON c.id=m.entity_id
    JOIN visible_tree_nodes v ON v.id=c.id WHERE m.instance_id=$1 AND m.template_key='salary-income'
    AND c.ledger_id=$2 AND (cardinality(c.allowed_directions)=0 OR 'income'=ANY(c.allowed_directions))`,[template.id,p.ledger_id])).rows[0]?.id;
  if(!category){
    category=await entity(db,w,'category',p.ledger_id);
    await db.query("INSERT INTO category_tags(id,workspace_id,ledger_id,name,allowed_directions,icon_id) VALUES($1,$2,$3,'工资',ARRAY['income']::text[],'salary')",[category,w,p.ledger_id]);
    await db.query('UPDATE tree_nodes SET position=(SELECT coalesce(max(position),-1)+1 FROM tree_nodes WHERE workspace_id=$2 AND parent_id=$3 AND id<>$1) WHERE id=$1',[category,w,p.ledger_id]);
    await db.query(`INSERT INTO template_entity_mappings(workspace_id,instance_id,template_key,entity_id) VALUES($1,$2,'salary-income',$3)
      ON CONFLICT(instance_id,template_key) DO UPDATE SET entity_id=EXCLUDED.entity_id`,[w,template.id,category]);
  }
  const id=await entity(db,w,'transaction',category);
  await db.query("INSERT INTO transactions(id,workspace_id,ledger_id,category_id,direction,amount_minor,occurred_on) VALUES($1,$2,$3,$4,'income',$5,$6)",[id,w,p.ledger_id,category,amount,actualDate]);
  await db.query(`INSERT INTO salary_income_links(workspace_id,ledger_id,month,plan_id,transaction_id) VALUES($1,$2,$3,$4,$5)
    ON CONFLICT(workspace_id,ledger_id,month) DO UPDATE SET plan_id=EXCLUDED.plan_id,transaction_id=EXCLUDED.transaction_id`,[w,p.ledger_id,p.month,p.id,id]);
  return id;
}
