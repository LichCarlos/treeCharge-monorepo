import pg from 'pg';
import {readFile,writeFile,readdir,mkdir} from 'node:fs/promises';
import {createHash,randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../../',import.meta.url));
const admin=new pg.Client({host:process.env.PGHOST??'127.0.0.1',port:Number(process.env.PGPORT??15432),user:'postgres',password:process.env.PGADMINPASSWORD,database:process.env.PGDATABASE??'charge_development'});
if(!/_development$|_test$/.test(admin.database)) throw new Error('Local setup requires a dedicated *_development or *_test database');
await admin.connect();
const password=process.env.PGPASSWORD;if(!password) throw new Error('Set PGPASSWORD in server/.env');
await admin.query("DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='charge_owner') THEN CREATE ROLE charge_owner NOLOGIN; END IF; IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='charge_app') THEN CREATE ROLE charge_app LOGIN; END IF; END $$");
await admin.query(`ALTER ROLE charge_app PASSWORD '${password.replaceAll("'","''")}'`);
await admin.query(`GRANT CONNECT ON DATABASE "${admin.database}" TO charge_app`);
await admin.query(`ALTER DATABASE "${admin.database}" OWNER TO charge_owner`);
await admin.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC');
for(const filename of (await readdir(path.join(root,'server/db/migrations'))).filter(n=>n.endsWith('.sql')).sort()) {
  const source=await readFile(path.join(root,'server/db/migrations',filename),'utf8'),hash=createHash('sha256').update(source).digest('hex'),version=filename.slice(0,-4);
  const {rows:[{exists}]}=await admin.query("SELECT to_regclass('charge.schema_migrations') IS NOT NULL AS exists");
  if(exists) {const {rows:[old]}=await admin.query('SELECT sha256 FROM charge.schema_migrations WHERE version=$1',[version]);if(old){if(old.sha256!==hash)throw new Error('Migration checksum mismatch: '+version);continue;}}
  try {await admin.query('BEGIN; SET LOCAL ROLE charge_owner');await admin.query(source);await admin.query('INSERT INTO charge.schema_migrations(version,sha256) VALUES($1,$2)',[version,hash]);await admin.query('COMMIT');console.log('Applied',version);}
  catch(e){await admin.query('ROLLBACK');throw e;}
}
const config=JSON.parse(await readFile(path.join(root,'src/domain/templates/default-templates.json'),'utf8'));
for(const t of config.templates) await admin.query(`INSERT INTO charge.ledger_templates(id,version,name,ledger_type,config) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,[t.id,t.version,t.name,t.ledgerType,JSON.stringify(t)]);
const {hashPassword}=await import('../src/security.ts');
const {rows:[{count}]}=await admin.query("SELECT count(*) FROM charge.app_users WHERE system_role='super_admin' AND disabled_at IS NULL AND deleted_at IS NULL");
if(Number(count)===0) {
  const initial=randomBytes(18).toString('base64url');
  await admin.query("INSERT INTO charge.app_users(username,password_hash,system_role,must_change_password) VALUES('system_admin',$1,'super_admin',true)",[await hashPassword(initial)]);
  await mkdir(path.join(root,'.work'),{recursive:true});
  await writeFile(path.join(root,'.work/local-admin.credentials.json'),JSON.stringify({username:'system_admin',password:initial,mustChangePassword:true},null,2),{flag:'wx'});
  console.log('Local administrator initialized; credentials in ignored .work/local-admin.credentials.json');
}
await admin.end();console.log('Local database ready.');
