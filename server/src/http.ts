import { z } from 'zod';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { pool, type DB } from './db.js';
export class HttpError extends Error { constructor(public statusCode:number,message:string){super(message);} }
export const uuid=z.uuid();
export const name=z.string().trim().min(1).max(100);
export const money=z.number().int().positive().max(99999999999);
export const date=z.iso.date();
export const password=z.string().min(12,'密码至少12位').max(128,'密码最多128位');
export type Actor={id:string;username:string;system_role:'user'|'super_admin';auth_version:number;must_change_password:boolean;session_id:string};
declare module 'fastify' { interface FastifyRequest { actor:Actor } }
export async function authenticate(req:FastifyRequest) {
  const match=/^Bearer ([A-Za-z0-9_-]{40,100})$/.exec(req.headers.authorization??'');
  if(!match) throw new HttpError(401,'请先登录');
  const {digest}=await import('./security.js');
  const {rows:[user]}=await pool.query(`SELECT u.id,u.username,u.system_role,u.auth_version,u.must_change_password,s.id session_id
    FROM auth_sessions s JOIN app_users u ON u.id=s.user_id WHERE s.access_token_hash=$1
    AND s.access_expires_at>now() AND s.expires_at>now() AND s.revoked_at IS NULL AND u.disabled_at IS NULL AND u.deleted_at IS NULL`,[digest(match[1])]);
  if(!user) throw new HttpError(401,'登录已过期，请重新登录'); req.actor=user;
  if(user.must_change_password&&!['/v1/me','/v1/me/password','/v1/auth/logout'].includes(req.url.split('?')[0])) throw new HttpError(403,'首次登录请先修改密码');
}
export async function requireAdmin(req:FastifyRequest) { if(req.actor.system_role!=='super_admin') throw new HttpError(403,'需要系统超级管理员权限'); }
export async function access(req:FastifyRequest,db:DB,workspace:string,write=false) {
  uuid.parse(workspace);
  // Revalidate account while holding a shared lock. Concurrent role changes wait for the complete business transaction.
  const {rows:[actor]}=await db.query('SELECT * FROM app_users WHERE id=$1 FOR SHARE',[req.actor.id]);
  if(!actor||actor.disabled_at||actor.deleted_at||actor.must_change_password||actor.auth_version!==req.actor.auth_version) throw new HttpError(401,'账号状态已变化，请重新登录');
  if(write) await db.query('SELECT id FROM workspaces WHERE id=$1 FOR UPDATE',[workspace]);
  const {rows:[allowed]}=await db.query('SELECT has_workspace_access($1,$2,$3) allowed',[req.actor.id,workspace,write]);
  if(!allowed.allowed) throw new HttpError(403,'无权访问此工作区');
}
export function params(req:FastifyRequest):Record<string,string> { return req.params as Record<string,string>; }
export function query(req:FastifyRequest):Record<string,string|undefined> { return req.query as Record<string,string|undefined>; }
export async function audit(db:DB,req:FastifyRequest,w:string,id:string,action:string,before:unknown,after:unknown,reason?:string) {
  await db.query('INSERT INTO audit_events(workspace_id,entity_id,action,before_value,after_value) VALUES($1,(SELECT id FROM entities WHERE id=$2 AND workspace_id=$1),$3,$4,$5)',[w,id,action,before?JSON.stringify(before):null,after?JSON.stringify(after):null]);
  if(req.actor.system_role==='super_admin') {
    if(!reason?.trim()) throw new HttpError(422,'管理员修改数据需填写操作理由');
    await db.query(`INSERT INTO system_audit_events(actor_id,workspace_id,action,resource_type,resource_id,reason,before_value,after_value)
      VALUES($1,$2,$3,'entity',$4,$5,$6,$7)`,[req.actor.id,w,action,id,reason,before?JSON.stringify(before):null,after?JSON.stringify(after):null]);
  }
}
export function sendError(error:any,req:FastifyRequest,reply:FastifyReply) {
  if(error instanceof z.ZodError) return reply.code(422).send({message:error.issues.map(i=>`${i.path.join('.')}: ${i.message}`).join('；')});
  if(error instanceof HttpError) return reply.code(error.statusCode).send({message:error.message});
  const pgMessages:Record<string,string>={'23505':'绑定或操作编号已存在','23503':'关联数据不存在或仍被引用','23514':'数据不符合业务约束，请检查金额、归属和关联','42501':'权限不足','22P02':'数据格式错误','40001':'数据已变化，请刷新后重试','40P01':'操作冲突，请重新提交','P0001':'操作不符合业务约束'};
  if(pgMessages[error.code]) return reply.code(409).send({message:pgMessages[error.code]});
  if(error.statusCode===429) return reply.code(429).send({message:'请求过于频繁，请稍后重试'});
  if(error.statusCode&&error.statusCode<500) return reply.code(error.statusCode).send({message:error.message});
  req.log.error({err:error},'request failed'); return reply.code(500).send({message:'服务器暂时无法处理，请稍后重试',requestId:req.id});
}
