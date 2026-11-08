import assert from "node:assert/strict";
import test from "node:test";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {AgentService,type GraphExecutor} from "../packages/agent-service/src/service";
import {Store} from "../packages/agent-service/src/store";
import {runSpec,type Registration,type Run,type ToolSpec} from "../packages/contracts/src/index";
import {workspaceToolResult} from "../packages/contracts/src/workspace-receipts";

const tool:ToolSpec={name:"edit_fixture",description:"Approved editor effect",schema:{type:"object"},effect:"write",host:"vscode-host"};
const reg:Registration={id:"vscode-fixture",product:"companion-vscode",profile:"default",workspace:"fixture",providers:["ollama"],hostTools:[tool.name],toolCatalog:[tool]};
const spec=runSpec.parse({runtime:"standard",mode:"review",provider:{kind:"ollama",endpoint:"http://127.0.0.1:11434/v1",roles:{executor:"test"}},messages:[{role:"user",content:"Read fixture"}],systemPrompt:"fixture",tools:[tool],workspace:{threadId:"thread",assistantMessageId:"assistant"}});
const result={kind:"workspace-tool-result",result:{changed:true},state:{epoch:"editor-1",changes:[],omitted:0,evidence:{commands:[],diagnostics:[],browser:[],processes:[],filesRead:[],projectIndexInspected:false,playbooksRead:[]}}};
const tick=()=>new Promise(resolve=>setTimeout(resolve,5));
async function fixture(executor:GraphExecutor){const dir=await mkdtemp(path.join(tmpdir(),"workspace-service-"));const store=new Store(path.join(dir,"metadata.sqlite"));const service=new AgentService(store,dir,executor);const session=store.createSession(reg,"Editor");return {store,service,session,async close(){await service.close();await rm(dir,{recursive:true,force:true});}};}

test("an exact editor approval survives disconnect and cannot authorize another dispatched operation",async()=>{
 const f=await fixture(async(_spec,ctx)=>{const value=await ctx.invokeTool(tool,{path:"test.txt"},"effect-1");return {text:"saved",value};});
 try{
  const run=await f.service.dispatch(reg,"runs.start",{sessionId:f.session.id,key:"first",spec},"old") as Run;
  let requests:any[]=[];for(let n=0;n<100&&!requests.length;n++){requests=await f.service.dispatch(reg,"host.poll",{},"old") as any[];await tick();}
  const parent=requests[0];assert.equal(parent.kind,"tool");
  const approval=await f.service.dispatch(reg,"host.approval.create",{parentId:parent.id,request:{prompt:"Edit test.txt?",action:"Edit",target:"test.txt",explanation:"Exact replacement",risk:"standard"}},"old") as {id:string};
  await assert.rejects(f.service.dispatch(reg,"host.approval.create",{parentId:parent.id,request:{prompt:"Edit?",action:"Edit",target:"test",explanation:"",risk:"standard"}},"forged"),/dispatched/);
  assert.equal(f.store.run(reg,run.id).state,"awaiting_approval");
  f.service.disconnect("old");
  requests=await f.service.dispatch(reg,"host.poll",{},"new") as any[];
  assert.ok(requests.some(row=>row.id===parent.id));assert.ok(requests.some(row=>row.id===approval.id));
  await f.service.dispatch(reg,"approvals.respond",{id:approval.id,value:true},"new");
  await assert.rejects(f.service.dispatch(reg,"host.respond",{id:parent.id,value:{result:"untyped"}},"new"));
  await f.service.dispatch(reg,"host.respond",{id:parent.id,value:result},"new");
  for(let n=0;n<100&&f.store.run(reg,run.id).state!=="completed";n++)await tick();
  assert.equal(f.store.run(reg,run.id).state,"completed");
  assert.equal((await f.service.dispatch(reg,"host.approval.get",{id:approval.id},"new") as any).value,true);
  await assert.rejects(f.service.dispatch(reg,"host.respond",{id:approval.id,value:false},"new"),/different decision/);
 }finally{await f.close();}
});

test("an editor effect lost after approval requires reconciliation rather than repeating",async()=>{
 const f=await fixture(async(_spec,ctx)=>({text:String(await ctx.invokeTool(tool,{path:"test.txt"},"effect-2"))}));
 try{
  const run=await f.service.dispatch(reg,"runs.start",{sessionId:f.session.id,key:"lost",spec},"old") as Run;
  let requests:any[]=[];for(let n=0;n<100&&!requests.length;n++){requests=await f.service.dispatch(reg,"host.poll",{},"old") as any[];await tick();}
  assert.equal(requests[0].kind,"tool");f.service.disconnect("old");await tick();
  assert.equal(f.store.run(reg,run.id).state,"awaiting_reconciliation");
  await assert.rejects(f.service.dispatch(reg,"runs.resume",{id:run.id},"new"),/Reconcile/);
 }finally{await f.close();}
});

test("workspace receipts reject oversized, unknown and invented evidence fields",()=>{
 assert.equal(workspaceToolResult.parse(result).kind,"workspace-tool-result");
 assert.throws(()=>workspaceToolResult.parse({...result,state:{...result.state,evidence:{...result.state.evidence,filesRead:[{path:"test",sha256:"observed"}]}}}));
 assert.throws(()=>workspaceToolResult.parse({...result,state:{...result.state,changes:Array(51).fill({path:"x",kind:"modified"})}}));
 assert.throws(()=>workspaceToolResult.parse({...result,state:{...result.state,privateReasoning:"must not persist"}}));
});

test("both editor executors use the shared official graph and the deep backend has a durable operation identity",async()=>{
 const {FakeToolCallingModel}=await import("langchain");
 const {executeGraph}=await import("../packages/agent-core/src/index");
 const {SqliteSaver}=await import("@langchain/langgraph-checkpoint-sqlite");
 const {WORKSPACE_BACKEND_TOOLS}=await import("../packages/contracts/src/workspace-backend");
 for(const runtime of ["standard","deep"] as const){
  const dir=await mkdtemp(path.join(tmpdir(),"editor-graph-"));const saver=SqliteSaver.fromConnString(path.join(dir,"graph.sqlite"));
  const catalog=runtime === "deep"?WORKSPACE_BACKEND_TOOLS:[{name:"read_fixture",description:"Read fixture",schema:{type:"object",properties:{},additionalProperties:false},effect:"read" as const,host:"vscode-host"}];
  const registration={...reg,providers:["litellm" as const],hostTools:catalog.map(row=>row.name),toolCatalog:catalog};
  const spec=runSpec.parse({runtime,mode:"execute",provider:{kind:"litellm",endpoint:"https://fixture.invalid",roles:{executor:"fixture"}},messages:[{role:"user",content:"Read the approved fixture"}],systemPrompt:"Read fixture",tools:catalog,workspace:{threadId:"source-thread",assistantMessageId:"stable-message",finalReview:"off"}});
  const executor=new FakeToolCallingModel({toolCalls:[[{name:runtime === "deep"?"read_file":"read_fixture",args:runtime === "deep"?{file_path:"/workspace/test.txt"}:{},id:"read-once"}],[]]});
  let calls=0;const receipts:{id:string;tool:string;value:unknown}[]=[];
  const evaluator={invoke:async()=>({text:JSON.stringify(calls++===0?{outcome:"answer",objective:"Read the fixture",acceptanceCriteria:["Read the actual contents"]}:{verdict:"satisfied",reason:"Actual read receipt"})})} as any;
  try{
   const answer=await executeGraph(spec,{registration,threadId:"editor-run",signal:new AbortController().signal,checkpointer:saver,models:{executor,evaluator},emit(){},operationResults:()=>receipts,
    async invokeTool(definition,input,id){assert.ok(id);assert.equal(definition.name,runtime === "deep"?"vscode_backend_read":"read_fixture");
     if(runtime === "deep")assert.equal((input as any).args[0],"/test.txt");
     const value={...result,result:runtime === "deep"?{content:"1: fixture-contents"}:"fixture-contents",state:{...result.state,evidence:{...result.state.evidence,filesRead:[{path:"test.txt",sha256:"a".repeat(64)}]}}};receipts.push({id,tool:definition.name,value});return value;
    }});
   assert.ok(answer.text);assert.equal(receipts.length,1);assert.equal((answer as any).message.id,"stable-message");assert.equal((answer as any).completionOutcome,"complete");
  }finally{saver.db.close();await rm(dir,{recursive:true,force:true});}
 }
});

test("service-managed processes survive editor disconnection, require approval and stop with the service",async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),"service-process-"));
 const {writeFile}=await import("node:fs/promises");await writeFile(path.join(directory,"watch.cjs"),"console.log('ready');setInterval(()=>{},1000)");
 const definition:ToolSpec={name:"start_local_process",description:"Start approved local watcher",schema:{type:"object"},effect:"external",host:"service-process"};
 const registration={...reg,workspace:directory,hostTools:[definition.name],toolCatalog:[definition]};
 const store=new Store(path.join(directory,"metadata.sqlite"));
 const service=new AgentService(store,directory,async(_spec,ctx)=>({text:JSON.stringify(await ctx.invokeTool(definition,{command:"node",args:["watch.cjs"]},"start-once"))}));
 try{
  const session=store.createSession(registration,"Process");
  const run=await service.dispatch(registration,"runs.start",{sessionId:session.id,key:"start",spec:{...spec,mode:"execute",tools:[definition]}},"editor") as Run;
  let waits:any[]=[];for(let n=0;n<100&&!waits.length;n++){waits=await service.dispatch(registration,"host.poll",{},"editor") as any[];await tick();}
  assert.equal(waits[0].kind,"approval");service.disconnect("editor");
  waits=await service.dispatch(registration,"host.poll",{},"reopened") as any[];
  await service.dispatch(registration,"approvals.respond",{id:waits[0].id,value:true},"reopened");
  service.disconnect("reopened");
  for(let n=0;n<100&&store.run(registration,run.id).state!=="completed";n++)await tick();
  assert.equal(store.run(registration,run.id).state,"completed");
  assert.equal((await service.dispatch(registration,"engine.shutdownIfIdle",{},"other") as any).accepted,false,"a retained watcher prevents unsafe activation");
  assert.deepEqual(await service.dispatch(registration,"host.poll",{},"other"),[]);
 }finally{await service.close();await rm(directory,{recursive:true,force:true});}
});
