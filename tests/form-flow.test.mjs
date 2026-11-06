import {test} from 'node:test';
import assert from 'node:assert/strict';
import {visibleFields,missingField,fieldSummary} from '../apps/mobile/src/formFlow.mjs';
test('conditional fields follow current selection, including required checks',()=>{
 const fields=[{key:'template',required:true},{key:'salary',required:true,visibleWhen:v=>v.template==='salary'},{key:'name',required:true}];
 assert.deepEqual(visibleFields(fields,{template:'blank'}).map(f=>f.key),['template','name']);
 assert.equal(missingField(fields,{template:'blank',name:'同名账本'}),undefined);
 assert.equal(missingField(fields,{template:'salary',name:'同名账本'}).key,'salary');
 assert.equal(missingField(fields,{template:'salary',salary:'0',name:'同名账本'}),undefined);
});
test('overview resolves IDs in dependent multi-selects rather than exposing IDs',()=>{
 const field={key:'category',type:'multiselect',optionsFor:v=>v.ledger==='a'?[{value:'1',label:'餐饮'},{value:'2',label:'交通'}]:[]};
 assert.equal(fieldSummary(field,{ledger:'a',category:'1,2'}),'餐饮、交通');
 assert.equal(fieldSummary(field,{ledger:'b',category:'1'}),'已失效，请重新选择');
});
test('overview masks secrets and distinguishes empty optional values from zero',()=>{
 assert.equal(fieldSummary({key:'password',type:'password'},{password:'not-for-display'}),'已填写');
 assert.equal(fieldSummary({key:'amount'},{amount:'0'}),'0');
 assert.equal(fieldSummary({key:'remark'},{}),'未填写');
});
