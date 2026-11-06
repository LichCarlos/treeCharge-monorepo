import {readFile,writeFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {parseEnv} from 'node:util';
const root=new URL('../../',import.meta.url);
async function env(path){try{return parseEnv(await readFile(new URL(path,root),'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}}
const existingRoot=await env('.env'),existingServer=await env('server/.env');
const adminPassword=existingRoot?.PGADMINPASSWORD??existingServer?.PGADMINPASSWORD??randomBytes(24).toString('base64url');
if(!existingRoot)await writeFile(new URL('.env',root),'PGADMINPASSWORD='+adminPassword+'\n',{flag:'wx'});
if(!existingServer)await writeFile(new URL('server/.env',root),[
  'HOST=0.0.0.0','PORT=3100','PGHOST=127.0.0.1','PGPORT=15432','PGDATABASE=charge_development','PGUSER=charge_app',
  'PGPASSWORD='+randomBytes(24).toString('base64url'),'PGADMINPASSWORD='+adminPassword,
  'CORS_ORIGINS=http://localhost:8081,http://localhost:8082','REGISTRATION_ENABLED=true',''
].join('\n'),{flag:'wx'});
console.log('Local environment ready. Existing files were preserved; credentials were not printed.');
