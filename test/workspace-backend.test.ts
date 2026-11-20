import assert from "node:assert/strict";
import { mkdtemp,readFile,writeFile,rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { FakeToolCallingModel } from "langchain";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import { executeGraph,type ExecutionContext } from "../packages/agent-core/src/index";
import { AgentService } from "../packages/agent-service/src/service";
import { Store } from "../packages/agent-service/src/store";
import { AgentError,errors,runSpec,type Registration,type RunSpec,type Run,type ToolSpec } from "../packages/contracts/src/index";
import { WORKSPACE_BACKEND_TOOLS } from "../packages/contracts/src/workspace-backend";
import { GAME_AGENT_TOOLS } from "../packages/agent-service/src/game-agent-tools";

type Call={name:string;args:Record<string,unknown>;id:string};
const call=(name:string,args:Record<string,unknown>,id=name):Call=>({name,args,id});
function model(calls:Call[][]){
  const value=new FakeToolCallingModel({toolCalls:calls}),seen=new Map<string,string>(),systems:string[]=[];
  const bind=value.bindTools.bind(value);value.bindTools=tools=>{
    const bound=bind(tools);assert.ok(bound instanceof FakeToolCallingModel);const generate=bound._generate.bind(bound);
    bound._generate=async(...args)=>{
      for(const message of args[0]){const text=typeof message.content==="string"?message.content:JSON.stringify(message.content);if(message.getType()==="tool")seen.set((message as {tool_call_id?:string}).tool_call_id??message.id??"",text);if(message.getType()==="system")systems.push(text);}
      const result=await generate(...args);for(const row of result.generations){row.text="BACKEND_FIXTURE_OK";row.message.content=row.text;}return result;
    };return bound;
  };
  return {value,seen,systems};
}
const evaluator=()=>new FakeToolCallingModel({structuredResponse:{outcome:"answer",objective:"Inspect only the available fixture",reason:"Fixture",requiredEvidence:"none",acceptanceCriteria:[],verdict:"satisfied"}});
const envelope=(value:unknown)=>({kind:"workspace-tool-result",result:value,state:{epoch:"fixture",changes:[],omitted:0,evidence:{commands:[],diagnostics:[],browser:[],processes:[],filesRead:[],projectIndexInspected:false,playbooksRead:[]}}});
function spec(tools:ToolSpec[]=[],mode:"execute"|"plan"="execute"):RunSpec{return runSpec.parse({runtime:"deep",mode,provider:{kind:"ollama",endpoint:"http://127.0.0.1:11434/v1",roles:{executor:"fixture"}},messages:[{role:"user",content:"Inspect the fixture; unavailable host files are not game revisions"}],systemPrompt:"Fixture only",tools,workspace:{threadId:"fixture",assistantMessageId:"answer",finalReview:"off"}});}
const registration=(directory:string,tools:ToolSpec[]=[]):Registration=>({id:"backend-fixture",product:"companion-vscode",profile:"fixture",workspace:directory,providers:["ollama"],hostTools:tools.map(tool=>tool.name),toolCatalog:tools});
const tick=()=>new Promise(resolve=>setTimeout(resolve,5));

test("Deep keeps unregistered workspace operations as explicit V2 errors, preserves scratch and continues with authorized game reads",async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),"unregistered-workspace-")),saver=SqliteSaver.fromConnString(":memory:");
  const canary=path.join(directory,"canary.txt");await writeFile(canary,"HOST_CANARY_MUST_REMAIN_PRIVATE");
  const calls=[call("read_file",{file_path:"/workspace/canary.txt"}),call("write_file",{file_path:"/workspace/canary.txt",content:"must-not-write"}),
    call("ls",{path:"/workspace/"}),call("glob",{pattern:"*.txt",path:"/workspace/"}),call("grep",{pattern:"canary",path:"/workspace/"}),
    call("edit_file",{file_path:"/workspace/canary.txt",old_string:"canary",new_string:"changed"}),call("delete",{file_path:"/workspace/canary.txt"}),
    call("game_read_file",{projectId:"project",path:"src/main.ts"}),call("write_file",{file_path:"/scratch/note.txt",content:"virtual planning note"},"scratch-write"),call("read_file",{file_path:"/scratch/note.txt"},"scratch-read")];
  const fake=model([...calls.map(row=>[row]),[]]);let hostCalls=0,gameReads=0;
  try{
    const result=await executeGraph(spec(),{registration:registration(directory),threadId:"absent-host",checkpointer:saver,signal:AbortSignal.timeout(20_000),models:{executor:fake.value,evaluator:evaluator()},emit(){},
      invokeTool:async()=>{hostCalls++;throw Error("No unregistered host dispatch is permitted");},
      gameProduction:{catalog:GAME_AGENT_TOOLS.filter(tool=>tool.name==="game_read_file"),evidence:()=>({changes:[],projects:[]}),invoke:async(name,input,id)=>{assert.equal(name,"game_read_file");assert.deepEqual(input,{projectId:"project",path:"src/main.ts"});assert.match(id,/^[a-f0-9]{64}$/);gameReads++;return {content:"Saved game source fixture"};}}});
    assert.match(result.text,/BACKEND_FIXTURE_OK/);assert.equal(hostCalls,0);assert.equal(gameReads,1);
    for(const name of ["read_file","write_file","ls","glob","grep","edit_file","delete"])assert.match(fake.seen.get(name)!,/not registered/);
    assert.match(fake.seen.get("game_read_file")!,/Saved game source/);assert.match(fake.seen.get("scratch-read")!,/virtual planning note/);
    assert.ok(fake.systems.some(text=>text.includes("no editor backend operations are registered")));
    assert.deepEqual(Object.keys(result.files as object),["/scratch/note.txt"],"reserved workspace mount must not fall back to virtual files");
    assert.equal(await readFile(canary,"utf8"),"HOST_CANARY_MUST_REMAIN_PRIVATE");assert.ok(![...fake.seen.values()].join(" ").includes("HOST_CANARY"));
  }finally{saver.db.close();await rm(directory,{recursive:true,force:true});}
});

test("partial editor registration does not grant another backend operation and plan mode retains read-only authority",async()=>{
  for(const mode of ["execute","plan"] as const){
    const saver=SqliteSaver.fromConnString(":memory:"),catalog=WORKSPACE_BACKEND_TOOLS.filter(tool=>mode==="plan"||tool.name==="vscode_backend_read"),ids:string[]=[];
    const fake=model([[call("write_file",{file_path:"/workspace/target.txt",content:"forbidden"})],[call("read_file",{file_path:"/workspace/target.txt"})],[call("delete",{file_path:"/workspace/target.txt"})],[]]);
    try{
      const result=await executeGraph(spec(catalog,mode),{registration:registration("fixture",catalog),threadId:`partial-${mode}`,checkpointer:saver,signal:AbortSignal.timeout(20_000),models:{executor:fake.value,evaluator:evaluator()},emit(){},
        invokeTool:async(definition,input,id)=>{assert.equal(definition.name,"vscode_backend_read");assert.deepEqual((input as {args:unknown[]}).args.slice(0,1),["/target.txt"]);ids.push(id);return envelope({content:"1: authorized read"});}});
      assert.match(result.text,/BACKEND_FIXTURE_OK/);assert.equal(ids.length,1);assert.match(ids[0]!,/^[a-f0-9]{64}$/);
      assert.match(fake.seen.get("read_file")!,/authorized read/);for(const name of ["write_file","delete"])assert.match(fake.seen.get(name)!,mode==="plan"?/denied|Plan mode/i:/not registered/);
      assert.ok(!Object.keys((result.files??{}) as object).some(name=>name.startsWith("/workspace/")));
    }finally{saver.db.close();}
  }
});

test("a delegated Deep reader also receives explicit absence without a host dispatch or parent failure",async()=>{
  const saver=SqliteSaver.fromConnString(":memory:"),parent=model([[call("task",{subagent_type:"fixture-reader",description:"Inspect the reserved workspace path without substituting another backend"})],[]]);
  const child=model([[call("read_file",{file_path:"/workspace/canary.txt"})],[]]);let hostCalls=0;
  try{
    const result=await executeGraph(spec(),{registration:registration("fixture"),threadId:"delegated-unavailable",checkpointer:saver,signal:AbortSignal.timeout(20_000),models:{executor:parent.value,evaluator:evaluator()},emit(){},
      subagents:[{name:"fixture-reader",description:"Readonly fixture",systemPrompt:"Read only through the registered backend",model:child.value,tools:[]}],
      invokeTool:async()=>{hostCalls++;throw Error("No unregistered child dispatch");}});
    assert.match(result.text,/BACKEND_FIXTURE_OK/);assert.equal(hostCalls,0);assert.match(child.seen.get("read_file")!,/not registered/);assert.equal(child.seen.size,1);
  }finally{saver.db.close();}
});

test("registered backend reconciliation is still an interrupt, never a retryable availability error or fallback",async()=>{
  const saver=SqliteSaver.fromConnString(":memory:"),catalog=WORKSPACE_BACKEND_TOOLS.filter(tool=>tool.name==="vscode_backend_write"),fake=model([[call("write_file",{file_path:"/workspace/target.txt",content:"unknown effect"})],[]]);let effects=0;
  try{
    await assert.rejects(executeGraph(spec(catalog),{registration:registration("fixture",catalog),threadId:"unknown-backend",checkpointer:saver,signal:AbortSignal.timeout(20_000),models:{executor:fake.value,evaluator:evaluator()},emit(){},
      invokeTool:async()=>{effects++;throw new AgentError(errors.reconciliation,"Original host result is unknown");}}),error=>error instanceof AgentError&&error.code===errors.reconciliation);
    assert.equal(effects,1);assert.ok(![...fake.seen.values()].join(" ").includes("not registered"));
    const checkpoint=await saver.getTuple({configurable:{thread_id:"unknown-backend"}});assert.ok(checkpoint);assert.ok(!Object.keys((checkpoint.checkpoint.channel_values.files??{}) as object).includes("/workspace/target.txt"));
  }finally{saver.db.close();}
});

test("a registered Deep editor read waits for its host, survives reconnect and keeps one durable receipt",async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),"registered-deep-backend-")),store=new Store(path.join(directory,"metadata.sqlite")),catalog=WORKSPACE_BACKEND_TOOLS.filter(tool=>tool.name==="vscode_backend_read"),reg=registration(directory,catalog);
  const fake=model([[call("read_file",{file_path:"/workspace/target.txt"})],[]]);
  const service=new AgentService(store,directory,(request,context)=>executeGraph(request,{...context,models:{executor:fake.value,evaluator:evaluator()}}));
  try{
    const session=store.createSession(reg,"Registered backend"),request={sessionId:session.id,key:"read-once",spec:spec(catalog)},run=await service.dispatch(reg,"runs.start",request,"closed-window") as Run;
    for(let i=0;i<600&&store.run(reg,run.id).state!=="awaiting_host";i++)await tick();assert.equal(store.run(reg,run.id).state,"awaiting_host");
    const waits=await service.dispatch(reg,"host.poll",{},"first-window") as {id:string;payload:{tool:string}}[];assert.equal(waits.length,1);assert.equal(waits[0]!.payload.tool,"vscode_backend_read");
    service.disconnect("first-window");const resumed=await service.dispatch(reg,"host.poll",{},"reopened-window") as {id:string}[];assert.equal(resumed.length,1);assert.equal(resumed[0]!.id,waits[0]!.id);
    assert.equal(store.run(reg,run.id).state,"awaiting_host");await service.dispatch(reg,"host.respond",{id:resumed[0]!.id,value:envelope({content:"1: registered host result"})},"reopened-window");
    for(let i=0;i<600&&!['completed','failed'].includes(store.run(reg,run.id).state);i++)await tick();assert.equal(store.run(reg,run.id).state,"completed",store.run(reg,run.id).error);
    assert.equal((await service.dispatch(reg,"runs.start",request,"reopened-window") as Run).id,run.id);
    const receipts=store.db.prepare("SELECT r.status FROM receipts r JOIN operation_identities i ON i.id=r.id WHERE r.run=? AND i.tool='vscode_backend_read'").all(run.id) as {status:string}[];
    assert.deepEqual(receipts,[{status:"completed"}]);assert.deepEqual(await service.dispatch(reg,"host.poll",{},"reopened-window"),[]);
  }finally{await service.close();await rm(directory,{recursive:true,force:true});}
});
