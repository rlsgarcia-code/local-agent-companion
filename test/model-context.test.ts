import {SqliteSaver} from '@langchain/langgraph-checkpoint-sqlite';
import {executeGraph} from '../packages/agent-core/src/index';
import {namespace as namespaceKey} from '../packages/agent-service/src/security';
import assert from 'node:assert/strict';
import test from 'node:test';
import {createServer} from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {modelContextWindow,modelContextWindows,parseOptionalModelContextWindow} from '../packages/contracts/src/model-context';
import {providerSpec,runSpec,type Registration,type Session,type Run,AgentError,errors} from '../packages/contracts/src/index';
import {parseLiteLlmModelProfiles,updateLiteLlmModelProfile} from '../packages/agent-core/src/litellm';
import {createConnectionProfile,parseConnectionProfile,serializeConnectionProfile} from '../src/connection-profile';
import {parseIncomingMessage} from '../src/webview-protocol';
import {ProviderModels} from '../packages/agent-core/src/provider-models';
import {ContextualChatCompletions,declaredModelContextWindow} from '../packages/agent-core/src/model-context';
import {Models} from '../packages/agent-service/src/models';
import {Store} from '../packages/agent-service/src/store';
import {AgentService} from '../packages/agent-service/src/service';
import type {InferenceBudgetSnapshot} from '../packages/contracts/src/inference-budget';

const reg:Registration={id:'context-fixture',product:'companion-vscode',profile:'context-fixture',workspace:'',providers:['ollama'],hostTools:[]};
test('effective context windows are bounded numeric declarations, exact aliases and portable profile data, never arbitrary provider options',()=>{
 for(const v of [2048,8192,131072,2000000])assert.equal(modelContextWindow.parse(v),v);
 for(const v of [2047,2000001,0,-1,NaN,Infinity,8192.5,'8192',{},null])assert.equal(modelContextWindow.safeParse(v).success,false);
 assert.equal(parseOptionalModelContextWindow('8192'),8192);assert.equal(parseOptionalModelContextWindow(''),undefined);assert.throws(()=>parseOptionalModelContextWindow('8k'));
 assert.equal(modelContextWindows.safeParse({'__proto__':8192,constructor:4096}).success,false);
 const profiles=updateLiteLlmModelProfile({},'Exact/Alias',{contextWindow:8192});assert.deepEqual(parseLiteLlmModelProfiles(profiles),profiles);assert.deepEqual(updateLiteLlmModelProfile(profiles,'Exact/Alias',{}),{});for(const contextWindow of [3,null,'8192'])assert.throws(()=>parseLiteLlmModelProfiles({broken:{contextWindow}}));
 const portable=createConnectionProfile({gateway:{endpoint:'https://gateway.invalid/v1',modelsEndpoint:'',authHeader:'api-key',requiresKey:true,requiresCorporateCa:false},models:{chat:'Exact/Alias',embedding:'',semanticMemoryEnabled:false,profiles},workspace:{runtime:'deep',autonomyMode:'review'}});
 assert.deepEqual(parseConnectionProfile(JSON.parse(serializeConnectionProfile(portable))).models.profiles,profiles);assert.throws(()=>parseConnectionProfile({...portable,models:{...portable.models,profiles:{'Exact/Alias':{contextWindow:'8192'}}}}));
 const provider={kind:'ollama',endpoint:'http://127.0.0.1:11434/v1',roles:{executor:'Exact/Alias'},modelProfiles:profiles};assert.deepEqual(providerSpec.parse(provider).modelProfiles,profiles);assert.equal(providerSpec.safeParse({...provider,profile:{contextWindow:8192,options:{num_ctx:8192}}}).success,false);
 const message={type:'testLiteLlm',provider:'ollama',endpoint:provider.endpoint,model:'Exact/Alias',apiKey:'',authHeader:'authorization',modelsEndpoint:'',preset:'custom',reasoningEffort:'omit',temperature:'',topP:'',semanticMemoryEnabled:false,embeddingModel:'',contextWindow:'8192'};assert.ok(parseIncomingMessage(message));assert.equal(parseIncomingMessage({...message,contextWindow:8192}),undefined);
});

test('the factory applies declarations only to the selected exact role and preserves default profiles and offline token counting',async()=>{
 const models=new ProviderModels({kind:'ollama',endpoint:'http://127.0.0.1:11434/v1',roles:{executor:'Exact',planner:'PLAN',evaluator:'EVAL'},authHeader:'authorization',profile:{contextWindow:32768},modelProfiles:{Exact:{contextWindow:8192},PLAN:{contextWindow:4096}}},undefined,new AbortController().signal);
 try{const executor=models.model(),planner=models.model('planner'),evaluator=models.model('evaluator');assert.equal(executor.profile.maxInputTokens,8192);assert.equal(planner.profile.maxInputTokens,4096);assert.equal(declaredModelContextWindow(evaluator),undefined);assert.equal(evaluator.profile.maxInputTokens,undefined);assert.equal(await executor.getNumTokens('abc'),1);}
 finally{await models.close();}
 const original=new ContextualChatCompletions({model:'gpt-4o',apiKey:'synthetic'}),overridden=new ContextualChatCompletions({model:'gpt-4o',apiKey:'synthetic'},8192);assert.equal(declaredModelContextWindow(original),undefined);assert.equal(overridden.profile.maxInputTokens,8192);assert.deepEqual({...overridden.profile,maxInputTokens:original.profile.maxInputTokens},original.profile);
});

test('model settings preserve windows during legacy role edits, enforce revision/namespace and refuse KidOS management',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'context-settings-')),store=new Store(path.join(directory,'metadata.sqlite')),models=new Models(store,directory);try{
  const first=models.configure(reg,{revision:0,roles:{executor:'Exact'},contextWindows:{Exact:8192}});assert.equal(first.contextWindows?.Exact,8192);
  const next=models.configure(reg,{revision:1,roles:{executor:'Other'}});assert.equal(next.contextWindows?.Exact,8192);assert.equal(models.configuration({...reg,profile:'other'}),null);assert.throws(()=>models.configure(reg,{revision:1,roles:{executor:'Exact'},contextWindows:{Exact:32768}}),/Refresh/);
  assert.throws(()=>models.configure({...reg,product:'kidos'},{revision:0,roles:{executor:'Exact'},contextWindows:{Exact:8192}}),/system authority/);
  assert.deepEqual(models.configure(reg,{revision:2,roles:{executor:'Other'},contextWindows:{}}).contextWindows,{});
 }finally{await models.close();store.close();await rm(directory,{recursive:true,force:true});}
});

for(const runtime of ['standard','deep'] as const)test(`${runtime}: native compaction shares real inference accounting, hides its output and replays its checkpoint without another model call`,async()=>{
 let requests:any[]=[];const server=createServer((request,response)=>{let body='';request.on('data',b=>{body+=b;});request.on('end',()=>{const input=JSON.parse(body);requests.push(input);const text=requests.length===1?'PRIVATE_COMPACTION_ONLY':'PUBLIC_FINAL';response.writeHead(200,{'content-type':'text/event-stream'});response.write(`data: ${JSON.stringify({id:`call-${requests.length}`,object:'chat.completion.chunk',model:'fixture',choices:[{index:0,delta:{role:'assistant',content:text},finish_reason:'stop'}]})}\n\n`);response.write(`data: ${JSON.stringify({id:`call-${requests.length}`,object:'chat.completion.chunk',model:'fixture',choices:[],usage:{prompt_tokens:100,completion_tokens:5,total_tokens:105}})}\n\n`);response.end('data: [DONE]\n\n');});});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address==='object');const directory=await mkdtemp(path.join(tmpdir(),'native-context-')),service=new AgentService(new Store(path.join(directory,'metadata.sqlite')),directory);
 const messages=[];for(let i=0;i<20;i++)messages.push({role:'user',content:'Historical public request '+String(i)+' '+'.'.repeat(900)},{role:'assistant',content:'Historical public answer '+String(i)+' '+'.'.repeat(900)});messages.push({role:'user',content:'Return PUBLIC_FINAL, no tools.'});
 const spec=runSpec.parse({runtime,mode:'plan',provider:{kind:'ollama',endpoint:`http://127.0.0.1:${address.port}/v1`,roles:{executor:'fixture'},profile:{contextWindow:8192}},systemPrompt:'Read-only synthetic context test. Never execute tools.',messages,tools:[]});
 try{
  const session=await service.dispatch(reg,'sessions.create',{title:'Native compaction'},'fixture') as Session,run=await service.dispatch(reg,'runs.start',{sessionId:session.id,key:'one',spec},'fixture') as Run;
  for(let i=0;i<2000&&service.store.run(reg,run.id).state==='running';i++)await new Promise(resolve=>setTimeout(resolve,5));const saved=service.store.run(reg,run.id);assert.equal(saved.state,'completed',saved.error);assert.equal(requests.length,2);
  assert.ok(JSON.stringify(requests[1].messages).includes('PRIVATE_COMPACTION_ONLY'));const oldBefore=(JSON.stringify(requests[0].messages).match(/Historical public/g)??[]).length,oldAfter=(JSON.stringify(requests[1].messages).match(/Historical public/g)??[]).length;assert.ok(oldBefore>0&&oldAfter<oldBefore,JSON.stringify({oldBefore,oldAfter}));
  for(const body of requests)for(const key of ['contextWindow','num_ctx','options','max_context_tokens'])assert.equal(key in body,false);
  const snapshot=service.store.snapshot(reg,session.id),publicText=JSON.stringify(snapshot.events.filter(e=>e.type==='text.delta'||e.type==='text.final'));assert.equal(publicText.includes('PRIVATE_COMPACTION_ONLY'),false);assert.ok(publicText.includes('PUBLIC_FINAL'));
  const budget=await service.dispatch(reg,'inference.budgets.get',{sessionId:session.id},'fixture') as InferenceBudgetSnapshot,namespace=budget.budgets.find(b=>b.scope.kind==='namespace')!;assert.equal(namespace.calls,2);assert.equal(namespace.pendingCalls,0);assert.equal(namespace.chargedTokens,210);
  await service.dispatch(reg,'runs.start',{sessionId:session.id,key:'one',spec},'fixture');assert.equal(requests.length,2);assert.equal((service.store.db.prepare("SELECT count(*) AS n FROM receipts WHERE status IN ('started','completed')").get() as {n:number}).n,0);
  await service.close();const saver=SqliteSaver.fromConnString(path.join(directory,'namespaces',namespaceKey(reg),'graph.sqlite'));
  try{const replay=await executeGraph(spec,{registration:reg,threadId:run.id,checkpointer:saver,signal:new AbortController().signal,requireCheckpoint:true,emit:()=>{},invokeTool:async()=>assert.fail('No tool replay'),inferenceBudget:{begin:async()=>assert.fail('Completed checkpoint must not invoke a model'),finish:()=>{}}});assert.ok(JSON.stringify(replay).includes('PUBLIC_FINAL'));assert.equal(requests.length,2);}finally{saver.db.close();}

 }finally{await service.close();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(directory,{recursive:true,force:true});}
});

test('Mac admission freezes context across host waiting, service restart and resume; new runs use new settings',async()=>{
 const {OllamaDesktopRuntime}=await import('../packages/agent-core/src/desktop-runtime');
 type Runtime=InstanceType<typeof OllamaDesktopRuntime>;
 const directory=await mkdtemp(path.join(tmpdir(),'mac-context-binding-')),file=path.join(directory,'metadata.sqlite'),mac:Registration={...reg,product:'companion-mac'};
 let store=new Store(file),service=new AgentService(store,directory),saver=SqliteSaver.fromConnString(path.join(directory,'recording.sqlite'));const seen:unknown[]=[];
 class RecordingRuntime extends OllamaDesktopRuntime{
  override async run(options:Parameters<Runtime['run']>[0]):ReturnType<Runtime['run']>{seen.push(options.modelContextWindows);await options.openPreview('http://127.0.0.1:10001/owned-fixture');throw Error('Owned fixture host wait ended.');}
 }
 const inject=()=>{(service as unknown as {desktopRuntimes:Map<string,Runtime>}).desktopRuntimes.set(namespaceKey(mac),new RecordingRuntime(saver));};inject();
 const spec={thread:{id:'thread',title:'Fixture',messages:[],createdAt:1,updatedAt:1},request:'Read-only context binding.',workspacePath:'',modelRoles:{executor:'Exact'},dockerSandboxEnabled:false,mode:'plan',agentRuntime:'standard',assistantMessageId:'answer',contextPages:[]};
 async function waiting(run:Run){for(let i=0;i<1000&&store.run(mac,run.id).state==='running';i++)await new Promise(resolve=>setTimeout(resolve,2));assert.equal(store.run(mac,run.id).state,'awaiting_host');}
 async function cancel(run:Run){await service.dispatch(mac,'runs.cancel',{id:run.id},'fixture');for(let i=0;i<1000&&store.run(mac,run.id).state!=='cancelled';i++)await new Promise(resolve=>setTimeout(resolve,2));assert.equal(store.run(mac,run.id).state,'cancelled');}
 try{
  await service.dispatch(mac,'models.configure',{revision:0,roles:{executor:'Exact'},contextWindows:{Exact:8192}},'fixture');const session=await service.dispatch(mac,'sessions.create',{title:'Bound context'},'fixture') as Session,first=await service.dispatch(mac,'desktop.start',{sessionId:session.id,key:'one',spec},'fixture') as Run;await waiting(first);
  await service.dispatch(mac,'models.configure',{revision:1,roles:{executor:'Exact'},contextWindows:{Exact:32768}},'fixture');await service.close();saver.db.close();
  store=new Store(file);service=new AgentService(store,directory);saver=SqliteSaver.fromConnString(path.join(directory,'recording.sqlite'));inject();await service.dispatch(mac,'runs.resume',{id:first.id},'fixture');await waiting(first);assert.deepEqual(seen,[{Exact:8192},{Exact:8192}]);
  await cancel(first);
  const second=await service.dispatch(mac,'desktop.start',{sessionId:session.id,key:'two',spec},'fixture') as Run;await waiting(second);assert.deepEqual(seen[2],{Exact:32768});await cancel(second);
  await service.dispatch(mac,'models.configure',{revision:2,roles:{executor:'Exact'},contextWindows:{}},'fixture');const third=await service.dispatch(mac,'desktop.start',{sessionId:session.id,key:'three',spec},'fixture') as Run;await waiting(third);assert.deepEqual(seen[3],{});
  assert.equal(store.snapshot(mac,session.id).events.some(e=>e.type==='model.failure'),false);
 }finally{await service.close();saver.db.close();await rm(directory,{recursive:true,force:true});}
});
