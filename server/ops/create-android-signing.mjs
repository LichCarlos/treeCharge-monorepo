import {randomBytes} from 'node:crypto';
import {mkdir,readFile,writeFile,access} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
const folder=path.resolve('.work/android-signing');await mkdir(folder,{recursive:true});
const filename=path.join(folder,'credentials.json'),keystore=path.join(folder,'charge-release.keystore');
let credentials;
try {credentials=JSON.parse(await readFile(filename,'utf8'));}catch(error){
 if(error.code!=='ENOENT')throw error;
 try{await access(keystore);throw new Error('Keystore exists without credentials; do not overwrite');}catch(e){if(e.code!=='ENOENT')throw e;}
 credentials={storePassword:randomBytes(32).toString('hex'),keyPassword:randomBytes(32).toString('hex'),alias:'charge-release'};
 await writeFile(filename,JSON.stringify(credentials,null,2),{flag:'wx',mode:0o600});
}
try{await access(keystore);}catch(error){
 if(error.code!=='ENOENT')throw error;
 const result=spawnSync(path.join(process.env.JAVA_HOME,'bin','keytool.exe'),['-genkeypair','-keystore',keystore,'-storetype','JKS','-storepass:env','CHARGE_KEYSTORE_PASSWORD','-keypass:env','CHARGE_KEY_PASSWORD','-alias',credentials.alias,'-keyalg','RSA','-keysize','3072','-validity','10000','-dname','CN=Charge Android, OU=Mobile, O=Charge, C=CN'],{env:{...process.env,CHARGE_KEYSTORE_PASSWORD:credentials.storePassword,CHARGE_KEY_PASSWORD:credentials.keyPassword},stdio:'pipe'});
 if(result.status!==0)throw new Error('Release keystore creation failed: '+result.stderr.toString());
}
console.log('Release signing key ready; credentials remain in .work/android-signing (not bundled).');
