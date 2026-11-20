import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,writeFile,readFile,rm,chmod,link,symlink,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {SqliteSaver} from '@langchain/langgraph-checkpoint-sqlite';
import {contextWorkingBudget} from '../packages/contracts/src/model-context';
import {readOwnerContextWorkingBudget,CONTEXT_WORKING_BUDGET_FILE} from '../packages/agent-service/src/context-working-budget';
import {AgentService} from '../packages/agent-service/src/service';
import {Store} from '../packages/agent-service/src/store';
import {namespace} from '../packages/agent-service/src/security';
import {OllamaDesktopRuntime} from '../packages/agent-core/src/desktop-runtime';
import {runSpec,type Registration,type Run,type Session} from '../packages/contracts/src/index';
const policy={triggerTokens:4096,keepTokens:1024},other={triggerTokens:8192,keepTokens:2048};
const reg:Registration={id:'working-context',product:'companion-vscode',profile:'fixture',workspace:'',providers:['ollama'],hostTools:[]};
const spec=runSpec.parse({runtime:'standard',mode:'plan',provider:{kind:'ollama',endpoint:'http://127.0.0.1:11434/v1',roles:{executor:'fixture'}},messages:[{role:'user',content:'Synthetic configuration test; no inference'}],tools:[],systemPrompt:''});
async function fixture(){const directory=await mkdtemp(path.join(tmpdir(),'ctx-work-'));return {directory,file:path.join(directory,CONTEXT_WORKING_BUDGET_FILE),close:()=>rm(directory,{recursive:true,force:true})};}
test('owner working context is optional strict private JSON, never model capacity, provider options or inference grants',async()=>{
 const f=await fixture();try{
  assert.equal(await readOwnerContextWorkingBudget(f.directory),undefined);await writeFile(f.file,JSON.stringify({schemaVersion:1,policy}),{mode:0o600});const bytes=await readFile(f.file);assert.deepEqual(await readOwnerContextWorkingBudget(f.directory),policy);assert.deepEqual(await readFile(f.file),bytes);
  for(const value of [{...policy,triggerTokens:0},{...policy,keepTokens:4096},{...policy,model:'gpt-6-luna'},{...policy,maxBlocks:2},{...policy,triggerTokens:NaN},{...policy,keepTokens:512.5}])assert.equal(contextWorkingBudget.safeParse(value).success,false);
  for(const value of [null,{schemaVersion:2,policy},{schemaVersion:1,policy,PRIVATE:'never echo'},{schemaVersion:1,policy:{...policy,keepTokens:4096}}]){await writeFile(f.file,JSON.stringify(value));await assert.rejects(readOwnerContextWorkingBudget(f.directory),error=>error instanceof Error&&/Invalid or unsafe/.test(error.message)&&!error.message.includes('never echo'));}
  await writeFile(f.file,'{"PRIVATE_MALFORMED":');await assert.rejects(readOwnerContextWorkingBudget(f.directory),error=>error instanceof Error&&!error.message.includes('PRIVATE_MALFORMED'));
 }finally{await f.close();}
});
test('owner working context refuses public, linked, non-file and oversized files without changing originals',{skip:process.platform==='win32'},async()=>{
 const f=await fixture(),original=f.file+'.original';try{
  await writeFile(f.file,JSON.stringify({schemaVersion:1,policy}),{mode:0o600});const bytes=await readFile(f.file);await chmod(f.file,0o644);await assert.rejects(readOwnerContextWorkingBudget(f.directory),/unsafe/);await chmod(f.file,0o600);
  await link(f.file,original);await assert.rejects(readOwnerContextWorkingBudget(f.directory),/unsafe/);await rm(f.file);await symlink(original,f.file);await assert.rejects(readOwnerContextWorkingBudget(f.directory),/unsafe/);assert.deepEqual(await readFile(original),bytes);
  await rm(f.file);await mkdir(f.file);await assert.rejects(readOwnerContextWorkingBudget(f.directory),/unsafe/);await rm(f.file,{recursive:true});await writeFile(f.file,' '.repeat(16385),{mode:0o600});await assert.rejects(readOwnerContextWorkingBudget(f.directory),/unsafe/);
 }finally{await f.close();}
});
test('generic admission captures owner context privately; new policy affects only new runs and client/child input cannot set it',async()=>{
 const f=await fixture(),file=path.join(f.directory,'state.sqlite'),seen:unknown[]=[];let store=new Store(file),service=new AgentService(store,f.directory,async(_spec,context)=>{seen.push(context.contextWorkingBudget);return {text:'No model invoked'};},{},{contextWorkingBudget:policy});
 const wait=async(run:Run)=>{for(let i=0;i<500&&store.run(reg,run.id).state==='running';i++)await new Promise(resolve=>setTimeout(resolve,2));assert.equal(store.run(reg,run.id).state,'completed');};
 try{
  const session=await service.dispatch(reg,'sessions.create',{title:'Owner context'},'fixture') as Session;const first=await service.dispatch(reg,'runs.start',{sessionId:session.id,key:'one',spec},'fixture') as Run;await wait(first);assert.deepEqual(seen.slice(),[policy]);
  const receipt=()=>store.receipt(reg,`private:${first.id}:context-working-budget`)?.value;assert.deepEqual(receipt(),policy);assert.equal(JSON.stringify(store.snapshot(reg,session.id)).includes('triggerTokens'),false);
  await assert.rejects(service.dispatch(reg,'runs.start',{sessionId:session.id,key:'forged',spec:{...spec,contextWorkingBudget:other}},'fixture'));assert.equal(seen.length,1);
  await service.close();store=new Store(file);service=new AgentService(store,f.directory,async(_spec,context)=>{seen.push(context.contextWorkingBudget);return {};},{},{contextWorkingBudget:other});
  const replay=await service.dispatch(reg,'runs.start',{sessionId:session.id,key:'one',spec},'fixture') as Run;assert.equal(replay.id,first.id);assert.deepEqual(receipt(),policy);assert.equal(seen.length,1);
  const next=await service.dispatch(reg,'runs.start',{sessionId:session.id,key:'two',spec},'fixture') as Run;await wait(next);assert.deepEqual(seen[1],other);
  const child={...reg,product:'kidos' as const};const info=await service.dispatch(child,'engine.info',{},'fixture') as {capabilities:string[];contextWorkingBudget?:unknown};assert.equal('contextWorkingBudget' in info,false);assert.equal(info.capabilities.includes('context-working-budget-v1'),false);
 }finally{await service.close();await f.close();}
});
test('Mac resumes a host wait with its captured context policy after owner changes, while legacy runs remain unset',async()=>{
 const f=await fixture(),file=path.join(f.directory,'state.sqlite'),mac={...reg,product:'companion-mac' as const};const seen:unknown[]=[];let store=new Store(file),service=new AgentService(store,f.directory,undefined,{}, {contextWorkingBudget:policy}),saver=SqliteSaver.fromConnString(path.join(f.directory,'recording.sqlite'));
 class Recording extends OllamaDesktopRuntime{override async run(options:Parameters<OllamaDesktopRuntime['run']>[0]):ReturnType<OllamaDesktopRuntime['run']>{seen.push(options.contextWorkingBudget);await options.openPreview('http://127.0.0.1:10001/private-fixture');throw Error('Fixture host wait ended.');}}
 const inject=()=>{(service as unknown as {desktopRuntimes:Map<string,OllamaDesktopRuntime>}).desktopRuntimes.set(namespace(mac),new Recording(saver));};inject();
 const desktopSpec={thread:{id:'thread',title:'Fixture',messages:[],createdAt:1,updatedAt:1},request:'Context binding only',workspacePath:'',modelRoles:{executor:'fixture'},dockerSandboxEnabled:false,mode:'plan',agentRuntime:'standard',assistantMessageId:'answer',contextPages:[]};
 const wait=async(run:Run)=>{for(let i=0;i<1000&&store.run(mac,run.id).state==='running';i++)await new Promise(resolve=>setTimeout(resolve,2));assert.equal(store.run(mac,run.id).state,'awaiting_host');};
 const cancel=async(run:Run)=>{await service.dispatch(mac,'runs.cancel',{id:run.id},'fixture');for(let i=0;i<1000&&store.run(mac,run.id).state!=='cancelled';i++)await new Promise(resolve=>setTimeout(resolve,2));assert.equal(store.run(mac,run.id).state,'cancelled');};
 try{
  const session=await service.dispatch(mac,'sessions.create',{title:'Mac binding'},'fixture') as Session,first=await service.dispatch(mac,'desktop.start',{sessionId:session.id,key:'one',spec:desktopSpec},'fixture') as Run;await wait(first);
  await service.close();saver.db.close();store=new Store(file);service=new AgentService(store,f.directory,undefined,{}, {contextWorkingBudget:other});saver=SqliteSaver.fromConnString(path.join(f.directory,'recording.sqlite'));inject();await service.dispatch(mac,'runs.resume',{id:first.id},'fixture');await wait(first);assert.deepEqual(seen,[policy,policy]);await cancel(first);
  const next=await service.dispatch(mac,'desktop.start',{sessionId:session.id,key:'two',spec:desktopSpec},'fixture') as Run;await wait(next);assert.deepEqual(seen[2],other);await cancel(next);
  await service.close();saver.db.close();store=new Store(file);service=new AgentService(store,f.directory);saver=SqliteSaver.fromConnString(path.join(f.directory,'recording.sqlite'));inject();
  const legacy=await service.dispatch(mac,'desktop.start',{sessionId:session.id,key:'legacy',spec:desktopSpec},'fixture') as Run;await wait(legacy);assert.equal(seen[3],undefined);
  await service.close();saver.db.close();store=new Store(file);service=new AgentService(store,f.directory,undefined,{}, {contextWorkingBudget:other});saver=SqliteSaver.fromConnString(path.join(f.directory,'recording.sqlite'));inject();await service.dispatch(mac,'runs.resume',{id:legacy.id},'fixture');await wait(legacy);assert.equal(seen[4],undefined);await cancel(legacy);
 }finally{await service.close();saver.db.close();await f.close();}
});
