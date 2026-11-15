// Actual packaged service, SDK/TLS and official graph. Synthetic local SSE only;
// never the personal service, a real provider, installation or a game result.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:http';
import {createHash,randomUUID} from 'node:crypto';
import {mkdtemp,mkdir,readFile,writeFile,cp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import security from '../dist-tests/packages/agent-service/src/security.js';
import storage from '../dist-tests/packages/agent-service/src/store.js';
import sdk from '../dist-tests/packages/client-ts/src/index.js';
import bootstrap from '../dist-tests/packages/client-ts/src/bootstrap.js';

const root=await mkdtemp(path.join(tmpdir(),'context-engine-'));
const output=path.resolve('output/game-generation/model-context-engine',`${new Date().toISOString().replace(/[:.]/g,'-')}-${randomUUID().slice(0,8)}`);
await mkdir(output,{recursive:true});
const engine=path.join(root,'engine');await cp(path.resolve('engine-dist'),engine,{recursive:true});await bootstrap.verifyBundle(engine,undefined,true);
const state=path.join(root,'state');await mkdir(state,{mode:0o700});
const identity=await security.ensureIdentity(state),credential=await security.createClientCredential(state,{id:'context-fixture',product:'companion-vscode',profile:'context-fixture',workspace:'',providers:['ollama'],hostTools:[]});
const store=new storage.Store(path.join(state,'metadata.sqlite'));store.register(credential);store.close();
let requests=[],child,client,passed=false;
const results=[],sessions=[];
const server=createServer((request,response)=>{let body='';request.on('data',value=>body+=value);request.on('end',()=>{
 const input=JSON.parse(body);requests.push(input);const text=requests.length===1?'PRIVATE_COMPACTION_ONLY':'PUBLIC_FINAL';
 response.writeHead(200,{'content-type':'text/event-stream'});
 response.write(`data: ${JSON.stringify({id:`call-${requests.length}`,object:'chat.completion.chunk',model:'fixture',choices:[{index:0,delta:{role:'assistant',content:text},finish_reason:'stop'}]})}\n\n`);
 response.write(`data: ${JSON.stringify({id:`call-${requests.length}`,object:'chat.completion.chunk',model:'fixture',choices:[],usage:{prompt_tokens:100,completion_tokens:5,total_tokens:105}})}\n\n`);response.end('data: [DONE]\n\n');
 });});
const tick=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function start(){
 child=spawn(path.join(engine,'node'),[path.join(engine,'service.cjs'),state],{stdio:['ignore','ignore','ignore']});
 let ready=false;for(let i=0;i<600;i++){assert.equal(child.exitCode,null,'Owned service exited');try{if(JSON.parse(await readFile(path.join(state,'runtime.json'),'utf8')).pid===child.pid){ready=true;break;}}catch{}await tick(25);}assert.ok(ready,'Inspect the original owned process; do not restart on an observation timeout');
 client=new sdk.AgentClient({address:security.ipcPath(state),certificate:identity.cert,credential});await client.connect();
}
async function stop(){client?.close();client=undefined;if(child?.exitCode===null){const stopped=once(child,'exit');child.kill('SIGTERM');await stopped;}}
try{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address==='object');await start();
 assert.ok((await client.call('engine.info')).capabilities.includes('model-context-window-v1'));
 for(const runtime of ['standard','deep']){
  requests=[];const messages=[];for(let i=0;i<20;i++)messages.push({role:'user',content:`Historical public request ${i} ${'.'.repeat(900)}`},{role:'assistant',content:`Historical public answer ${i} ${'.'.repeat(900)}`});messages.push({role:'user',content:'Return PUBLIC_FINAL, no tools.'});
  const spec={runtime,mode:'plan',provider:{kind:'ollama',endpoint:`http://127.0.0.1:${address.port}/v1`,roles:{executor:'fixture'},modelProfiles:{fixture:{contextWindow:8192}}},messages,systemPrompt:'Read-only synthetic context qualification. No tools or effects.',tools:[]};
  const key=`context-${runtime}`,session=await client.call('sessions.create',{title:`Context fixture ${runtime}`});const original=await client.startRun(session.id,key,spec);
  const run=await client.waitForRun(original.id,session.id,()=>{},undefined,AbortSignal.timeout(20000));assert.equal(run.state,'completed',run.error);assert.equal(requests.length,2);
  assert.ok(JSON.stringify(requests[1].messages).includes('PRIVATE_COMPACTION_ONLY'));
  const before=(JSON.stringify(requests[0].messages).match(/Historical public/g)??[]).length,after=(JSON.stringify(requests[1].messages).match(/Historical public/g)??[]).length;assert.ok(before>after&&after>=0);
  for(const input of requests){assert.equal(input.model,'fixture');for(const field of ['contextWindow','options','num_ctx','max_context_tokens'])assert.equal(field in input,false);}
  const snapshot=await client.snapshotSession(session.id);assert.equal(JSON.stringify(snapshot).includes('PRIVATE_COMPACTION_ONLY'),false,'Private summary escaped into the public snapshot');assert.ok(JSON.stringify(snapshot.events).includes('PUBLIC_FINAL'));
  const budget=await client.getInferenceBudgets(session.id),namespace=budget.budgets.find(value=>value.scope.kind==='namespace');const expectedCalls=runtime==='standard'?2:4;assert.equal(namespace.calls,expectedCalls);assert.equal(namespace.chargedTokens,expectedCalls*105);assert.equal(namespace.pendingCalls,0);
  await client.startRun(session.id,key,spec);assert.equal(requests.length,2);
  sessions.push({id:session.id,key,runId:run.id,spec});results.push({runtime,compactionRequests:1,executionRequests:1,privateSummaryAbsentFromPublicSnapshot:true,historyMessagesBefore:before,historyMessagesAfter:after,providerBodyUnchanged:true,cumulativeCalls:namespace.calls,cumulativeChargedTokens:namespace.chargedTokens,idempotentReplayWithoutInference:true});
 }
 await stop();await start();
 for(const session of sessions){const snapshot=await client.snapshotSession(session.id);assert.equal(JSON.stringify(snapshot).includes('PRIVATE_COMPACTION_ONLY'),false);const original=await client.startRun(session.id,session.key,session.spec);assert.equal(original.id,session.runId);assert.equal(original.state,'completed');}
 assert.equal(requests.length,2);const manifest=await readFile(path.join(engine,'manifest.json'));
 await writeFile(path.join(output,'report.json'),JSON.stringify({scope:'Packaged development service and real SDK/TLS/native LangChain graphs; simulated local SSE. Not real-model, installed-client or game-quality acceptance.',engineManifestSha256:createHash('sha256').update(manifest).digest('hex'),results,serviceRestartAndIdempotentReplay:true,realInference:false},null,2)+'\n');
 passed=true;console.log(`MODEL_CONTEXT_ENGINE_OK ${output}`);
}catch(error){await writeFile(path.join(output,'failure.json'),JSON.stringify({message:error instanceof Error?error.message:String(error)},null,2));throw error;}finally{await stop();server.closeAllConnections();await new Promise(resolve=>server.close(()=>resolve()));if(passed)await rm(root,{recursive:true,force:true});else console.error(`Owned context fixture preserved: ${root}`);}
