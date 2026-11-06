import {cp,mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
const root=process.cwd(),target=path.resolve(process.argv[2]??'.work/backend-release');
if(!target.startsWith(root+path.sep))throw new Error('Release output must stay inside workspace');
await mkdir(target,{recursive:true});
const server=JSON.parse(await readFile('server/package.json','utf8'));
await writeFile(path.join(target,'package.json'),JSON.stringify({name:'charge-api-runtime',version:server.version,private:true,type:'module',engines:{node:'>=22'},dependencies:{...server.dependencies,'@charge/calendar':'file:packages/calendar','@charge/categories':'file:packages/categories'}},null,2)+'\n');
for(const [source,dest] of [['server/dist','dist'],['packages/calendar','packages/calendar'],['server/db','server/db'],['server/ops','server/ops'],['src/domain/templates/default-templates.json','src/domain/templates/default-templates.json']]){
  await cp(path.join(root,source),path.join(target,dest),{recursive:true});
}
console.log('Release prepared:',target);
await cp(path.join(root,'packages/categories'),path.join(target,'packages/categories'),{recursive:true});
