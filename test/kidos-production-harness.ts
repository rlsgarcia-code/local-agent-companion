/** Explicit Linux qualification helper, never a release entrypoint or installer. */
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { appendFile, chmod, mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { AgentService } from "../packages/agent-service/src/service";
import { Store } from "../packages/agent-service/src/store";
import { LocalServer } from "../packages/agent-service/src/server";
import { createClientCredential, ensureIdentity, ipcPath } from "../packages/agent-service/src/security";
import { loadSignedAdapter } from "../packages/agent-service/src/installed-adapter";
import { enforceSystemProvisioning } from "../packages/agent-service/src/provisioning";
import { AgentClient } from "../packages/client-ts/src/index";
import { gameContentHash } from "../packages/game-design/src/project";
import { contentHash } from "../packages/contracts/src/identity";
import type { ClientCredential, Registration } from "../packages/contracts/src/index";

const sha=(value:Uint8Array)=>createHash("sha256").update(value).digest("hex");
const sleep=()=>new Promise(resolve=>setTimeout(resolve,10));
async function json(file:string){return JSON.parse(await readFile(file,"utf8"));}
async function save(file:string,value:unknown){await writeFile(file,JSON.stringify(value,null,2)+"\n",{mode:0o600});}

async function serve(file:string){
 const config=await json(file),credential=await json(config.credential) as ClientCredential;
 const adapter=await loadSignedAdapter(config.descriptor,config.publicKey,{owner:process.getuid!(),boundary:config.root,engine:config.pin});
 const service=new AgentService(new Store(path.join(config.state,"metadata.sqlite")),config.state,undefined,{}, {adapter,deferRecovery:true});
 service.store.register(credential);
 const server=new LocalServer(service,config.state);await server.listen();
 for(const signal of ["SIGINT","SIGTERM"] as const)process.once(signal,()=>{void server.close().finally(()=>process.exit(0));});
}

async function run(file:string){
 const config=await json(file),root=config.root as string,state=path.join(root,"service"),adapter=path.join(root,"adapter"),trace=path.join(root,"trace.jsonl");
 await mkdir(state,{mode:0o700});await mkdir(adapter,{mode:0o700});
 for(const [source,destination] of [["adapter.cjs","domain-adapter.cjs"],["production.cjs","production.cjs"],["core-exchange.cjs","core-exchange.cjs"],["media.cjs","media.cjs"],["bridge.py","bridge.py"]])
  await writeFile(path.join(adapter,destination!),await readFile(path.join(config.sources,source!)),{mode:0o600});
 const runtimeLock=await json(path.join(config.compiler,"game-runtimes/runtime.lock.json"));
 const manifest=await readFile(path.join(config.compiler,"manifest.json")),pin={version:"development-kidos-port-fixture",commit:"0".repeat(40),manifestSha256:sha(manifest)};
 const catalog=await json(config.catalog);catalog.engine={...pin,sdkManifestSha256:"0".repeat(64)};
 catalog.gameProduction={schema:1,adapters:runtimeLock.engines.map((row:any)=>({id:`kidos-core-${row.engine}-v1`,engine:row.engine,
  toolchain:{id:`web-${row.engine}`,version:`${row.version}+esbuild.${runtimeLock.compiler.version}.adapter.1`,sha256:contentHash({runtime:row,compiler:runtimeLock.compiler,adapterABI:1,implementation:pin.manifestSha256})}}))};
 await save(path.join(adapter,"catalog.json"),catalog);
 await save(path.join(adapter,"fixture.json"),{coreSocket:config.coreSocket,python:config.pythonBridge,trace});
 // The wrapper is part of a fixture-signed manifest; production uses its fixed
 // Python bridge. The fixture changes only the endpoint to a private test Core.
 const entry=`const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
 module.exports.createAdapter=api=>{const cfg=JSON.parse(fs.readFileSync(path.join(__dirname,'fixture.json'),'utf8'));
 const bridge=(request,signal)=>new Promise((resolve,reject)=>{const child=spawn('/usr/bin/python3',['-I','-S',cfg.python,cfg.coreSocket,path.join(__dirname,'bridge.py')],{signal,stdio:['pipe','pipe','pipe'],env:{PATH:'/usr/bin:/bin',LANG:'C.UTF-8'}});let size=0,parts=[];child.stdout.on('data',data=>{size+=data.length;if(size>8*1024*1024){child.kill();reject(Error('Bound exceeded'));}else parts.push(data)});child.stderr.resume();child.stdin.on('error',()=>{});child.once('error',reject);child.once('close',code=>{try{const result=JSON.parse(Buffer.concat(parts));if(code!==0||result.ok!==true)throw Error(result.error||'Bridge failed');if(request.operation==='start'&&result.result.ok===true)fs.appendFileSync(cfg.trace,JSON.stringify({operation:'start',requestId:result.result.result.request_id})+String.fromCharCode(10),{mode:0o600});resolve(result.result);}catch(error){reject(error)}});child.stdin.end(JSON.stringify(request));});
 return require('./domain-adapter.cjs').createAdapter({...api,bridge});};`;
 await writeFile(path.join(adapter,"adapter.cjs"),entry,{mode:0o600});
 const files:Record<string,string>={};for(const name of await readdir(adapter))files[name]=sha(await readFile(path.join(adapter,name)));
 const bytes=Buffer.from(JSON.stringify({schema:1,product:"kidos",protocol:"1.0",entry:"adapter.cjs",files})),keys=generateKeyPairSync("ed25519");
 await writeFile(path.join(adapter,"manifest.json"),bytes,{mode:0o600});await writeFile(path.join(adapter,"manifest.sig"),sign(null,bytes,keys.privateKey),{mode:0o600});
 const descriptor=path.join(root,"descriptor.json"),publicKey=path.join(root,"fixture.pub");
 await save(descriptor,{schema:1,directory:adapter,manifestSha256:sha(bytes)});await writeFile(publicKey,keys.publicKey.export({type:"spki",format:"pem"}),{mode:0o600});
 // Reuse only the public, root-provisioned registration. Never read or reuse
 // the installed client's credential; this private service gets a fresh token.
 const enrollment=await json(`/etc/kidos/agent-clients/${process.getuid!()}.json`);
 const registration=JSON.parse(enrollment.canonicalRegistration) as Registration;
 enforceSystemProvisioning(registration);
 assert.equal(registration.product,"kidos");assert.equal(registration.profile,String(process.getuid!()));
 assert.equal(contentHash(registration.toolCatalog),contentHash(catalog.tools),"The fixture must not broaden the provisioned tool catalog");
 const credential=await createClientCredential(state,registration),identity=await ensureIdentity(state);
 const credentialFile=path.join(root,"client.json"),serverConfig=path.join(root,"server.json");await save(credentialFile,credential);
 await save(serverConfig,{root,state,descriptor,publicKey,pin,credential:credentialFile});
 let child:ChildProcess|undefined,client:AgentClient|undefined;const cases=[];
 async function stop(){
  client?.close();client=undefined;
  if(child){if(child.exitCode===null){const exited=new Promise<void>(resolve=>child!.once("exit",()=>resolve()));child.kill("SIGKILL");await exited;}child=undefined;}
  await unlink(ipcPath(state)).catch(error=>{if(error.code!=="ENOENT")throw error;});
 }
 async function boot(){
  child=spawn(process.execPath,[process.argv[1]!,"--serve",serverConfig],{stdio:["ignore","pipe","pipe"],env:process.env});
  child.stdout?.on("data",data=>{void appendFile(path.join(root,"service.log"),data,{mode:0o600});});child.stderr?.on("data",data=>{void appendFile(path.join(root,"service.log"),data,{mode:0o600});});
  const deadline=Date.now()+15000;
  for(;;){
   if(child.exitCode!==null)throw Error("Temporary service failed; inspect service.log");
   const candidate=new AgentClient({address:ipcPath(state),certificate:identity.cert,credential});
   try{await candidate.connect();client=candidate;return;}catch{candidate.close();if(Date.now()>deadline)throw Error("Temporary service did not become ready");await sleep();}
  }
 }
 try{
  await boot();
  for(const engine of ["phaser","babylon"]){
   const source=path.join(config.inputs,engine,"input"),request=await json(path.join(source,"request.json")),document=request.document;
   for(const entry of document.files){const data=await readFile(path.join(source,"blobs",entry.sha256));assert.equal(sha(data),entry.sha256);const transfer=await client!.upload("source-"+entry.sha256,data,entry.mime);entry.transferId=transfer.id;}
   const project=await client!.createGameProject("project-"+engine,document),sourceHash=gameContentHash(document);
   const job=await client!.startGameBuild("build-"+engine,project.id,project.revision),deadline=Date.now()+30000;
   const requestId:string="engine-build-"+contentHash([process.getuid!(),registration.product,registration.profile,registration.workspace,job.id]);
   for(;;){
    const lines=await readFile(trace,"utf8").catch(()=>"");
    if(lines.split("\n").filter(Boolean).map(line=>JSON.parse(line)).some(row=>row.requestId===requestId))break;
    const current=await client!.getGameProduction(job.id);assert.ok(!["completed","failed","cancelled"].includes(current.state),JSON.stringify(current));
    if(Date.now()>deadline)throw Error("Core submission was not observed");await sleep();
   }
   await stop();await boot();
   assert.equal((await client!.getGameProduction(job.id)).state,"awaiting_reconciliation");
   const recoveryDeadline=Date.now()+45000;
   for(;;){const current=await client!.reconcileGameProduction(job.id);if(current.state==="completed")break;assert.equal(current.state,"awaiting_reconciliation");if(Date.now()>recoveryDeadline)throw Error("Core recovery timed out");await sleep();}
   const artifact=await client!.getGameArtifact(job.id);assert.equal(artifact.sourceHash,sourceHash);assert.equal(artifact.adapterId,"kidos-core-"+engine+"-v1");
   for(const entry of artifact.files){const data=await client!.downloadGameArtifactFile(job.id,entry.path);assert.equal(sha(data),entry.sha256);}
   assert.equal((await client!.startGameBuild("build-"+engine,project.id,project.revision)).id,job.id);
   assert.equal((await client!.getGameQuality(project.id)).ready,false);
   const starts:{operation:string;requestId:string}[]=(await readFile(trace,"utf8")).split("\n").filter(Boolean).map(line=>JSON.parse(line)).filter(row=>row.requestId===requestId);assert.equal(starts.length,1);
   await save(path.join(root,engine+"-artifact.json"),artifact);
   cases.push({engine,jobId:job.id,requestId,sourceHash,artifactHash:artifact.artifactHash,filesVerified:artifact.files.length,serviceSigkillRecovered:true,coreStarts:starts.length});
  }
 }finally{await stop();}
 const report={scope:"temporary-sdk-service-fixture-signed-port-core-not-installed",state:"passed",cases};await save(path.join(root,"service-report.json"),report);
 process.stdout.write(JSON.stringify({state:"passed",cases:cases.length,reportSha256:sha(await readFile(path.join(root,"service-report.json")))})+"\n");
}

for(const name of ["LANGCHAIN_TRACING_V2","LANGSMITH_TRACING","LANGSMITH_TRACING_V2"])process.env[name]="false";
const mode=process.argv[2],file=process.argv[3];
if(!file||!["--serve","--run"].includes(mode!))throw Error("Select an explicit private qualification configuration");
void (mode==="--serve"?serve(file):run(file)).catch(error=>{console.error(error);process.exitCode=1;});
