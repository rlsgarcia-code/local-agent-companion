import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp,rm,writeFile,readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { PNG } from "pngjs";
import { AgentService } from "../packages/agent-service/src/service";
import { Store } from "../packages/agent-service/src/store";
import { Transfers } from "../packages/agent-service/src/transfers";
import { LocalServer } from "../packages/agent-service/src/server";
import { ensureIdentity,createClientCredential,ipcPath } from "../packages/agent-service/src/security";
import { AgentClient } from "../packages/client-ts/src/index";
import type { Registration } from "../packages/contracts/src/index";
import type { GameDocument,GameProject,GameRevision } from "../packages/contracts/src/games";
import type { GameProductionJob } from "../packages/contracts/src/game-production";
import type { Transfer } from "../packages/contracts/src/transfers";
import { gameAssetSpec,type GameAssetResult } from "../packages/contracts/src/game-assets";
import { createLocalGameAssetProcessor } from "../packages/adapter-game-assets/src/index";
import { GameProductionUncertain,type GameAssetProcessor,type ProcessedGameAsset } from "../packages/game-production/src/index";
import { fixtureGameDocument } from "./game-fixtures";

const reg:Registration={id:"asset-test",product:"companion-mac",profile:"test",workspace:"",providers:["ollama"],hostTools:[]};
const call=<T>(s:AgentService,method:string,args:unknown={},r=reg)=>s.dispatch(r,method,args,"fixture") as Promise<T>;
const spec=()=>gameAssetSpec.parse({processorId:"local-media-v1",target:{id:"edited",role:"Edited hero",placeholder:false},operation:{type:"image.compose",output:"assets/edited.png",width:8,height:8,layers:[{source:{assetId:"raw",path:"assets/raw.png"},x:0,y:0,width:8,height:8,filter:"nearest"}]}});
const audio=()=>gameAssetSpec.parse({processorId:"local-media-v1",target:{id:"tone",role:"Procedural sound",placeholder:false},operation:{type:"audio.render",output:"assets/tone.wav",durationMs:100,notes:[{waveform:"sine",frequency:440,startMs:0,durationMs:100,gain:0.4}]}});
async function fixture(processors:GameAssetProcessor[]=[createLocalGameAssetProcessor()]) {
  const directory=await mkdtemp(path.join(tmpdir(),"game-assets-")),file=path.join(directory,"state.sqlite");
  const service=new AgentService(new Store(file),directory,undefined,{}, {gameAssetProcessors:processors});
  return {directory,file,service,async close(){await service.close();await rm(directory,{recursive:true,force:true});}};
}
async function project(s:AgentService,placeholder=true):Promise<GameProject>{
  const image=new PNG({width:4,height:4});for(let i=0;i<image.data.length;i+=4)image.data.set([240,30,80,255],i);
  const bytes=PNG.sync.write(image),sha256=createHash("sha256").update(bytes).digest("hex"),transfers=new Transfers(s.store);
  const transfer=transfers.begin(reg,{key:`fixture:${sha256}`,mime:"application/octet-stream",size:bytes.length,sha256});transfers.append(reg,transfer.id,0,bytes);transfers.commit(reg,transfer.id);
  const document=fixtureGameDocument();document.files=[{path:"assets/raw.png",transferId:transfer.id,mime:"image/png",sha256,size:bytes.length}];
  document.assets=[{id:"raw",role:"Original sprite",kind:"sprite",files:["assets/raw.png"],placeholder,origin:{kind:"library",source:"Local test fixture; no external library",author:"Test author",license:"Fixture license: retain attribution and source declaration",referenceIds:[]}}];
  return call(s,"games.projects.create",{requestId:"create",document});
}
async function wait(s:AgentService,id:string):Promise<GameProductionJob>{
  for(let i=0;i<1000;i++){const job=await call<GameProductionJob>(s,"games.production.get",{id});if(["completed","failed","cancelled","awaiting_reconciliation"].includes(job.state))return job;await new Promise((resolve)=>setTimeout(resolve,5));}
  throw new Error("Media worker did not settle");
}
async function result(s:AgentService,id:string):Promise<GameAssetResult>{const transfer=await call<Transfer>(s,"games.assets.result",{id});return new Transfers(s.store).json(reg,transfer.id) as GameAssetResult;}
async function revision(s:AgentService,id:string,number?:number):Promise<GameRevision>{
  const transfer=await call<Transfer>(s,"games.revisions.get",{projectId:id,...(number?{revision:number}:{})});return new Transfers(s.store).json(reg,transfer.id) as GameRevision;
}

test("real media worker produces an immutable candidate and explicit idempotent application preserves original bytes and provenance",async()=>{
  const f=await fixture();try{
    const p=await project(f.service),request={requestId:"process",projectId:p.id,revision:1,spec:spec()},job=await call<GameProductionJob>(f.service,"games.assets.process",request);
    assert.equal((await wait(f.service,job.id)).state,"completed");assert.equal((await call<GameProductionJob>(f.service,"games.assets.process",request)).id,job.id);
    const candidate=await result(f.service,job.id);assert.equal(candidate.asset.placeholder,true,"source placeholder status must propagate");assert.equal(candidate.sourceHash,p.contentHash);
    assert.equal((await revision(f.service,p.id)).revision,1,"processing must not mutate the project");
    const provenanceFile=candidate.files.find((file)=>file.path.includes("/provenance/"))!,provenance=JSON.parse(new Transfers(f.service.store).bytes(reg,provenanceFile.transferId).toString());
    assert.equal(provenance.sources[0].asset.origin.license,"Fixture license: retain attribution and source declaration");assert.equal(provenance.licenseStatus,"declared-unverified");
    const application={requestId:"apply",jobId:job.id,expectedRevision:1},applied=await call<GameProject>(f.service,"games.assets.apply",application);assert.equal(applied.revision,2);
    assert.deepEqual(await call(f.service,"games.assets.apply",application),applied);
    await assert.rejects(call(f.service,"games.assets.apply",{...application,expectedRevision:2}),/different content/);
    const doc=(await revision(f.service,p.id)).document;assert.equal(doc.assets.length,2);assert.equal(doc.assets.find((a)=>a.id==="edited")!.processing!.jobId,job.id);
    const original=(await revision(f.service,p.id,1)).document.files[0]!;
    assert.equal(doc.files.find((file)=>file.path==="assets/raw.png")!.sha256,original.sha256);
    assert.throws(()=>f.service.store.db.prepare("DELETE FROM transfers WHERE id=?").run(candidate.files[0]!.transferId),/FOREIGN KEY/);
    await assert.rejects(call(f.service,"games.assets.file",{jobId:job.id,path:"assets/raw.png"}),/does not belong/);
  }finally{await f.close();}
});

test("an unrelated design revision may explicitly apply a candidate; changed sources, shared targets and cycles are rejected",async()=>{
  for(const change of ["design","source","collision","cycle"]){
    const f=await fixture();try{
      const p=await project(f.service),job=await call<GameProductionJob>(f.service,"games.assets.process",{requestId:"edit",projectId:p.id,revision:1,spec:spec()});assert.equal((await wait(f.service,job.id)).state,"completed");
      const doc=(await revision(f.service,p.id)).document;doc.title="Later design";
      if(change==="source")doc.assets[0]!.origin.license="Changed attribution";
      if(change==="collision")doc.files.push({...doc.files[0]!,path:"assets/edited.png"});
      if(change==="cycle"){
        doc.assets.push({...structuredClone(doc.assets[0]!),id:"edited"});doc.assets[0]!.origin.referenceIds=["edited"];
      }
      await call(f.service,"games.revisions.commit",{requestId:"later",projectId:p.id,expectedRevision:1,document:doc,message:"Later revision"});
      await assert.rejects(call(f.service,"games.assets.apply",{requestId:"stale",jobId:job.id,expectedRevision:1}),/Refresh/);
      if(change==="design")assert.equal((await call<GameProject>(f.service,"games.assets.apply",{requestId:"current",jobId:job.id,expectedRevision:2})).revision,3);
      else await assert.rejects(call(f.service,"games.assets.apply",{requestId:"current",jobId:job.id,expectedRevision:2}),/changed|overwrite/);
      assert.equal((await result(f.service,job.id)).jobId,job.id,"conflict must retain candidate");
      if(change==="cycle")await assert.rejects(call(f.service,"games.assets.process",{requestId:"cycle",projectId:p.id,revision:2,spec:spec()}),/cycle/);
    }finally{await f.close();}
  }
});

test("candidate acknowledgement and application failures leave no partial blobs or revisions; corrupted candidate bytes cannot be applied",async()=>{
  const f=await fixture();try{
    const p=await project(f.service),before=(f.service.store.db.prepare("SELECT count(*) AS n FROM transfers").get() as {n:number}).n;
    f.service.store.db.exec("CREATE TRIGGER reject_media_pin BEFORE INSERT ON game_asset_result_files BEGIN SELECT RAISE(ABORT, 'media-pin-failure'); END;");
    const bad=await call<GameProductionJob>(f.service,"games.assets.process",{requestId:"atomic",projectId:p.id,revision:1,spec:audio()});assert.equal((await wait(f.service,bad.id)).state,"awaiting_reconciliation");
    assert.equal((f.service.store.db.prepare("SELECT count(*) AS n FROM transfers").get() as {n:number}).n,before);
    assert.equal((f.service.store.db.prepare("SELECT count(*) AS n FROM game_asset_results").get() as {n:number}).n,0);
    f.service.store.db.exec("DROP TRIGGER reject_media_pin");assert.equal((await call<GameProductionJob>(f.service,"games.production.reconcile",{id:bad.id})).state,"failed");
    const good=await call<GameProductionJob>(f.service,"games.assets.process",{requestId:"good",projectId:p.id,revision:1,spec:audio()});assert.equal((await wait(f.service,good.id)).state,"completed");
    f.service.store.db.exec("CREATE TRIGGER reject_application BEFORE INSERT ON game_asset_applications BEGIN SELECT RAISE(ABORT, 'application-failure'); END;");
    const apply={requestId:"apply",jobId:good.id,expectedRevision:1};await assert.rejects(call(f.service,"games.assets.apply",apply),/application-failure/);assert.equal((await revision(f.service,p.id)).revision,1);
    f.service.store.db.exec("DROP TRIGGER reject_application");const candidate=await result(f.service,good.id);
    f.service.store.db.prepare("UPDATE transfer_parts SET data=? WHERE id=?").run(Buffer.from("bad"),candidate.files[0]!.transferId);
    await assert.rejects(call(f.service,"games.assets.apply",apply),/verified SHA-256/);assert.equal((await revision(f.service,p.id)).revision,1);
  }finally{await f.close();}
});

test("a target asset cannot overwrite a file shared with another asset even when its fingerprint is unchanged",async()=>{
  const f=await fixture();try{
    const p=await project(f.service),doc=(await revision(f.service,p.id)).document;
    doc.files.push({...doc.files[0]!,path:"assets/edited.png"});
    doc.assets.push({...structuredClone(doc.assets[0]!),id:"edited",files:["assets/edited.png"]}, {...structuredClone(doc.assets[0]!),id:"shared",files:["assets/edited.png"]});
    await call(f.service,"games.revisions.commit",{requestId:"shared",projectId:p.id,expectedRevision:1,document:doc,message:"Shared source declaration"});
    const job=await call<GameProductionJob>(f.service,"games.assets.process",{requestId:"process",projectId:p.id,revision:2,spec:spec()});assert.equal((await wait(f.service,job.id)).state,"completed");
    await assert.rejects(call(f.service,"games.assets.apply",{requestId:"apply",jobId:job.id,expectedRevision:2}),/shared asset/);
    assert.equal((await revision(f.service,p.id)).revision,2);assert.equal((await result(f.service,job.id)).jobId,job.id);
  }finally{await f.close();}
});

test("media jobs retain authenticated namespaces and no generic processor can be exposed to the child product",async()=>{
  const f=await fixture();try{
    const p=await project(f.service),job=await call<GameProductionJob>(f.service,"games.assets.process",{requestId:"isolated",projectId:p.id,revision:1,spec:spec()});await wait(f.service,job.id);
    for(const r of [{...reg,product:"companion-vscode" as const},{...reg,profile:"other"},{...reg,product:"kidos" as const}]){
      for(const [method,args] of [["games.assets.result",{id:job.id}],["games.assets.apply",{requestId:"forged",jobId:job.id,expectedRevision:1}],["games.assets.file",{jobId:job.id,path:"assets/edited.png"}]] as const)
        await assert.rejects(call(f.service,method,args,r),/namespace|not found|acknowledged/);
    }
    await assert.rejects(call(f.service,"games.assets.process",{requestId:"forge",projectId:p.id,revision:1,spec:{...spec(),toolchain:{available:true}}}));
    const unsafe=createLocalGameAssetProcessor();unsafe.products=["kidos"];
    const store=new Store(path.join(f.directory,"unsafe.sqlite"));try{assert.throws(()=>new AgentService(store,f.directory,undefined,{}, {gameAssetProcessors:[unsafe]}),/protected Core/);}finally{store.close();}
  }finally{await f.close();}
});

test("unknown media effects require the original inspector; reconciling never repeats processing",async()=>{
  let calls=0;const processor=createLocalGameAssetProcessor();processor.process=async()=>{calls++;throw new GameProductionUncertain("Unacknowledged candidate");};
  const f=await fixture([processor]);let restarted:AgentService|undefined;try{
    const p=await project(f.service),job=await call<GameProductionJob>(f.service,"games.assets.process",{requestId:"unknown",projectId:p.id,revision:1,spec:audio()});assert.equal((await wait(f.service,job.id)).state,"awaiting_reconciliation");
    await assert.rejects(call(f.service,"games.assets.process",{requestId:"repeat",projectId:p.id,revision:1,spec:audio()}),/unreconciled/);await f.service.close();
    const wrong=createLocalGameAssetProcessor({implementationSha256:"changed"});restarted=new AgentService(new Store(f.file),f.directory,undefined,{}, {gameAssetProcessors:[wrong]});
    await assert.rejects(call(restarted,"games.production.reconcile",{id:job.id}),/original media inspector/);await restarted.close();
    restarted=new AgentService(new Store(f.file),f.directory,undefined,{}, {gameAssetProcessors:[processor]});
    assert.equal((await call<GameProductionJob>(restarted,"games.production.reconcile",{id:job.id})).state,"failed");assert.equal(calls,1);
  }finally{await restarted?.close();await f.close();}
});

test("cancel waits for a real worker to stop; unavailable codecs produce a recoverable diagnosis",async()=>{
  const f=await fixture();try{
    const p=await project(f.service),long=audio();if(long.operation.type!=="audio.render")return;
    long.operation.durationMs=180000;long.operation.notes=[{...long.operation.notes[0]!,durationMs:180000}];
    const job=await call<GameProductionJob>(f.service,"games.assets.process",{requestId:"cancel",projectId:p.id,revision:1,spec:long});
    assert.ok(["cancelling","cancelled"].includes((await call<GameProductionJob>(f.service,"games.production.cancel",{id:job.id})).state));
    assert.equal((await wait(f.service,job.id)).state,"cancelled");
    const next=await call<GameProductionJob>(f.service,"games.assets.process",{requestId:"after-cancel",projectId:p.id,revision:1,spec:audio()});assert.equal((await wait(f.service,next.id)).state,"completed");
    assert.equal((await revision(f.service,p.id)).revision,1);
  }finally{await f.close();}
  const missing=await createLocalGameAssetProcessor({workerPath:path.join(tmpdir(),"no-such-game-codec.cjs")}).probe(reg);assert.equal(missing.available,false);
});

test("recovered media acknowledgement clears the current error while retaining the interruption event",async()=>{
  const processor=createLocalGameAssetProcessor(),process=processor.process;let candidate:ProcessedGameAsset|undefined,calls=0;
  processor.process=async(access)=>{calls++;candidate=await process(access);return candidate;};
  processor.reconcile=async()=>{assert.ok(candidate);return {state:"completed",result:candidate};};
  const f=await fixture([processor]);try{
    const p=await project(f.service);f.service.store.db.exec("CREATE TRIGGER fail_candidate BEFORE INSERT ON game_asset_results BEGIN SELECT RAISE(ABORT,'fixture interruption'); END");
    const job=await call<GameProductionJob>(f.service,"games.assets.process",{requestId:"recover-candidate",projectId:p.id,revision:1,spec:audio()});
    const failed=await wait(f.service,job.id);assert.equal(failed.state,"awaiting_reconciliation");assert.match(failed.error!,/fixture interruption/);
    f.service.store.db.exec("DROP TRIGGER fail_candidate");
    const recovered=await call<GameProductionJob>(f.service,"games.production.reconcile",{id:job.id});
    assert.equal(recovered.state,"completed");assert.equal(recovered.error,undefined);assert.equal(recovered.waitingReason,undefined);assert.equal(calls,1);
    const events=f.service.store.db.prepare("SELECT value FROM game_production_events WHERE job=? ORDER BY sequence").all(job.id) as {value:string}[];
    assert.ok(events.map((row)=>JSON.parse(row.value)).some((event)=>event.state==="awaiting_reconciliation"&&event.error.includes("fixture interruption")));
    assert.equal((await result(f.service,job.id)).jobId,job.id);assert.equal((await revision(f.service,p.id)).revision,1);
  }finally{await f.close();}
});

test("TypeScript and Python clients process, download and apply through real authenticated IPC, surviving a service restart",async()=>{
  const f=await fixture(),credential=await createClientCredential(f.directory,reg);f.service.store.register(credential);
  const identity=await ensureIdentity(f.directory),server=new LocalServer(f.service,f.directory);let client:AgentClient|undefined,restarted:AgentService|undefined;
  try{
    await server.listen();client=new AgentClient({address:ipcPath(f.directory),certificate:identity.cert,credential});await client.connect();
    const p=await client.createGameProject("sdk",fixtureGameDocument()),job=await client.processGameAsset("sound",p.id,1,audio());assert.equal((await wait(f.service,job.id)).state,"completed");
    assert.equal((await client.getGameAssetResult(job.id)).asset.placeholder,false);assert.equal((await client.downloadGameAssetFile(job.id,"assets/tone.wav")).subarray(0,4).toString(),"RIFF");
    if(process.platform!=="win32"){
      const cert=path.join(f.directory,"cert.pem"),auth=path.join(f.directory,"auth.json");await writeFile(cert,identity.cert);await writeFile(auth,JSON.stringify(credential),{mode:0o600});
      const code=`import sys\nsys.path.insert(0,sys.argv[1])\nfrom pathlib import Path\nfrom companion_client import AgentClient\nc=AgentClient(sys.argv[2],Path(sys.argv[3]),Path(sys.argv[4]));c.connect()\nr=c.get_game_asset_result(sys.argv[5])\nassert r['asset']['id']=='tone'\nassert c.download_game_asset_file(sys.argv[5],'assets/tone.wav')[:4]==b'RIFF'\np=c.apply_game_asset('py-apply',sys.argv[5],1)\nassert p['revision']==2\nassert c.apply_game_asset('py-apply',sys.argv[5],1)==p\nc.close()\nprint('PYTHON_MEDIA_OK')`;
      const executed=await promisify(execFile)("python3",["-I","-c",code,path.resolve("packages/client-python"),ipcPath(f.directory),cert,auth,job.id],{timeout:30000});assert.match(executed.stdout,/PYTHON_MEDIA_OK/);
    }else assert.equal((await client.applyGameAsset("ts-apply",job.id,1)).revision,2);
    client.close();await server.close();await f.service.close();restarted=new AgentService(new Store(f.file),f.directory,undefined,{}, {gameAssetProcessors:[createLocalGameAssetProcessor()]});
    assert.equal((await result(restarted,job.id)).jobId,job.id);assert.equal((await revision(restarted,p.id)).document.assets[0]!.id,"tone");
  }finally{client?.close();await server.close();await restarted?.close();await f.close();}
});

test("cancellation stops an observed live worker before acknowledging terminal state",async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),"media-cancel-canary-")),marker=path.join(directory,"started"),workerPath=path.join(directory,"worker.cjs");
  await writeFile(workerPath,`const fs=require('node:fs');let n=0;setInterval(()=>fs.writeFileSync(${JSON.stringify(marker)},String(++n)),5);`);
  const processor=createLocalGameAssetProcessor({workerPath}),f=await fixture([processor]);
  try{
    const p=await project(f.service),job=await call<GameProductionJob>(f.service,"games.assets.process",{requestId:"live-worker",projectId:p.id,revision:1,spec:audio()});
    let started=false;for(let i=0;i<1000;i++){try{started=Number(await readFile(marker,"utf8"))>0;if(started)break;}catch{}await new Promise((resolve)=>setTimeout(resolve,5));}
    assert.ok(started,"worker must be observed live before cancellation");
    assert.equal((await processor.probe(reg)).available,true,"an installed busy codec remains available for queued work");
    assert.equal((await call<GameProductionJob>(f.service,"games.production.get",{id:job.id})).state,"running");
    assert.equal((await call<GameProductionJob>(f.service,"games.production.cancel",{id:job.id})).state,"cancelling");
    assert.equal((await wait(f.service,job.id)).state,"cancelled");assert.equal((await processor.probe(reg)).available,true);
    const stopped=await readFile(marker,"utf8");await new Promise((resolve)=>setTimeout(resolve,50));assert.equal(await readFile(marker,"utf8"),stopped,"cancelled worker must stop its observed heartbeat");
    await assert.rejects(result(f.service,job.id),/No acknowledged/);assert.equal((await revision(f.service,p.id)).revision,1);
  }finally{await f.close();await rm(directory,{recursive:true,force:true});}
});
