import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt=promisify(scryptCallback);
export async function hashPassword(password:string) {
  const salt=randomBytes(16); const hash=await scrypt(password,salt,64) as Buffer;
  return `scrypt$16384$8$1$${salt.toString('base64')}$${hash.toString('base64')}`;
}
export async function verifyPassword(password:string,encoded:string) {
  const parts=encoded.split('$');
  if(parts.length!==6||parts.slice(0,4).join('$')!=='scrypt$16384$8$1') return false;
  const actual=await scrypt(password,Buffer.from(parts[4],'base64'),64) as Buffer;
  const expected=Buffer.from(parts[5],'base64');
  return actual.length===expected.length && timingSafeEqual(actual,expected);
}
export const token=()=>randomBytes(32).toString('base64url');
export const digest=(text:string)=>createHash('sha256').update(text).digest('hex');
export function canonical(value:unknown):string {
  if(value===null||typeof value!=='object') return JSON.stringify(value);
  if(Array.isArray(value)) return '['+value.map(canonical).join(',')+']';
  return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical((value as Record<string,unknown>)[k])).join(',')+'}';
}
