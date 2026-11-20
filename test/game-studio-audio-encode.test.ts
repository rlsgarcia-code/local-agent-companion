import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {AgentService} from '../packages/agent-service/src/service';
import {Store} from '../packages/agent-service/src/store';
import {LocalServer} from '../packages/agent-service/src/server';
import {ensureIdentity,createClientCredential,ipcPath} from '../packages/agent-service/src/security';
import {AgentClient} from '../packages/client-ts/src/index';
import {GameStudioController} from '../packages/client-ts/src/game-studio';
import {gameStudioAudioEncode} from '../packages/contracts/src/game-studio';
import {errors} from '../packages/contracts/src/index';
import type {GameAssetProcessor} from '../packages/game-production/src/index';
import {fixtureGameDocument} from './game-fixtures';

// Simulated processor output, not a real AAC codec. Native codec qualification
// separately uses the signed-source image; these tests exercise authority/API.
async function fixture(){
 const directory=await mkdtemp(path.join(tmpdir(),'studio-audio-encode-')),reg={id:'studio-audio-encode',product:'companion-mac' as const,profile:'fixture',workspace:'',providers:['ollama' as const],hostTools:[]};let processes=0,available=true,writable=true,approved=true,approvals=0,onApprove:undefined|(()=>Promise<void>);
 const processor:GameAssetProcessor={id:'audio-codec-isolated-v1',products:['companion-mac','companion-vscode'],authority:'workspace',operations:['audio.encode'],toolchain:{id:'simulated-codec',version:'fixture',sha256:'a'.repeat(64)},async probe(){return {available};},async process(){processes++;return {files:[{path:'assets/delivery.compact.m4a',mime:'audio/mp4',data:Buffer.from('Not AAC; authority fixture only')},{path:'assets/delivery.encoded.json',mime:'application/json',data:Buffer.from('{\"fixture\":true}')}],info:{fixture:true}};}};
 const service=new AgentService(new Store(path.join(directory,'metadata.sqlite')),directory,undefined,{}, {gameAssetProcessors:[processor]}),credential=await createClientCredential(directory,reg);service.store.register(credential);const identity=await ensureIdentity(directory),server=new LocalServer(service,directory);await server.listen();const client=new AgentClient({address:ipcPath(directory),certificate:identity.cert,credential});await client.connect();
 const wav=Buffer.alloc(46);wav.write('RIFF');wav.writeUInt32LE(38,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(22050,24);wav.writeUInt32LE(44100,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(2,40);
 const source=await client.uploadGameFile('assets/master.wav',wav,'audio/wav'),document=fixtureGameDocument();document.files=[source];document.assets=[{id:'master',kind:'audio',role:'Synthetic master',placeholder:true,files:[source.path],origin:{kind:'procedural',source:'Authored test input',author:'Test',license:'Synthetic fixture',referenceIds:[]}}];const project=await client.createGameProject('source',document),session=await client.call<{id:string}>('sessions.create',{title:'Audio encode'});await client.selectGameProject(session.id,project.id);
 const controller=new GameStudioController(client,session.id,{canWrite:()=>writable,approve:async()=>{approvals++;await onApprove?.();return approved;},preview:async()=>{},exportSource:async()=>false,exportBuild:async()=>false,exportAsset:async()=>false});
 const command=gameStudioAudioEncode.parse({action:'encode-audio',projectId:project.id,expectedRevision:1,requestId:'encode',sourceSha256:source.sha256,spec:{processorId:processor.id,target:{id:'delivery',role:'Delivery',placeholder:true},operation:{type:'audio.encode',codec:'aac-lc',source:{assetId:'master',path:source.path},outputBase:'assets/delivery',variants:[{id:'compact',bitrateKbps:64}]}}});
 const settled=async(id:string)=>{for(let i=0;i<500;i++){const job=await client.getGameProduction(id);if(['completed','failed','cancelled','awaiting_reconciliation'].includes(job.state))return job;await new Promise(r=>setTimeout(r,5));}throw Error('Original fixture job did not settle');};
 return {directory,reg,service,credential,identity,client,controller,command,project,source,session,settled,get processes(){return processes;},get approvals(){return approvals;},set available(v:boolean){available=v;},set writable(v:boolean){writable=v;},set approved(v:boolean){approved=v;},set onApprove(fn:(()=>Promise<void>)|undefined){onApprove=fn;},async close(){client.close();await server.close();await service.close();await rm(directory,{recursive:true,force:true});}};
}
test('audio variants inspect missing without effects, require consent and recover the exact request read-only after later work',async()=>{
 const f=await fixture();try{
  const c=f.command;assert.equal((await f.client.inspectGameAssetRequest(c.requestId,c.projectId,1,c.spec)).state,'missing');assert.equal(f.processes,0);assert.equal((await f.client.listGameProduction(c.projectId)).jobs.length,0);
  f.approved=false;assert.deepEqual(await f.controller.dispatch(c),{cancelled:true});assert.equal(f.processes,0);
  f.approved=true;const response=await f.controller.dispatch(c) as {requestedAssetJobId:string;assetRequestAcknowledged:boolean};assert.equal(response.assetRequestAcknowledged,true);assert.equal((await f.settled(response.requestedAssetJobId)).state,'completed');assert.equal(f.processes,1);assert.equal((await f.client.getGameProject(c.projectId)).revision,1);
  const inspected=await f.client.inspectGameAssetRequest(c.requestId,c.projectId,1,c.spec);assert.equal(inspected.state,'acknowledged');if(inspected.state==='acknowledged')assert.equal(inspected.jobId,response.requestedAssetJobId);
  await assert.rejects(()=>f.client.inspectGameAssetRequest(c.requestId,c.projectId,1,{...c.spec,operation:{...c.spec.operation,variants:[{id:'compact',bitrateKbps:96}]}}),/different content/);
  const later=await f.client.getGameRevision(c.projectId);later.document.title='Later work';await f.client.commitGameRevision(c.projectId,'later',1,later.document,'Later work');f.writable=false;f.available=false;const approvals=f.approvals;
  const resumed=await f.controller.dispatch({action:'resume-encode-audio',projectId:c.projectId,command:c}) as {requestedAssetJobId:string};assert.equal(resumed.requestedAssetJobId,response.requestedAssetJobId);assert.equal(f.approvals,approvals);assert.equal(f.processes,1);assert.equal((await f.client.listGameProduction(c.projectId)).jobs.length,1);assert.equal((await f.client.getGameProject(c.projectId)).revision,2);
  await assert.rejects(()=>f.service.dispatch({...f.reg,profile:'other'},'games.assets.inspect',{requestId:c.requestId,projectId:c.projectId,revision:1,spec:c.spec},'fixture'),{code:errors.missing});
  await assert.rejects(()=>f.service.dispatch({...f.reg,product:'kidos'},'games.assets.inspect',{requestId:c.requestId,projectId:c.projectId,revision:1,spec:c.spec},'fixture'),/protected KidOS/);
  if(process.platform!=='win32'){
   const cert=path.join(f.directory,'cert.pem'),auth=path.join(f.directory,'auth.json'),request=path.join(f.directory,'inspect.json');await writeFile(cert,f.identity.cert);await writeFile(auth,JSON.stringify(f.credential),{mode:0o600});await writeFile(request,JSON.stringify({command:c,receipt:inspected}),{mode:0o600});
   const code="import sys,json\nfrom pathlib import Path\nsys.path.insert(0,sys.argv[1])\nfrom companion_client import AgentClient\nc=AgentClient(sys.argv[2],Path(sys.argv[3]),Path(sys.argv[4]));c.connect()\ndata=json.loads(Path(sys.argv[5]).read_text());r=data['command']\nassert c.inspect_game_asset_request(r['requestId'],r['projectId'],r['expectedRevision'],r['spec'])==data['receipt']\nc.close()\nprint('PYTHON_ASSET_INSPECTION_OK')";
   const result=await promisify(execFile)('python3',['-I','-c',code,path.resolve('packages/client-python'),ipcPath(f.directory),cert,auth,request],{timeout:30000});assert.match(result.stdout,/PYTHON_ASSET_INSPECTION_OK/);
  }
 }finally{await f.close();}
});
test('audio variant host rejects forged sources, processors, conflicts, read-only and authority changes during consent before processing',async()=>{
 const f=await fixture();try{
  const c=f.command;for(const command of [{...c,sourceSha256:'b'.repeat(64)},{...c,spec:{...c.spec,processorId:'host-shell'}},{...c,spec:{...c.spec,operation:{...c.spec.operation,source:{assetId:'master',path:'assets/not-owned.wav'}}}},{...c,spec:{...c.spec,target:{...c.spec.target,id:'master'}}}])assert.equal((await f.controller.dispatch(command) as {audioEncodeRejected:boolean}).audioEncodeRejected,true);
  assert.equal(f.approvals,0);assert.equal(f.processes,0);f.writable=false;assert.equal((await f.controller.dispatch(c) as {audioEncodeRejected:boolean}).audioEncodeRejected,true);f.writable=true;
  f.onApprove=async()=>{f.writable=false;};assert.equal((await f.controller.dispatch(c) as {audioEncodeRejected:boolean}).audioEncodeRejected,true);assert.equal(f.processes,0);f.writable=true;
  const other=await f.client.createGameProject('other',fixtureGameDocument());f.onApprove=async()=>{await f.client.selectGameProject(f.session.id,other.id);};assert.equal((await f.controller.dispatch(c) as {audioEncodeRejected:boolean}).audioEncodeRejected,true);assert.equal(f.processes,0);assert.equal((await f.client.listGameProduction(c.projectId)).jobs.length,0);
 }finally{await f.close();}
});
test('lost processing acknowledgment cannot be replaced by a missing or mismatched inspection; exact receipt recovers without a second effect',async()=>{
 const f=await fixture();try{
  const c=f.command,process=f.client.processGameAsset.bind(f.client),call=f.client.call.bind(f.client);let requests=0;
  f.client.processGameAsset=async(...args)=>{requests++;await process(...args);throw Error('Fixture lost acknowledgment');};await assert.rejects(()=>f.controller.dispatch(c),/lost acknowledgment/);
  const job=(await f.client.listGameProduction(c.projectId)).jobs[0]!;assert.equal((await f.settled(job.id)).state,'completed');const later=await f.client.getGameRevision(c.projectId);later.document.title='Later design';await f.client.commitGameRevision(c.projectId,'later',1,later.document,'Later design');
  f.client.call=(async(method:string,args:unknown)=>{const result=await call(method,args);if(method!=='games.assets.inspect')return result;const {jobId,...binding}=result as {jobId:string};return {...binding,state:'missing'};}) as typeof f.client.call;
  assert.equal((await f.controller.dispatch({action:'resume-encode-audio',projectId:c.projectId,command:c}) as {audioEncodeRejected:boolean}).audioEncodeRejected,true);assert.equal(requests,1);
  f.client.call=(async(method:string,args:unknown)=>{const result=await call(method,args);return method==='games.assets.inspect'?{...result as object,requestHash:'f'.repeat(64)}:result;}) as typeof f.client.call;
  await assert.rejects(()=>f.controller.dispatch({action:'resume-encode-audio',projectId:c.projectId,command:c}),/receipt differs/);assert.equal(requests,1);
  f.client.call=call;const recovered=await f.controller.dispatch({action:'resume-encode-audio',projectId:c.projectId,command:c}) as {requestedAssetJobId:string};assert.equal(recovered.requestedAssetJobId,job.id);assert.equal(requests,1);assert.equal(f.processes,1);assert.equal((await f.client.getGameProject(c.projectId)).revision,2);
 }finally{await f.close();}
});
