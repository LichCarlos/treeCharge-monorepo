import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const base=process.env.CHARGE_API_URL??'https://lichcarlos.top/charge-api';
const call=async(path,method='GET',body,token,status=200)=>{
 const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});
 const value=await response.json();assert.equal(response.status,status,path+': '+(value.message??response.status));return value;
};
assert.equal((await call('/health')).ok,true);
assert.equal((await call('/v1/auth/registration-status')).enabled,true);
await call('/v1/workspaces','GET',undefined,undefined,401);
const credentials=JSON.parse(await readFile('/etc/charge/bootstrap-admin.credentials','utf8'));
const session=await call('/v1/auth/login','POST',{username:credentials.username,password:credentials.password});
const user=await call('/v1/me','GET',undefined,session.accessToken);
assert.equal(user.role,'super_admin');assert.equal(user.mustChangePassword,true);
await call('/v1/workspaces','GET',undefined,session.accessToken,403);
await call('/v1/auth/logout','POST',{},session.accessToken);
await call('/v1/me','GET',undefined,session.accessToken,401);
console.log('PASS HTTPS health, database connectivity, registration availability, anonymous rejection, existing administrator login, enforced first password change, logout revocation. No test user or financial data created.');
