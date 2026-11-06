import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {categoryIcons,categoryIconIds,defaultIconRules,inferCategoryIcon,resolveCategoryIcon,moveCategory,categoryIconBindings} from '../packages/categories/index.mjs';
test('100 stable category icons use real bundled Ionicons glyphs and match the DB constraint',()=>{
 const glyphs=JSON.parse(readFileSync(new URL('../node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/Ionicons.json',import.meta.url),'utf8'));
 const sql=readFileSync(new URL('../server/db/migrations/012_category_icons_and_order.sql',import.meta.url),'utf8');
 assert.equal(categoryIcons.length,100);assert.equal(new Set(categoryIconIds).size,100);assert.equal(new Set(categoryIcons.map(i=>i.glyph)).size,100);
 for(const icon of categoryIcons){assert(glyphs[icon.glyph],icon.id);assert(sql.includes("'"+icon.id+"'"));}
 for(const [pattern,id] of defaultIconRules)assert(sql.includes("WHEN name ~ '"+pattern+"' THEN '"+id+"'"));
 const bindings=categoryIconBindings([{name:'a',icon_id:'food',ledger_id:'one'},{name:'b',icon_id:'food',ledger_id:'one'},{name:'c',icon_id:'salary',ledger_id:'two'}],['one']);assert.equal(bindings.get('food'),2);assert.equal(bindings.has('salary'),false);assert.equal(bindings.size,1);
});
test('persisted icon identity survives renames and is shared by entry and history',()=>{
 assert.equal(inferCategoryIcon('通勤交通'),'transport');assert.equal(inferCategoryIcon('工资'),'salary');
 assert.equal(resolveCategoryIcon({name:'名字已改',icon_id:'transport'}).id,'transport');
 assert.equal(resolveCategoryIcon({name:'交通',icon_id:'salary'}).id,'salary');
 assert.equal(resolveCategoryIcon({name:'未知类别'}).id,'other');
 const rows=[{id:'a'},{id:'b'},{id:'c'}];assert.deepEqual(moveCategory(rows,'a',2).map(c=>c.id),['b','c','a']);assert.deepEqual(rows.map(c=>c.id),['a','b','c']);
 assert.deepEqual(moveCategory(rows,'c',9).map(c=>c.id),['a','b','c']);
});
