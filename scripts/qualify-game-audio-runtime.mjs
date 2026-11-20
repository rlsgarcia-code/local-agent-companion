// Native Web Audio observations on synthetic sources, not hearing/game acceptance.
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
assert.ok([3,4].includes(process.argv.length));assert.ok(process.argv[2].startsWith('--engine='));assert.ok(process.argv.length===3||process.argv[3].startsWith('--codec='));const engine=path.resolve(process.argv[2].slice(9)),codecPath=process.argv[3]?.slice(8);await bootstrap.verifyBundle(engine,undefined,true);
const audioLock=JSON.parse(await readFile(path.join(engine,'game-runtimes/audio.lock.json'),'utf8'));
const output=path.resolve(codecPath?'output/playwright/game-audio-runtime-aac':'output/playwright/game-audio-runtime',new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID().slice(0,8));await mkdir(output,{recursive:true});
const state=await mkdtemp(path.join(tmpdir(),'game-audio-runtime-')),identity=await security.ensureIdentity(state),store=new storage.Store(path.join(state,'metadata.sqlite'));
const credential=await security.createClientCredential(state,{id:'game-audio-runtime',product:'companion-mac',profile:'fixture',workspace:'',providers:['ollama'],hostTools:[]});store.register(credential);store.close();
if(codecPath){await mkdir(path.join(state,'toolchains'),{mode:0o700});await writeFile(path.join(state,'toolchains/audio-codec.json'),await readFile(path.resolve(codecPath)),{mode:0o600});}
const save=async(name,value)=>{const file=path.join(output,name);await mkdir(path.dirname(file),{recursive:true});await writeFile(file,Buffer.isBuffer(value)?value:JSON.stringify(value,null,2)+'\n');};
const child=spawn(path.join(engine,'node'),[path.join(engine,'service.cjs'),state],{cwd:state,env:{HOME:state,PATH:'/usr/bin:/bin',TMPDIR:tmpdir(),LANG:'en_US.UTF-8'},stdio:'ignore'});
let client,preview,activeBuild,passed=false;const results=[],builds=[],closures=[],encodedCandidates=[];
async function stop(){client?.close();client=undefined;if(child.exitCode===null){const done=once(child,'exit');child.kill('SIGTERM');await done;}assert.equal(child.exitCode,0);}
function wave(frequency,rate=22050,channels=1){const frames=rate*2,b=Buffer.alloc(44+frames*channels*2);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(channels,22);b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*channels*2,28);b.writeUInt16LE(channels*2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(frames*channels*2,40);for(let i=0;i<frames;i++)for(let channel=0;channel<channels;channel++)b.writeInt16LE(Math.round(12000*Math.sin(2*Math.PI*frequency*i/rate)),44+(i*channels+channel)*2);return b;}
const inputs=codecPath?[['menu',220,48000,2],['play',660,44100,1],['wind',110,22050,1],['hit',880,22050,2],['extraa',330,44100,2],['extrab',440,48000,1]]:[['menu',220,22050,1],['play',660,22050,1],['wind',110,22050,1],['hit',880,22050,1]];
const settings={assets:Object.fromEntries(inputs.map(([name])=>[name,{path:'assets/'+name+(codecPath?'.compact.m4a':'.wav'),bus:name==='menu'||name==='play'?'music':name==='wind'?'ambience':'effects',gain:name==='wind'?.1:name==='menu'||name==='play'?.5:.4,...(name==='hit'?{maxInstances:2}:{})}])),states:{menu:['menu','wind'],play:['play','wind']}};
const audioSource=`import {createGameAudio,audioRuntimeVersion} from '@companion/game-audio';
const settings=${JSON.stringify(settings)};
const audio=createGameAudio(settings);let rejected=false,lastEffect=null;const status=document.createElement('pre');status.id='status';document.body.append(status);
function update(){status.textContent=JSON.stringify({version:audioRuntimeVersion,rejected,lastEffect,...audio.snapshot()});}
function button(name,action){const node=document.createElement('button');node.textContent=name;node.addEventListener('click',event=>Promise.resolve(action(event)).then(update).catch(error=>{document.querySelector('#error').textContent=error.message;}));document.body.append(node);}
const error=document.createElement('p');error.id='error';document.body.append(error);
button('Start sound',event=>audio.unlock(event));button('Play state',()=>audio.setState('play',{fadeMs:120}));button('Menu state',()=>audio.setState('menu',{fadeMs:120}));button('Hit',async()=>{lastEffect=await audio.playEffect('hit');});button('Mute',()=>audio.setMuted(true));button('Unmute',()=>audio.setMuted(false));button('Pause',()=>audio.pause());button('Resume',event=>audio.resume(event));button('Close',()=>audio.close());
const offlineResult=document.createElement('pre');offlineResult.id='offline';document.body.append(offlineResult);
button('Offline graph',async()=>{
 const context=new OfflineAudioContext(2,48000,48000);let menuSamples,playSamples,mutedSamples,offlineMode;
 if(typeof context.suspend==='function'){
  offlineMode='single-graph-scheduled-transitions';const mixer=createGameAudio({...settings,context});await mixer.preload(Object.keys(settings.assets));await mixer.setState('menu');await mixer.unlock();
  const change=context.suspend(.3).then(async()=>{await mixer.setState('play',{fadeMs:100});await context.resume();});
  const mute=context.suspend(.7).then(async()=>{mixer.setMuted(true);await context.resume();});
  const rendered=await context.startRendering();await Promise.all([change,mute]);menuSamples=playSamples=mutedSamples=rendered.getChannelData(0);await mixer.close();
 }else{
  // Observed Firefox does not implement OfflineAudioContext.suspend. Keep its
  // live transition checks, and identify these separate static native graphs.
  offlineMode='three-static-native-graphs-no-suspend-api';
  const render=async(ctx,name,muted)=>{const mixer=createGameAudio({...settings,context:ctx});await mixer.setState(name);await mixer.unlock();mixer.setMuted(muted);const out=await ctx.startRendering();const samples=out.getChannelData(0);await mixer.close();return samples;};
  menuSamples=await render(context,'menu',false);playSamples=await render(new OfflineAudioContext(2,48000,48000),'play',false);mutedSamples=await render(new OfflineAudioContext(2,48000,48000),'play',true);
 }
 const amplitude=(samples,frequency,start,end)=>{let sin=0,cos=0,n=0;for(let i=Math.round(start*48000);i<Math.round(end*48000);i++){sin+=samples[i]*Math.sin(2*Math.PI*frequency*i/48000);cos+=samples[i]*Math.cos(2*Math.PI*frequency*i/48000);n++;}return 2*Math.hypot(sin,cos)/n;};
 let tail=0,peak=0;for(let i=0;i<menuSamples.length;i++){peak=Math.max(peak,Math.abs(menuSamples[i]),Math.abs(playSamples[i]));if(i>=40800)tail+=mutedSamples[i]*mutedSamples[i];}
 offlineResult.textContent=JSON.stringify({sampleRate:48000,channels:2,offlineMode,menu220:amplitude(menuSamples,220,.15,.25),menu660:amplitude(menuSamples,660,.15,.25),play220:amplitude(playSamples,220,.55,.65),play660:amplitude(playSamples,660,.55,.65),mutedRms:Math.sqrt(tail/(mutedSamples.length-40800)),peak});
});
(async()=>{try{await audio.unlock();}catch{rejected=true;}await audio.preload(Object.keys(settings.assets));await audio.setState('menu');update();document.body.dataset.ready='yes';})().catch(error=>{document.querySelector('#error').textContent=error.message;});`;
function source(gameEngine){const visual=gameEngine==='phaser'?`import Phaser from 'phaser';new Phaser.Game({type:Phaser.CANVAS,canvas:document.querySelector('#game'),width:640,height:160,backgroundColor:'#172c32',scene:{create(){this.add.circle(320,80,44,0x5dc4ae);}}});`:`import {Engine,Scene,FreeCamera,Vector3,MeshBuilder,HemisphericLight} from 'babylonjs';const engine=new Engine(document.querySelector('#game'),true),scene=new Scene(engine),camera=new FreeCamera('camera',new Vector3(0,0,-6),scene);camera.setTarget(Vector3.Zero());new HemisphericLight('light',Vector3.Up(),scene);MeshBuilder.CreateSphere('fixture',{diameter:2},scene);engine.runRenderLoop(()=>scene.render());`;return `import './style.css';${visual}\n${audioSource}`;}
try{
 let ready=false;for(let i=0;i<600;i++){assert.equal(child.exitCode,null);try{if(JSON.parse(await readFile(path.join(state,'runtime.json'),'utf8')).pid===child.pid){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,25));}assert.ok(ready);
 client=new sdk.AgentClient({address:security.ipcPath(state),certificate:identity.cert,credential});await client.connect();
 if(codecPath)assert.ok((await client.gameProductionCapabilities()).assetProcessors.some(item=>item.id==='audio-codec-isolated-v1'&&item.available));
 for(const gameEngine of ['phaser','babylon']){
  const document=fixtures.fixtureGameDocument();document.title='Native audio '+gameEngine;document.engine=gameEngine;if(gameEngine==='babylon')document.brief.dimension='3d';document.files=[];document.assets=[];
  for(const [name,text]of [['game.web.json',JSON.stringify({schemaVersion:1,entry:'src/main.ts',engineVersion:gameEngine==='phaser'?'4.2.1':'9.35.0'})],['src/main.ts',source(gameEngine)],['src/style.css','body{font:13px system-ui;background:#eef1f6;color:#172c32;overflow:auto;padding:16px;box-sizing:border-box}#game{height:160px;width:640px;max-width:100%}button{padding:8px;margin:8px 8px 0 0}pre{white-space:pre-wrap;overflow-wrap:anywhere}#error{color:#a00020}']])document.files.push(await client.uploadGameFile(name,Buffer.from(text),name.endsWith('.json')?'application/json':'text/plain'));
  for(const [name,frequency,rate,channels]of inputs){document.files.push(await client.uploadGameFile('assets/'+name+'.wav',wave(frequency,rate,channels),'audio/wav'));document.assets.push({id:codecPath?'master-'+name:name,kind:'audio',role:'Synthetic native-audio input',placeholder:true,files:['assets/'+name+'.wav'],origin:{kind:'procedural',source:'Authored sine fixture',author:'Test',license:'Synthetic test data',referenceIds:[]}});}
  let project=await client.createGameProject('audio-'+gameEngine,document);
  if(codecPath)for(const [name,,rate,channels]of inputs){
   const job=await client.processGameAsset('encode-'+gameEngine+'-'+name,project.id,project.revision,{processorId:'audio-codec-isolated-v1',target:{id:name,role:'Synthetic delivery '+name,placeholder:true},operation:{type:'audio.encode',codec:'aac-lc',source:{assetId:'master-'+name,path:'assets/'+name+'.wav'},outputBase:'assets/'+name,variants:[{id:'compact',bitrateKbps:64}]}});activeBuild=job.id;
   let done;for(let i=0;i<10000;i++){done=await client.getGameProduction(job.id);if(['completed','failed','cancelled','awaiting_reconciliation'].includes(done.state))break;await new Promise(r=>setTimeout(r,25));}if(['completed','failed','cancelled'].includes(done?.state))activeBuild=undefined;assert.equal(done?.state,'completed',done?.error);
   const report=JSON.parse(Buffer.from(await client.downloadGameAssetFile(job.id,'assets/'+name+'.encoded.json')).toString('utf8'));assert.equal(report.sampleRate,rate);assert.equal(report.channels,channels);assert.equal(report.sourceFrames,rate*2);await save(gameEngine+'/codec/'+name+'.json',report);project=await client.applyGameAsset('apply-'+gameEngine+'-'+name,job.id,project.revision);encodedCandidates.push({gameEngine,name,jobId:job.id,report});console.log('AAC_MIXER_INPUT '+gameEngine+' '+name+' '+rate+' '+channels);
  }
  const build=await client.startGameBuild('audio-build-'+gameEngine,project.id,project.revision);activeBuild=build.id;
  let done;for(let i=0;i<2400;i++){done=await client.getGameProduction(build.id);if(['completed','failed','cancelled','awaiting_reconciliation'].includes(done.state))break;await new Promise(r=>setTimeout(r,25));}assert.equal(done?.state,'completed',done?.error);activeBuild=undefined;
  const artifact=await client.getGameArtifact(build.id),files=new Map();for(const file of artifact.files){const bytes=await client.downloadGameArtifactFile(build.id,file.path);files.set(file.path,bytes);await save(gameEngine+'/build/'+file.path,bytes);}assert.ok(files.has('engine/GAME-AUDIO-LICENSE.txt'));await save(gameEngine+'/artifact.json',artifact);builds.push({gameEngine,artifact,files});assert.equal((await client.getGameQuality(project.id)).ready,false);
 }
 await stop(); // All player and offline-audio observations below use exported bytes only.
 for(const {gameEngine,artifact,files}of builds)for(const name of ['chromium','firefox','webkit']){
  const options={artifact,readFile:async file=>files.get(file),signal:new AbortController().signal};
  preview=name==='chromium'?await previewModule.openGamePreview({...options,headless:true}):await openInstalledBrowserPreview({...options,name});const page=preview.page;
  await page.waitForFunction(()=>document.body.dataset.ready==='yes');const snapshot=async()=>JSON.parse(await page.locator('#status').textContent());
  let status=await snapshot();assert.equal(status.version,audioLock.version);assert.equal(status.rejected,true);assert.equal(status.phase,'locked');assert.equal(status.voices.length,0);assert.equal(status.loaded.length,inputs.length);assert.ok(status.decodedCached>0);assert.equal(status.decodedReserved,0);assert.equal(status.encodedReserved,0);
  await page.getByRole('button',{name:'Start sound',exact:true}).click();await page.waitForFunction(()=>JSON.parse(document.querySelector('#status').textContent).phase==='playing');
  status=await snapshot();assert.equal(status.contextState,'running');const common=status.voices.find(v=>v.assetId==='wind').id;
  await page.getByRole('button',{name:'Play state',exact:true}).click();await page.waitForFunction(()=>JSON.parse(document.querySelector('#status').textContent).state==='play');status=await snapshot();assert.equal(status.voices.find(v=>v.assetId==='wind').id,common);
  await page.getByRole('button',{name:'Hit',exact:true}).click();await page.waitForFunction(()=>JSON.parse(document.querySelector('#status').textContent).lastEffect?.played===true);
  await page.getByRole('button',{name:'Mute',exact:true}).click();await page.waitForFunction(()=>JSON.parse(document.querySelector('#status').textContent).muted);
  await page.getByRole('button',{name:'Pause',exact:true}).click();await page.waitForFunction(()=>JSON.parse(document.querySelector('#status').textContent).phase==='paused');assert.equal((await snapshot()).voices.length,0);
  await page.getByRole('button',{name:'Resume',exact:true}).click();await page.waitForFunction(()=>JSON.parse(document.querySelector('#status').textContent).phase==='playing');assert.equal((await snapshot()).muted,true);
  await page.getByRole('button',{name:'Close',exact:true}).click();await page.waitForFunction(()=>JSON.parse(document.querySelector('#status').textContent).phase==='closed');assert.equal((await snapshot()).voices.length,0);
  await page.getByRole('button',{name:'Offline graph',exact:true}).click();await page.locator('#offline').filter({hasText:'sampleRate'}).waitFor();const pcm=JSON.parse(await page.locator('#offline').textContent());
  assert.equal(pcm.channels,2);assert.equal(pcm.sampleRate,48000);assert.ok(pcm.menu220>.05&&pcm.menu220>pcm.menu660*20);assert.ok(pcm.play660>.05&&pcm.play660>pcm.play220*20);assert.ok(pcm.mutedRms<1e-8);assert.ok(pcm.peak<1);
  assert.equal(await page.locator('#error').textContent(),'');await page.screenshot({path:path.join(output,gameEngine+'-'+name+'.png')});assert.deepEqual(preview.errors,[]);assert.deepEqual(preview.blocked,[]);
  const metadata=preview.browserMetadata;if(metadata)await save(gameEngine+'-'+name+'-browser.json',metadata);const closure=await preview.close();preview=undefined;closures.push({gameEngine,name,closure});results.push({gameEngine,browser:name,offlineEngineServiceStopped:true,trustedGestureRequired:true,nativeContextRunning:true,stateTransition:true,commonAmbiencePreserved:true,effect:true,muteAndPause:true,resumePreservesMute:true,explicitClose:true,pcm,physicalHearing:false,qualityApproved:false});
 }
 await bootstrap.verifyBundle(engine,undefined,true);await save('report.json',{scope:'Actual packaged compilation and exported Phaser/Babylon builds, native Web Audio/OfflineAudioContext in Chromium and patched Firefox/WebKit. No engine service during playback, no model, physical hearing, artistic, consumer-browser or installed acceptance.',format:codecPath?'real isolated AAC-LC mono/stereo at22050/44100/48000':'canonical WAV',audioRuntimeVersion:audioLock.version,encodedCandidates,manifestSha256:createHash('sha256').update(await readFile(path.join(engine,'manifest.json'))).digest('hex'),results,serviceExitCode:child.exitCode,modelCalls:0});passed=true;console.log('GAME_AUDIO_RUNTIME_QUALIFIED '+output);
}catch(error){await save('failure.json',{message:error.message,activeBuild,ownedServicePid:child.pid,results});if(preview)try{await preview.page.screenshot({path:path.join(output,'failure.png'),fullPage:true});await save('failure-ui.json',{error:await preview.page.locator('#error').textContent(),status:await preview.page.locator('#status').textContent(),browserErrors:preview.errors,blocked:preview.blocked});}catch{}throw error;}
finally{if(preview)closures.push(await preview.close());if(activeBuild){client?.close();child.unref();await save('closure.json',{servicePreservedForInspection:true,ownedServicePid:child.pid,activeBuild,previews:closures});console.error('Inspect the original build/service: '+state);}else{await stop();await save('closure.json',{serviceExitCode:child.exitCode,previews:closures});if(passed)await rm(state,{recursive:true,force:true});else console.error('Original failed state preserved: '+state);}}
