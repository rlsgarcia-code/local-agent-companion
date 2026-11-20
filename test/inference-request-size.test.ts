import assert from 'node:assert/strict';
import test from 'node:test';
import {ChatOpenAICompletions} from '@langchain/openai';
import {InferenceBudgetCallback} from '../packages/agent-core/src/inference-budget';
import {InferenceBudgets} from '../packages/agent-service/src/inference-budgets';
import {Store} from '../packages/agent-service/src/store';
import {runSpec,type Registration} from '../packages/contracts/src/index';
import {modelRequestReservation} from '../packages/agent-core/src/inference-request-size';
import {DEFAULT_INFERENCE_TOKEN_RESERVATION} from '../packages/contracts/src/inference-budget';

test('official model start must reserve a large prompt before a request can exceed the fixed-reservation budget',async()=>{
  const reg:Registration={id:'request-size-fixture',product:'companion-vscode',profile:'synthetic',workspace:'',providers:['ollama'],hostTools:[]};
  const store=new Store(':memory:');let wireRequests=0;
  try{
    const session=store.createSession(reg,'Synthetic request reservation'),spec=runSpec.parse({runtime:'standard',mode:'plan',provider:{kind:'ollama',endpoint:'http://127.0.0.1:11434/v1',roles:{executor:'synthetic'}},messages:[{role:'user',content:'No real inference'}],systemPrompt:'Synthetic',tools:[]});
    const run=store.start(reg,session.id,'request-size',spec).run,scopes=[{kind:'namespace' as const}];
    const quota={callsPerBlock:2,tokensPerBlock:200000,maxBlocks:1},meter=new InferenceBudgets(store,{namespace:quota,stage:quota,unknownTokensPerCall:65536});
    const callback=new InferenceBudgetCallback({begin:async(id:string,request?:unknown)=>{
      // Pass through the private sideband. Reflect also allows this regression
      // to run against the older four-argument meter without changing that code.
      if(Reflect.apply(meter.begin,meter,[reg,run.id,id,scopes,request]))throw Error('Synthetic request rejected before provider');
    },finish:(id,usage)=>meter.finish(reg,run.id,id,usage)});
    const model=new ChatOpenAICompletions({model:'synthetic',apiKey:'synthetic-key-never-recorded',maxRetries:0,
      configuration:{baseURL:'http://127.0.0.1:1/v1',fetch:async()=>{wireRequests++;return new Response(JSON.stringify({id:'synthetic',object:'chat.completion',created:1,model:'synthetic',choices:[{index:0,message:{role:'assistant',content:'simulated'},finish_reason:'stop'}],usage:{prompt_tokens:230000,completion_tokens:1,total_tokens:230001}}),{headers:{'content-type':'application/json'}});}}});
    await assert.rejects(model.invoke('Synthetic large input: '+'.abcdefghij'.repeat(30000),{callbacks:[callback]}),/Synthetic request rejected before provider/);
    assert.equal(wireRequests,0);assert.equal(meter.snapshot(reg,scopes).budgets[0]!.calls,0);
    assert.equal((store.db.prepare('SELECT count(*) AS n FROM inference_calls').get() as {n:number}).n,0);
  }finally{store.close();}
});

test('request sizing includes tool/schema bytes and output headroom without retaining content, model configuration or credentials',()=>{
  const messages=[[{role:'user',content:'private input'}]],tools=[{type:'function',function:{name:'fixture',description:'private tool schema',parameters:{type:'object',properties:{}}}}];
  const request={messages,tools,response_format:{type:'json_object'}};
  const base=modelRequestReservation(messages,{invocation_params:{model:'fixture',tools,response_format:request.response_format,api_key:'never-count-this-credential',headers:{authorization:'never-count-this-header'}}});
  assert.equal(base,Buffer.byteLength(JSON.stringify(request))+DEFAULT_INFERENCE_TOKEN_RESERVATION);
  assert.equal(modelRequestReservation(messages,{invocation_params:{model:'fixture',tools,response_format:request.response_format,max_completion_tokens:131072}}),Buffer.byteLength(JSON.stringify(request))+131072);
  assert.equal(modelRequestReservation(messages),undefined,'Models without supported invocation metadata keep the old minimum');
  const cyclic:unknown[]=[];cyclic.push(cyclic);assert.throws(()=>modelRequestReservation(cyclic,{invocation_params:{model:'fixture'}}),/Cannot reserve this model input safely/);
});

test('size-aware shortage grants the exact needed block, releases known usage and preserves larger unknown reservations after recovery',()=>{
  const reg:Registration={id:'size-aware-meter',product:'companion-vscode',profile:'synthetic',workspace:'',providers:['ollama'],hostTools:[]},store=new Store(':memory:');
  try{
    const session=store.createSession(reg,'Size-aware decisions'),spec=runSpec.parse({runtime:'standard',mode:'plan',provider:{kind:'ollama',endpoint:'http://127.0.0.1:11434/v1',roles:{executor:'fixture'}},messages:[{role:'user',content:'Synthetic'}],systemPrompt:'Synthetic',tools:[]});
    const run=store.start(reg,session.id,'meter',spec).run,quota={callsPerBlock:2,tokensPerBlock:1000,maxBlocks:2},meter=new InferenceBudgets(store,{namespace:quota,stage:quota,unknownTokensPerCall:10}),scopes=[{kind:'namespace' as const}];
    assert.equal(meter.begin(reg,run.id,'one',scopes,800),null);meter.finish(reg,run.id,'one',{input:500,output:10});
    assert.equal(meter.snapshot(reg,scopes).budgets[0]!.exhausted,false,'The old floor alone would fit');
    const short=meter.begin(reg,run.id,'two',scopes,800)!;assert.equal(short.budgets[0]!.exhausted,true);assert.equal(short.budgets[0]!.nextReservationTokens,800);assert.equal(short.budgets[0]!.canContinue,true);
    meter.grant(reg,'exact-size-decision',short);meter.grant(reg,'exact-size-decision',short);assert.equal(meter.snapshot(reg,scopes).budgets[0]!.blocks,2);
    assert.equal(meter.begin(reg,run.id,'two',scopes,800),null);assert.equal(meter.begin(reg,run.id,'two',scopes,799),null);
    assert.throws(()=>meter.begin(reg,run.id,'two',scopes,801),/increase its reserved request/);
    meter.recover();const after=meter.snapshot(reg,scopes).budgets[0]!;assert.equal(after.chargedTokens,1310);assert.equal(after.pendingCalls,0);assert.equal(after.unreportedCalls,1);assert.equal(after.reservedTokensPerCall,10);
    assert.equal(meter.begin(reg,run.id,'three',scopes,800)!.budgets[0]!.canContinue,false);
    assert.doesNotMatch(JSON.stringify(store.db.prepare('SELECT value FROM inference_budgets').all()),/nextReservationTokens/,'A single large input never becomes the permanent floor');
    const impossible=meter.begin(reg,run.id,'impossible',scopes,3000)!;assert.equal(impossible.budgets[0]!.canContinue,false);
  }finally{store.close();}
});
