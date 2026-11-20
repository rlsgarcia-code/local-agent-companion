// An explicit development bundle and synthetic loopback SSE only. No personal
// service, real inference, installer, budget renewal or client UI is exercised.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:http';
import {createHash,randomUUID} from 'node:crypto';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import security from '../dist-tests/packages/agent-service/src/security.js';
import storage from '../dist-tests/packages/agent-service/src/store.js';
import sdk from '../dist-tests/packages/client-ts/src/index.js';
import bootstrap from '../dist-tests/packages/client-ts/src/bootstrap.js';

const args=process.argv.slice(2);assert.equal(args.length,1,'Supply one --engine=<exact-development-bundle>');
assert.ok(args[0].startsWith('--engine=')&&args[0].slice(9),'An explicit bundle is required');
const engine=path.resolve(args[0].slice(9));await bootstrap.verifyBundle(engine,undefined,true);
const manifest=await readFile(path.join(engine,'manifest.json'));
const manifestSha256=createHash('sha256').update(manifest).digest('hex');
const root=await mkdtemp(path.join(tmpdir(),'working-context-engine-'));
const output=path.resolve('output/game-generation/working-context-engine',`${new Date().toISOString().replace(/[:.]/g,'-')}-${randomUUID().slice(0,8)}`);
await mkdir(output,{recursive:true});
const state=path.join(root,'state');await mkdir(state,{mode:0o700});
const policyFile=path.join(state,'context-working-budget.json');
const firstPolicy={triggerTokens:4096,keepTokens:1024},nextPolicy={triggerTokens:8192,keepTokens:2048};
await writeFile(policyFile,JSON.stringify({schemaVersion:1,policy:firstPolicy}),{mode:0o600});
const identity=await security.ensureIdentity(state);
const credential=await security.createClientCredential(state,{id:'working-context-fixture',product:'companion-vscode',profile:'fixture',workspace:'',providers:['ollama'],hostTools:[]});
const initialStore=new storage.Store(path.join(state,'metadata.sqlite'));initialStore.register(credential);initialStore.close();
const childEnv={...process.env,LANGSMITH_TRACING:'false',LANGSMITH_TRACING_V2:'false',LANGCHAIN_TRACING_V2:'false',LANGSMITH_OTEL_ENABLED:'false',OTEL_ENABLED:'false'};
delete childEnv.OPENAI_API_KEY;delete childEnv.LANGCHAIN_TRACING;
const tick=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let child,client,passed=false;const requests=[],sessions=[],results=[];let responseIndex=0;
const server=createServer((request,response)=>{
 let body='';request.on('data',part=>body+=part);request.on('end',()=>{
  assert.equal(request.method,'POST');assert.equal(request.url,'/v1/chat/completions');requests.push(JSON.parse(body));
  const content=++responseIndex===1?'PRIVATE_WORKING_ENGINE_SUMMARY':'PUBLIC_WORKING_ENGINE_FINAL';
  response.writeHead(200,{'content-type':'text/event-stream'});
  response.write(`data: ${JSON.stringify({id:'working-'+requests.length,object:'chat.completion.chunk',model:'unprofiled-working-fixture',choices:[{index:0,delta:{role:'assistant',content},finish_reason:'stop'}]})}\n\n`);
  response.write(`data: ${JSON.stringify({id:'working-'+requests.length,object:'chat.completion.chunk',model:'unprofiled-working-fixture',choices:[],usage:{prompt_tokens:100,completion_tokens:5,total_tokens:105}})}\n\n`);response.end('data: [DONE]\n\n');
 });
});
function spawnService(){
 const owned=spawn(path.join(engine,'node'),[path.join(engine,'service.cjs'),state],{stdio:['ignore','ignore','pipe'],env:childEnv});
 let stderr='';owned.stderr.on('data',bytes=>{if(stderr.length<8192)stderr+=bytes.toString().slice(0,8192-stderr.length);});
 owned.stderrText=()=>stderr;return owned;
}
async function start(){
 child=spawnService();let ready=false;
 for(let i=0;i<600;i++){
  assert.equal(child.exitCode,null,'Owned development service exited before readiness');
  try{if(JSON.parse(await readFile(path.join(state,'runtime.json'),'utf8')).pid===child.pid){ready=true;break;}}catch{}
  await tick(25);
 }
 assert.ok(ready,'Observe the original process after a readiness timeout; never automatically relaunch');
 client=new sdk.AgentClient({address:security.ipcPath(state),certificate:identity.cert,credential});await client.connect();
}
async function stop(){client?.close();client=undefined;if(child?.exitCode===null){const stopped=once(child,'exit');child.kill('SIGTERM');await stopped;}}
const syntheticMessages=[];
for(let i=0;i<20;i++)syntheticMessages.push({role:'user',content:`ORIGINAL_WORKING_${i}: ${'.'.repeat(900)}`},{role:'assistant',content:`Original public answer ${i}: ${'.'.repeat(900)}`});
syntheticMessages.push({role:'user',content:'Return the public final without tools.'});
function privateReceipts(){
 const store=new storage.Store(path.join(state,'metadata.sqlite'));
 try{for(const session of sessions)assert.deepEqual(store.receipt(credential.registration,`private:${session.runId}:context-working-budget`)?.value,session.policy);}finally{store.close();}
}
try{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address==='object');await start();
 const info=await client.call('engine.info');assert.ok(info.capabilities.includes('context-working-budget-v1'));assert.deepEqual(info.contextWorkingBudget,firstPolicy);
 for(const runtime of ['standard','deep']){
  responseIndex=0;const beforeRequests=requests.length;
  const spec={runtime,mode:'plan',provider:{kind:'ollama',endpoint:`http://127.0.0.1:${address.port}/v1`,roles:{executor:'unprofiled-working-fixture'}},messages:syntheticMessages,systemPrompt:'Read-only synthetic history. No tools or real provider.',tools:[]};
  const key='working-'+runtime,session=await client.call('sessions.create',{title:'Working context '+runtime});
  const original=await client.startRun(session.id,key,spec),run=await client.waitForRun(original.id,session.id,()=>{},undefined,AbortSignal.timeout(20000));
  assert.equal(run.state,'completed',run.error);assert.equal(requests.length-beforeRequests,2);
  const batch=requests.slice(beforeRequests);assert.ok(JSON.stringify(batch[1].messages).includes('PRIVATE_WORKING_ENGINE_SUMMARY'));
  const before=(JSON.stringify(batch[0].messages).match(/ORIGINAL_WORKING_/g)??[]).length,after=(JSON.stringify(batch[1].messages).match(/ORIGINAL_WORKING_/g)??[]).length;assert.ok(before>after);
  for(const input of batch){assert.equal(input.model,'unprofiled-working-fixture');for(const field of ['contextWindow','contextWorkingBudget','triggerTokens','keepTokens','options','num_ctx','context_management'])assert.equal(field in input,false);}
  const snapshot=await client.snapshotSession(session.id);assert.equal(JSON.stringify(snapshot).includes('PRIVATE_WORKING_ENGINE_SUMMARY'),false);assert.ok(JSON.stringify(snapshot.events).includes('PUBLIC_WORKING_ENGINE_FINAL'));
  const budget=await client.getInferenceBudgets(session.id),scope=budget.budgets.find(value=>value.scope.kind==='namespace'),expectedCalls=runtime==='standard'?2:4;
  assert.equal(scope.calls,expectedCalls);assert.equal(scope.chargedTokens,105*expectedCalls);assert.equal(scope.pendingCalls,0);
  sessions.push({id:session.id,key,spec,runId:run.id,policy:firstPolicy});
  results.push({runtime,summaryCalls:1,normalCalls:1,originalHistoryMarkersBefore:before,originalHistoryMarkersAfter:after,privateSummaryAbsentFromEntireSnapshot:true,cumulativeCalls:scope.calls,cumulativeSyntheticTokens:scope.chargedTokens});
 }
 await stop();privateReceipts();await writeFile(policyFile,JSON.stringify({schemaVersion:1,policy:nextPolicy}));await start();
 assert.deepEqual((await client.call('engine.info')).contextWorkingBudget,nextPolicy);const beforeReplay=requests.length;
 for(const session of sessions){const replay=await client.startRun(session.id,session.key,session.spec);assert.equal(replay.id,session.runId);assert.equal(replay.state,'completed');assert.equal(JSON.stringify(await client.snapshotSession(session.id)).includes('PRIVATE_WORKING_ENGINE_SUMMARY'),false);}
 assert.equal(requests.length,beforeReplay,'Completed replay invoked inference');
 responseIndex=1;const session=await client.call('sessions.create',{title:'New policy admission'}),spec={...sessions[0].spec,messages:[{role:'user',content:'Only return the public final.'}]};
 const run=await client.startRun(session.id,'new-policy',spec),saved=await client.waitForRun(run.id,session.id,()=>{},undefined,AbortSignal.timeout(20000));assert.equal(saved.state,'completed',saved.error);assert.equal(requests.length,beforeReplay+1);
 sessions.push({id:session.id,key:'new-policy',runId:run.id,spec,policy:nextPolicy});await stop();privateReceipts();
 // A present malformed policy must fail closed, preserve bytes and never echo
 // them. The old ledger/receipts must remain intact, not be recreated as fresh.
 const malformed='{"PRIVATE_INVALID_POLICY":';await writeFile(policyFile,malformed);child=spawnService();const [exit]=await once(child,'exit');assert.notEqual(exit,0);assert.match(child.stderrText(),/Companion engine failed to start/);assert.equal(child.stderrText().includes('PRIVATE_INVALID_POLICY'),false);assert.equal(await readFile(policyFile,'utf8'),malformed);privateReceipts();
 await bootstrap.verifyBundle(engine,undefined,true);assert.equal(createHash('sha256').update(await readFile(path.join(engine,'manifest.json'))).digest('hex'),manifestSha256);
 await writeFile(path.join(output,'report.json'),JSON.stringify({scope:'Explicit immutable development engine, bundled Node, actual SDK/TLS and official graphs. Synthetic loopback SSE; no real provider, personal state, GUI, installation or game acceptance.',engine,manifestSha256,results,originalPolicyRetainedAfterRestart:true,newPolicyOnlyForNewRuns:true,completedReplayWithoutInference:true,malformedOwnerFileRefusesStartupWithoutEcho:true,allOwnedProcessesClosed:true,totalSyntheticRequests:requests.length,realInference:false},null,2)+'\n');
 passed=true;console.log('WORKING_CONTEXT_ENGINE_OK '+output);
}catch(error){await writeFile(path.join(output,'failure.json'),JSON.stringify({message:error instanceof Error?error.message:String(error)},null,2)+'\n');throw error;}
finally{await stop();server.closeAllConnections();await new Promise(resolve=>server.close(()=>resolve()));if(passed)await rm(root,{recursive:true,force:true});else console.error('Owned fixture retained: '+root);}
