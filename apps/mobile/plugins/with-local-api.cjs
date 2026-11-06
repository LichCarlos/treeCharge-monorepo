const {withAndroidManifest}=require('@expo/config-plugins');
module.exports=function withLocalApi(config){
  const api=process.env.EXPO_PUBLIC_API_URL||'http://10.0.2.2:3100';
  const local=process.env.EAS_BUILD_PROFILE!=='production';
  if(!local&&!api.startsWith('https://'))throw new Error('Production builds require EXPO_PUBLIC_API_URL=https://...');
  return withAndroidManifest(config,c=>{
    c.modResults.manifest.application[0].$['android:usesCleartextTraffic']=local?'true':'false';
    return c;
  });
};
