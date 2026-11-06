import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool,transaction } from './db.js';
import { hashPassword,verifyPassword,token,digest } from './security.js';
import { authenticate,requireAdmin,HttpError,params,query,uuid,password } from './http.js';
const credentials=z.object({username:z.string().trim().min(3).max(32).refine(s=>!/[\x00-\x1f\x7f]/.test(s)),password}).strict();
const userView=(u:any)=>({id:u.id,username:u.username,role:u.system_role,mustChangePassword:u.must_change_password});
async function session(db:any,userId:string) {
  const accessToken=token(),refreshToken=token();
  await db.query(`INSERT INTO auth_sessions(user_id,refresh_token_hash,expires_at,access_token_hash,access_expires_at)
    VALUES($1,$2,now()+interval '30 days',$3,now()+interval '30 minutes')`,[userId,digest(refreshToken),digest(accessToken)]);
  return {accessToken,refreshToken};
}
export async function authRoutes(app:FastifyInstance) {
  app.get('/v1/auth/registration-status',async()=>({enabled:(await pool.query("SELECT value FROM system_settings WHERE key='registration_enabled'")).rows[0]?.value===true}));
  app.post('/v1/auth/register',{config:{rateLimit:{max:5,timeWindow:'1 minute'}}},async(req,reply)=>{
    const body=credentials.parse(req.body);
    if(process.env.REGISTRATION_ENABLED==='false'||(await pool.query("SELECT value FROM system_settings WHERE key='registration_enabled'")).rows[0]?.value!==true) throw new HttpError(403,'当前已关闭注册');
    const hashed=await hashPassword(body.password);
    const result=await transaction(async db=>(await db.query('SELECT * FROM register_account($1,$2)',[body.username,hashed])).rows[0]);
    return reply.code(201).send({userId:result.user_id,message:'注册成功，请登录'});
  });
  const dummy=await hashPassword(token());
  app.post('/v1/auth/login',{config:{rateLimit:{max:10,timeWindow:'1 minute'}}},async(req)=>{
    const body=credentials.parse(req.body);
    return transaction(async db=>{
      const {rows:[u]}=await db.query('SELECT * FROM app_users WHERE lower(username)=lower($1) FOR SHARE',[body.username]);
      const valid=await verifyPassword(body.password,u?.password_hash??dummy);
      if(!valid||!u||u.disabled_at||u.deleted_at) throw new HttpError(401,'用户名或密码错误，或账号不可用');
      return {...await session(db,u.id),user:userView(u)};
    });
  });
  app.post('/v1/auth/refresh',{config:{rateLimit:{max:20,timeWindow:'1 minute'}}},async req=>{
    const body=z.object({refreshToken:z.string().min(40).max(100)}).strict().parse(req.body);
    return transaction(async db=>{
      const {rows:[s]}=await db.query(`SELECT s.id session_id,u.* FROM auth_sessions s JOIN app_users u ON u.id=s.user_id
        WHERE refresh_token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now() AND u.disabled_at IS NULL AND u.deleted_at IS NULL FOR UPDATE OF s`,[digest(body.refreshToken)]);
      if(!s) throw new HttpError(401,'会话已失效');
      await db.query('UPDATE auth_sessions SET revoked_at=now() WHERE id=$1',[s.session_id]);
      return {...await session(db,s.id),user:userView(s)};
    });
  });
  app.post('/v1/auth/logout',{preHandler:authenticate},async req=>{
    await pool.query('UPDATE auth_sessions SET revoked_at=now() WHERE id=$1',[req.actor.session_id]); return {ok:true};
  });
  app.get('/v1/me',{preHandler:authenticate},async req=>userView(req.actor));
  app.post('/v1/me/password',{preHandler:authenticate},async req=>{
    const b=z.object({oldPassword:password,newPassword:password}).strict().parse(req.body);
    return transaction(async db=>{
      const {rows:[u]}=await db.query('SELECT * FROM app_users WHERE id=$1',[req.actor.id]);
      if(!await verifyPassword(b.oldPassword,u.password_hash)) throw new HttpError(422,'原密码不正确');
      await db.query('SELECT change_account_password($1,$2,$3)',[u.id,req.actor.auth_version,await hashPassword(b.newPassword)]);
      return {ok:true,message:'密码已修改，请重新登录'};
    });
  });
  app.get('/v1/workspaces',{preHandler:authenticate},async req=>{
    const {rows}=await pool.query(`SELECT w.*, (SELECT id FROM tree_nodes WHERE workspace_id=w.id AND parent_id IS NULL) root_id,
      (SELECT u.username FROM workspace_members m JOIN app_users u ON u.id=m.user_id WHERE m.workspace_id=w.id AND m.access_role='owner' LIMIT 1) owner_name
      FROM workspaces w WHERE has_workspace_access($1,w.id,false) ORDER BY w.created_at`,[req.actor.id]);return rows;
  });
  app.get('/v1/admin/users',{preHandler:[authenticate,requireAdmin]},async req=>{
    const q=(query(req).q??'').slice(0,100);
    return (await pool.query(`SELECT id,username,system_role,disabled_at,deleted_at,must_change_password,created_at FROM app_users
      WHERE username ILIKE $1 ORDER BY created_at DESC LIMIT 200`,['%'+q+'%'])).rows;
  });
  app.post('/v1/admin/users',{preHandler:[authenticate,requireAdmin]},async req=>{
    const b=credentials.extend({role:z.enum(['user','super_admin']).default('user'),reason:z.string().trim().min(1).max(500)}).parse(req.body);
    return transaction(async db=>{
      const {rows:[u]}=await db.query('SELECT * FROM register_account($1,$2)',[b.username,await hashPassword(b.password)]);
      await db.query('SELECT admin_update_account($1,$2,$3,false,false,$4)',[req.actor.id,u.user_id,b.role,b.reason]);
      await db.query('SELECT admin_reset_password($1,$2,$3,$4)',[req.actor.id,u.user_id,await hashPassword(b.password),b.reason]);
      return {id:u.user_id};
    });
  });
  app.patch('/v1/admin/users/:id',{preHandler:[authenticate,requireAdmin]},async req=>{
    const b=z.object({role:z.enum(['user','super_admin']),disabled:z.boolean(),deleted:z.boolean(),reason:z.string().trim().min(1).max(500)}).strict().parse(req.body);
    return (await pool.query('SELECT admin_update_account($1,$2,$3,$4,$5,$6) result',[req.actor.id,uuid.parse(params(req).id),b.role,b.disabled,b.deleted,b.reason])).rows[0].result;
  });
  app.post('/v1/admin/users/:id/reset-password',{preHandler:[authenticate,requireAdmin]},async req=>{
    const b=z.object({password,reason:z.string().trim().min(1).max(500)}).strict().parse(req.body);
    await pool.query('SELECT admin_reset_password($1,$2,$3,$4)',[req.actor.id,uuid.parse(params(req).id),await hashPassword(b.password),b.reason]);return {ok:true};
  });
  app.get('/v1/admin/audit',{preHandler:[authenticate,requireAdmin]},async()=> (await pool.query(`SELECT a.*,u.username actor_name FROM system_audit_events a LEFT JOIN app_users u ON u.id=a.actor_id ORDER BY a.id DESC LIMIT 200`)).rows);
  app.get('/v1/admin/settings',{preHandler:[authenticate,requireAdmin]},async()=> (await pool.query('SELECT * FROM system_settings ORDER BY key')).rows);
  app.put('/v1/admin/settings/registration',{preHandler:[authenticate,requireAdmin]},async req=>{
    const b=z.object({enabled:z.boolean(),reason:z.string().trim().min(1).max(500)}).strict().parse(req.body);
    return transaction(async db=>{
      await db.query("UPDATE system_settings SET value=$1,updated_at=now() WHERE key='registration_enabled'",[JSON.stringify(b.enabled)]);
      await db.query(`INSERT INTO system_audit_events(actor_id,action,resource_type,resource_id,reason,after_value)
        VALUES($1,'admin.registration.update','setting','registration_enabled',$2,$3)`,[req.actor.id,b.reason,JSON.stringify({enabled:b.enabled})]);return {ok:true};
    });
  });
}
