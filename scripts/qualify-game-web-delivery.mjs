// Maintainer qualification, not a client UI or a production authority.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createHash,randomUUID} from 'node:crypto';
import {readFile,writeFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import bootstrap from '../dist-tests/packages/client-ts/src/bootstrap.js';
import security from '../dist-tests/packages/agent-service/src/security.js';
import storage from '../dist-tests/packages/agent-service/src/store.js';
import sdk from '../dist-tests/packages/client-ts/src/index.js';
import fixtures from '../dist-tests/test/game-fixtures.js';
import previewModule from '../dist-tests/packages/adapter-game-browser/src/preview.js';
import {openInstalledBrowserPreview} from './game-qualification/installed-browser.mjs';

assert.equal(process.argv.length,4);
assert.ok(process.argv[2].startsWith('--engine=')&&process.argv[3].startsWith('--input='));
const engine=path.resolve(process.argv[2].slice(9)),input=path.resolve(process.argv[3].slice(8));
await bootstrap.verifyBundle(engine,undefined,true);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
// Reuse acknowledged real-codec bytes, never relabel a synthetic MP4 as AAC.
const codec=JSON.parse(await readFile(path.join(input,'phaser/codec/menu.json'),'utf8'));
assert.equal(codec.schemaVersion,1);assert.equal(codec.codec,'aac-lc');assert.equal(codec.channels,2);
const master=await readFile(path.join(input,'phaser/build/assets/menu.wav'));
const encoded=await readFile(path.join(input,'phaser/build/assets/menu.compact.m4a'));
assert.equal(sha(master),codec.sourceSha256);assert.equal(sha(encoded),codec.variants[0].sha256);
assert.equal(encoded.length,codec.variants[0].size);assert.equal(codec.sampleRate,48000);assert.equal(codec.sourceFrames,96000);
const output=path.resolve('output/playwright/game-web-delivery',new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID().slice(0,8));
await mkdir(output,{recursive:true});
const save=async(name,value)=>{const file=path.join(output,name);await mkdir(path.dirname(file),{recursive:true});await writeFile(file,Buffer.isBuffer(value)||value instanceof Uint8Array?value:JSON.stringify(value,null,2)+'\n');};
const state=await mkdtemp(path.join(tmpdir(),'game-web-delivery-'));
const identity=await security.ensureIdentity(state),store=new storage.Store(path.join(state,'metadata.sqlite'));
const credentials=[];
for(const product of ['companion-mac','companion-vscode']){
 const credential=await security.createClientCredential(state,{id:'delivery-'+product,product,profile:'fixture',workspace:'',providers:['ollama'],hostTools:[]});
 store.register(credential);credentials.push(credential);await writeFile(path.join(state,product+'-credential.json'),JSON.stringify(credential),{mode:0o600});
}
store.close();
const child=spawn(path.join(engine,'node'),[path.join(engine,'service.cjs'),state],{cwd:state,env:{HOME:state,PATH:'/usr/bin:/bin',TMPDIR:tmpdir(),LANG:'en_US.UTF-8'},stdio:'ignore'});
await save('control.json',{engine,engineManifestSha256:sha(await readFile(path.join(engine,'manifest.json'))),observerSha256:sha(await readFile(new URL(import.meta.url))),codecInput:input,ownedServicePid:child.pid,modelCalls:0});
const clients=[],projects=[],builds=[],results=[],closures=[];let preview,passed=false,stopped=false;
async function stop(){if(stopped)return;for(const client of clients)client.close();if(child.exitCode===null){const done=once(child,'exit');child.kill('SIGTERM');await done;}assert.equal(child.exitCode,0);stopped=true;}
async function build(client,project,requestId){
 const job=await client.startGameBuild(requestId,project.id,project.revision);let final;
 for(let i=0;i<2400;i++){final=await client.getGameProduction(job.id);if(['completed','failed','cancelled','awaiting_reconciliation'].includes(final.state))break;await new Promise(r=>setTimeout(r,25));}
 assert.equal(final?.state,'completed',final?.error);return {job,artifact:await client.getGameArtifact(job.id)};
}
function code(gameEngine){
 const visual=gameEngine==='phaser'?`import Phaser from 'phaser';new Phaser.Game({type:Phaser.CANVAS,canvas:document.querySelector('#game'),width:640,height:160,backgroundColor:'#172c32',scene:{create(){this.add.circle(320,80,44,0x5dc4ae);}}});`:`import {Engine,Scene,FreeCamera,Vector3,MeshBuilder,HemisphericLight} from 'babylonjs';const engine=new Engine(document.querySelector('#game'),true),scene=new Scene(engine),camera=new FreeCamera('camera',new Vector3(0,0,-6),scene);camera.setTarget(Vector3.Zero());new HemisphericLight('light',Vector3.Up(),scene);MeshBuilder.CreateSphere('fixture',{diameter:2},scene);engine.runRenderLoop(()=>scene.render());`;
 return `${visual}\nimport './style.css';import {createGameAudio} from '@companion/game-audio';
const audio=createGameAudio({assets:{theme:{path:'assets/menu.compact.m4a',bus:'music'}},states:{menu:['theme']}});
const status=document.createElement('pre');status.id='status';document.body.append(status);const error=document.createElement('p');error.id='error';document.body.append(error);
function update(){status.textContent=JSON.stringify(audio.snapshot());}
for(const [title,action]of [['Start',e=>audio.unlock(e)],['Pause',()=>audio.pause()],['Close',()=>audio.close()]]){const button=document.createElement('button');button.textContent=title;button.addEventListener('click',event=>Promise.resolve(action(event)).then(update).catch(e=>error.textContent=e.message));document.body.append(button);}
(async()=>{const levels=await(await fetch('data/levels.json')).json();if(levels.rounds.length!==3)throw Error('Missing content');await audio.preload(['theme']);await audio.setState('menu');update();document.body.dataset.ready='yes';})().catch(e=>error.textContent=e.message);`;
}
try{
 let ready=false;for(let i=0;i<600;i++){assert.equal(child.exitCode,null);try{if(JSON.parse(await readFile(path.join(state,'runtime.json'),'utf8')).pid===child.pid){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,25));}assert.ok(ready);
 for(const [index,credential]of credentials.entries()){
  const client=new sdk.AgentClient({address:security.ipcPath(state),certificate:identity.cert,credential});clients.push(client);await client.connect();
  assert.ok((await client.call('engine.info',{})).capabilities.includes('game-web-delivery-v1'));
  const gameEngine=index===0?'phaser':'babylon',product=credential.registration.product;
  const document=fixtures.fixtureGameDocument();document.title='Explicit delivery '+product;document.engine=gameEngine;if(gameEngine==='babylon')document.brief.dimension='3d';document.files=[];document.assets=[];
  const settings={schemaVersion:1,entry:'src/main.ts',engineVersion:gameEngine==='phaser'?'4.2.1':'9.35.0'};
  const source=new Map([
   ['game.web.json',[Buffer.from(JSON.stringify(settings)),'application/json']],
   ['src/main.ts',[Buffer.from(code(gameEngine)),'text/plain']],
   ['src/style.css',[Buffer.from('body{font:14px system-ui;background:#edf2f4;color:#173138;overflow:auto;padding:20px;box-sizing:border-box}#game{height:160px;width:640px;max-width:100%}button{padding:10px;margin:12px 12px 0 0}pre{white-space:pre-wrap;overflow-wrap:anywhere}'),'text/css']],
   ['assets/menu.wav',[master,'audio/wav']],['assets/menu.compact.m4a',[encoded,'audio/mp4']],
   ['assets/menu.encoded.json',[Buffer.from(JSON.stringify(codec)),'application/json']],
   ['assets/original/COPYING.txt',[Buffer.from('Full fixture notice\nAuthored synthetic sine input, not finished game music.\n'),'text/plain']],
   ['data/levels.json',[Buffer.from('{"rounds":[1,2,3]}'),'application/json']],
   ['assets/unused.bin',[Buffer.alloc(1024*1024,73),'application/octet-stream']],
  ]);
  for(const [name,[bytes,mime]]of source)document.files.push(await client.uploadGameFile(name,bytes,mime));
  const origin={kind:'procedural',source:'Reused acknowledged sine fixture',author:'Qualification',license:'Synthetic qualification input; declared-unverified',referenceIds:[]};
  document.assets=[{id:'master',kind:'audio',role:'Preserved master',placeholder:true,files:['assets/menu.wav','assets/original/COPYING.txt'],origin},
   {id:'delivery',kind:'audio',role:'Reused actual AAC variant',placeholder:true,files:['assets/menu.compact.m4a','assets/menu.encoded.json'],origin:{...origin,referenceIds:['master']}}];
  let project=await client.createGameProject('delivery-create',document);projects.push({client,projectId:project.id});
  const baseline=await build(client,project,'baseline');assert.ok(baseline.artifact.files.some(f=>f.path==='assets/menu.wav'));
  settings.delivery={schemaVersion:1,files:['assets/menu.compact.m4a','data/levels.json']};
  let revision=await client.getGameRevision(project.id);const config=await client.uploadGameFile('game.web.json',Buffer.from(JSON.stringify(settings)),'application/json');
  revision.document.files=revision.document.files.map(f=>f.path===config.path?config:f);project=await client.commitGameRevision(project.id,'select-delivery',project.revision,revision.document,'Select exact exported resources');
  const selected=await build(client,project,'selected'),files=new Map();
  for(const file of selected.artifact.files){const bytes=await client.downloadGameArtifactFile(selected.job.id,file.path);assert.equal(sha(bytes),file.sha256);files.set(file.path,bytes);await save(product+'/build/'+file.path,bytes);}
  for(const absent of ['assets/menu.wav','assets/unused.bin'])assert.equal(files.has(absent),false);
  for(const retained of ['assets/menu.compact.m4a','assets/original/COPYING.txt','assets/menu.encoded.json','data/levels.json','engine/GAME-AUDIO-LICENSE.txt'])assert.ok(files.has(retained));
  assert.deepEqual(files.get('assets/original/COPYING.txt'),source.get('assets/original/COPYING.txt')[0]);
  const report=JSON.parse(Buffer.from(files.get('engine/COMPANION-DELIVERY.json')).toString());assert.equal(report.sourceHash,project.contentHash);assert.equal(report.assets.length,2);assert.equal(report.licenseStatus,'declared-unverified');
  const archive=await client.exportGameProject(project.id),blobs=new Map();
  for(const revision of archive.revisions)for(const file of revision.document.files)if(!blobs.has(file.sha256)){const bytes=await client.downloadGameFile(project.id,file.path,revision.revision);assert.equal(sha(bytes),file.sha256);blobs.set(file.sha256,bytes);await save(product+'/source-blobs/'+file.sha256,bytes);}
  const imported=await client.importGameProject('roundtrip-source',archive,blobs);assert.equal(imported.contentHash,project.contentHash);assert.equal(imported.revision,project.revision);
  assert.deepEqual(await client.downloadGameFile(imported.id,'assets/menu.wav'),master);
  assert.deepEqual(await client.importGameProject('roundtrip-source',archive,blobs),imported);
  revision=await client.getGameRevision(project.id);revision.document.title+=' · later work';project=await client.commitGameRevision(project.id,'later-work',project.revision,revision.document,'Preserve work after selection');
  revision=await client.getGameRevision(project.id);const legacyConfig=document.files.find(f=>f.path==='game.web.json');revision.document.files=revision.document.files.map(f=>f.path===legacyConfig.path?legacyConfig:f);
  project=await client.commitGameRevision(project.id,'restore-default',project.revision,revision.document,'Remove only explicit delivery selection');
  assert.ok(project.title.endsWith('later work'));const restored=await build(client,project,'restored');
  assert.ok(restored.artifact.files.some(f=>f.path==='assets/menu.wav'));assert.ok(restored.artifact.files.some(f=>f.path==='assets/unused.bin'));assert.ok(!restored.artifact.files.some(f=>f.path==='engine/COMPANION-DELIVERY.json'));
  assert.deepEqual(await client.getGameArtifact(selected.job.id),selected.artifact);assert.equal((await client.getGameQuality(project.id)).ready,false);
  const total=artifact=>artifact.files.reduce((sum,f)=>sum+f.size,0);assert.ok(total(selected.artifact)<total(baseline.artifact));
  const result={product,gameEngine,projectId:project.id,baselineBytes:total(baseline.artifact),selectedBytes:total(selected.artifact),omittedMasterBytes:master.length,omittedUnusedBytes:1024*1024,baselineJobId:baseline.job.id,selectedJobId:selected.job.id,restoredJobId:restored.job.id,noticeBytesPreserved:true,sourceRoundtripIdempotent:true,importedProjectId:imported.id,restoredRevision:project.revision,laterTitlePreserved:true,oldArtifactUnchanged:true,qualityApproved:false};
  results.push(result);builds.push({product,gameEngine,artifact:selected.artifact,files});await save(product+'/archive.json',archive);await save(product+'/artifacts.json',{baseline:baseline.artifact,selected:selected.artifact,restored:restored.artifact});await save('progress.json',results);
 }
 await stop(); // Exported selected bytes alone are used from this point onward.
 for(const {product,gameEngine,artifact,files}of builds)for(const name of ['chromium','firefox','webkit']){
  const options={artifact,readFile:async file=>files.get(file),signal:new AbortController().signal};preview=name==='chromium'?await previewModule.openGamePreview({...options,headless:true}):await openInstalledBrowserPreview({...options,name});const page=preview.page;
  const ownedBrowser=page.context().browser(),browserVersion=ownedBrowser.version();
  await page.waitForFunction(()=>document.body.dataset.ready==='yes');assert.equal(await page.locator('#error').textContent(),'');
  const snapshot=async()=>JSON.parse(await page.locator('#status').textContent());assert.equal((await snapshot()).phase,'locked');assert.equal((await snapshot()).loaded.length,1);
  await page.getByRole('button',{name:'Start',exact:true}).click();await page.waitForFunction(()=>JSON.parse(document.querySelector('#status').textContent).phase==='playing');assert.equal((await snapshot()).contextState,'running');
  await page.getByRole('button',{name:'Pause',exact:true}).click();await page.waitForFunction(()=>JSON.parse(document.querySelector('#status').textContent).phase==='paused');
  await page.screenshot({path:path.join(output,product+'-'+name+'.png'),fullPage:true});
  await page.getByRole('button',{name:'Close',exact:true}).click();await page.waitForFunction(()=>JSON.parse(document.querySelector('#status').textContent).phase==='closed');
  assert.deepEqual(preview.errors,[]);assert.deepEqual(preview.blocked,[]);const browser=preview.browserMetadata,closure=await preview.close();preview=undefined;assert.equal(ownedBrowser.isConnected(),false);
  if(browser)await save(product+'-'+name+'-browser.json',{browser,closure});closures.push({product,gameEngine,name,browserVersion,serviceExitCode:child.exitCode,browserClosed:true,selectedAacPreloaded:true,gesturePlayback:true,pause:true,close:true});await save('closures.json',closures);console.log('WEB_DELIVERY_PLAYER '+product+' '+gameEngine+' '+name);
 }
 await bootstrap.verifyBundle(engine,undefined,true);
 await save('report.json',{scope:'Real packaged Node/API/TLS and Phaser/Babylon compilers, source-domain import/restore, actual prior AAC codec bytes, six isolated native browser fixtures after service shutdown. Direct authenticated Mac/VSCode namespaces, not installed interface/rollback or physical/artistic/human acceptance.',engineManifestSha256:sha(await readFile(path.join(engine,'manifest.json'))),codecInput:{directory:input,masterSha256:sha(master),variantSha256:sha(encoded),reportSha256:sha(await readFile(path.join(input,'phaser/codec/menu.json')))},results,closures,modelCalls:0,installs:0});passed=true;console.log('GAME_WEB_DELIVERY_QUALIFIED '+output);
}catch(error){await save('failure.json',{message:error.message,results,closures,ownedServicePid:child.pid});if(preview)try{await preview.page.screenshot({path:path.join(output,'failure.png'),fullPage:true});}catch{}throw error;}
finally{
 await preview?.close();const unresolved=[];
 if(!stopped)for(const {client,projectId}of projects)try{for(const job of (await client.listGameProduction(projectId)).jobs)if(!['completed','failed','cancelled'].includes(job.state))unresolved.push({id:job.id,state:job.state});}catch{unresolved.push({projectId,state:'inspection-unavailable'});}
 if(unresolved.length){for(const client of clients)client.close();child.unref();await save('closure.json',{servicePreservedForInspection:true,ownedServicePid:child.pid,unresolved});console.error('Inspect original fixture at '+state);}
 else{await stop();await save('closure.json',{serviceExitCode:child.exitCode,browsersClosed:true});if(passed)await rm(state,{recursive:true,force:true});else console.error('Failed fixture preserved: '+state);}
}
