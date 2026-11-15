// Disposable bundled-runtime qualification. Local simulated HTTP only; no real
// model, UI, host tools, production effects, credentials or installation.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {APIConnectionTimeoutError} from 'openai';
import {BaseCallbackHandler} from '@langchain/core/callbacks/base';
import {ProviderModels} from '../packages/agent-core/src/provider-models';
import {executeGraph} from '../packages/agent-core/src/index';
import {AgentService} from '../packages/agent-service/src/service';
import {Store} from '../packages/agent-service/src/store';
import {runSpec,type Registration,type Session,type Run} from '../packages/contracts/src/index';
import {modelFailure} from '../packages/contracts/src/model-failure';
import type {InferenceBudgetSnapshot} from '../packages/contracts/src/inference-budget';
const runtime=process.argv[2];assert.ok(runtime==='standard'||runtime==='deep');const baseline=process.argv[3]==='baseline';
async function main(){
 let requests=0;const observed:{constructorName:string;name:string;officialTimeout:boolean}[]=[];
 class Observe extends BaseCallbackHandler{name='fixture_timeout_observer';awaitHandlers=true;handleLLMError(error:unknown){if(error&&typeof error==='object')observed.push({constructorName:error.constructor.name,name:error instanceof Error?error.name:'non-error',officialTimeout:error instanceof APIConnectionTimeoutError});}}
 const server=createServer(request=>{requests++;assert.equal(request.method,'POST');assert.equal(request.url,'/v1/chat/completions');request.resume();});await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const address=server.address();assert.ok(address&&typeof address==='object');const directory=await mkdtemp(path.join(tmpdir(),'bundled-model-timeout-'));
 const reg:Registration={id:'fixture',product:'companion-vscode',profile:'timeout-bundle',workspace:'',providers:['ollama'],hostTools:[]};
 const spec=runSpec.parse({runtime,mode:'plan',provider:{kind:'ollama',endpoint:`http://127.0.0.1:${address.port}/v1`,roles:{executor:'synthetic-timeout'}},messages:[{role:'user',content:'Read-only synthetic SDK deadline test.'}],systemPrompt:'No effects or tools.',tools:[]});
 const service=new AgentService(new Store(path.join(directory,'metadata.sqlite')),directory,async(request,context)=>{
  const models=new ProviderModels(request.provider,undefined,context.signal);try{const model=models.model('executor',true,{timeout:200,requiresTools:false});model.callbacks=[new Observe()];return await executeGraph(request,{...context,model});}finally{await models.close();}
 });
 try{
  const session=await service.dispatch(reg,'sessions.create',{title:'Synthetic packaged deadline'},'fixture') as Session;
  const run=await service.dispatch(reg,'runs.start',{sessionId:session.id,key:'original',spec},'fixture') as Run;
  for(let i=0;i<1600&&service.store.run(reg,run.id).state==='running';i++)await new Promise(resolve=>setTimeout(resolve,5));
  const saved=service.store.run(reg,run.id);assert.equal(saved.state,'failed');assert.equal(requests,1);assert.equal(observed.length,1);assert.equal(observed[0]!.name,'TimeoutError');assert.equal(observed[0]!.constructorName,'Error');assert.equal(observed[0]!.officialTimeout,false);
  const diagnostics=service.store.snapshot(reg,session.id).events.filter(e=>e.type==='model.failure');
  if(baseline){assert.equal(diagnostics.length,0);assert.equal(saved.error,'Request timed out.');assert.notEqual(observed[0]!.constructorName,'APIConnectionTimeoutError');}
  else{assert.equal(diagnostics.length,1);assert.deepEqual(modelFailure.parse(diagnostics[0]!.data),{category:'request_timeout'});assert.match(saved.error!,/solicitação ao provedor excedeu/);}
  const budget=await service.dispatch(reg,'inference.budgets.get',{sessionId:session.id},'fixture') as InferenceBudgetSnapshot,namespace=budget.budgets.find(b=>b.scope.kind==='namespace')!;
  assert.equal(namespace.calls,1);assert.equal(namespace.unreportedCalls,1);assert.equal(namespace.pendingCalls,0);
  const attempts=service.store.db.prepare('SELECT value FROM inference_calls WHERE run=?').all(run.id) as {value:string}[];assert.equal(attempts.length,1);
  const attempt=JSON.parse(attempts[0]!.value) as {reservation:number;state:string};assert.equal(attempt.state,'unreported');assert.ok(attempt.reservation>namespace.reservedTokensPerCall);
  assert.equal(namespace.chargedTokens,attempt.reservation);
  await service.dispatch(reg,'runs.start',{sessionId:session.id,key:'original',spec},'fixture');assert.equal(requests,1);assert.equal(service.store.snapshot(reg,session.id).events.filter(e=>e.type==='model.failure').length,diagnostics.length);
  await service.close();const reopened=new Store(path.join(directory,'metadata.sqlite'));try{assert.deepEqual(reopened.snapshot(reg,session.id).events.filter(e=>e.type==='model.failure'),diagnostics);}finally{reopened.close();}
  console.log(JSON.stringify({marker:'BUNDLED_MODEL_DEADLINE',runtime,baseline,observed,requests,diagnostics:diagnostics.map(e=>e.data),unknownUsageReservationPreserved:true,replayWithoutRedispatch:true,persistedAfterReopen:true,toolsExecuted:0}));
 }finally{await service.close();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(directory,{recursive:true,force:true});}
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
