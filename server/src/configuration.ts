import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { entity,transaction } from './db.js';
import { access,authenticate,HttpError,params,uuid,name } from './http.js';
import { write,meta,visible,revise } from './ledger.js';
const kinds=z.array(z.enum(['root','group','ledger','category','transaction','remark','tag','plan','goal','budget_plan','budget_item'])).min(1);
export async function configurationRoutes(app:FastifyInstance) {
  write(app,'POST','/tags',z.object({...meta,name,applicableKinds:kinds.default(['transaction'])}).strict(),async(db,req,w,b)=>{
    const id=await entity(db,w,'tag');await db.query('INSERT INTO auxiliary_tags(id,workspace_id,name,applicable_kinds) VALUES($1,$2,$3,$4)',[id,w,b.name,b.applicableKinds]);return {id};
  });
  write(app,'PUT','/tags/:id',z.object({...meta,name,applicableKinds:kinds,expectedRevision:z.number().int().positive()}).strict(),async(db,req,w,b)=>{
    const id=uuid.parse(params(req).id);await visible(db,w,id,'tag',b.expectedRevision);
    await db.query('UPDATE auxiliary_tags SET name=$2,applicable_kinds=$3 WHERE id=$1',[id,b.name,b.applicableKinds]);await revise(db,id);return {id};
  });
  write(app,'POST','/fields',z.object({...meta,name,fieldType:z.enum(['text','integer','decimal','money','date','boolean','single_select','multi_select','entity']),applicableKinds:kinds.default(['transaction']),options:z.array(name).max(100).default([])}).strict(),async(db,req,w,b)=>{
    const id=await entity(db,w,'field');await db.query('INSERT INTO field_definitions(id,workspace_id,name,field_type,applicable_kinds) VALUES($1,$2,$3,$4,$5)',[id,w,b.name,b.fieldType,b.applicableKinds]);
    for(const [i,n] of b.options.entries()) await db.query('INSERT INTO field_options(workspace_id,field_id,name,position) VALUES($1,$2,$3,$4)',[w,id,n,i]);return {id};
  });
  write(app,'PUT','/fields/:id',z.object({...meta,name,expectedRevision:z.number().int().positive()}).strict(),async(db,req,w,b)=>{
    const id=uuid.parse(params(req).id);await visible(db,w,id,'field',b.expectedRevision);await db.query('UPDATE field_definitions SET name=$2 WHERE id=$1',[id,b.name]);await revise(db,id);return {id};
  });
  write(app,'POST','/relations',z.object({...meta,name,cardinality:z.enum(['one_to_one','one_to_many']),sourceKinds:kinds.default(['transaction']),targetKinds:kinds.default(['transaction'])}).strict(),async(db,req,w,b)=>{
    const id=await entity(db,w,'relation');await db.query('INSERT INTO relation_definitions(id,workspace_id,name,cardinality,source_kinds,target_kinds) VALUES($1,$2,$3,$4,$5,$6)',[id,w,b.name,b.cardinality,b.sourceKinds,b.targetKinds]);return {id};
  });
  app.get('/v1/workspaces/:w/entities/:id/configuration',{preHandler:authenticate},async req=>transaction(async db=>{
    const w=uuid.parse(params(req).w),id=uuid.parse(params(req).id);await access(req,db,w);const e=await visible(db,w,id);
    return {
      entity:e,
      bindings:(await db.query('SELECT tag_id FROM entity_tag_bindings WHERE entity_id=$1',[id])).rows,
      fields:(await db.query('SELECT f.*,v.value_text,v.value_integer,v.value_decimal,v.value_date,v.value_boolean,v.value_entity FROM field_definitions f JOIN entities e ON e.id=f.id AND e.deleted_at IS NULL LEFT JOIN entity_field_values v ON v.field_id=f.id AND v.entity_id=$1 WHERE f.workspace_id=$2 AND $3=ANY(f.applicable_kinds)',[id,w,e.kind])).rows,
      options:(await db.query('SELECT * FROM field_options WHERE workspace_id=$1 ORDER BY position',[w])).rows,
      selectedOptions:(await db.query('SELECT field_id,option_id FROM entity_field_option_values WHERE entity_id=$1',[id])).rows,
      edges:(await db.query('SELECT * FROM relation_edges WHERE source_id=$1 OR target_id=$1',[id])).rows
    };
  }));
  write(app,'PUT','/entities/:id/configuration',z.object({...meta,expectedRevision:z.number().int().positive(),tagIds:z.array(uuid).max(100),values:z.array(z.object({fieldId:uuid,value:z.union([z.string().max(10000),z.number().finite(),z.boolean(),z.array(uuid).max(100),z.null()])}).strict()).max(100),edges:z.array(z.object({definitionId:uuid,targetId:uuid}).strict()).max(100)}).strict(),async(db,req,w,b)=>{
    const id=uuid.parse(params(req).id),e=await visible(db,w,id,undefined,b.expectedRevision);
    await db.query('DELETE FROM entity_tag_bindings WHERE entity_id=$1',[id]);
    for(const tid of b.tagIds) {
      await visible(db,w,tid,'tag');const t=(await db.query('SELECT * FROM auxiliary_tags WHERE id=$1',[tid])).rows[0];
      if(!t.applicable_kinds.includes(e.kind)) throw new HttpError(422,'标签不适用于该实体');
      await db.query('INSERT INTO entity_tag_bindings VALUES($1,$2,$3)',[w,id,tid]);
    }
    for(const v of b.values) {
      await visible(db,w,v.fieldId,'field');const f=(await db.query('SELECT * FROM field_definitions WHERE id=$1',[v.fieldId])).rows[0];
      await db.query('DELETE FROM entity_field_values WHERE entity_id=$1 AND field_id=$2',[id,v.fieldId]);await db.query('DELETE FROM entity_field_option_values WHERE entity_id=$1 AND field_id=$2',[id,v.fieldId]);
      if(v.value===null||v.value==='') {if(f.required) throw new HttpError(422,f.name+'为必填');continue;}
      if(['single_select','multi_select'].includes(f.field_type)) {
        const opts=z.array(uuid).parse(v.value);if(f.field_type==='single_select'&&opts.length>1) throw new HttpError(422,'单选字段只能选一项');
        for(const option of opts) await db.query('INSERT INTO entity_field_option_values VALUES($1,$2,$3,$4)',[w,id,f.id,option]);
      } else {
        const columns:Record<string,string>={text:'value_text',integer:'value_integer',money:'value_integer',decimal:'value_decimal',date:'value_date',boolean:'value_boolean',entity:'value_entity'};
        if(f.field_type==='entity') await visible(db,w,uuid.parse(v.value));
        if(['integer','money'].includes(f.field_type)) z.number().int().safe().parse(v.value);
        if(f.field_type==='decimal') z.number().finite().parse(v.value);
        if(f.field_type==='date') z.iso.date().parse(v.value);
        if(f.field_type==='boolean') z.boolean().parse(v.value);
        if(f.field_type==='text') z.string().parse(v.value);
        await db.query(`INSERT INTO entity_field_values(workspace_id,entity_id,field_id,${columns[f.field_type]}) VALUES($1,$2,$3,$4)`,[w,id,f.id,v.value]);
      }
    }
    await db.query('DELETE FROM relation_edges WHERE source_id=$1',[id]);
    for(const edge of b.edges) {
      await visible(db,w,edge.definitionId,'relation');await visible(db,w,edge.targetId);
      await db.query('INSERT INTO relation_edges VALUES($1,$2,$3,$4)',[w,edge.definitionId,id,edge.targetId]);
    }
    await revise(db,id);return {id};
  });
}
