import assert from "node:assert/strict";
import {mkdtemp,rm,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import test from "node:test";
import {AgentService} from "../packages/agent-service/src/service";
import {Store} from "../packages/agent-service/src/store";
import {LocalServer} from "../packages/agent-service/src/server";
import {ensureIdentity,createClientCredential,ipcPath} from "../packages/agent-service/src/security";
import {AgentClient} from "../packages/client-ts/src/index";
import {GameStudioController,type GameStudioHost} from "../packages/client-ts/src/game-studio";
import {compareGameRevisions} from "../packages/game-design/src/comparison";
import {gameContentHash} from "../packages/game-design/src/project";
import {gameRevisionCompare,gameRevisionComparison,type GameComparisonChange} from "../packages/contracts/src/game-comparison";
import type {GameDocument,GameRevision} from "../packages/contracts/src/games";
import type {Registration,Session} from "../packages/contracts/src/index";
import {fixtureGameDocument} from "./game-fixtures";

function revision(document:GameDocument,number:number):GameRevision{return {projectId:"fixture",revision:number,contentHash:gameContentHash(document),parentHash:null,document,message:"Synthetic revision",createdAt:number,origin:"edited"};}
const request=(section:"all"|"design"|"files"|"assets"|"legacy"="all",cursor=0,limit=100)=>gameRevisionCompare.parse({projectId:"fixture",baseRevision:1,targetRevision:2,section,cursor,limit});

test("revision comparison matches identified content, preserves full fields and reports ordered moves separately from modified values",()=>{
  const a=fixtureGameDocument(),b=structuredClone(a);
  a.design!.mechanics.push({id:"jump",name:"Jump",description:"Unchanged mechanics must not be mistaken for another ID"});
  b.design!.mechanics=structuredClone([...a.design!.mechanics].reverse());b.design!.mechanics[1]!.description="A changed gravity rule";
  b.design!.premise="x".repeat(4000);b.title="<img src=x onerror=alert(1)>";
  const result=gameRevisionComparison.parse(compareGameRevisions(revision(a,1),revision(b,2),request()));
  const moves=result.changes.filter(entry=>entry.change==="moved");assert.equal(moves.length,2);assert.ok(moves.every(entry=>entry.path.at(-1)==="@order"));
  const description=result.changes.filter(entry=>entry.path.at(-1)==="description");assert.equal(description.length,1);assert.ok(description[0]!.path.includes("id:gravity"));
  assert.ok(result.changes.some(entry=>entry.after.kind==="string"&&entry.after.value.length===4000),"never truncate an ordinary domain field to fit the display");
  assert.equal(result.counts.overview,1);assert.equal(result.sourceEqual,false);assert.equal(result.hasMore,false);
  const reverse=compareGameRevisions(revision(b,1),revision(a,2),request());assert.equal(reverse.counts.total,result.counts.total);
});

test("file transport IDs are ignored, while metadata, content hashes, ordering and large legacy changes stay distinguishable and paged",()=>{
  const a=fixtureGameDocument(),b=structuredClone(a);
  a.files=[{path:"src/main.ts",size:10,mime:"text/plain",sha256:"a".repeat(64),transferId:"old-transfer"}];b.files=[{...a.files[0]!,transferId:"new-transfer"}];
  let first=compareGameRevisions(revision(a,1),revision(b,2),request());assert.equal(first.counts.total,0);assert.equal(first.sourceEqual,true);
  b.files[0]!.mime="text/javascript";
  first=compareGameRevisions(revision(a,1),revision(b,2),request("files"));assert.equal(first.changes.length,1);assert.equal(first.changes[0]!.before.kind,"file");assert.doesNotMatch(JSON.stringify(first),/old-transfer|new-transfer/);
  a.legacy={schemaVersion:1,reviewRequired:true,design:{large:"a".repeat(200000)}};b.legacy={schemaVersion:1,reviewRequired:true,design:{large:"b".repeat(200000)}};
  const legacy=gameRevisionComparison.parse(compareGameRevisions(revision(a,1),revision(b,2),request("legacy")));assert.equal(legacy.changes.length,1);
  assert.equal(legacy.changes[0]!.before.kind,"opaque");assert.ok(JSON.stringify(legacy).length<3000);assert.equal(a.legacy.design.large,"a".repeat(200000));
  const design=structuredClone(b);design.design=null;
  const empty=compareGameRevisions(revision(design,1),revision(b,2),request("design",0,1));assert.equal(empty.changes.length,1);assert.equal(empty.hasMore,true);
  assert.equal(empty.changes[0]!.before.kind,"null");assert.equal(empty.changes[0]!.after.kind,"object");
});

async function fixture(){
  const directory=await mkdtemp(path.join(tmpdir(),"game-comparison-")),reg:Registration={id:"comparison-fixture",product:"companion-mac",profile:"fixture",workspace:"",providers:["ollama"],hostTools:[]};
  const service=new AgentService(new Store(path.join(directory,"state.sqlite")),directory,async()=>{throw Error("No inference is permitted");});
  const credential=await createClientCredential(directory,reg);service.store.register(credential);const identity=await ensureIdentity(directory),server=new LocalServer(service,directory);await server.listen();
  const client=new AgentClient({address:ipcPath(directory),certificate:identity.cert,credential});await client.connect();
  return {directory,reg,identity,credential,service,client,server,async close(){client.close();await server.close();await service.close();await rm(directory,{recursive:true,force:true});}};
}

test("comparison pages bind two immutable revisions, all changes and namespaces without effects; both SDKs use authenticated IPC",async()=>{
  const f=await fixture();
  try{
    const a=fixtureGameDocument();a.design!.content=Array.from({length:120},(_,i)=>({id:`content-${i}`,kind:"Synthetic",description:`Before ${i}`}));
    a.files=[await f.client.uploadGameFile("src/main.ts",Buffer.from("const before = 1;"),"text/plain")];
    a.assets=[{id:"script",kind:"other",role:"Synthetic source",files:["src/main.ts"],placeholder:true,origin:{kind:"procedural",source:"Synthetic fixture",author:"Test",license:"Fixture only",referenceIds:[]}}];
    const project=await f.client.createGameProject("create",a),b=structuredClone(a);
    b.design!.content.forEach((entry,i)=>entry.description=`After ${i}`);b.files=[await f.client.uploadGameFile("src/main.ts",Buffer.from("const after = 2;"),"text/plain")];b.assets[0]!.origin.license="Changed declaration, not a verified license";
    await f.client.commitGameRevision(project.id,"change",1,b,"Synthetic fields and source");
    const state=()=>["game_revisions","game_project_events","game_project_mutations","receipts","transfers"].map(table=>(f.service.store.db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as {n:number}).n);
    const initial=state(),changes:GameComparisonChange[]=[];let cursor=0,targetHash="";
    for(;;){const page=await f.client.compareGameRevisions(project.id,1,2,"all",cursor,7);assert.ok(page.changes.length<=7);changes.push(...page.changes);targetHash=page.target.contentHash;if(!page.hasMore)break;assert.ok(page.cursor>cursor);cursor=page.cursor;}
    assert.deepEqual(state(),initial,"read comparison must not create revisions, events, receipts or transfers");
    assert.equal(changes.filter(entry=>entry.section==="design").length,120);assert.equal(changes.filter(entry=>entry.section==="files").length,1);assert.equal(changes.filter(entry=>entry.section==="assets").length,1);
    assert.equal(new Set(changes.map(entry=>JSON.stringify([entry.section,entry.path]))).size,changes.length);
    const c=structuredClone(b);c.title="Later source";await f.client.commitGameRevision(project.id,"later",2,c,"Keep later work");
    const repeated=await f.client.compareGameRevisions(project.id,1,2);assert.equal(repeated.target.contentHash,targetHash);assert.equal(repeated.target.revision,2);assert.equal((await f.client.getGameProject(project.id)).revision,3);
    for(const identity of [{...f.reg,profile:"other"},{...f.reg,product:"companion-vscode" as const},{...f.reg,workspace:"other"}])await assert.rejects(f.service.dispatch(identity,"games.revisions.compare",{projectId:project.id,baseRevision:1,targetRevision:2},"fixture"),/not found/);
    await assert.rejects(f.client.compareGameRevisions(project.id,1,999),/not found/);
    await assert.rejects(f.client.call("games.revisions.compare",{projectId:project.id,baseRevision:1,targetRevision:2,namespace:"forged"}));
    const auth=path.join(f.directory,"auth.json"),certificate=path.join(f.directory,"certificate.pem");await writeFile(auth,JSON.stringify(f.credential),{mode:0o600});await writeFile(certificate,f.identity.cert,{mode:0o600});
    if(process.platform!=="win32"){
      const code=`import sys\nsys.path.insert(0,sys.argv[1])\nfrom pathlib import Path\nfrom companion_client import AgentClient\nc=AgentClient(sys.argv[2],Path(sys.argv[3]),Path(sys.argv[4]))\nc.connect()\nr=c.compare_game_revisions(sys.argv[5],1,2,'design',0,7)\nassert r['counts']['design']==120 and len(r['changes'])==7 and r['hasMore']\nassert r['target']['revision']==2\nc.close()\nprint('COMPARISON_PYTHON_OK')`;
      const result=await promisify(execFile)("python3",["-I","-c",code,path.resolve("packages/client-python"),ipcPath(f.directory),certificate,auth,project.id],{timeout:30000});assert.match(result.stdout,/COMPARISON_PYTHON_OK/);
    }
  }finally{await f.close();}
});

test("Studio comparison works in read-only mode, refuses a changed project and requires the comparison capability without restoring anything",async()=>{
  const f=await fixture();
  try{
    const a=fixtureGameDocument(),project=await f.client.createGameProject("first",a),other=await f.client.createGameProject("other",a),session=await f.client.call<Session>("sessions.create",{title:"Compare"});
    const b=structuredClone(a);b.design!.camera="Changed camera";await f.client.commitGameRevision(project.id,"change",1,b,"Read comparison");await f.client.selectGameProject(session.id,project.id);
    const host:GameStudioHost={canWrite:()=>false,approve:async()=>{throw Error("Comparison must not ask for write consent");},preview:async()=>{throw Error("No preview");},exportSource:async()=>false,exportBuild:async()=>false,exportAsset:async()=>false};
    const controller=new GameStudioController(f.client,session.id,host),command={action:"compare",projectId:project.id,baseRevision:1,targetRevision:2};
    const result=await controller.dispatch(command) as {comparison:{counts:{design:number}}};assert.equal(result.comparison.counts.design,1);
    const compare=f.client.compareGameRevisions.bind(f.client);f.client.compareGameRevisions=async(...args)=>{const value=await compare(...args);await f.client.selectGameProject(session.id,other.id);return value;};
    await assert.rejects(controller.dispatch(command),/selecionado mudou/);f.client.compareGameRevisions=compare;await f.client.selectGameProject(session.id,project.id);
    const call=f.client.call.bind(f.client);f.client.call=async(method,input)=>method==="engine.info"?{capabilities:[]} as never:call(method,input);
    await assert.rejects(controller.dispatch(command),/atualização/);f.client.call=call;
    assert.equal((await f.client.getGameProject(project.id)).revision,2);assert.equal((await f.client.getGameQuality(project.id)).ready,false);
  }finally{await f.close();}
});
