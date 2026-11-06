import AsyncStorage from '@react-native-async-storage/async-storage';

export async function clearAccountCache(user:string){
  const keys=await AsyncStorage.getAllKeys();
  await AsyncStorage.multiRemove(keys.filter(k=>k.startsWith('cache:'+user+':')||k.startsWith('draft:'+user+':')||k.startsWith('record-draft:v2:'+user+':')||k.startsWith('selected-ledger:'+user+':')));
}
export async function invalidateBusinessCache(user:string,workspace:string,result:any,destructive:boolean){
  const keys=await AsyncStorage.getAllKeys();
  const invalid=new Set<string>([...(result?.invalidatedIds??[]),result?.id,result?.ledgerId].filter(Boolean));
  const remove=keys.filter(k=>k.startsWith('cache:'+user+':')&&k.includes(workspace));
  if(destructive){
    const drafts=keys.filter(k=>k.startsWith('record-draft:v2:'+user+':'+workspace+':')||k.startsWith('draft:'+user+':'+workspace+':')||k==='selected-ledger:'+user+':'+workspace);
    for(const [key,raw] of await AsyncStorage.multiGet(drafts)){
      if(!raw)continue;
      if([...invalid].some(id=>key.includes(id)||raw.includes(id)))remove.push(key);
    }
  }
  if(remove.length)await AsyncStorage.multiRemove(remove);
}
