import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";
import { AgentService } from "../packages/agent-service/src/service";
import { Store } from "../packages/agent-service/src/store";
import { LocalServer } from "../packages/agent-service/src/server";
import { createClientCredential, ensureIdentity, ipcPath } from "../packages/agent-service/src/security";
import { AgentClient } from "../packages/client-ts/src/index";
import type { Registration } from "../packages/contracts/src/index";
import { gameMutationInspection, type GameProject, type GameMutationInspection } from "../packages/contracts/src/games";
import { contentHash } from "../packages/contracts/src/identity";
import { fixtureGameDocument } from "./game-fixtures";

const reg: Registration = { id: "mutation-mac", product: "companion-mac", profile: "fixture", workspace: "workspace-a", providers: ["ollama"], hostTools: [] };

test("domain mutation inspection is read-only, namespace/project scoped, durable and cannot acknowledge an uncommitted transaction", async () => {
  const directory=await mkdtemp(path.join(tmpdir(),"game-mutation-")),file=path.join(directory,"state.sqlite");let service=new AgentService(new Store(file),directory);
  const api=<T>(method:string,input:unknown,actor=reg)=>service.dispatch(actor,method,input,"fixture") as Promise<T>;
  const counts=()=>["game_projects","game_revisions","game_project_mutations","game_project_events","receipts","runs","transfers"].map(table=>(service.store.db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as {n:number}).n);
  try{
    const doc=fixtureGameDocument(),p=await api<GameProject>("games.projects.create",{requestId:"create",document:doc}),other=await api<GameProject>("games.projects.create",{requestId:"other",document:doc});
    const request={projectId:p.id,requestId:"original-commit",expectedRevision:1,document:{...doc,title:"Original committed source"},message:"Mutation fixture"};
    assert.deepEqual(await api("games.mutations.inspect",{projectId:p.id,requestId:request.requestId}),{state:"missing",projectId:p.id,requestId:request.requestId});
    service.store.db.exec("CREATE TRIGGER fail_mutation_event BEFORE INSERT ON game_project_events BEGIN SELECT RAISE(ABORT, 'fixture-rollback'); END;");
    await assert.rejects(api("games.revisions.commit",request),/fixture-rollback/);
    assert.equal((await api<GameMutationInspection>("games.mutations.inspect",{projectId:p.id,requestId:request.requestId})).state,"missing");
    service.store.db.exec("DROP TRIGGER fail_mutation_event");
    const committed=await api<GameProject>("games.revisions.commit",request);
    await api("games.revisions.commit",{...request,requestId:"later",expectedRevision:2,document:{...doc,title:"Preserve later source"}});
    const before=counts(),expected={state:"acknowledged",projectId:p.id,requestId:request.requestId,bindingHash:contentHash({method:"commit",...request}),revision:2,contentHash:committed.contentHash};
    assert.deepEqual(await api("games.mutations.inspect",{projectId:p.id,requestId:request.requestId}),expected);
    assert.deepEqual(await api("games.mutations.inspect",{projectId:p.id,requestId:request.requestId},{...reg,id:"rotated-registration"}),expected);
    assert.deepEqual(await api("games.mutations.inspect",{projectId:other.id,requestId:request.requestId}),{state:"missing",projectId:other.id,requestId:request.requestId});
    for(const actor of [{...reg,profile:"other"},{...reg,workspace:"workspace-b"},{...reg,product:"companion-vscode" as const}])await assert.rejects(api("games.mutations.inspect",{projectId:p.id,requestId:request.requestId},actor),/not found/);
    for(const extra of [{approved:true},{result:committed},{namespace:"forged"},{bindingHash:"a".repeat(64)}])await assert.rejects(api("games.mutations.inspect",{projectId:p.id,requestId:request.requestId,...extra}));
    assert.deepEqual(counts(),before,"inspection cannot create transfers, effects, revisions, tool receipts or runs");
    await service.close();service=new AgentService(new Store(file),directory);
    assert.deepEqual(await api("games.mutations.inspect",{projectId:p.id,requestId:request.requestId}),expected);
    assert.equal((await api<GameProject>("games.projects.get",{id:p.id})).revision,3);
    assert.ok((await api<{capabilities:string[]}>("engine.info",{})).capabilities.includes("game-mutation-inspection-v1"));
    assert.equal(gameMutationInspection.safeParse({...expected,approved:true}).success,false);
    assert.equal(gameMutationInspection.safeParse({...expected,revision:1.5}).success,false);
  }finally{await service.close();await rm(directory,{recursive:true,force:true});}
});

test("TypeScript and Python inspect the same authenticated domain receipt over TLS without reserializing the original payload",async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),"game-mutation-sdk-")),store=new Store(path.join(directory,"state.sqlite")),credential=await createClientCredential(directory,reg);store.register(credential);
  const identity=await ensureIdentity(directory),service=new AgentService(store,directory),server=new LocalServer(service,directory);await server.listen();
  const client=new AgentClient({address:ipcPath(directory),certificate:identity.cert,credential});await client.connect();
  try{
    const doc=fixtureGameDocument(),p=await client.createGameProject("create",doc),committed=await client.commitGameRevision(p.id,"original",1,doc,"SDK fixture");
    const expected={state:"acknowledged",projectId:p.id,requestId:"original",bindingHash:contentHash({method:"commit",projectId:p.id,requestId:"original",expectedRevision:1,document:doc,message:"SDK fixture"}),revision:2,contentHash:committed.contentHash};
    assert.deepEqual(await client.inspectGameMutation(p.id,"original"),expected);
    if(process.platform!=="win32"){
    const cert=path.join(directory,"client.crt"),credentials=path.join(directory,"client.json");await writeFile(cert,identity.cert,{mode:0o600});await writeFile(credentials,JSON.stringify(credential),{mode:0o600});
    const code=`import sys,json\nfrom pathlib import Path\nsys.path.insert(0,sys.argv[1])\nfrom companion_client import AgentClient,AgentError\nc=AgentClient(sys.argv[2],Path(sys.argv[3]),Path(sys.argv[4]));c.connect()\nr=c.inspect_game_mutation(sys.argv[5],'original')\nassert r==json.loads(sys.argv[6])\nd=c.get_game_revision(sys.argv[5],2)['document'];d['brief']['players']['min']=1.0;d['brief']['players']['max']=1.0\np=c.commit_game_revision(sys.argv[5],'python',2,d,'Python commit')\nassert c.inspect_game_mutation(p['id'],'python')['revision']==3\nassert c.inspect_game_mutation(p['id'],'missing')['state']=='missing'\nc.close()\n# Malformed server replies must not be interpreted as acknowledged effects.\nfor bad in [dict(r,approved=True),dict(r,revision=True),dict(r,bindingHash='bad'),dict(r,requestId='other'),dict(r,projectId='other'),dict(r,state='running')]:\n x=object.__new__(AgentClient);x.call=lambda method,params,bad=bad:bad\n try:x.inspect_game_mutation(sys.argv[5],'original');raise AssertionError('accepted forged receipt')\n except AgentError:pass\nprint('PYTHON_MUTATION_INSPECTION_OK')`;
    const result=await promisify(execFile)("python3",["-I","-c",code,path.resolve("packages/client-python"),ipcPath(directory),cert,credentials,p.id,JSON.stringify(expected)],{timeout:30000});assert.match(result.stdout,/PYTHON_MUTATION_INSPECTION_OK/);
    assert.equal((await client.getGameProject(p.id)).revision,3);
    assert.deepEqual(await client.inspectGameMutation(p.id,"original"),expected,"inspection returns original acknowledged revision, not the latest source");
    }
    const call=client.call.bind(client);
    for(const bad of [{...expected,approved:true},{...expected,revision:true},{...expected,bindingHash:"bad"},{...expected,requestId:"other"},{...expected,projectId:"other"},{...expected,state:"running"}]){
      client.call=async()=>bad as never;await assert.rejects(client.inspectGameMutation(p.id,"original"));
    }
    client.call=call;
  }finally{client.close();await server.close();await rm(directory,{recursive:true,force:true});}
});
