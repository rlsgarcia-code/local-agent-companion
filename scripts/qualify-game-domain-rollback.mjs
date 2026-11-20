// Explicit disposable binary rollback, without models or installed activation.
// The old signed runtime need not implement games: its refusal must preserve
// all newer domain data, which the exact current runtime must recover.
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {readFile,writeFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import verification from './smoke-engine-rollback.cjs';
import bootstrap from '../dist-tests/packages/client-ts/src/bootstrap.js';
import security from '../dist-tests/packages/agent-service/src/security.js';
import storage from '../dist-tests/packages/agent-service/src/store.js';
import sdk from '../dist-tests/packages/client-ts/src/index.js';
import drafts from '../dist-tests/packages/client-ts/src/game-studio-file-drafts.js';
import draftTypes from '../dist-tests/packages/client-ts/src/game-studio-drafts.js';
const names=['--engine','--previous-engine','--previous-sdk','--source','--output'];
assert.equal(process.argv.length,names.length+2);
const option=name=>{const v=process.argv.find(a=>a.startsWith(name+'='));if(!v)throw Error('Missing '+name);return path.resolve(v.slice(name.length+1));};
const [engine,previousEngine,previousSdk,source,output]=names.map(option);
await mkdir(output); // Never replace another run or its original state.
const sha=b=>createHash('sha256').update(b).digest('hex');
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const hash=v=>sha(Buffer.from(JSON.stringify(canonical(v))));
const save=(name,value)=>writeFile(path.join(output,name),JSON.stringify(value,null,2)+'\n');
const root=await mkdtemp(path.join(tmpdir(),'game-domain-rollback-')),state=path.join(root,'state'),workspace=path.join(root,'workspace');
await mkdir(state,{mode:0o700});await mkdir(workspace,{mode:0o700});
const services=[],actors=[];let active,passed=false,mayHaveProduction=false;
async function connect(actor,Client=sdk.AgentClient){
 const client=new Client({address:security.ipcPath(state),certificate:await readFile(path.join(state,'server.crt'),'utf8'),credential:actor.credential});await client.connect();actor.client=client;return client;
}
async function start(bundle,label,Client=sdk.AgentClient){
 assert.ok(!active||active.child.exitCode!==null,'Stop/quiesce original process before another runtime starts');
 const child=spawn(path.join(bundle,'node'),[path.join(bundle,'service.cjs'),state],{env:{HOME:root,PATH:'/usr/bin:/bin',TMPDIR:tmpdir(),LANG:'en_US.UTF-8'},stdio:'ignore'});
 const record={child,label,bundle};services.push(record);active=record;
 for(let i=0;i<600;i++){
  if(child.exitCode!==null)throw Error('Owned service exited during startup: '+label);
  let ready=false;try{ready=JSON.parse(await readFile(path.join(state,'runtime.json'),'utf8')).pid===child.pid;}catch{}
  if(ready){for(const actor of actors)await connect(actor,Client);return actors[0].client.call('engine.info',{});}
  await new Promise(resolve=>setTimeout(resolve,25));
 }
 throw Error('Original owned service startup not observed: '+label);
}
async function stop(){
 if(!active||active.child.exitCode!==null)return;
 assert.equal((await actors[0].client.call('engine.quiesceIfIdle',{})).accepted,true,'Never rollback with live/unknown work');
 for(const actor of actors){actor.client?.close();actor.client=undefined;}
 const end=once(active.child,'exit');active.child.kill('SIGTERM');await end;assert.equal(active.child.exitCode,0);
}
function gameTables(){
 const db=new Database(path.join(state,'metadata.sqlite'),{readonly:true,fileMustExist:true});
 try{return Object.fromEntries(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'game_%' ORDER BY name").all().map(({name})=>{
  const rows=db.prepare('SELECT * FROM "'+name.replaceAll('"','""')+'"').all().map(canonical).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return [name,{rows:rows.length,sha256:hash(rows)}];
 }));}finally{db.close();}
}
async function inspect(actor){
 const {client,project,session,study,artifact}=actor;
 const archive=await client.exportGameProject(project.id);
 for(const revision of archive.revisions)for(const file of revision.document.files){
  const bytes=await client.downloadGameFile(project.id,file.path,revision.revision);assert.equal(bytes.length,file.size);assert.equal(sha(bytes),file.sha256);
 }
 const actualArtifact=await client.getGameArtifact(artifact.jobId);assert.deepEqual(actualArtifact,artifact);
 for(const file of artifact.files){const bytes=await client.downloadGameArtifactFile(artifact.jobId,file.path);assert.equal(bytes.length,file.size);assert.equal(sha(bytes),file.sha256);}
 const jobs=(await client.listGameProduction(project.id)).jobs;assert.equal(jobs.length,1);assert.equal(jobs[0].state,'completed');
 const playtest=await client.exportGamePlaytest(study.id,true);assert.equal(playtest.summary.qualityApproved,false);
 // Export time belongs to this new export, not to persisted study/observations.
 // Assert it separately; every persisted field still participates in the hash.
 const {exportedAt,...playtestDomain}=playtest;
 assert.ok(Number.isSafeInteger(exportedAt)&&exportedAt>=study.createdAt&&exportedAt>=(actor.exportTimes?.at(-1)??0));
 (actor.exportTimes??=[]).push(exportedAt);
 const domain=await client.exportSession(session.id);
 const storedDraft=await actor.drafts.dispatch({action:'draft-read'});
 const quality=await client.getGameQuality(project.id);assert.equal(quality.ready,false);
 return {project:await client.getGameProject(project.id),archiveSha256:hash(archive),sourceFilesAcrossRevisions:archive.revisions.reduce((n,r)=>n+r.document.files.length,0),artifactSha256:hash(actualArtifact),jobsSha256:hash(jobs),playtestDomainSha256:hash(playtestDomain),sessionDomainSha256:hash(domain),draftSha256:hash(storedDraft),qualitySha256:hash(quality)};
}
try{
 const productionKey=await readFile('release-keys/companion-ed25519.pub','utf8');
 const old=await verification.verifiedSdk(previousSdk,productionKey);
 await old.verifyBundle(previousEngine,productionKey,false);await bootstrap.verifyBundle(engine,undefined,true);
 const currentRaw=await readFile(path.join(engine,'manifest.json')),priorRaw=await readFile(path.join(previousEngine,'manifest.json'));
 const currentManifest=JSON.parse(currentRaw),priorManifest=JSON.parse(priorRaw);assert.notEqual(currentManifest.version,priorManifest.version);assert.equal(currentManifest.development,true);
 const archiveBytes=await readFile(path.join(source,'history.json')),archive=JSON.parse(archiveBytes),blobs=new Map();
 for(const digest of new Set(archive.revisions.flatMap(r=>r.document.files.map(f=>f.sha256)))){const bytes=await readFile(path.join(source,'blobs',digest));assert.equal(sha(bytes),digest);blobs.set(digest,bytes);}
 await save('control.json',{observerSha256:sha(await readFile(new URL(import.meta.url))),sdkVerifierSha256:sha(await readFile(new URL('./smoke-engine-rollback.cjs',import.meta.url))),currentManifestSha256:sha(currentRaw),previousManifestSha256:sha(priorRaw),previousSdkManifestSha256:sha(await readFile(path.join(previousSdk,'manifest.json'))),inputArchiveSha256:sha(archiveBytes),blobHashes:[...blobs.keys()],currentIsDevelopment:true,previousIsOfficiallySigned:true});
 await security.ensureIdentity(state);
 const store=new storage.Store(path.join(state,'metadata.sqlite'));
 for(const product of ['companion-mac','companion-vscode']){
  const credential=await security.createClientCredential(state,{id:'rollback-'+product,product,profile:'domain-rollback-fixture',workspace,providers:['ollama'],hostTools:[]});store.register(credential);actors.push({product,credential});
 }store.close();
 const initial=await start(engine,'current-before-rollback');
 for(const actor of actors){
  const {client}=actor;actor.session=await client.importSession('post-update-public-history',{schemaVersion:1,messages:[{id:'public-'+actor.product,role:'user',content:'Synthetic history created after the update. No model was called.'}]});
  actor.sessionBefore=hash(await client.exportSession(actor.session.id));
  actor.project=await client.importGameProject('post-update-game-import',archive,blobs);assert.equal(actor.project.revision,3);
  assert.equal((await client.importGameProject('post-update-game-import',archive,blobs)).id,actor.project.id);
  await client.selectGameProject(actor.session.id,actor.project.id);
  const revision=await client.getGameRevision(actor.project.id);revision.document.title='New history survives rollback · '+actor.product;
  actor.project=await client.commitGameRevision(actor.project.id,'post-update-edit',3,revision.document,'Synthetic edit created after update');assert.equal(actor.project.revision,4);
  mayHaveProduction=true;let job=await client.startGameBuild('post-update-build',actor.project.id,4);actor.buildId=job.id;
  for(let i=0;i<1200&&!['completed','failed','cancelled'].includes(job.state);i++){await new Promise(r=>setTimeout(r,25));job=await client.getGameProduction(job.id);}
  assert.equal(job.state,'completed',JSON.stringify({id:job.id,state:job.state,error:job.error}));mayHaveProduction=false;
  actor.artifact=await client.getGameArtifact(job.id);
  actor.study=await client.createGamePlaytest({requestId:'synthetic-study',buildId:job.id,title:'Synthetic rollback study, no real participants',audience:'Automated fixture only'});
  await client.recordGamePlaytest({requestId:'synthetic-observation',studyId:actor.study.id,participantId:randomUUID(),consentConfirmed:true,distinctParticipantConfirmed:true,understoodWithoutHelp:false,actionSeconds:null,experienceScore:2,environment:{platform:'Synthetic, not physical',device:'Fixture only',browser:'No browser used',input:['keyboard']},notes:'Synthetic data only. No human consent, play or quality acceptance is claimed.'});
  actor.drafts=drafts.fileGameStudioDraftStore(path.join(root,actor.product),draftTypes.gameStudioDraftKey(actor.credential.registration,actor.session.id));
  await actor.drafts.dispatch({action:'draft-write',expectedRevision:0,value:{schemaVersion:1,libraryImport:null,mediaEdit:null,designEdit:null,deliveryEdit:{schemaVersion:1,projectId:actor.project.id,expectedRevision:4,selected:['assets/menu.compact.m4a'],note:'Unsent new-format choice; never dispatched'},audioEncodeEdit:{source:'assets/menu.wav',bitrate:96,note:'Unsent choice; never encoded'}}});
  actor.before=await inspect(actor);
 }
 assert.notEqual(actors[0].project.id,actors[1].project.id);
 for(const actor of actors)await assert.rejects(actor.client.getGameProject(actors.find(a=>a!==actor).project.id));
 await stop();const tablesBefore=gameTables();assert.ok(Object.keys(tablesBefore).length>5);
 const prior=await start(previousEngine,'previous-signed',old.Client);
 const refusals=[];
 for(const actor of actors){
  assert.equal(hash(await actor.client.exportSession(actor.session.id)),actor.sessionBefore);
  let refusal;try{await actor.client.call('games.projects.get',{id:actor.project.id});}catch(error){refusal={code:error.code,message:error.message};}
  assert.ok(refusal&&(refusal.code===-32601||/unknown.*method|method.*(?:not found|not supported)/i.test(refusal.message)),'Previous runtime must explicitly refuse an unsupported method, not fail for another reason');refusals.push({product:actor.product,...refusal});
  const later=await actor.client.importSession('created-during-explicit-rollback',{schemaVersion:1,messages:[{id:'rollback-'+actor.product,role:'user',content:'Synthetic public history created while the old signed engine was active.'}]});actor.rollbackSession=later;actor.rollbackSessionHash=hash(await actor.client.exportSession(later.id));
 }
 await stop();const tablesAfterOld=gameTables();assert.deepEqual(tablesAfterOld,tablesBefore,'Old engine must preserve every newer game table and receipt');
 const reactivated=await start(engine,'current-reactivated');
 for(const actor of actors){
  assert.deepEqual(await inspect(actor),actor.before);
  assert.equal(hash(await actor.client.exportSession(actor.rollbackSession.id)),actor.rollbackSessionHash);
  assert.equal((await actor.client.importGameProject('post-update-game-import',archive,blobs)).id,actor.project.id);
  const replay=await actor.client.startGameBuild('post-update-build',actor.project.id,4);assert.equal(replay.id,actor.buildId);assert.equal(replay.state,'completed');
  assert.equal((await actor.client.listGameProduction(actor.project.id)).jobs.length,1,'Replay must not create another build');
 }
 await stop();assert.deepEqual(gameTables(),tablesBefore);
 await save('playtest-export-times.json',{scope:'New export timestamps only; persisted study/response fields retain exact hashes.',products:actors.map(a=>({product:a.product,exportedAt:a.exportTimes}))});
 await save('report.json',{scope:'Disposable real-binary domain rollback: current development engine, official signed previous engine and current again. Not installed apps, checkpoint conversion or full-profile rollback.',current:{version:initial.version,build:initial.build},previous:{version:prior.version,build:prior.build},reactivated:{version:reactivated.version,build:reactivated.build},products:actors.map(a=>({product:a.product,projectId:a.project.id,revision:a.project.revision,...a.before,postUpdateSessionPreserved:true,sessionCreatedDuringRollbackPreserved:true,idempotentImportAndBuildReplay:true})),gameTables:tablesBefore,oldGameMethodRefusals:refusals,sourceBlobCount:blobs.size,sourceRevisionCount:archive.revisions.length,privateNewFormatDraftBytesPreserved:true,oldClientDraftRenderingTested:false,productionKeyChanged:false,modelCalls:0,installationAllowed:false,qualityApproved:false});
 passed=true;console.log('GAME_DOMAIN_BINARY_ROLLBACK_QUALIFIED '+output);
}catch(error){await save('failure.json',{message:error.message,originalPrivateState:root,services:services.map(s=>({label:s.label,pid:s.child.pid,exitCode:s.child.exitCode})),mayHaveProduction});throw error;}
finally{
 if(active?.child.exitCode===null){
  if(!mayHaveProduction)try{await stop();}catch{}
  if(active.child.exitCode===null){for(const a of actors)a.client?.close();active.child.unref();console.error('Inspect original owned service/state: '+active.child.pid+' '+root);}
 }
 const closed=services.every(s=>s.child.exitCode===0);
 if(passed&&closed)await rm(root,{recursive:true,force:true});
 await save('closure.json',{services:services.map(s=>({label:s.label,pid:s.child.pid,exitCode:s.child.exitCode,signalCode:s.child.signalCode})),privateStateRemoved:passed&&closed});
}
