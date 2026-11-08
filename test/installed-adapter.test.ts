import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { chmod, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import test from "node:test";
import { loadSignedAdapter } from "../packages/agent-service/src/installed-adapter";
import { AgentService } from "../packages/agent-service/src/service";
import { Store } from "../packages/agent-service/src/store";
import { runSpec, type Registration, type Run, type ToolSpec } from "../packages/contracts/src/index";
import type { InstalledAdapter } from "../packages/agent-core/src/installed-adapter";

test("only the pinned signed adapter under protected ownership can load code", { skip: process.platform === "win32" ? "KidOS adapters require POSIX system ownership" : false }, async () => {
 const root=await mkdtemp(path.join(tmpdir(),"signed-adapter-"));
 try {
  const directory=path.join(root,"version");await mkdir(directory,{mode:0o700});
  const keys=generateKeyPairSync("ed25519");const key=path.join(root,"key.pub");
  await writeFile(key,keys.publicKey.export({type:"spki",format:"pem"}),{mode:0o600});
  const source="module.exports.createAdapter=()=>({product:'kidos',validate(){},async execute(){return {text:'fixture'}},prepareTool(r,d,a){return a},async invokeTool(){return {ok:true}}})";
  await writeFile(path.join(directory,"adapter.cjs"),source,{mode:0o600});
  const bytes=Buffer.from(JSON.stringify({schema:1,product:"kidos",protocol:"1.0",entry:"adapter.cjs",files:{"adapter.cjs":createHash("sha256").update(source).digest("hex")}}));
  await writeFile(path.join(directory,"manifest.json"),bytes,{mode:0o600});await writeFile(path.join(directory,"manifest.sig"),sign(null,bytes,keys.privateKey),{mode:0o600});
  const descriptor=path.join(root,"descriptor.json");await writeFile(descriptor,JSON.stringify({schema:1,directory,manifestSha256:createHash("sha256").update(bytes).digest("hex")}),{mode:0o600});
  const trust={owner:process.getuid?.() ?? 0,boundary:root};
  assert.equal((await loadSignedAdapter(descriptor,key,trust)).product,"kidos");
  await writeFile(path.join(directory,"adapter.cjs"),source+";throw Error('must not execute')");
  await assert.rejects(loadSignedAdapter(descriptor,key,trust),/integrity/);
  await writeFile(path.join(directory,"adapter.cjs"),source);
  await writeFile(path.join(directory,"extra.cjs"),"throw Error('must not execute')");
  await assert.rejects(loadSignedAdapter(descriptor,key,trust),/Undeclared/);await rm(path.join(directory,"extra.cjs"));
  if(process.platform!=="win32"){
   await chmod(descriptor,0o666);await assert.rejects(loadSignedAdapter(descriptor,key,trust),/permissions/);await chmod(descriptor,0o600);
   await symlink(descriptor,path.join(root,"linked.json"));await assert.rejects(loadSignedAdapter(path.join(root,"linked.json"),key,trust),/ownership/);
  }
  await writeFile(path.join(directory,"manifest.sig"),Buffer.alloc(64));await assert.rejects(loadSignedAdapter(descriptor,key,trust),/signature/);
 } finally {await rm(root,{recursive:true,force:true});}
});

test("KidOS effects run in the installed adapter under the coordinator ledger, never a UI callback", async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),"installed-effect-"));const store=new Store(path.join(directory,"metadata.sqlite"));
 const definition:ToolSpec={name:"kidos_build",description:"Fixture",schema:{type:"object"},effect:"external"};
 const reg:Registration={id:"kid",product:"kidos",profile:"child",workspace:"",providers:["kidos-gateway"],hostTools:[definition.name],toolCatalog:[definition]};
 let effects=0;
 const adapter:InstalledAdapter={product:"kidos",validate(){},prepareTool(_reg,_definition,input,state){return {input,state};},async invokeTool(){effects++;return {built:true};},async execute(_spec,context){
  const first=await context.invokeTool(definition,{game:"fixture"},"one",{files:{"/game.js":"preserved"}});
  assert.deepEqual(await context.invokeTool(definition,{game:"fixture"},"one",{files:{"/game.js":"preserved"}}),first);
  await assert.rejects(context.invokeTool(definition,{game:"different"},"one",{}),/different tool arguments/);
  assert.equal(context.operationResults?.().length,1);
  return {text:"adapter done"};
 }};
 const service=new AgentService(store,directory,undefined,{}, {adapter});
 try{
  const session=store.createSession(reg,"KidOS");const spec=runSpec.parse({runtime:"standard",mode:"execute",provider:{kind:"kidos-gateway",endpoint:"http://127.0.0.1:8788",roles:{executor:"managed-by-guardian"}},messages:[{role:"user",content:"fixture"}],systemPrompt:"ignored",tools:[definition]});
  const run=await service.dispatch(reg,"runs.start",{sessionId:session.id,key:"adapter-run",spec},"ui") as Run;
  for(let index=0;index<100&&store.run(reg,run.id).state==="running";index++)await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(store.run(reg,run.id).state,"completed");assert.equal(effects,1);assert.deepEqual(await service.dispatch(reg,"host.poll",{},"ui"),[]);
 }finally{await service.close();await rm(directory,{recursive:true,force:true});}
});

test("retired enrollment files do not prevent loading the currently provisioned adapter after an update",async()=>{
 const {loadProvisionedClients}=await import("../packages/agent-service/src/server");
 const {AgentError,errors}=await import("../packages/contracts/src/index");
 const root=await mkdtemp(path.join(tmpdir(),"retired-enrollment-"));
 try{
  await mkdir(path.join(root,"clients"),{mode:0o700});
  const credentials=[{registration:{id:"retired"},token:"retired"},{registration:{id:"current"},token:"current"}];
  for(let index=0;index<credentials.length;index++)await writeFile(path.join(root,"clients",String(index).repeat(64)+".json"),JSON.stringify(credentials[index]),{mode:0o600});
  const registered:string[]=[];const store={register(value:any){if(value.registration.id==="retired")throw new AgentError(errors.forbidden,"Not in the current system policy");registered.push(value.registration.id);}} as unknown as Store;
  await loadProvisionedClients(store,root);assert.deepEqual(registered,["current"]);
 }finally{await rm(root,{recursive:true,force:true});}
});
