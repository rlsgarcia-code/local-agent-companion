// Exact packaged engine qualification, without native UI or model inference.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {readFile,writeFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import bootstrap from '../dist-tests/packages/client-ts/src/bootstrap.js';
import security from '../dist-tests/packages/agent-service/src/security.js';
import storage from '../dist-tests/packages/agent-service/src/store.js';
import sdk from '../dist-tests/packages/client-ts/src/index.js';
import studio from '../dist-tests/packages/client-ts/src/game-studio.js';
import fixtures from '../dist-tests/test/game-fixtures.js';
import models from '../dist-tests/test/game-blender-fixtures.js';
import glb from '../dist-tests/packages/game-production/src/glb.js';
const engineArgument=process.argv.find(value=>value.startsWith('--engine='))?.slice(9),blenderArgument=process.argv.find(value=>value.startsWith('--blender='))?.slice(10);assert.ok(engineArgument&&blenderArgument,'Use explicit --engine and --blender inputs');
const engine=path.resolve(engineArgument);await bootstrap.verifyBundle(engine,undefined,true);
const sha=data=>createHash('sha256').update(data).digest('hex'),manifestBytes=await readFile(path.join(engine,'manifest.json')),manifest=JSON.parse(manifestBytes),manifestHash=sha(manifestBytes),provision=JSON.parse(await readFile(blenderArgument));assert.equal(provision.driverSha256,manifest.files['game-editors/blender/process.py']);
const output=path.resolve('output/game-generation/packaged-model/runs',new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID().slice(0,8));await mkdir(output,{recursive:true});
const state=await mkdtemp(path.join(tmpdir(),'pmod-')),save=async(name,value)=>{const file=path.join(output,name);await mkdir(path.dirname(file),{recursive:true});await writeFile(file,Buffer.isBuffer(value)?value:JSON.stringify(value,null,2)+'\n');};
const sourceNames=['scripts/qualify-packaged-game-model.mjs','packages/client-ts/src/game-studio.ts','test/game-blender-fixtures.ts'],sources=[];for(const file of sourceNames){const data=await readFile(file);sources.push({path:file,sha256:sha(data)});await save('sources/'+file,data);}
await mkdir(path.join(state,'toolchains'),{mode:0o700});await writeFile(path.join(state,'toolchains/blender.json'),JSON.stringify(provision),{mode:0o600});
const identity=await security.ensureIdentity(state),credentials=[],store=new storage.Store(path.join(state,'metadata.sqlite'));
for(const product of ['companion-mac','companion-vscode']){const credential=await security.createClientCredential(state,{id:'packaged-model-'+product,product,profile:'fixture',workspace:'',providers:['ollama'],hostTools:[]});store.register(credential);credentials.push(credential);}store.close();
let child,logs='',passed=false;const clients=[],jobs=[],results=[],tick=()=>new Promise(resolve=>setTimeout(resolve,30));
async function boot(){
 child=spawn(path.join(engine,'node'),[path.join(engine,'service.cjs'),state],{stdio:['ignore','pipe','pipe']});child.stdout.on('data',bytes=>logs=(logs+bytes).slice(-100000));child.stderr.on('data',bytes=>logs=(logs+bytes).slice(-100000));
 let ready=false;for(let i=0;i<1000;i++){assert.equal(child.exitCode,null,'Original engine exited; inspect its log');try{if(JSON.parse(await readFile(path.join(state,'runtime.json'),'utf8')).pid===child.pid){ready=true;break;}}catch{}await tick();}assert.ok(ready,'Original engine bootstrap unconfirmed; inspect the same process');
 for(const credential of credentials){const client=new sdk.AgentClient({address:security.ipcPath(state),certificate:identity.cert,credential});await client.connect();clients.push(client);const info=await client.call('engine.info');assert.equal(info.build.manifestSha256,manifestHash);assert.equal(info.node,'22.23.4');assert.equal(info.product,credential.registration.product);}
}
async function stop(){for(const client of clients.splice(0))client.close();if(child&&child.exitCode===null&&child.signalCode===null){const exited=once(child,'exit');child.kill('SIGTERM');await exited;}}
async function settled(client,id){for(let i=0;i<8000;i++){const job=await client.getGameProduction(id);if(!['admitting','queued','running','cancelling'].includes(job.state)){assert.equal(job.state,'completed',job.error);return job;}await tick();}throw Error('Inspect original packaged job '+id+' without repeating');}
const preserve=async(client,id,folder)=>{const result=await client.getGameAssetResult(id);await save(folder+'/result.json',result);for(const file of result.files)await save(folder+'/'+file.path,await client.downloadGameAssetFile(id,file.path));return result;};
try{
 await save('control.json',{scope:'Exact packaged independent engine, authenticated products, actual isolated Blender and SDK controller; no native UI, model inference or installed acceptance',engine,manifestSha256:manifestHash,sources,provision});await boot();
 for(const [index,credential]of credentials.entries()){
  let client=clients[index];const product=credential.registration.product,session=await client.call('sessions.create',{title:'Packaged model fixture'}),document=fixtures.fixtureGameDocument();document.engine='babylon';document.brief.dimension='3d';
  const project=await client.createGameProject('model',document);await client.selectGameProject(session.id,project.id);
  const capability=(await client.gameProductionCapabilities()).assetProcessors.find(item=>item.id==='blender-model-isolated-v1');assert.ok(capability?.available,'Exact packaged Blender processor unavailable');
  const original=await client.processGameAsset('original',project.id,1,{processorId:'blender-model-isolated-v1',target:{id:'sleeve',role:'Packaged engineering model',placeholder:true},operation:models.fixtureSkinnedModelOperation()});jobs.push({product,id:original.id});await settled(client,original.id);const before=await preserve(client,original.id,product+'/original');
  const originalHash=sha(await client.downloadGameAssetFile(original.id,'assets/sleeve.glb')),operation=structuredClone(before.spec.operation);operation.materials[0].color='#4477bbff';operation.clips[0].tracks[0].keys[1].value[2]=-35;
  const command={action:'adjust-model',projectId:project.id,jobId:original.id,expectedRevision:1,requestId:'variant',operation};
  const host={canWrite:()=>true,approve:async()=>true,preview:async()=>{},exportSource:async()=>false,exportBuild:async()=>false,exportAsset:async()=>false};
  const controller=new studio.GameStudioController(client,session.id,host),process=client.processGameAsset.bind(client);let variantId;
  client.processGameAsset=async(...args)=>{const job=await process(...args);variantId=job.id;jobs.push({product,id:job.id});throw Error('Fixture lost packaged model acknowledgment');};
  await assert.rejects(controller.dispatch(command),/Fixture lost packaged model acknowledgment/);client.processGameAsset=process;assert.ok(variantId);await settled(client,variantId);
  await stop();await boot();client=clients[index];const resumed=await new studio.GameStudioController(client,session.id,host).dispatch(command);assert.equal(resumed.requestedAssetJobId,variantId);
  assert.equal((await client.listGameProduction(project.id)).jobs.length,2);assert.equal((await client.getGameProject(project.id)).revision,1);assert.equal(sha(await client.downloadGameAssetFile(original.id,'assets/sleeve.glb')),originalHash);
  const candidate=await preserve(client,variantId,product+'/variant');assert.deepEqual(candidate.spec.operation,operation);const info=glb.inspectGameGlb(await client.downloadGameAssetFile(variantId,'assets/sleeve.glb'));assert.ok(info.mixedWeightVertices>0&&info.animations>0);
  const application=await new studio.GameStudioController(client,session.id,host).dispatch({action:'apply-asset',projectId:project.id,jobId:variantId,expectedRevision:1,requestId:'apply'});assert.equal(application.project.revision,2);assert.equal(application.quality.ready,false);assert.equal((await client.listGameProjects()).projects.length,1);
  results.push({product,originalId:original.id,variantId,originalHash,revision:2,exactReplayAfterPackagedRestart:true,oneNewJob:true,namespaceIsolated:true,mixedWeightVertices:info.mixedWeightVertices,animations:info.animations,modelInvocations:0});
 }
 await bootstrap.verifyBundle(engine,undefined,true);assert.equal(sha(await readFile(path.join(engine,'manifest.json'))),manifestHash);passed=true;await save('report.json',{state:'passed',scope:'Independent packaged engine/SDK/controller, native Blender in isolation; no native GUI or installation',engineManifestSha256:manifestHash,results,immutableBundleUnchanged:true,modelInvocations:0,installed:false,published:false,fullProductAcceptance:false});console.log('PACKAGED_MODEL_QUALIFIED '+output);
}catch(error){await save('failure.json',{message:error.message});process.exitCode=1;}
finally{
 let terminal=true;try{for(const job of jobs){const client=clients[credentials.findIndex(credential=>credential.registration.product===job.product)];if(!client||!['completed','failed','cancelled'].includes((await client.getGameProduction(job.id)).state))terminal=false;}}catch{terminal=false;}
 if(terminal){await stop();if(passed)await rm(state,{recursive:true,force:true});else console.error('Failed private packaged state retained: '+state);}else console.error('Inspect original packaged service/jobs: '+state+' pid '+child?.pid);
 await save('service.log',Buffer.from(logs));await save('closure.json',{serviceClosed:terminal,originalJobsTerminal:terminal});
}
