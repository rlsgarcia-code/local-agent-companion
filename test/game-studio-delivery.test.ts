import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {AgentService} from '../packages/agent-service/src/service';
import {Store} from '../packages/agent-service/src/store';
import {LocalServer} from '../packages/agent-service/src/server';
import {ensureIdentity,createClientCredential,ipcPath} from '../packages/agent-service/src/security';
import {AgentClient} from '../packages/client-ts/src/index';
import {GameStudioController} from '../packages/client-ts/src/game-studio';
import {fixtureGameDocument} from './game-fixtures';

async function fixture(){
 const directory=await mkdtemp(path.join(tmpdir(),'studio-delivery-')),reg={id:'studio-delivery',product:'companion-mac' as const,profile:'fixture',workspace:'',providers:['ollama' as const],hostTools:[]};
 const identity=await ensureIdentity(directory),credential=await createClientCredential(directory,reg),store=new Store(path.join(directory,'metadata.sqlite'));store.register(credential);
 const service=new AgentService(store,directory),server=new LocalServer(service,directory);await server.listen();
 const client=new AgentClient({address:ipcPath(directory),certificate:identity.cert,credential});await client.connect();
 const doc=fixtureGameDocument();for(const [name,data,mime]of [['game.web.json','{"schemaVersion":1,"entry":"src/main.ts","engineVersion":"4.2.1"}','application/json'],['assets/master.wav','synthetic master','audio/wav'],['assets/compact.m4a','synthetic test bytes, not AAC','audio/mp4'],['data/levels.json','{}','application/json']])doc.files.push(await client.uploadGameFile(name!,Buffer.from(data!),mime!));
 const project=await client.createGameProject('create',doc),session=await client.call<{id:string}>('sessions.create',{title:'Delivery fixture'});await client.selectGameProject(session.id,project.id);
 let writable=true,approved=true,approvals=0,onApprove:undefined|(()=>Promise<void>);
 const controller=new GameStudioController(client,session.id,{canWrite:()=>writable,approve:async()=>{approvals++;await onApprove?.();return approved;},preview:async()=>{},exportSource:async()=>false,exportBuild:async()=>false,exportAsset:async()=>false});
 const command={action:'set-delivery' as const,projectId:project.id,expectedRevision:1,requestId:'choose',configSha256:doc.files[0]!.sha256,delivery:{schemaVersion:1 as const,files:['assets/compact.m4a','data/levels.json']}};
 return {directory,service,server,client,controller,doc,project,session,command,set writable(v:boolean){writable=v;},set approved(v:boolean){approved=v;},set onApprove(v:typeof onApprove){onApprove=v;},get approvals(){return approvals;},async close(){client.close();await server.close();await service.close();await rm(directory,{recursive:true,force:true});}};
}
test('Studio delivery uses exact config/revision, consent and one normal domain commit; removing selection preserves originals',async()=>{
 const f=await fixture();try{
  const read=await f.controller.dispatch({action:'delivery-settings',projectId:f.project.id}) as any;
  assert.equal(read.deliverySettings.configSha256,f.command.configSha256);assert.equal(read.deliverySettings.files.length,3);assert.equal(read.deliverySettings.delivery,null);
  f.approved=false;assert.deepEqual(await f.controller.dispatch(f.command),{cancelled:true});assert.equal((await f.client.getGameProject(f.project.id)).revision,1);
  f.approved=true;const result=await f.controller.dispatch(f.command) as any;assert.equal(result.deliveryMutationAcknowledged,true);assert.equal(result.project.revision,2);
  const bytes=await f.client.downloadGameFile(f.project.id,'game.web.json');assert.deepEqual(JSON.parse(bytes.toString()).delivery,f.command.delivery);
  assert.deepEqual(await f.client.downloadGameFile(f.project.id,'assets/master.wav'),Buffer.from('synthetic master'));
  const two=await f.client.getGameRevision(f.project.id);const cleared=await f.controller.dispatch({...f.command,requestId:'clear',expectedRevision:2,configSha256:two.document.files[0]!.sha256,delivery:null}) as any;
  assert.equal(cleared.project.revision,3);assert.equal(JSON.parse((await f.client.downloadGameFile(f.project.id,'game.web.json')).toString()).delivery,undefined);
  assert.equal((await f.client.listGameProduction(f.project.id)).jobs.length,0);
 }finally{await f.close();}
});
test('lost delivery commit recovers read-only after later work, without upload, consent or another revision; missing/wrong bindings cannot settle it',async()=>{
 const f=await fixture();try{
  const commit=f.client.commitGameRevision.bind(f.client);let commits=0;f.client.commitGameRevision=async(...args)=>{commits++;await commit(...args);throw Error('Lost delivery response');};
  await assert.rejects(f.controller.dispatch(f.command),/Lost delivery response/);f.client.commitGameRevision=commit;
  const later=await f.client.getGameRevision(f.project.id);later.document.title='Later work';await commit(f.project.id,'later',2,later.document,'Keep later work');
  let uploads=0;const upload=f.client.uploadGameFile.bind(f.client);f.client.uploadGameFile=async(...args)=>{uploads++;return upload(...args);};
  const inspect=f.client.inspectGameMutation.bind(f.client),resume={...f.command,action:'resume-delivery'};
  f.client.inspectGameMutation=async(projectId,requestId)=>({state:'missing',projectId,requestId});
  assert.equal((await f.controller.dispatch(resume) as any).deliveryEditRejected,true);assert.equal(uploads,0);
  f.client.inspectGameMutation=async(...args)=>{const value=await inspect(...args);return value.state==='acknowledged'?{...value,bindingHash:'a'.repeat(64)}:value;};
  assert.equal((await f.controller.dispatch(resume) as any).deliveryEditRejected,true);
  f.client.inspectGameMutation=inspect;f.writable=false;f.approved=false;const before=f.approvals;
  const call=f.client.call.bind(f.client);f.client.call=async(method,params)=>{const value:any=await call(method,params);return (method==='engine.info'?{...value,capabilities:value.capabilities.filter((v:string)=>v!=='game-web-delivery-v1')}:value) as any;};
  const recovered=await f.controller.dispatch(resume) as any;assert.equal(recovered.deliveryMutationAcknowledged,true);assert.equal(recovered.recoveredDeliveryCommit.revision,2);assert.equal(recovered.project.revision,3);assert.equal(recovered.project.title,'Later work');
  assert.equal(f.approvals,before);assert.equal(uploads,0);assert.equal(commits,1);assert.equal((await f.client.listGameRevisions(f.project.id)).revisions.length,3);
  assert.equal((await f.controller.dispatch({...resume,delivery:{schemaVersion:1,files:[]}}) as any).deliveryEditRejected,true);
 }finally{await f.close();}
});
test('forged configuration/resource/identity and changed authority during consent are rejected before upload or commit',async()=>{
 const f=await fixture();try{
  let uploads=0;const upload=f.client.uploadGameFile.bind(f.client);f.client.uploadGameFile=async(...args)=>{uploads++;return upload(...args);};
  for(const command of [{...f.command,projectId:'other'},{...f.command,configSha256:'f'.repeat(64)},
   {...f.command,delivery:{schemaVersion:1,files:['assets/missing']}},{...f.command,delivery:{schemaVersion:1,files:['../secret']}},
   {...f.command,delivery:{schemaVersion:1,files:[],allowShell:true}}])assert.equal((await f.controller.dispatch(command) as any).deliveryEditRejected,true);
  f.writable=false;assert.equal((await f.controller.dispatch(f.command) as any).deliveryEditRejected,true);
  f.writable=true;f.onApprove=async()=>{f.writable=false;};assert.equal((await f.controller.dispatch(f.command) as any).deliveryEditRejected,true);assert.equal(uploads,0);
  f.writable=true;f.onApprove=async()=>{const r=await f.client.getGameRevision(f.project.id);r.document.title='Changed during consent';await f.client.commitGameRevision(f.project.id,'change',1,r.document,'Concurrent edit');};
  assert.equal((await f.controller.dispatch(f.command) as any).deliveryEditRejected,true);assert.equal(uploads,0);assert.equal((await f.client.getGameProject(f.project.id)).revision,2);
 }finally{await f.close();}
});

test('unknown configuration fields are preserved and refused rather than silently rewritten',async()=>{
 const f=await fixture();try{
  const original=await f.client.getGameRevision(f.project.id),data=Buffer.from('{"schemaVersion":1,"entry":"src/main.ts","engineVersion":"4.2.1","futureSetting":{"keep":true}}');
  const file=await f.client.uploadGameFile('game.web.json',data,'application/json');original.document.files=original.document.files.map(value=>value.path===file.path?file:value);
  await f.client.commitGameRevision(f.project.id,'future-config',1,original.document,'Preserve newer configuration');
  const result=await f.controller.dispatch({action:'delivery-settings',projectId:f.project.id}) as any;assert.equal(result.deliveryEditRejected,true);assert.match(result.message,/Nenhum deles foi descartado/);
  assert.equal((await f.client.getGameProject(f.project.id)).revision,2);assert.deepEqual(await f.client.downloadGameFile(f.project.id,file.path),data);assert.equal(f.approvals,0);
 }finally{await f.close();}
});
