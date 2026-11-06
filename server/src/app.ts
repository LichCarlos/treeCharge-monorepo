import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { pool } from './db.js';
import { sendError } from './http.js';
import { authRoutes } from './auth.js';
import { ledgerRoutes } from './ledger.js';
import { budgetRoutes } from './budget.js';
import { configurationRoutes } from './configuration.js';
import { reportRoutes } from './reports.js';
export async function buildApp(log=false) {
  const app=Fastify({trustProxy:process.env.TRUST_PROXY==='loopback'?['127.0.0.1','::1']:false,logger:log?{redact:['req.headers.authorization','req.body.password','req.body.oldPassword','req.body.newPassword','req.body.refreshToken']}:false,bodyLimit:256*1024});
  app.decorateRequest('actor',null as any);
  await app.register(cors,{origin:(process.env.CORS_ORIGINS??'http://localhost:8081').split(','),methods:['GET','POST','PUT','PATCH','DELETE']});
  await app.register(rateLimit,{max:150,timeWindow:'1 minute'});
  app.setErrorHandler(sendError);
  app.get('/health',async()=>{await pool.query('SELECT 1');return {ok:true,service:'charge-api'};});
  await authRoutes(app);await ledgerRoutes(app);await budgetRoutes(app);await configurationRoutes(app);await reportRoutes(app);
  return app;
}
