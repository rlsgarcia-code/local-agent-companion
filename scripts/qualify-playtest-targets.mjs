// Aggregate policy through an actual packaged service. All records are synthetic;
// no person, physical observation, consent or game acceptance is certified.
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {readFile,writeFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import bootstrap from '../dist-tests/packages/client-ts/src/bootstrap.js';
import security from '../dist-tests/packages/agent-service/src/security.js';
import storage from '../dist-tests/packages/agent-service/src/store.js';
import sdk from '../dist-tests/packages/client-ts/src/index.js';
assert.equal(process.argv.length,5);
const option=name=>{const v=process.argv.find(a=>a.startsWith(name+'='));if(!v)throw Error('Missing '+name);return path.resolve(v.slice(name.length+1));};
const engine=option('--engine'),source=option('--source'),output=option('--output');await mkdir(output);
const sha=b=>createHash('sha256').update(b).digest('hex'),save=(name,data)=>writeFile(path.join(output,name),JSON.stringify(data,null,2)+'\n');
await bootstrap.verifyBundle(engine,undefined,true);
const manifestRaw=await readFile(path.join(engine,'manifest.json')),manifest=JSON.parse(manifestRaw),archiveRaw=await readFile(path.join(source,'history.json')),archive=JSON.parse(archiveRaw),blobs=new Map();
for(const digest of new Set(archive.revisions.flatMap(r=>r.document.files.map(f=>f.sha256)))){const bytes=await readFile(path.join(source,'blobs',digest));assert.equal(sha(bytes),digest);blobs.set(digest,bytes);}
const root=await mkdtemp(path.join(tmpdir(),'playtest-targets-')),actors=[],services=[];let active,mayHaveProduction=false,passed=false;
await security.ensureIdentity(root);const store=new storage.Store(path.join(root,'metadata.sqlite'));
for(const product of ['companion-mac','companion-vscode']){const credential=await security.createClientCredential(root,{id:'targets-'+product,product,profile:'synthetic-only',workspace:'',providers:['ollama'],hostTools:[]});store.register(credential);actors.push({product,credential});}store.close();
async function start(){
 assert.ok(!active||active.exitCode!==null);active=spawn(path.join(engine,'node'),[path.join(engine,'service.cjs'),root],{env:{HOME:root,PATH:'/usr/bin:/bin',TMPDIR:tmpdir(),LANG:'en_US.UTF-8'},stdio:'ignore'});services.push(active);
 let spawnError;active.once('error',error=>{spawnError=error;});
 for(let i=0;i<600;i++){
  if(spawnError)throw spawnError;assert.equal(active.exitCode,null);
  let ready=false;try{ready=JSON.parse(await readFile(path.join(root,'runtime.json'),'utf8')).pid===active.pid;}catch{}
  if(ready){for(const actor of actors){actor.client=new sdk.AgentClient({address:security.ipcPath(root),certificate:await readFile(path.join(root,'server.crt'),'utf8'),credential:actor.credential});await actor.client.connect();}return;}
  await new Promise(r=>setTimeout(r,25));
 }throw Error('Original service readiness not observed');
}
async function stop(){
 if(!active?.pid||active.exitCode!==null)return;
 assert.equal((await actors[0].client.call('engine.quiesceIfIdle',{})).accepted,true);
 for(const actor of actors)actor.client?.close();const end=once(active,'exit');active.kill('SIGTERM');await end;assert.equal(active.exitCode,0);
}
async function summary(actor,id){const snapshot=await actor.client.getGamePlaytest(id);assert.equal(snapshot.summary.source,'operator-attested');assert.equal(snapshot.summary.qualityApproved,false);return snapshot.summary;}
async function noQuality(actor){const value=await actor.client.getGameQuality(actor.project.id);assert.equal(value.ready,false);assert.equal(value.reports.length,0);assert.ok(value.blockers.includes('human-playtest-targets-unverified'));}
try{
 await save('control.json',{observerSha256:sha(await readFile(new URL(import.meta.url))),policySourceSha256:sha(await readFile('packages/game-design/src/playtest-targets.ts')),manifestSha256:sha(manifestRaw),inputArchiveSha256:sha(archiveRaw),qualificationOnly:true});
 await start();const info=await actors[0].client.call('engine.info',{});assert.equal(info.build.manifestSha256,sha(manifestRaw));assert.equal(info.node,'22.23.4');
 for(const actor of actors){
  const {client}=actor;actor.project=await client.importGameProject('synthetic-target-project',archive,blobs);
  mayHaveProduction=true;let job=await client.startGameBuild('synthetic-target-build',actor.project.id,actor.project.revision);actor.buildId=job.id;
  for(let i=0;i<1200&&!['completed','failed','cancelled'].includes(job.state);i++){await new Promise(r=>setTimeout(r,25));job=await client.getGameProduction(job.id);}
  assert.equal(job.state,'completed');mayHaveProduction=false;actor.studies=[];
  for(const good of [false,true]){
   const study=await client.createGamePlaytest({requestId:'study-'+good,buildId:job.id,title:'Synthetic numerical test, not a real playtest',audience:'Automated fixture only; no people'}),requests=[];
   for(let i=0;i<20;i++){
    const understands=i<(good?16:8),request={requestId:'record-'+good+'-'+i,studyId:study.id,participantId:randomUUID(),consentConfirmed:true,distinctParticipantConfirmed:true,understoodWithoutHelp:understands,actionSeconds:understands?30:null,experienceScore:i<(good?14:7)?4:2,environment:{platform:'synthetic',device:'no physical participant',browser:'not used',input:['keyboard']},notes:'Synthetic data, not human consent or quality evidence'};
    await client.recordGamePlaytest(request);requests.push(request);
   }
   const before=await summary(actor,study.id);assert.equal(before.active,20);assert.equal(before.requiredComprehension,16);assert.equal(before.requiredRatings,14);assert.equal(before.numericalTargetsMet,good);await noQuality(actor);
   let after=before;
   if(good){await client.withdrawGamePlaytest({requestId:'withdraw-positive',studyId:study.id,participantId:requests[0].participantId,consentWithdrawalConfirmed:true});after=await summary(actor,study.id);assert.equal(after.active,19);assert.equal(after.withdrawn,1);assert.equal(after.understoodWithin30Seconds,15);assert.equal(after.ratedAtLeastFour,13);assert.equal(after.requiredComprehension,16);assert.equal(after.requiredRatings,14);assert.equal(after.numericalTargetsMet,false);}
   actor.studies.push({id:study.id,good,before,after,requests});
  }
  await noQuality(actor);
 }
 await stop();await start();
 for(const actor of actors){
  for(const study of actor.studies){
   assert.deepEqual(await summary(actor,study.id),study.after);
   const replay=await actor.client.recordGamePlaytest(study.requests[0]);assert.equal(replay.withdrawn,study.good);
   assert.deepEqual(await summary(actor,study.id),study.after);
  }
  assert.equal((await actor.client.getGameProject(actor.project.id)).revision,3);await noQuality(actor);
 }
 await stop();await bootstrap.verifyBundle(engine,undefined,true);assert.equal(sha(await readFile(path.join(engine,'manifest.json'))),sha(manifestRaw));
 await save('report.json',{scope:'Actual packaged development service, real Phaser builds and authenticated SDK/IPC in separate Mac/VSCode namespaces. Synthetic counts only; no actual participants or quality acceptance.',manifestSha256:sha(manifestRaw),version:manifest.version,node:info.node,target:manifest.target,results:actors.map(a=>({product:a.product,projectId:a.project.id,buildId:a.buildId,studies:a.studies.map(({id,good,before,after})=>({id,syntheticTargetMetBeforeWithdrawal:good,before,after})),summaryAndWithdrawalPersistAfterRestart:true,replayDidNotDuplicateOrResurrect:true,projectRevisionUnchanged:true,noQualityReportsCreated:true})),modelCalls:0,qualityApproved:false,installedAcceptance:false});
 passed=true;console.log('PLAYTEST_TARGETS_PACKAGED_SERVICE_QUALIFIED '+output);
}catch(error){await save('failure.json',{message:error.message,originalPrivateState:root,mayHaveProduction,services:services.map(p=>({pid:p.pid,exitCode:p.exitCode}))});throw error;}
finally{
 if(active?.exitCode===null&&active.pid){if(!mayHaveProduction)try{await stop();}catch{}if(active.exitCode===null){for(const a of actors)a.client?.close();active.unref();console.error('Inspect original owned service/state: '+active.pid+' '+root);}}
 const closed=services.every(p=>p.exitCode===0);if(passed&&closed)await rm(root,{recursive:true,force:true});
 await save('closure.json',{services:services.map(p=>({pid:p.pid,exitCode:p.exitCode,signalCode:p.signalCode})),privateStateRemoved:passed&&closed});
}
