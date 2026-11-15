/** Explicit Root/native qualification client. No release entrypoint or agent loop. */
import assert from "node:assert/strict";
import { generateKeyPairSync, createHash, sign } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { appendFile, mkdir, readFile, readdir, writeFile, unlink, lstat, readlink } from "node:fs/promises";
import path from "node:path";
import { AgentClient } from "../packages/client-ts/src/index";
import { AgentService } from "../packages/agent-service/src/service";
import { Store } from "../packages/agent-service/src/store";
import { LocalServer } from "../packages/agent-service/src/server";
import { createClientCredential, ensureIdentity, ipcPath } from "../packages/agent-service/src/security";
import { loadSignedAdapter } from "../packages/agent-service/src/installed-adapter";
import { enforceSystemProvisioning } from "../packages/agent-service/src/provisioning";
import { contentHash } from "../packages/contracts/src/identity";
import type { ClientCredential, Registration } from "../packages/contracts/src/index";
import type { GameDocument, GameFile } from "../packages/contracts/src/games";
import { fixtureGameDocument } from "./game-fixtures";
import { gameBrowserCandidateToolchain } from "../packages/adapter-game-browser/src/candidate-toolchain";

const hash=(raw:Uint8Array)=>createHash("sha256").update(raw).digest("hex");
const json=async(file:string)=>JSON.parse(await readFile(file,"utf8"));
const save=async(file:string,value:unknown,mode=0o600)=>writeFile(file,JSON.stringify(value,null,2)+"\n",{mode});
const pause=()=>new Promise(resolve=>setTimeout(resolve,100));
const [mode,root]=process.argv.slice(2);
function guard(){
 if(process.platform!=="linux"||process.versions.node!=="22.23.4"||!root||!/^\/var\/lib\/kidos-qualification\/root-browser-[a-f0-9]{32}$/.test(root)||
    !["--provision","--serve","--run"].includes(mode!))throw Error("Select the explicit temporary native Root validation qualification.");
 return root;
}
async function privateNamespace(root:string){
 const file=root+"/boundary.json",info=await lstat(file);
 if(!info.isFile()||info.isSymbolicLink()||info.uid!==0||(info.mode&0o022))throw Error("Root-owned qualification marker required.");
 const boundary=await json(file);
 if(boundary.schema!==1||boundary.scope!=="temporary-native-root-browser"||typeof boundary.hostMountNamespace!=="string"||
    !/^mnt:\[[0-9]+\]$/.test(boundary.hostMountNamespace)||boundary.hostMountNamespace===await readlink("/proc/self/ns/mnt")||
    typeof boundary.sourceManifestSha256!=="string"||!/^[a-f0-9]{64}$/.test(boundary.sourceManifestSha256))
  throw Error("The qualification requires its private mount namespace; never provision the host.");
}
async function provision(root:string){
 assert.equal(process.getuid!(),0);
 const inputs=root+"/inputs",shared=root+"/shared",directory=shared+"/adapter";await mkdir(directory,{mode:0o755});
 for(const name of ["inference.cjs","production.cjs","core-exchange.cjs","validation.cjs"])
  await writeFile(path.join(directory,name),await readFile(path.join(inputs,"adapter",name)),{mode:0o644});
 await writeFile(directory+"/domain.cjs",await readFile(inputs+"/adapter/adapter.cjs"),{mode:0o644});
 const runtime=await json(root+"/runtime/manifest.json"),implementation=hash(await readFile(root+"/runtime/manifest.json"));
 const lock=await json(root+"/runtime/game-runtimes/runtime.lock.json"),browser=await json(inputs+"/fixture.json");
 const catalog=await json(inputs+"/catalog.json");
 const pin={version:"native-root-qualification",commit:"0".repeat(40),manifestSha256:implementation};
 catalog.engine={...pin,sdkManifestSha256:"0".repeat(64)};
 catalog.protectedInference={schema:1};
 catalog.gameProduction={schema:1,budgetPolicyABI:2,projectBudgets:{schema:1},queueAdmission:{schema:1},adapters:lock.engines.map((row:any)=>({
  id:`kidos-core-${row.engine}-v1`,engine:row.engine,toolchain:{id:`web-${row.engine}`,version:`${row.version}+esbuild.${lock.compiler.version}.adapter.1`,
  sha256:contentHash({runtime:row,compiler:lock.compiler,adapterABI:1,implementation})}}))};
 assert.equal(runtime.dependencies["playwright-core"],"1.58.2");
 catalog.gameValidation={schema:1,implementation_sha256:implementation,browser_manifest_sha256:browser.browserManifestSha256,
  browser_component_manifest_sha256:browser.browserComponentSha256,browser_target:"linux-x64",
  toolchain:gameBrowserCandidateToolchain(implementation,browser.browserManifestSha256,browser.browserComponentSha256)};
 await save(directory+"/catalog.json",catalog,0o644);
 const wrapper=`const {spawn}=require('node:child_process');
 module.exports.createAdapter=api=>require('./domain.cjs').createAdapter({...api,bridge:(request,signal)=>new Promise((resolve,reject)=>{
  const child=spawn('/usr/bin/python3',['-I','-S',${JSON.stringify(inputs+"/native_root_validation.py")},'--bridge',${JSON.stringify(root)}],{signal,stdio:['pipe','pipe','pipe'],env:{PATH:'/usr/bin:/bin',LANG:'C.UTF-8'}});
  let size=0,parts=[];child.stdout.on('data',data=>{size+=data.length;if(size>1048576){child.kill();reject(Error('Qualification bridge bound'));}else parts.push(data);});
  child.stderr.resume();child.stdin.on('error',()=>{});child.once('error',reject);child.once('close',code=>{try{const row=JSON.parse(Buffer.concat(parts));if(code!==0||row.ok!==true)throw Error('Qualification bridge refused');resolve(row.result);}catch(error){reject(error);}});child.stdin.end(JSON.stringify(request));})});`;
 await writeFile(directory+"/adapter.cjs",wrapper,{mode:0o644});
 const files:Record<string,string>={};for(const name of await readdir(directory))files[name]=hash(await readFile(path.join(directory,name)));
 const bytes=Buffer.from(JSON.stringify({schema:1,product:"kidos",protocol:"1.0",entry:"adapter.cjs",files})),keys=generateKeyPairSync("ed25519");
 await writeFile(directory+"/manifest.json",bytes,{mode:0o644});await writeFile(directory+"/manifest.sig",sign(null,bytes,keys.privateKey),{mode:0o644});
 await writeFile(shared+"/fixture.pub",keys.publicKey.export({type:"spki",format:"pem"}),{mode:0o644});
 await save(shared+"/descriptor.json",{schema:1,directory,manifestSha256:hash(bytes)},0o644);
 const registration:Registration={id:"native-root-validation",product:"kidos",profile:"1000",workspace:"",providers:["kidos-gateway"],
  hostTools:catalog.tools.map((row:any)=>row.name),toolCatalog:catalog.tools};
 await save("/etc/kidos/agent-policy.json",{schema:1,clients:[{uid:1000,id:registration.id,registrationSha256:contentHash(registration)}]},0o644);
 await save(shared+"/config.json",{pin,registration},0o644);
}
async function serve(root:string){
 assert.equal(process.getuid!(),1000);const config=await json(root+"/shared/config.json"),state=root+"/child/service";
 const adapter=await loadSignedAdapter(root+"/shared/descriptor.json",root+"/shared/fixture.pub",{engine:config.pin});
 const service=new AgentService(new Store(state+"/metadata.sqlite"),state,undefined,{}, {adapter,deferRecovery:true});
 service.store.register(await json(root+"/child/client.json") as ClientCredential);
 const server=new LocalServer(service,state);await server.listen();
 for(const signal of ["SIGINT","SIGTERM"] as const)process.once(signal,()=>{void server.close().finally(()=>process.exit(0));});
}
async function run(root:string){
 assert.equal(process.getuid!(),1000);const config=await json(root+"/shared/config.json"),reg=config.registration as Registration,state=root+"/child/service";
 enforceSystemProvisioning(reg);
 for(const forged of [{...reg,product:"companion-mac" as const},{...reg,profile:"1001"},{...reg,hostTools:[...reg.hostTools,"shell"]}])
  assert.throws(()=>enforceSystemProvisioning(forged));
 await mkdir(state,{mode:0o700});const credential=await createClientCredential(state,reg),identity=await ensureIdentity(state);await save(root+"/child/client.json",credential);
 let child:ChildProcess|undefined,client:AgentClient|undefined,sequence=0;const cases:string[]=[],details:unknown[]=[];
 async function stop(){client?.close();client=undefined;if(child){if(child.exitCode===null&&child.signalCode===null){const exited=new Promise<void>(resolve=>child!.once("exit",()=>resolve()));child.kill("SIGKILL");await exited;}child=undefined;}
  await unlink(ipcPath(state)).catch(error=>{if(error.code!=="ENOENT")throw error;});}
 async function boot(){
  child=spawn(process.execPath,[process.argv[1]!,"--serve",root],{env:process.env,stdio:["ignore","pipe","pipe"]});
  for(const stream of [child.stdout,child.stderr])stream?.on("data",data=>{void appendFile(root+"/child/service.log",data,{mode:0o600});});
  const deadline=Date.now()+20000;for(;;){if(child.exitCode!==null||child.signalCode!==null)throw Error("Native qualification service exited");
   const candidate=new AgentClient({address:ipcPath(state),certificate:identity.cert,credential});
   try{await candidate.connect();client=candidate;return;}catch{candidate.close();if(Date.now()>deadline)throw Error("Service startup timed out");await pause();}}
 }
 async function control(action:string,project_id?:string){
  const id=++sequence;await save(root+"/child/control-request.json",{id,action,...(project_id?{project_id}:{})});const deadline=Date.now()+10000;
  for(;;){const row=await json(root+"/child/control-response.json").catch(()=>null);if(row?.id===id){assert.equal(row.ok,true);return row.result;}
   if(Date.now()>deadline)throw Error("Root fixture control timed out");await pause();}
 }
 async function terminal(id:string,expected="completed"){
  const deadline=Date.now()+120000;for(;;){const job=await client!.getGameProduction(id);if(job.state===expected)return job;
   if(["completed","failed","cancelled","awaiting_reconciliation"].includes(job.state)||Date.now()>deadline)throw Error("Native production: "+JSON.stringify(job));await pause();}
 }
 try{
  await boot();const lock=await json(root+"/runtime/game-runtimes/runtime.lock.json");
  const engineVersion=lock.engines.find((row:any)=>row.engine==="phaser").version;
  const suite={schemaVersion:1,viewport:{width:640,height:360},scenarios:[{id:"keyboard-pixels",steps:[
   {action:"capture",name:"before",selector:"canvas"},{action:"press",key:"ArrowRight"},
   {action:"expect-image",baseline:"before",comparison:"changed",threshold:0.1,selector:"canvas"}]}]};
  const rows:{path:string;mime:"application/json"|"text/plain";raw:Buffer}[]=[
   {path:"game.web.json",mime:"application/json",raw:Buffer.from(JSON.stringify({schemaVersion:1,entry:"src/main.ts",engineVersion}))},
   {path:"src/main.ts",mime:"text/plain",raw:Buffer.from('const c=document.querySelector<HTMLCanvasElement>("#game")!;c.width=160;c.height=90;const x=c.getContext("2d")!;function draw(color:string){x.fillStyle=color;x.fillRect(0,0,80,90);x.fillStyle="green";x.fillRect(80,0,80,90)}draw("red");addEventListener("keydown",e=>{if(e.key==="ArrowRight")draw("blue")});')},
   {path:"data/playtests.json",mime:"application/json",raw:Buffer.from(JSON.stringify(suite))},
   {path:"data/playtests/recovery.json",mime:"application/json",raw:Buffer.from(JSON.stringify({...suite,scenarios:[{id:"long",steps:Array.from({length:25},()=>({action:"wait",ms:2000}))}]}))},
  ];
  const files:GameFile[]=[];for(const row of rows){const transfer=await client!.upload("source-"+hash(row.raw),row.raw,row.mime);
   files.push({path:row.path,mime:row.mime,size:row.raw.length,sha256:hash(row.raw),transferId:transfer.id});}
  const document:GameDocument={...fixtureGameDocument(),files},projects=[];
  for(const name of ["first","queued"]){const project=await client!.createGameProject("native-project-"+name,document);await control("project.allow",project.id);
   const build=await client!.startGameBuild("native-build-"+name,project.id,1);await terminal(build.id);projects.push({project,build});}
  cases.push("native-core-builds-through-sdk-and-root-allocation");
  const [first,queued]=projects,collector="kidos-core-browser-v1";
  const normal=await client!.startGameValidation("native-observation",first!.build.id,collector);await terminal(normal.id);
  const reports=await client!.getGameReports(first!.build.id);assert.ok(reports.some(row=>row.metrics.renderedPixelsObserved===true));
  assert.ok(reports.every(row=>row.checks.every(check=>check.status==="passed")));
  cases.push("native-browser-candidate-through-signed-port-core-root-and-sdk");
  const long=await client!.startGameValidation("native-recovery",first!.build.id,collector,"data/playtests/recovery.json");
  const deadline=Date.now()+120000;
  while((await control("snapshot")).validationStarts<2){const current=await client!.getGameProduction(long.id);if(current.state==="failed"||Date.now()>deadline)throw Error("Original native validation did not start");await pause();}
  const waiting=await client!.startGameValidation("native-queued",queued!.build.id,collector);
  for(;;){const current=await client!.getGameProduction(waiting.id);if(current.state==="queued"&&current.admission==="reserved")break;
   if(current.state==="failed"||Date.now()>deadline)throw Error("Pre-queue Root admission failed");await pause();}
  await client!.cancelGameProduction(waiting.id);await terminal(waiting.id,"cancelled");
  assert.deepEqual((await control("project.get",queued!.project.id)).stages.design.production_by_kind,{build:1,assets:0,validate:1});
  cases.push("queued-native-validation-cancel-preserves-root-debit");
  await stop();await boot();assert.equal((await client!.getGameProduction(long.id)).state,"awaiting_reconciliation");
  for(;;){const current=await client!.reconcileGameProduction(long.id);if(current.state==="completed")break;assert.equal(current.state,"awaiting_reconciliation");
   if(Date.now()>deadline)throw Error("Native original validation did not close");await pause();}
  assert.equal((await client!.startGameValidation("native-recovery",first!.build.id,collector,"data/playtests/recovery.json")).id,long.id);
  assert.equal((await control("snapshot")).validationStarts,2);
  cases.push("service-sigkill-reconciles-native-browser-without-reexecution");
  const denied=await client!.startGameValidation("native-over-budget",first!.build.id,collector);await terminal(denied.id,"failed");
  assert.equal((await control("snapshot")).validationStarts,2);assert.equal((await control("snapshot")).policy.starts,5);
  assert.equal((await client!.getGameQuality(first!.project.id)).ready,false);
  cases.push("shared-budget-refuses-extra-validation-and-runtime-report-does-not-certify-game");
  details.push({projects,normal:normal.id,long:long.id,queued:waiting.id,reports,final:await control("snapshot")});
 }finally{await stop();}
 await save(root+"/child/service-report.json",{scope:"native-root-service-core-browser-qualification-not-installed-navi",state:"passed",cases,details});
}
void (async()=>{const root=guard();await privateNamespace(root);if(mode==="--provision")await provision(root);else if(mode==="--serve")await serve(root);else await run(root);})()
 .catch(error=>{process.stderr.write(String(error)+"\n");process.exitCode=1;});
