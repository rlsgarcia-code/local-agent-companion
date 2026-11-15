// Exact packaged service/SDK and native graphs. Synthetic loopback SSE only;
// no real model, personal profile, new allowance or installed-client acceptance.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import security from '../dist-tests/packages/agent-service/src/security.js';
import storage from '../dist-tests/packages/agent-service/src/store.js';
import sdk from '../dist-tests/packages/client-ts/src/index.js';
import bootstrap from '../dist-tests/packages/client-ts/src/bootstrap.js';
assert.equal(process.versions.node,'22.23.4');assert.equal(process.argv.length,4);
const arg=name=>{const v=process.argv.find(a=>a.startsWith(name+'='));assert.ok(v);return path.resolve(v.slice(name.length+1));};
const engine=arg('--engine'),output=arg('--output');await mkdir(output);await bootstrap.verifyBundle(engine,undefined,true);
const manifest=await readFile(path.join(engine,'manifest.json')),sha=b=>createHash('sha256').update(b).digest('hex'),save=(n,v)=>writeFile(path.join(output,n),JSON.stringify(v,null,2)+'\n');
const root=await mkdtemp(path.join(tmpdir(),'sized-reservation-')),env={HOME:root,PATH:'/usr/bin:/bin',TMPDIR:tmpdir(),LANG:'en_US.UTF-8'};
const policy={namespace:{callsPerBlock:4,tokensPerBlock:200000,maxBlocks:1},stage:{callsPerBlock:4,tokensPerBlock:200000,maxBlocks:1},unknownTokensPerCall:65536};
await writeFile(path.join(root,'inference-limits.json'),JSON.stringify({schemaVersion:1,policy}),{mode:0o600});
const identity=await security.ensureIdentity(root),store=new storage.Store(path.join(root,'metadata.sqlite')),actors=[],services=[];let active,passed=false,unknown=false,requests=0,approvals=0;
for(const product of ['companion-mac','companion-vscode'])for(const runtime of ['standard','deep']){
 const credential=await security.createClientCredential(root,{id:'sized-'+product+'-'+runtime,product,profile:'synthetic-'+runtime,workspace:'',providers:['ollama'],hostTools:[]});store.register(credential);actors.push({product,runtime,credential});
}store.close();
const mock=createServer((request,response)=>{
 let bytes=0;request.on('data',part=>{bytes+=part.length;});request.on('end',()=>{
  assert.equal(request.method,'POST');assert.equal(request.url,'/v1/chat/completions');requests++;
  response.writeHead(200,{'content-type':'text/event-stream'});const common={id:'fixture-'+requests,object:'chat.completion.chunk',model:'reservation-fixture'};
  response.write('data: '+JSON.stringify({...common,choices:[{index:0,delta:{role:'assistant',content:'Synthetic read-only reply'},finish_reason:'stop'}]})+'\n\n');
  response.write('data: '+JSON.stringify({...common,choices:[],usage:{prompt_tokens:100,completion_tokens:5,total_tokens:105}})+'\n\n');response.end('data: [DONE]\n\n');
 });
});mock.listen(0,'127.0.0.1');await once(mock,'listening');const address=mock.address();assert.ok(address&&typeof address==='object');
async function start(){
 assert.ok(!active||active.exitCode!==null);active=spawn(path.join(engine,'node'),[path.join(engine,'service.cjs'),root],{env,stdio:'ignore'});services.push(active);
 let ready=false;for(let i=0;i<600;i++){assert.equal(active.exitCode,null);try{ready=JSON.parse(await readFile(path.join(root,'runtime.json'),'utf8')).pid===active.pid;}catch{}if(ready)break;await new Promise(r=>setTimeout(r,25));}assert.ok(ready,'Inspect original service on readiness timeout');
 for(const actor of actors){actor.client=new sdk.AgentClient({address:security.ipcPath(root),certificate:identity.cert,credential:actor.credential});await actor.client.connect();const info=await actor.client.call('engine.info');assert.equal(info.build.manifestSha256,sha(manifest));assert.ok(info.capabilities.includes('request-sized-inference-reservations-v1'));}
}
async function stop(){
 if(!active||active.exitCode!==null)return;assert.equal((await actors[0].client.call('engine.quiesceIfIdle',{})).accepted,true);
 for(const actor of actors)actor.client.close();const end=once(active,'exit');active.kill('SIGTERM');await end;assert.equal(active.exitCode,0);
}
async function run(actor,large,key){
 const client=actor.client,session=await client.call('sessions.create',{title:'Synthetic request reservation'}),before=requests;
 unknown=true;const started=await client.startRun(session.id,key,{runtime:actor.runtime,mode:'plan',provider:{kind:'ollama',endpoint:`http://127.0.0.1:${address.port}/v1`,roles:{executor:'reservation-fixture'}},
   // Deep's native middleware may offload a large user message before model
   // admission. Put the fixture in the system context instead: this checks the
   // actual request after preparation, without disabling native middleware.
   messages:[{role:'user',content:'Reply briefly. Read-only synthetic qualification; no tools.'}],systemPrompt:large?'SYNTHETIC_LARGE_REQUEST_CANARY '+'.abcdefghij'.repeat(15000):'Read only. No tools or effects.',tools:[]});
 const finished=await client.waitForRun(started.id,session.id,()=>{},async()=>{approvals++;return false;},AbortSignal.timeout(30000));unknown=false;
 const budget=(await client.getInferenceBudgets(session.id)).budgets.find(b=>b.scope.kind==='namespace');
 if(large){assert.equal(finished.state,'failed');assert.match(finished.error,/budget.*exhausted/i);assert.equal(requests,before);}
 else{assert.equal(finished.state,'completed',finished.error);assert.equal(requests,before+1);}
 assert.equal(budget.pendingCalls,0);assert.equal(budget.unreportedCalls,0);return {sessionId:session.id,runId:started.id,state:finished.state,large,additionalProviderRequests:requests-before,budget};
}
try{
 await save('control.json',{observerSha256:sha(await readFile(new URL(import.meta.url))),engineManifestSha256:sha(manifest),policy,syntheticOnly:true,closedServiceEnvironment:true});
 await start();for(const actor of actors){actor.results=[];actor.results.push(await run(actor,false,'small-before'));actor.results.push(await run(actor,true,'large-denied'));actor.results.push(await run(actor,false,'small-after'));assert.equal(actor.results.at(-1).budget.calls,2);assert.equal(actor.results.at(-1).budget.chargedTokens,210);}
 await stop();await start();for(const actor of actors){const result=await run(actor,true,'large-after-restart');assert.equal(result.budget.calls,2);assert.equal(result.budget.chargedTokens,210);actor.results.push(result);}await stop();
 const inspect=new storage.Store(path.join(root,'metadata.sqlite'));let receipts;
 try{receipts=inspect.db.prepare('SELECT value FROM inference_calls').all().map(row=>JSON.parse(row.value));assert.equal(receipts.length,8);assert.ok(receipts.every(r=>r.reservation>65536&&r.state==='reported'));assert.doesNotMatch(JSON.stringify(inspect.db.prepare('SELECT value FROM inference_budgets').all()),/SYNTHETIC_LARGE_REQUEST_CANARY|nextReservationTokens/);}finally{inspect.close();}
 assert.equal(requests,8);assert.equal(approvals,0);await bootstrap.verifyBundle(engine,undefined,true);assert.ok(manifest.equals(await readFile(path.join(engine,'manifest.json'))));
 await save('report.json',{scope:'Actual packaged Node/service/SDK/TLS/IPC and Standard/Deep native graphs in separate Mac/editor registrations. Common Agent API only, not desktop compatibility routes, GUI/installed clients or real-model billing.',engineManifestSha256:sha(manifest),results:actors.map(({product,runtime,results})=>({product,runtime,results})),requests,approvals,receiptReservations:receipts.map(r=>r.reservation),unknownReservesRefunded:false,realModelCalls:0,qualityApproved:false,installedAcceptance:false});passed=true;console.log('REQUEST_SIZE_RESERVATIONS_QUALIFIED '+output);
}catch(error){await save('failure.json',{message:String(error?.message??error).slice(0,4000),privateState:root,unknown,services:services.map(s=>({pid:s.pid,exitCode:s.exitCode})),requests});process.exitCode=1;console.error(String(error?.message??error).slice(0,4000));}
finally{
 if(active?.exitCode===null&&!unknown)try{await stop();}catch{}
 if(active?.exitCode===null){for(const actor of actors)actor.client?.close();active.unref();}
 mock.closeAllConnections();await new Promise(resolve=>mock.close(resolve));const closed=services.every(s=>s.exitCode===0);if(passed&&closed)await rm(root,{recursive:true,force:true});
 await save('closure.json',{services:services.map(s=>({pid:s.pid,exitCode:s.exitCode,signalCode:s.signalCode})),privateStateRemoved:passed&&closed,unknown});
}
