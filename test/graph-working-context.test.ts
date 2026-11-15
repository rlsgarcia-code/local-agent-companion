import assert from 'node:assert/strict';
import test from 'node:test';
import {createServer} from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {BaseChatModel} from '@langchain/core/language_models/chat_models';
import {BaseCallbackHandler} from '@langchain/core/callbacks/base';
import {AIMessage,HumanMessage,type BaseMessage} from '@langchain/core/messages';
import {SqliteSaver} from '@langchain/langgraph-checkpoint-sqlite';
import {tool} from 'langchain';
import {z} from 'zod';
import {AgentService} from '../packages/agent-service/src/service';
import {Store} from '../packages/agent-service/src/store';
import {namespace} from '../packages/agent-service/src/security';
import {runSpec,type Registration,type Session,type Run} from '../packages/contracts/src/index';
import type {InferenceBudgetSnapshot} from '../packages/contracts/src/inference-budget';
import {executeGraph} from '../packages/agent-core/src/index';
import {executePreparedGraph} from '../packages/agent-core/src/graph-executor';
import {InferenceBudgetCallback} from '../packages/agent-core/src/inference-budget';
const policy={triggerTokens:4096,keepTokens:1024};
const reg:Registration={id:'working-fixture',product:'companion-vscode',profile:'fixture',workspace:'',providers:['ollama'],hostTools:[]};

for(const runtime of ['standard','deep'] as const)for(const declared of [false,true])test(`${runtime}: ${declared?'a smaller declared model clamps a larger owner target':'an unprofiled model uses owner working history'} without changing HTTP options or quota`,async()=>{
 const requests:any[]=[];const server=createServer((request,response)=>{let body='';request.on('data',part=>body+=part);request.on('end',()=>{requests.push(JSON.parse(body));const content=requests.length===1?'PRIVATE_WORKING_SUMMARY':'PUBLIC_WORKING_FINAL';response.writeHead(200,{'content-type':'text/event-stream'});response.write(`data: ${JSON.stringify({id:'fixture-'+requests.length,object:'chat.completion.chunk',model:'working-fixture',choices:[{index:0,delta:{role:'assistant',content},finish_reason:'stop'}]})}\n\n`);response.write(`data: ${JSON.stringify({id:'fixture-'+requests.length,object:'chat.completion.chunk',model:'working-fixture',choices:[],usage:{prompt_tokens:100,completion_tokens:5,total_tokens:105}})}\n\n`);response.end('data: [DONE]\n\n');});});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address==='object');const capturedPolicy=declared?{triggerTokens:65536,keepTokens:4096}:policy;const directory=await mkdtemp(path.join(tmpdir(),'working-graph-')),service=new AgentService(new Store(path.join(directory,'metadata.sqlite')),directory,undefined,{}, {contextWorkingBudget:capturedPolicy});
 const messages=[];for(let i=0;i<20;i++)messages.push({role:'user',content:'ORIGINAL_HISTORY_'+i+': '+'.'.repeat(900)},{role:'assistant',content:'Original response '+i+': '+'.'.repeat(900)});messages.push({role:'user',content:'Return the public final, no tools.'});
 const spec=runSpec.parse({runtime,mode:'plan',provider:{kind:'ollama',endpoint:`http://127.0.0.1:${address.port}/v1`,roles:{executor:'working-fixture'},...(declared?{modelProfiles:{'working-fixture':{contextWindow:8192}}}:{})},messages,tools:[],systemPrompt:'Synthetic history only. No actual provider or system action.'});
 try{
  const session=await service.dispatch(reg,'sessions.create',{title:'Working history'},'fixture') as Session,run=await service.dispatch(reg,'runs.start',{sessionId:session.id,key:'once',spec},'fixture') as Run;
  for(let i=0;i<2000&&service.store.run(reg,run.id).state==='running';i++)await new Promise(resolve=>setTimeout(resolve,5));const saved=service.store.run(reg,run.id);assert.equal(saved.state,'completed',saved.error);assert.equal(requests.length,2);
  assert.ok(JSON.stringify(requests[1].messages).includes('PRIVATE_WORKING_SUMMARY'));assert.ok((JSON.stringify(requests[0].messages).match(/ORIGINAL_HISTORY_/g)??[]).length>(JSON.stringify(requests[1].messages).match(/ORIGINAL_HISTORY_/g)??[]).length);
  for(const body of requests)for(const key of ['contextWindow','contextWorkingBudget','triggerTokens','keepTokens','num_ctx','options','context_management'])assert.equal(key in body,false);
  const snapshot=service.store.snapshot(reg,session.id),text=JSON.stringify(snapshot.events.filter(event=>['text.delta','text.final'].includes(event.type)));assert.ok(text.includes('PUBLIC_WORKING_FINAL'));assert.equal(JSON.stringify(snapshot).includes('PRIVATE_WORKING_SUMMARY'),false,'Private summary escaped through a public result or snapshot');
  const budget=await service.dispatch(reg,'inference.budgets.get',{sessionId:session.id},'fixture') as InferenceBudgetSnapshot;assert.equal(budget.budgets[0]!.calls,2);assert.equal(budget.budgets[0]!.chargedTokens,210);assert.equal(budget.budgets[0]!.pendingCalls,0);
  await service.close();const saver=SqliteSaver.fromConnString(path.join(directory,'namespaces',namespace(reg),'graph.sqlite'));
  try{
   let checkpoints='';for await(const tuple of saver.list({configurable:{thread_id:run.id}}))checkpoints+=JSON.stringify(tuple.checkpoint.channel_values);for(let i=0;i<20;i++)assert.ok(checkpoints.includes('ORIGINAL_HISTORY_'+i+':'),'Original historical checkpoint lost: '+i);
   await executeGraph(spec,{registration:reg,threadId:run.id,checkpointer:saver,contextWorkingBudget:capturedPolicy,signal:new AbortController().signal,requireCheckpoint:true,emit:()=>{},invokeTool:async()=>assert.fail('No tool replay'),inferenceBudget:{begin:async()=>assert.fail('No repeated inference'),finish:()=>{}}});assert.equal(requests.length,2);
  }finally{saver.db.close();}
 }finally{await service.close();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(directory,{recursive:true,force:true});}
});

class ReadingModel extends BaseChatModel{
 normalCalls=0;summaryCalls=0;largestHistory=0;
 constructor(readonly role:'root'|'reviewer',readonly summaries:Set<string>){super({});}
 override get profile(){return {};}
 _llmType(){return 'scripted-working-budget';}
 override bindTools(){return this;}
 async _generate(messages:BaseMessage[],_options:this['ParsedCallOptions'],manager?:import('@langchain/core/callbacks/manager').CallbackManagerForLLMRun){
  let content='PUBLIC_REVIEW_COMPLETE',calls:AIMessage['tool_calls'];
  if(manager&&this.summaries.has(manager.runId)){this.summaryCalls++;content='PRIVATE_REVIEW_SUMMARY: continue the numbered readings; original evidence remains in virtual history.';}
  else{this.normalCalls++;this.largestHistory=Math.max(this.largestHistory,JSON.stringify(messages.map(message=>message.content)).length);
   if(this.role==='root'&&this.normalCalls===1)calls=[{id:'delegate',name:'task',args:{subagent_type:'reviewer',description:'Read all sixteen numbered original findings once, then finish.'},type:'tool_call'}];
   if(this.role==='reviewer'&&this.normalCalls<=16)calls=[{id:'read-'+this.normalCalls,name:'read_finding',args:{index:this.normalCalls},type:'tool_call'}];}
  const message=new AIMessage({id:randomUUID(),content,tool_calls:calls,usage_metadata:{input_tokens:100,output_tokens:5,total_tokens:105}});return {generations:[{text:content,message}],llmOutput:{}};
 }
}
test('a Deep working budget reaches unprofiled specialists without changing profiles, losing virtual evidence or repeating effects',async t=>{
 async function run(bounded:boolean){
  const summaryRuns=new Set<string>(),root=new ReadingModel('root',summaryRuns),reviewer=new ReadingModel('reviewer',summaryRuns),readings:number[]=[],publicText:string[]=[];
  const observer=new class extends BaseCallbackHandler{name='working_observer';awaitHandlers=true;handleChatModelStart(_llm:unknown,_messages:unknown,id:string,_parent?:string,_extra?:unknown,tags?:string[]){if(tags?.includes('nostream'))summaryRuns.add(id);}}();
  const admissions=new Set<string>(),settlements=new Set<string>(),meter=new InferenceBudgetCallback({begin:async id=>{assert.ok(!admissions.has(id));admissions.add(id);},finish:(id,usage)=>{assert.ok(admissions.has(id));assert.deepEqual(usage,{input:100,output:5});settlements.add(id);}});
  const read=tool(async({index})=>{readings.push(index);return `ORIGINAL_SECTION_${index}: `+'Keep the exact project, revision, evidence and receipts. '.repeat(45);},{name:'read_finding',description:'Read one synthetic finding without changes',schema:z.object({index:z.number().int().min(1).max(16)})});
  const saver=SqliteSaver.fromConnString(':memory:');const execution={runtime:'deep' as const,threadId:'working-review',signal:new AbortController().signal,recursionLimit:200,callbacks:[observer,meter],initial:{messages:[new HumanMessage('Review all sixteen original findings.')]},delta:async(text:string)=>{publicText.push(text);},turn:async()=>{},graph:{model:root,tools:[],systemPrompt:'Delegate the bounded review then finish.',checkpointer:saver,...(bounded?{contextWorkingBudget:policy}:{}),subagents:[{name:'reviewer',description:'Bounded review',systemPrompt:'Read findings 1 through 16 once each, then finish.',model:reviewer,tools:[read]}]}};
  try{
   await executePreparedGraph(execution);assert.deepEqual(readings,Array.from({length:16},(_,index)=>index+1));assert.deepEqual(root.profile,{});assert.deepEqual(reviewer.profile,{});assert.equal(publicText.join('').includes('PRIVATE_REVIEW_SUMMARY'),false);
   const calls=root.normalCalls+reviewer.normalCalls+root.summaryCalls+reviewer.summaryCalls;assert.equal(admissions.size,calls);assert.equal(settlements.size,calls);
   let checkpoints='';for await(const tuple of saver.list({configurable:{thread_id:execution.threadId}}))checkpoints+=JSON.stringify(tuple.checkpoint.channel_values);for(let i=1;i<=16;i++)assert.ok(checkpoints.includes('ORIGINAL_SECTION_'+i+':'),'Original evidence missing: '+i);
   await executePreparedGraph({...execution,requireCheckpoint:true});assert.equal(admissions.size,calls);assert.equal(readings.length,16);
   return {summaryCalls:reviewer.summaryCalls,largestHistoryCharacters:reviewer.largestHistory,normalCalls:root.normalCalls+reviewer.normalCalls,admissions:admissions.size,settlements:settlements.size,originalReadings:readings.length};
  }finally{saver.db.close();}
 }
 const native=await run(false),working=await run(true);t.diagnostic(JSON.stringify({native,working,scope:'Scripted local models; characters are not full prompt tokens, provider cost or game acceptance'}));assert.equal(native.summaryCalls,0);assert.ok(working.summaryCalls>0);assert.ok(working.largestHistoryCharacters<native.largestHistoryCharacters);assert.equal(working.normalCalls,native.normalCalls);
});
