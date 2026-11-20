// Disposable maintainer fault injection. Never an installer or agent tool.
import assert from 'node:assert/strict';
import {spawn,execFile} from 'node:child_process';
import {once} from 'node:events';
import {promisify} from 'node:util';
import {readFile,writeFile,mkdir,mkdtemp,readdir,rm,lstat,unlink} from 'node:fs/promises';
import {createConnection} from 'node:net';
import {createHash,randomUUID} from 'node:crypto';
import {tmpdir} from 'node:os';
import path from 'node:path';
import bootstrap from '../dist-tests/packages/client-ts/src/bootstrap.js';
import security from '../dist-tests/packages/agent-service/src/security.js';
import storage from '../dist-tests/packages/agent-service/src/store.js';
import sdk from '../dist-tests/packages/client-ts/src/index.js';
import identityModule from '../dist-tests/packages/contracts/src/identity.js';
import fixtures from '../dist-tests/test/game-fixtures.js';
const args=Object.fromEntries(process.argv.slice(2).map(arg=>{const at=arg.indexOf('=');assert.ok(at>2);return [arg.slice(2,at),arg.slice(at+1)];}));assert.equal(process.argv.length,4);assert.deepEqual(Object.keys(args).sort(),['codec','engine']);
const engine=path.resolve(args.engine),provision=JSON.parse(await readFile(path.resolve(args.codec),'utf8'));await bootstrap.verifyBundle(engine,undefined,true);
const output=path.resolve('output/game-generation/audio-codec-lifecycle',new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID().slice(0,8));await mkdir(output,{recursive:true});
const state=await mkdtemp(path.join(tmpdir(),'audio-codec-lifecycle-')),identity=await security.ensureIdentity(state),store=new storage.Store(path.join(state,'metadata.sqlite')),credential=await security.createClientCredential(state,{id:'audio-codec-lifecycle',product:'companion-mac',profile:'fixture',workspace:'',providers:['ollama'],hostTools:[]});store.register(credential);store.close();
await writeFile(path.join(state,'fixture-client.json'),JSON.stringify(credential),{mode:0o600,flag:'wx'});
await mkdir(path.join(state,'toolchains'),{mode:0o700});await writeFile(path.join(state,'toolchains/audio-codec.json'),JSON.stringify(provision),{mode:0o600});
const save=(name,value)=>writeFile(path.join(output,name),JSON.stringify(value,null,2)+'\n'),pause=()=>new Promise(r=>setTimeout(r,25)),execute=promisify(execFile),jobs=new Set(),results=[];
let child,client,passed=false,serviceSignals=[];
const docker=async args=>(await execute(provision.dockerExecutable,args,{timeout:10000,maxBuffer:2*1024*1024,env:Object.fromEntries(['HOME','PATH','DOCKER_HOST','DOCKER_CONTEXT'].filter(k=>process.env[k]!==undefined).map(k=>[k,process.env[k]]))})).stdout;
async function boot(){child=spawn(path.join(engine,'node'),[path.join(engine,'service.cjs'),state],{cwd:state,env:{HOME:state,PATH:'/usr/bin:/bin',TMPDIR:tmpdir(),LANG:'en_US.UTF-8'},stdio:'ignore'});let ready=false;
 for(let i=0;i<600;i++){assert.equal(child.exitCode,null);try{if(JSON.parse(await readFile(path.join(state,'runtime.json'),'utf8')).pid===child.pid){ready=true;break;}}catch{}await pause();}assert.ok(ready);client=new sdk.AgentClient({address:security.ipcPath(state),certificate:identity.cert,credential});await client.connect();}
async function stop(){client?.close();if(child?.exitCode===null&&child?.signalCode===null){const done=once(child,'exit');child.kill('SIGTERM');await done;}}
async function cleanOwnedDeadSocket(){
 // Direct-spawn fixture only, as in smoke-game-browser-recovery. Installed
 // products use bootstrap health checks; never remove an inconclusive endpoint.
 assert.ok(child.exitCode!==null||child.signalCode!==null);assert.equal(JSON.parse(await readFile(path.join(state,'runtime.json'),'utf8')).pid,child.pid);if(process.platform==='win32')return;
 const endpoint=security.ipcPath(state),before=await lstat(endpoint);assert.ok(before.isSocket()&&before.uid===process.getuid());
 await new Promise((resolve,reject)=>{const socket=createConnection(endpoint);socket.once('connect',()=>{socket.destroy();reject(Error('Original fixture endpoint is still live'));});socket.once('error',e=>{socket.destroy();e.code==='ECONNREFUSED'?resolve():reject(e);});socket.setTimeout(1000,()=>{socket.destroy();reject(Error('Original fixture endpoint is inconclusive'));});});
 const after=await lstat(endpoint);assert.equal(after.ino,before.ino);assert.equal(after.dev,before.dev);await unlink(endpoint);
}
async function inspect(name,binding){const id=(await docker(['container','ls','--all','--no-trunc','--filter',`name=^/${name}$`,'--format','{{.ID}}'])).trim();if(!id)return undefined;const [container]=JSON.parse(await docker(['container','inspect',id]));assert.equal(container.Id,id);assert.equal(container.Image,provision.imageId);assert.equal(container.Config.Labels['org.companion.game-tool-job'],identityModule.contentHash(binding));return container;}
async function liveEncoder(jobId){
 for(let i=0;i<1200;i++){
  let folders=[];try{folders=await readdir(path.join(state,'game-tool-jobs'));}catch(e){if(e.code!=='ENOENT')throw e;}
  for(const folder of folders){const binding=JSON.parse(await readFile(path.join(state,'game-tool-jobs',folder,'operation.json'),'utf8'));if(binding.jobId!==jobId)continue;assert.equal(folder,identityModule.contentHash(binding));assert.equal(binding.imageId,provision.imageId);assert.equal(binding.recipeHash,provision.recipeSha256);const name='companion-tool-'+folder.slice(0,40),container=await inspect(name,binding);if(!container?.State.Running)continue;
   const top=await docker(['top',container.Id,'-eo','pid,args']);if(!top.includes('/opt/game-audio/ffmpeg/bin/ffmpeg'))continue;
   const job=await client.getGameProduction(jobId);assert.equal(job.state,'running','The observed encoder must still belong to a running original job');return {name,binding,containerId:container.Id,encoderProcessObserved:true};
  }
  const job=await client.getGameProduction(jobId);if(['completed','failed','cancelled','awaiting_reconciliation'].includes(job.state))throw Error('Original job settled before fault injection: '+job.state);await pause();
 }throw Error('Inspect original job '+jobId+'; live codec not observed');
}
async function terminal(id){for(let i=0;i<2400;i++){const job=await client.getGameProduction(id);if(['completed','failed','cancelled','awaiting_reconciliation'].includes(job.state))return job;await pause();}throw Error('Original job did not settle: '+id);}
function wav(){const rate=48000,frames=rate*60,channels=2,b=Buffer.alloc(44+frames*channels*2);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(channels,22);b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*channels*2,28);b.writeUInt16LE(channels*2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(b.length-44,40);for(let i=0;i<frames;i++){const sample=Math.round(10000*Math.sin(2*Math.PI*(220*i/rate+50*i*i/(frames*rate))));b.writeInt16LE(sample,44+i*4);b.writeInt16LE(Math.round(sample*.6),46+i*4);}return b;}
try{
 await boot();assert.ok((await client.gameProductionCapabilities()).assetProcessors.some(p=>p.id==='audio-codec-isolated-v1'&&p.available));const bytes=wav(),sha=createHash('sha256').update(bytes).digest('hex'),document=fixtures.fixtureGameDocument();document.title='Synthetic codec lifecycle';document.files=[await client.uploadGameFile('assets/master.wav',bytes,'audio/wav')];document.assets=[{id:'master',kind:'audio',role:'Synthetic lifecycle source',placeholder:true,files:['assets/master.wav'],origin:{kind:'procedural',source:'Authored fault-injection fixture',author:'Test',license:'Synthetic test data',referenceIds:[]}}];const project=await client.createGameProject('lifecycle-source',document);
 const spec={processorId:'audio-codec-isolated-v1',target:{id:'encoded',role:'Unapplied synthetic delivery',placeholder:true},operation:{type:'audio.encode',codec:'aac-lc',source:{assetId:'master',path:'assets/master.wav'},outputBase:'assets/delivery',variants:[{id:'compact',bitrateKbps:64},{id:'standard',bitrateKbps:128},{id:'high',bitrateKbps:192}]}};
 const cancel=await client.processGameAsset('cancel-original',project.id,1,spec);jobs.add(cancel.id);const first=await liveEncoder(cancel.id);await save('cancel-original.json',first);const requested=await client.cancelGameProduction(cancel.id);assert.ok(['cancelling','cancelled'].includes(requested.state));const cancelled=await terminal(cancel.id);assert.equal(cancelled.state,'cancelled');assert.equal(await inspect(first.name,first.binding),undefined);assert.equal((await client.getGameProject(project.id)).revision,1);results.push({scenario:'cancel-live-codec',jobId:cancel.id,encoderProcessObserved:true,state:cancelled.state,originalContainerAbsent:true,sourceUnchanged:true});await save('progress.json',results);
 const recovery=await client.processGameAsset('restart-original',project.id,1,spec);jobs.add(recovery.id);const second=await liveEncoder(recovery.id);await save('restart-original.json',second);const pid=child.pid,exit=once(child,'exit');child.kill('SIGKILL');const [code,signal]=await exit;assert.equal(code,null);assert.equal(signal,'SIGKILL');serviceSignals.push({ownedPid:pid,signal});client.close();await cleanOwnedDeadSocket();
 await boot();const recovered=await client.getGameProduction(recovery.id);assert.equal(recovered.state,'awaiting_reconciliation');const reconciled=await client.reconcileGameProduction(recovery.id);assert.ok(['completed','failed'].includes(reconciled.state),'Reconciliation must inspect the original, without re-encoding');assert.equal(reconciled.id,recovery.id);assert.equal(await inspect(second.name,second.binding),undefined);assert.equal((await client.listGameProduction(project.id)).jobs.length,2);const after=await client.getGameRevision(project.id);assert.equal(after.revision,1);assert.equal(after.document.files.find(f=>f.path==='assets/master.wav').sha256,sha);assert.equal(after.document.assets.length,1);results.push({scenario:'kill-service-during-codec',jobId:recovery.id,encoderProcessObserved:true,restartedState:recovered.state,reconciledState:reconciled.state,originalContainerAbsent:true,noNewJob:true,noApply:true,sourceUnchanged:true});
 await save('report.json',{scope:'Real packaged API/TLS and original pinned Linux x64 codec containers on ARM64, disposable SIGKILL/cancellation. No UI, models, installation or artistic/physical acceptance.',engineManifestSha256:createHash('sha256').update(await readFile(path.join(engine,'manifest.json'))).digest('hex'),provision,source:{sha256:sha,bytes:bytes.length,seconds:60},results,serviceSignals,modelCalls:0});passed=true;console.log('GAME_AUDIO_CODEC_LIFECYCLE_QUALIFIED '+output);
}catch(error){await save('failure.json',{message:error.message,ownedServicePid:child?.pid,results,serviceSignals});throw error;}
finally{const unresolved=[];for(const id of jobs){try{const job=await client.getGameProduction(id);if(!['completed','failed','cancelled'].includes(job.state))unresolved.push({id,state:job.state});}catch{unresolved.push({id,state:'inspection-unavailable'});}}
 if(unresolved.length){client?.close();child?.unref();await save('closure.json',{servicePreservedForInspection:true,ownedServicePid:child?.pid,unresolved});console.error('Inspect original service/jobs at '+state);}
 else{await stop();await save('closure.json',{serviceExitCode:child?.exitCode,serviceSignals});if(passed)await rm(state,{recursive:true,force:true});else console.error('Original failed fixture preserved: '+state);}}
