import assert from "node:assert/strict";
import test from "node:test";
import {mkdtemp,rm,cp,writeFile,readFile,symlink,link,unlink} from "node:fs/promises";
import path from "node:path";
import {tmpdir} from "node:os";
import {createHash} from "node:crypto";
import {createGameLibraryProcessor} from "../packages/adapter-game-library/src/index";
import {gameLibraryCopyOperation,gameLibrarySelection,gameLibraryQuery,type GameLibrarySelection,type GameLibraryPage} from "../packages/contracts/src/game-library";
import {gameAssetSpec,type GameAssetResult} from "../packages/contracts/src/game-assets";
import {gameMediaProcessRequest} from "../packages/contracts/src/game-media-worker";
import {contentHash} from "../packages/contracts/src/identity";
import {type GameProject,type GameRevision} from "../packages/contracts/src/games";
import {gameContentHash} from "../packages/game-design/src/project";
import type {Registration} from "../packages/contracts/src/index";
import type {GameProductionJob} from "../packages/contracts/src/game-production";
import type {Transfer} from "../packages/contracts/src/transfers";
import {Store} from "../packages/agent-service/src/store";
import {AgentService} from "../packages/agent-service/src/service";
import {Transfers} from "../packages/agent-service/src/transfers";
import {GAME_AGENT_TOOLS} from "../packages/agent-service/src/game-agent-tools";
import {fixtureGameDocument} from "./game-fixtures";
import type {ProductionAccess} from "../packages/game-production/src/index";

const directory=path.resolve("packages/adapter-game-library/libraries");
const reg:Registration={id:"library-test",product:"companion-mac",profile:"fixture",workspace:"",providers:["ollama"],hostTools:[]};
const sha=(bytes:Uint8Array)=>createHash("sha256").update(bytes).digest("hex");
const spec=(selection:GameLibrarySelection)=>gameAssetSpec.parse({processorId:"licensed-libraries-v1",target:{id:"hero",role:"Licensed animated character fixture",placeholder:true},operation:{type:"library.copy",selection,outputBase:"assets/hero"}});
function access(selection:GameLibrarySelection){return {registration:reg,job:{} as ProductionAccess["job"],document:fixtureGameDocument(),signal:new AbortController().signal,readFile:async()=>{throw Error("No project source reads authorized by a library copy");},spec:spec(selection)};}
async function selection(){const processor=await createGameLibraryProcessor({directory});return (await processor.libraries!({query:"character-soldier"})).entries[0]!;}
const call=<T>(service:AgentService,method:string,args:unknown={},registration=reg)=>service.dispatch(registration,method,args,"fixture") as Promise<T>;
async function candidate(service:AgentService,id:string){const transfer=await call<Transfer>(service,"games.assets.result",{id});return new Transfers(service.store).json(reg,transfer.id) as GameAssetResult;}
async function settled(service:AgentService,id:string){for(let i=0;i<500;i++){const job=await call<GameProductionJob>(service,"games.production.get",{id});if(["completed","failed","cancelled","awaiting_reconciliation"].includes(job.state))return job;await new Promise(resolve=>setTimeout(resolve,5));}throw Error("Library job not terminal; do not repeat it");}

test("licensed catalog pages actual pinned assets and copies all original dependencies, animations and full notices",async()=>{
  const processor=await createGameLibraryProcessor({directory});assert.equal((await processor.probe(reg)).available,true);
  const first=await processor.libraries!({limit:7}),second=await processor.libraries!({limit:30,cursor:first.cursor});
  assert.equal(first.hasMore,true);assert.equal(second.hasMore,false);assert.equal(first.entries.length+second.entries.length,22);
  const selected=await selection();assert.equal(selected.entry.animations.length,32);assert.equal(selected.entry.kind,"model");
  const result=await processor.process(access(selected));assert.equal(result.files.length,4);
  for(const file of selected.entry.files){const output=result.files.find(item=>item.path===`assets/hero/${file.path}`)!;assert.equal(sha(output.data),file.sha256);assert.equal(output.data.byteLength,file.size);assert.equal(output.mime,file.mime);}
  const notice=Buffer.from(result.files.find(file=>file.path.endsWith("/License.txt"))!.data).toString();assert.match(notice,/Creative Commons Zero, CC0/);assert.match(notice,/Tony/);
  assert.ok(result.files.some(file=>file.path==="assets/hero/Textures/colormap.png"));
  const glb=Buffer.from(result.files[0]!.data),json=JSON.parse(glb.subarray(20,20+glb.readUInt32LE(12)).toString());assert.equal(json.images[0].uri,"Textures/colormap.png");
  assert.deepEqual(json.animations.map((clip:{name:string})=>clip.name),selected.entry.animations);
  const outputSelection=JSON.parse(Buffer.from(result.files.at(-1)!.data).toString());assert.equal(outputSelection.manifestSha256,selected.manifestSha256);
  first.entries[0]!.library.author="Forged outside mutation";assert.notEqual((await processor.libraries!({limit:1})).entries[0]!.library.author,"Forged outside mutation");
});

test("library declarations cannot replace installed authority, strip files or forge authorship/animation metadata",async()=>{
  const processor=await createGameLibraryProcessor({directory}),selected=await selection();
  for(const mutate of [(value:GameLibrarySelection)=>{value.library.author="Forged";},(value:GameLibrarySelection)=>{value.manifestSha256="0".repeat(64);},
    (value:GameLibrarySelection)=>{value.entry.files=value.entry.files.filter(file=>file.mime!=="image/png");},(value:GameLibrarySelection)=>{value.entry.animations=[];},
    (value:GameLibrarySelection)=>{value.library.spdx="MIT";}]){
    const changed=structuredClone(selected);mutate(changed);await assert.rejects(processor.process(access(changed)),/exact library selection/);
  }
  const missingNotice=structuredClone(selected);missingNotice.entry.files=missingNotice.entry.files.filter(file=>file.path!=="License.txt");assert.equal(gameLibrarySelection.safeParse(missingNotice).success,false);
  assert.equal(gameLibraryCopyOperation.safeParse({type:"library.copy",selection:selected,outputBase:"../private"}).success,false);
  const conflict=structuredClone(selected);conflict.entry.files[0]!.path="LIBRARY.json";assert.equal(gameLibrarySelection.safeParse(conflict).success,false);
  assert.equal(gameLibraryQuery.safeParse({path:"/private"}).success,false);
});

test("changed manifests, corrupt blobs, symlinks and hardlinks fail closed without downloads or project writes",async()=>{
  const parent=await mkdtemp(path.join(tmpdir(),"game-library-integrity-"));
  try{
    for(const mode of ["manifest","blob","symlink","hardlink"]){
      const copy=path.join(parent,mode);await cp(directory,copy,{recursive:true});
      const processor=await createGameLibraryProcessor({directory:copy}),selected=await selection();assert.equal((await processor.probe(reg)).available,true);
      const target=path.join(copy,selected.library.id,"blobs",selected.entry.files[0]!.sha256);
      if(mode==="manifest")await writeFile(path.join(copy,selected.library.id,"manifest.json"),"{}");
      else if(mode==="blob")await writeFile(target,Buffer.alloc(selected.entry.files[0]!.size));
      else {const other=path.join(parent,`external-${mode}`);await writeFile(other,await readFile(target));await unlink(target);if(mode==="symlink")await symlink(other,target);else await link(other,target);}
      if(mode!=="manifest")await assert.rejects(processor.process(access(selected)),/verification\/copy failed/);
      const restored=await createGameLibraryProcessor({directory:copy});assert.equal((await restored.probe(reg)).available,false);await assert.rejects(restored.libraries!({}),/missing, changed or unverified/);
    }
  }finally{await rm(parent,{recursive:true,force:true});}
});

test("library jobs are immutable, namespace isolated and recoverable across service restart before explicit idempotent application",async()=>{
  const state=await mkdtemp(path.join(tmpdir(),"game-library-service-")),file=path.join(state,"state.sqlite");
  let service=new AgentService(new Store(file),state,undefined,{}, {gameAssetProcessors:[await createGameLibraryProcessor({directory})]});
  try{
    const p=await call<GameProject>(service,"games.projects.create",{requestId:"create",document:fixtureGameDocument()}),selected=(await call<GameLibraryPage>(service,"games.assets.libraries",{query:"character-soldier"})).entries[0]!;
    const request={requestId:"copy",projectId:p.id,revision:1,spec:spec(selected)},job=await call<GameProductionJob>(service,"games.assets.process",request);
    assert.equal((await settled(service,job.id)).state,"completed");assert.equal((await call<GameProductionJob>(service,"games.assets.process",request)).id,job.id);
    assert.equal((await call<GameProject>(service,"games.projects.get",{id:p.id})).revision,1);
    await service.close();service=new AgentService(new Store(file),state,undefined,{}, {gameAssetProcessors:[await createGameLibraryProcessor({directory})]});
    const result=await candidate(service,job.id);assert.equal(result.asset.kind,"model");assert.equal(result.asset.origin.kind,"library");assert.equal(result.asset.placeholder,true);assert.match(result.asset.origin.license,/CC0-1.0/);
    const provenance=JSON.parse(new Transfers(service.store).bytes(reg,result.files.find(file=>file.path.includes("/provenance/"))!.transferId).toString());assert.equal(provenance.licenseStatus,"declared-unverified");assert.deepEqual(provenance.spec.operation.selection,selected);
    const apply={requestId:"apply",jobId:job.id,expectedRevision:1};assert.equal((await call<GameProject>(service,"games.assets.apply",apply)).revision,2);assert.equal((await call<GameProject>(service,"games.assets.apply",apply)).revision,2);
    await assert.rejects(call(service,"games.assets.process",{...request,spec:{...request.spec,target:{...request.spec.target,placeholder:false}}}),/different content/);
    for(const other of [{...reg,profile:"other"},{...reg,product:"companion-vscode" as const}])await assert.rejects(call(service,"games.assets.result",{id:job.id},other),/namespace/);
    await assert.rejects(call(service,"games.assets.libraries",{}, {...reg,product:"kidos"}),/not authorized/);
    const transfer=await call<Transfer>(service,"games.revisions.get",{projectId:p.id}),revision=new Transfers(service.store).json(reg,transfer.id) as GameRevision;
    assert.ok(revision.document.files.some(file=>file.path==="assets/hero/Textures/colormap.png"));assert.equal(revision.document.assets.length,1);
    const replacement=structuredClone(request.spec);replacement.target.placeholder=false;
    const again=await call<GameProductionJob>(service,"games.assets.process",{requestId:"replace-existing-placeholder",projectId:p.id,revision:2,spec:replacement});assert.equal((await settled(service,again.id)).state,"completed");
    assert.equal((await candidate(service,again.id)).asset.placeholder,true,"copying a library must not silently promote the previous placeholder target");
  }finally{await service.close();await rm(state,{recursive:true,force:true});}
});

test("the service independently rejects substituted library bytes and metadata without committing partial results",async()=>{
  for(const mode of ["blob","sidecar"]){
    const state=await mkdtemp(path.join(tmpdir(),"game-library-output-")),processor=await createGameLibraryProcessor({directory}),process=processor.process;
    processor.process=async access=>{const result=await process(access),file=mode==="blob"?result.files[0]!:result.files.find(file=>file.path.endsWith("/LIBRARY.json"))!;file.data=Buffer.from(mode==="blob"?"substituted":"{\"forged\":true}");return result;};
    const service=new AgentService(new Store(path.join(state,"state.sqlite")),state,undefined,{}, {gameAssetProcessors:[processor]});
    try{
      const p=await call<GameProject>(service,"games.projects.create",{requestId:"create",document:fixtureGameDocument()});
      const job=await call<GameProductionJob>(service,"games.assets.process",{requestId:"copy",projectId:p.id,revision:1,spec:spec(await selection())});
      assert.equal((await settled(service,job.id)).state,"awaiting_reconciliation");
      assert.equal((await call<GameProject>(service,"games.projects.get",{id:p.id})).revision,1);
      await assert.rejects(candidate(service,job.id),/acknowledged/);
      assert.equal((service.store.db.prepare("SELECT count(*) AS n FROM game_asset_results").get() as {n:number}).n,0);
      assert.equal((await call<GameProductionJob>(service,"games.production.reconcile",{id:job.id})).state,"failed");
    }finally{await service.close();await rm(state,{recursive:true,force:true});}
  }
});

test("fixed KidOS media refuses library.copy and catalog tools never grant processing or parental permissions",async()=>{
  const document=fixtureGameDocument(),value=spec(await selection());
  const parsed=gameMediaProcessRequest.safeParse({schemaVersion:1,requestId:"fixture",sourceHash:gameContentHash(document),recipeHash:contentHash(value),toolchain:{id:"fixture",version:"1",sha256:"a".repeat(64)},document,spec:value,sources:[]});
  assert.equal(parsed.success,false);if(!parsed.success)assert.match(parsed.error.message,/separately qualified protected catalog/);
  const tool=GAME_AGENT_TOOLS.find(tool=>tool.name==="game_libraries")!;assert.equal(tool.effect,"read");assert.equal(tool.host,"service-game");
});
