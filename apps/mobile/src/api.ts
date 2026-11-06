import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import {budgetStore} from './budgetStore.mjs';
import {fetchWithTimeout} from './fetchWithTimeout.mjs';
import {clearAccountCache,invalidateBusinessCache} from './businessCache';
export type User={id:string;username:string;role:'user'|'super_admin';mustChangePassword:boolean};
export type Session={accessToken:string;refreshToken:string;user:User};
let session:Session|null=null;
export let baseUrl=process.env.EXPO_PUBLIC_API_URL??(Platform.OS==='android'?'http://10.0.2.2:3100':'http://localhost:3100');
export const operationId=()=>Crypto.randomUUID();
const tokenKey='charge.session.v1';
async function store(value:string|null) {
  if(Platform.OS==='web') {value===null?sessionStorage.removeItem(tokenKey):sessionStorage.setItem(tokenKey,value);}
  else if(value===null) await SecureStore.deleteItemAsync(tokenKey);else await SecureStore.setItemAsync(tokenKey,value);
}
export async function setSession(s:Session|null) {if(session?.user.id!==s?.user.id){if(session)await clearAccountCache(session.user.id).catch(()=>{});budgetStore.clear();budgetStore.setAccount(s?.user.id??'');}session=s;await store(s?JSON.stringify(s):null);}
export async function restoreSession() {
  baseUrl=(await AsyncStorage.getItem('charge.api-url'))??baseUrl;
  const s=Platform.OS==='web'?sessionStorage.getItem(tokenKey):await SecureStore.getItemAsync(tokenKey);
  if(s) {try {session=JSON.parse(s);budgetStore.setAccount(session?.user.id??'');} catch {await setSession(null);}}
  return session;
}
export async function changeBase(url:string) {
  const u=new URL(url);if(!['http:','https:'].includes(u.protocol)) throw new Error('请输入HTTP或HTTPS地址');
  baseUrl=url.replace(/\/$/,'');await AsyncStorage.setItem('charge.api-url',baseUrl);await setSession(null);
}
let refreshing:Promise<void>|null=null;
export class ApiError extends Error {constructor(message:string,public status:number){super(message);}}
export async function api<T=any>(path:string,method='GET',body?:unknown,retry=true):Promise<T> {
  let response:Response;
  try {response=await fetchWithTimeout(baseUrl+path,{method,headers:{'Content-Type':'application/json',...(session?{Authorization:'Bearer '+session.accessToken}:{})},body:body===undefined?undefined:JSON.stringify(body)});}
  catch {throw new ApiError('连接失败或超时。输入已保留；提交结果可能未知，请先刷新核查。',0);}
  if(response.status===401&&session&&retry&&path!=='/v1/auth/login') {
    if(!refreshing) refreshing=(async()=>{
      const s=await api<Session>('/v1/auth/refresh','POST',{refreshToken:session!.refreshToken},false);await setSession(s);
    })().finally(()=>{refreshing=null;});
    try {await refreshing;return api<T>(path,method,body,false);}catch {await setSession(null);throw new ApiError('登录已失效，请重新登录',401);}
  }
  const data=await response.json();if(!response.ok) throw new ApiError(data.message??'请求失败',response.status);
  const workspace=path.match(/^\/v1\/workspaces\/([^/?]+)/)?.[1];
  if(workspace&&method!=='GET'){
    if(session)await invalidateBusinessCache(session.user.id,workspace,data,method==='DELETE'||path.endsWith('/restore')).catch(()=>{});
    budgetStore.invalidate(workspace);
  }
  return data;
}
export function accessToken(){return session?.accessToken??'';}
export async function login(username:string,password:string){const s=await api<Session>('/v1/auth/login','POST',{username,password});await setSession(s);return s;}
export const amount=(minor:number|null|undefined)=>minor==null?'待设置':(minor/100).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});
export function minor(input:string) {if(!/^(0|[1-9]\d*)(\.\d{1,2})?$/.test(input)) throw new Error('金额请填写非负数字，最多两位小数');const [a,b='']=input.split('.');const n=Number(a)*100+Number(b.padEnd(2,'0'));if(!Number.isSafeInteger(n)||n>99999999999)throw new Error('金额超出范围');return n;}
export const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
