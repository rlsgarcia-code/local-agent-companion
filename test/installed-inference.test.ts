import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp,rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { AgentService } from "../packages/agent-service/src/service";
import { Store } from "../packages/agent-service/src/store";
import { adapterModelAPI,type InstalledAdapter } from "../packages/agent-core/src/installed-adapter";
import { runSpec,type Registration,type Run } from "../packages/contracts/src/index";

const reg:Registration={id:"inference-fixture",product:"kidos",profile:"child",workspace:"",providers:["kidos-gateway"],hostTools:[]};
const spec=runSpec.parse({runtime:"standard",mode:"execute",provider:{kind:"kidos-gateway",endpoint:"http://127.0.0.1:8788",roles:{executor:"managed-by-guardian"}},messages:[{role:"user",content:"fixture"}],systemPrompt:"",tools:[]});
async function stopped(service:AgentService,run:Run){
 for(let index=0;index<100;index++){
  const value=await service.dispatch(reg,"runs.get",{id:run.id},"client") as Run;
  if(value.state!=="running"&&value.state!=="cancelling"){await new Promise(resolve=>setTimeout(resolve,5));return value;}
  await new Promise(resolve=>setTimeout(resolve,5));
 }
 throw Error("Fixture did not stop");
}
for(const cancel of [false,true])test(`protected inference inspection requires original authority and preserves cancel intent (${cancel})`,async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),"inference-inspection-")),store=new Store(path.join(directory,"metadata.sqlite"));
 let starts=0,known=false,inspections=0;
 const adapter:InstalledAdapter={product:"kidos",validate(){},prepareTool(_r,_d,input){return input;},async invokeTool(){throw Error("No tools");},
  async execute(_spec,context){
   starts++;if(starts>1)return {text:"Explicit new model attempt only after inspection."};
   context.memo!.put("pending-provider",true);
   if(cancel)await new Promise<void>((_resolve,reject)=>{context.signal.addEventListener("abort",()=>reject(context.signal.reason),{once:true});});
   throw adapterModelAPI.protectedInferenceWait("Original provider result unknown.",true);
  },hasPendingInference(_reg,context){return context.memo.get("pending-provider")===true;},
  async reconcileInference(_reg,context){inspections++;if(!known)return {state:"unknown"};context.memo.put("pending-provider",false);return {state:"known",result:{receipt:"observed"}};},
 };
 const service=new AgentService(store,directory,undefined,{}, {adapter});
 try{
  const session=store.createSession(reg,"Provider fixture"),run=await service.dispatch(reg,"runs.start",{sessionId:session.id,key:"first",spec},"client") as Run;
  if(cancel){await new Promise(resolve=>setTimeout(resolve,5));await service.dispatch(reg,"runs.cancel",{id:run.id},"client");}
  assert.equal((await stopped(service,run)).state,"awaiting_reconciliation");
  await assert.rejects(service.dispatch(reg,"runs.resume",{id:run.id},"client"),/Reconcile/);
  await assert.rejects(service.dispatch(reg,"inference.inspect",{runId:run.id,result:true},"client"));
  await assert.rejects(service.dispatch({...reg,profile:"another"},"inference.inspect",{runId:run.id},"client"));
  assert.equal(inspections,0);
  assert.equal((await service.dispatch(reg,"inference.inspect",{runId:run.id},"client") as Run).state,"awaiting_reconciliation");
  assert.equal(starts,1);known=true;
  assert.equal((await service.dispatch(reg,"inference.inspect",{runId:run.id},"client") as Run).state,cancel?"cancelled":"awaiting_host");
  assert.equal(starts,1);
  await service.dispatch(reg,"runs.resume",{id:run.id},"client");
  if(cancel)assert.equal(starts,1);else {assert.equal((await stopped(service,run)).state,"completed");assert.equal(starts,2);}
 }finally{await service.close();await rm(directory,{recursive:true,force:true});}
});

test("protected policy refusal is waiting for configuration, not running or completed",async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),"inference-policy-")),store=new Store(path.join(directory,"metadata.sqlite"));
 const adapter:InstalledAdapter={product:"kidos",validate(){},prepareTool(_r,_d,input){return input;},async invokeTool(){},
  async execute(){throw adapterModelAPI.protectedInferenceWait("Await responsible policy.",false);},hasPendingInference(){return false;},async reconcileInference(){return {state:"known",result:{}};}};
 const service=new AgentService(store,directory,undefined,{}, {adapter});
 try{const session=store.createSession(reg,"Policy fixture"),run=await service.dispatch(reg,"runs.start",{sessionId:session.id,key:"first",spec},"client") as Run;
  const waiting=await stopped(service,run);assert.equal(waiting.state,"awaiting_host");assert.equal(waiting.waitingFor,"protected-inference");
 }finally{await service.close();await rm(directory,{recursive:true,force:true});}
});

test("KidOS inference binds the selected project at admission and preserves it across resume",async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),"inference-project-binding-")),store=new Store(path.join(directory,"metadata.sqlite"));
 const seen:(string|undefined)[]=[];
 const adapter:InstalledAdapter={product:"kidos",validate(){},prepareTool(_r,_d,input){return input;},async invokeTool(){},
  async execute(_spec,context){seen.push(context.inferenceProjectId);throw adapterModelAPI.protectedInferenceWait("Parent allocation pending.",false);},
  hasPendingInference(){return false;},async reconcileInference(){return {state:"known",result:{}};}};
 const service=new AgentService(store,directory,undefined,{}, {adapter});
 try{
  const document={schemaVersion:2,title:"Budget binding",engine:"phaser",brief:{request:"Fixture",audience:"Fixture",genre:"arcade",dimension:"2d",playMode:"single-player",players:{min:1,max:1},devices:["desktop"],inputs:["keyboard"]},design:null,files:[],assets:[]};
  const first=await service.dispatch(reg,"games.projects.create",{requestId:"first-project",document},"client") as {id:string};
  const second=await service.dispatch(reg,"games.projects.create",{requestId:"second-project",document},"client") as {id:string};
  const session=store.createSession(reg,"Binding fixture");
  await service.dispatch(reg,"games.projects.select",{sessionId:session.id,projectId:first.id},"client");
  await assert.rejects(service.dispatch(reg,"runs.start",{sessionId:session.id,key:"forged",spec:{...spec,inferenceProjectId:second.id}},"client"));
  const run=await service.dispatch(reg,"runs.start",{sessionId:session.id,key:"bound",spec},"client") as Run;
  assert.equal((await stopped(service,run)).state,"awaiting_host");
  await assert.rejects(service.dispatch(reg,"games.projects.select",{sessionId:session.id,projectId:second.id},"other-window"),/active conversation/);
  await service.dispatch(reg,"runs.resume",{id:run.id},"client");assert.equal((await stopped(service,run)).state,"awaiting_host");
  assert.deepEqual(seen,[first.id,first.id]);
  await service.dispatch(reg,"runs.cancel",{id:run.id},"client");
  await service.dispatch(reg,"games.projects.select",{sessionId:session.id,projectId:second.id},"other-window");
  const next=await service.dispatch(reg,"runs.start",{sessionId:session.id,key:"new-selected",spec},"client") as Run;
  await stopped(service,next);assert.deepEqual(seen,[first.id,first.id,second.id]);
 }finally{await service.close();await rm(directory,{recursive:true,force:true});}
});
