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
  const pin={version:"fixture-version",commit:"a".repeat(40),manifestSha256:"b".repeat(64)};
  const catalog=JSON.stringify({engine:pin});await writeFile(path.join(directory,"catalog.json"),catalog,{mode:0o600});
  const bytes=Buffer.from(JSON.stringify({schema:1,product:"kidos",protocol:"1.0",entry:"adapter.cjs",files:{"adapter.cjs":createHash("sha256").update(source).digest("hex"),"catalog.json":createHash("sha256").update(catalog).digest("hex")}}));
  await writeFile(path.join(directory,"manifest.json"),bytes,{mode:0o600});await writeFile(path.join(directory,"manifest.sig"),sign(null,bytes,keys.privateKey),{mode:0o600});
  const descriptor=path.join(root,"descriptor.json");await writeFile(descriptor,JSON.stringify({schema:1,directory,manifestSha256:createHash("sha256").update(bytes).digest("hex")}),{mode:0o600});
  const trust={owner:process.getuid?.() ?? 0,boundary:root};
  assert.equal((await loadSignedAdapter(descriptor,key,{...trust,engine:pin})).product,"kidos");
  await assert.rejects(loadSignedAdapter(descriptor,key,{...trust,engine:{...pin,manifestSha256:"c".repeat(64)}}),/different engine artifact/);
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

test("signed production hooks expose only Core ports for KidOS and receive the exact integration API",{skip:process.platform==="win32"},async()=>{
 const root=await mkdtemp(path.join(tmpdir(),"signed-game-port-"));const keys=generateKeyPairSync("ed25519");
 const key=path.join(root,"key.pub");await writeFile(key,keys.publicKey.export({type:"spki",format:"pem"}),{mode:0o600});
 try{
  for(const variant of ["protected","workspace","other-product","not-array","admission","bad-admission","missing-inspector"]){
   const directory=path.join(root,variant);await mkdir(directory,{mode:0o700});
   const hooks=variant==='admission'?",admission:{async reserve(){},async cancel(){}},async reconcile(){return {state:'missing',detail:'Fixture original closed'}}":variant==='bad-admission'?",admission:{reserve:1,async cancel(){}}":variant==='missing-inspector'?",admission:{async reserve(){},async cancel(){}}":"";
   const port=`{id:'fixture',engine:'phaser',authority:'${variant==="workspace"?"workspace":"kidos-core"}',products:['${variant==="other-product"?"companion-mac":"kidos"}'],toolchain:{id:'fixture',version:'1',sha256:'${"a".repeat(64)}'},async probe(){return {available:true}},async build(){return {entrypoint:'index.html',files:[]}}${hooks}}`;
   const source=`module.exports.createAdapter=api=>{if(api.installedGameProductionVersion!==1||!api.coreBuildSchemas||!api.GameProductionUncertain)throw Error('Missing integration kit');return {product:'kidos',validate(){},async execute(){},prepareTool(r,d,a){return a},async invokeTool(){},gameAdapters:${variant==="not-array"?"{}":`[${port}]`}}}`;
   await writeFile(path.join(directory,"adapter.cjs"),source,{mode:0o600});
   const bytes=Buffer.from(JSON.stringify({schema:1,product:"kidos",protocol:"1.0",entry:"adapter.cjs",files:{"adapter.cjs":createHash("sha256").update(source).digest("hex")}}));
   await writeFile(path.join(directory,"manifest.json"),bytes,{mode:0o600});await writeFile(path.join(directory,"manifest.sig"),sign(null,bytes,keys.privateKey),{mode:0o600});
   const descriptor=path.join(root,variant+".json");await writeFile(descriptor,JSON.stringify({schema:1,directory,manifestSha256:createHash("sha256").update(bytes).digest("hex")}),{mode:0o600});
   const result=loadSignedAdapter(descriptor,key,{owner:process.getuid?.()??0,boundary:root});
   if(variant==="protected"||variant==='admission')assert.equal((await result).gameAdapters?.length,1);
   else await assert.rejects(result,/protected|ports.*array|admission/i);
  }
 }finally{await rm(root,{recursive:true,force:true});}
});

test("signed media hooks require exclusive Core authority and durable admission/inspection",{skip:process.platform==="win32"},async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'signed-media-port-')),keys=generateKeyPairSync('ed25519'),key=path.join(root,'key.pub');
 await writeFile(key,keys.publicKey.export({type:'spki',format:'pem'}),{mode:0o600});
 try{
  for(const variant of ['protected','workspace','other-product','not-array','no-reserve','no-cancel','no-inspector']){
   const directory=path.join(root,variant);await mkdir(directory,{mode:0o700});
   const port=`{id:'fixture',authority:'${variant==='workspace'?'workspace':'kidos-core'}',products:['${variant==='other-product'?'companion-mac':'kidos'}'],async probe(){},async process(){},${variant==='no-inspector'?'':'async reconcile(){},'}admission:{${variant==='no-reserve'?'':'async reserve(){},'}${variant==='no-cancel'?'':'async cancel(){},'}}}`;
   const source=`module.exports.createAdapter=api=>{if(api.installedCoreGameMediaVersion!==1||!api.coreMediaSchemas||!api.gameMediaProcessRequest)throw Error('Missing media kit');return {product:'kidos',validate(){},async execute(){},prepareTool(r,d,a){return a},async invokeTool(){},gameAssetProcessors:${variant==='not-array'?'{}':`[${port}]`}}}`;
   await writeFile(path.join(directory,'adapter.cjs'),source,{mode:0o600});
   const bytes=Buffer.from(JSON.stringify({schema:1,product:'kidos',protocol:'1.0',entry:'adapter.cjs',files:{'adapter.cjs':createHash('sha256').update(source).digest('hex')}}));
   await writeFile(path.join(directory,'manifest.json'),bytes,{mode:0o600});await writeFile(path.join(directory,'manifest.sig'),sign(null,bytes,keys.privateKey),{mode:0o600});
   const descriptor=path.join(root,variant+'.json');await writeFile(descriptor,JSON.stringify({schema:1,directory,manifestSha256:createHash('sha256').update(bytes).digest('hex')}),{mode:0o600});
   const result=loadSignedAdapter(descriptor,key,{owner:process.getuid?.()??0,boundary:root});
   if(variant==='protected')assert.equal((await result).gameAssetProcessors?.length,1);
   else await assert.rejects(result,/protected|ports.*array/i);
  }
 }finally{await rm(root,{recursive:true,force:true});}
});

test('signed observation ports require exact KidOS authority, pre-queue admission and original inspection', {skip:process.platform==='win32'},async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'signed-observation-port-')),keys=generateKeyPairSync('ed25519'),key=path.join(root,'key.pub');
 await writeFile(key,keys.publicKey.export({type:'spki',format:'pem'}),{mode:0o600});
 try{
  for(const variant of ['protected','protected-format','bad-format','workspace','other-product','not-array','no-probe','no-reserve','no-cancel','no-inspector','bad-dispose']){
   const directory=path.join(root,variant);await mkdir(directory,{mode:0o700});
   const port=`{${variant==='protected-format'?"testSuiteFormat:'browser-v1',":variant==='bad-format'?"testSuiteFormat:'unknown',":''}id:'fixture-observer',engines:['phaser'],categories:['runtime'],toolchain:{id:'fixture',version:'1',sha256:'${'a'.repeat(64)}'},authority:'${variant==='workspace'?'workspace':'kidos-core'}',products:['${variant==='other-product'?'companion-mac':'kidos'}'],${variant==='no-probe'?'':'async probe(){return {available:true}},'}async validate(){return []},${variant==='no-inspector'?'':'async reconcile(){return {state:"missing",detail:"Fixture closed"}},'}${variant==='bad-dispose'?'dispose:1,':''}admission:{${variant==='no-reserve'?'':'async reserve(){},'}${variant==='no-cancel'?'':'async cancel(){},'}}}`;
   const source=`module.exports.createAdapter=api=>{if(api.installedCoreGameValidationVersion!==1)throw Error('Missing validation admission ABI');return {product:'kidos',validate(){},async execute(){},prepareTool(r,d,a){return a},async invokeTool(){},gameValidationCollectors:${variant==='not-array'?'{}':`[${port}]`}}}`;
   await writeFile(path.join(directory,'adapter.cjs'),source,{mode:0o600});
   const bytes=Buffer.from(JSON.stringify({schema:1,product:'kidos',protocol:'1.0',entry:'adapter.cjs',files:{'adapter.cjs':createHash('sha256').update(source).digest('hex')}}));
   await writeFile(path.join(directory,'manifest.json'),bytes,{mode:0o600});await writeFile(path.join(directory,'manifest.sig'),sign(null,bytes,keys.privateKey),{mode:0o600});
   const descriptor=path.join(root,variant+'.json');await writeFile(descriptor,JSON.stringify({schema:1,directory,manifestSha256:createHash('sha256').update(bytes).digest('hex')}),{mode:0o600});
   const pending=loadSignedAdapter(descriptor,key,{owner:process.getuid?.()??0,boundary:root});
   if(variant==='protected'||variant==='protected-format'){
     const installed=await pending;assert.equal(installed.gameValidationCollectors?.length,1);
     assert.equal(installed.gameValidationCollectors?.[0]?.testSuiteFormat,variant==='protected-format'?'browser-v1':undefined);
     const dir=path.join(root,'state-'+variant);await mkdir(dir);const service=new AgentService(new Store(path.join(dir,'state.sqlite')),dir,undefined,{}, {adapter:installed});
     try{
       const kid:Registration={id:'fixture-child',product:'kidos',profile:'child',workspace:'',providers:['kidos-gateway'],hostTools:[]};
       const caps=await service.dispatch(kid,'games.production.capabilities',{},'fixture') as {collectors:{id:string}[]};
       assert.deepEqual(caps.collectors.map(row=>row.id),['fixture-observer']);
       const mac={...kid,id:'mac',product:'companion-mac' as const,providers:['ollama' as const]};
       assert.deepEqual((await service.dispatch(mac,'games.production.capabilities',{},'fixture') as {collectors:unknown[]}).collectors,[]);
     }finally{await service.close();}
   }else await assert.rejects(pending,/protected|ports.*array/i);
  }
 }finally{await rm(root,{recursive:true,force:true});}
});
