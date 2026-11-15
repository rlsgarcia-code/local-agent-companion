import {constants,type Stats} from 'node:fs';
import {lstat,open} from 'node:fs/promises';
import path from 'node:path';
import {z} from 'zod';
import {contextWorkingBudget,type ContextWorkingBudget} from '../../contracts/src/model-context';
export const CONTEXT_WORKING_BUDGET_FILE='context-working-budget.json';
const document=z.object({schemaVersion:z.literal(1),policy:contextWorkingBudget}).strict();
const safe=(stat:Stats)=>stat.isFile()&&!stat.isSymbolicLink()&&stat.nlink===1&&(!process.getuid||(stat.uid===process.getuid()&&(stat.mode&0o077)===0));
/** Private optional owner configuration. Invalid/present files refuse startup;
 * absence preserves native defaults. Never consumes client or model input. */
export async function readOwnerContextWorkingBudget(directory:string):Promise<ContextWorkingBudget|undefined>{
 const file=path.join(directory,CONTEXT_WORKING_BUDGET_FILE);let before:Stats;
 try{before=await lstat(file);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return undefined;throw Error('Cannot inspect owner context policy.');}
 try{
  if(!safe(before)||before.size<1||before.size>16384)throw Error();
  const handle=await open(file,constants.O_RDONLY|(process.platform==='win32'?0:constants.O_NOFOLLOW));
  try{
   const current=await handle.stat();if(!safe(current)||current.ino!==before.ino||current.dev!==before.dev||current.size!==before.size)throw Error();
   const bytes=Buffer.alloc(16385);let used=0;
   while(used<bytes.length){const result=await handle.read(bytes,used,bytes.length-used,null);if(!result.bytesRead)break;used+=result.bytesRead;}
   const after=await handle.stat();if(used!==before.size||used>16384||!safe(after)||after.size!==used||after.mtimeMs!==before.mtimeMs)throw Error();
   return document.parse(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,used)))).policy;
  }finally{await handle.close();}
 }catch{throw Error('Invalid or unsafe owner context policy. Existing state was preserved; no default fallback is allowed.');}
}
