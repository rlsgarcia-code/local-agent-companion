// Real renderer/controller/SDK/TLS and packaged service; emulated host bridges.
// Synthetic image and sound inputs, no inference, build, installation or quality approval.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createHash,randomUUID} from 'node:crypto';
import {readFile,writeFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {PNG} from 'pngjs';
import {chromium} from 'playwright-core';
import bootstrap from '../dist-tests/packages/client-ts/src/bootstrap.js';
import security from '../dist-tests/packages/agent-service/src/security.js';
import storage from '../dist-tests/packages/agent-service/src/store.js';
import sdk from '../dist-tests/packages/client-ts/src/index.js';
import studio from '../dist-tests/packages/client-ts/src/game-studio.js';
import drafts from '../dist-tests/packages/client-ts/src/game-studio-drafts.js';
import fileDrafts from '../dist-tests/packages/client-ts/src/game-studio-file-drafts.js';
import browserModule from '../dist-tests/packages/adapter-game-browser/src/browser.js';
import fixtures from '../dist-tests/test/game-fixtures.js';

assert.equal(process.argv.length,3);assert.ok(process.argv[2].startsWith('--engine='));
const engine=path.resolve(process.argv[2].slice(9));await bootstrap.verifyBundle(engine,undefined,true);
const output=path.resolve('output/playwright/game-media-comparison',new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID().slice(0,8));await mkdir(output,{recursive:true});
const state=await mkdtemp(path.join(tmpdir(),'game-media-comparison-')),identity=await security.ensureIdentity(state);
const store=new storage.Store(path.join(state,'metadata.sqlite')),credentials=[];
for(const product of ['companion-mac','companion-vscode']){
  const credential=await security.createClientCredential(state,{id:'media-'+product,product,profile:'fixture',workspace:'',providers:['ollama'],hostTools:[]});
  store.register(credential);credentials.push(credential);
}store.close();
const save=async(name,value)=>{const file=path.join(output,name);await mkdir(path.dirname(file),{recursive:true});await writeFile(file,Buffer.isBuffer(value)?value:JSON.stringify(value,null,2)+'\n');};
const child=spawn(path.join(engine,'node'),[path.join(engine,'service.cjs'),state],{cwd:state,env:{HOME:state,PATH:'/usr/bin:/bin',TMPDIR:tmpdir(),LANG:'en_US.UTF-8'},stdio:'ignore'});
let browser,context,page,passed=false;const clients=[],results=[];
function picture(changed=false){
  const p=new PNG({width:512,height:160});
  for(let y=0;y<160;y++)for(let x=0;x<512;x++){
    const center=changed?340:180,inside=(x-center)**2+(y-80)**2<48**2;
    p.data.set(inside?(changed?[235,161,78,255]:[93,196,174,255]):[23,44,50,255],(y*512+x)*4);
  }return PNG.sync.write(p);
}
function wave(frequency){
  const rate=22050,frames=rate*12,pcm=frames*2,bytes=Buffer.alloc(44+pcm);
  bytes.write('RIFF');bytes.writeUInt32LE(36+pcm,4);bytes.write('WAVEfmt ',8);bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);
  bytes.writeUInt32LE(rate,24);bytes.writeUInt32LE(rate*2,28);bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(pcm,40);
  for(let i=0;i<frames;i++)bytes.writeInt16LE(Math.round(Math.sin(2*Math.PI*frequency*i/rate)*4000*Math.min(1,i/100,(frames-i)/100)),44+i*2);return bytes;
}
try{
  let ready=false;for(let i=0;i<600;i++){assert.equal(child.exitCode,null);try{if(JSON.parse(await readFile(path.join(state,'runtime.json'),'utf8')).pid===child.pid){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,25));}assert.ok(ready);
  const qualified=await browserModule.qualifyBrowser();assert.ok(qualified);
  browser=await chromium.launch({executablePath:qualified.executablePath,headless:true,chromiumSandbox:true});
  for(const [index,credential]of credentials.entries()){
    const client=new sdk.AgentClient({address:security.ipcPath(state),certificate:identity.cert,credential});clients.push(client);await client.connect();
    const session=await client.call('sessions.create',{title:'Media comparison'}),document=fixtures.fixtureGameDocument();document.title='Media comparison '+credential.registration.product;
    document.files=[await client.uploadGameFile('assets/picture.png',picture(),'image/png'),await client.uploadGameFile('assets/sound.wav',wave(220),'audio/wav')];
    document.assets=document.files.map((file,i)=>({id:i?'sound':'picture',kind:i?'audio':'image',role:'Synthetic comparison input',placeholder:true,files:[file.path],origin:{kind:'procedural',source:'Authored fixture',author:'Test',license:'Synthetic test data',referenceIds:[]}}));
    let project=await client.createGameProject('media-project',document);await client.selectGameProject(session.id,project.id);
    const next={...document,files:[await client.uploadGameFile('assets/picture.png',picture(true),'image/png'),await client.uploadGameFile('assets/sound.wav',wave(440),'audio/wav')]};
    project=await client.commitGameRevision(project.id,'media-next',1,next,'Synthetic visual and sound change');
    project=await client.commitGameRevision(project.id,'media-later',2,{...next,title:document.title+' later'},'Work after comparison');
    const scope=drafts.gameStudioDraftKey(credential.registration,session.id),draftStore=fileDrafts.fileGameStudioDraftStore(path.join(state,'host-'+index),scope);
    const controller=new studio.GameStudioController(client,session.id,{canWrite:()=>false,approve:async()=>{throw Error('No approval during read-only comparison');},preview:async()=>{throw Error('No game execution');},exportSource:async()=>false,exportBuild:async()=>false,exportAsset:async()=>false});
    context=await browser.newContext({viewport:{width:1200,height:900}});page=await context.newPage();const errors=[],commands=[];
    page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    let delayed=false,release;
    await page.exposeFunction('__mediaStudio',async command=>{
      if(draftStore.handles(command))return draftStore.dispatch(command);commands.push(structuredClone(command));
      const result=await controller.dispatch(command);
      if(command.action==='revision-media'&&delayed){delayed=false;await new Promise(resolve=>{release=resolve;});}return result;
    });
    await page.addInitScript(({editor})=>{if(!editor)window.gameStudioHost={request:command=>window.__mediaStudio(command)};
      else window.acquireVsCodeApi=()=>({postMessage:message=>{window.__mediaStudio(message.command).then(value=>window.postMessage({type:'game-studio-response',id:message.id,value},'*')).catch(e=>window.postMessage({type:'game-studio-response',id:message.id,error:e.message},'*'));}});
    },{editor:index===1});
    await page.goto(pathToFileURL(path.resolve('packages/game-studio-ui/index.html')).href);await page.getByRole('heading',{name:document.title+' later',exact:true}).waitFor();
    await page.locator('[data-tab="history"]').click();await page.locator('#comparison-base').fill('1');await page.locator('#comparison-target').fill('2');await page.locator('#comparison-section').selectOption('files');await page.locator('#compare-revisions').click();
    await page.locator('[data-compare-file="assets/picture.png"]').click();await page.locator('#compare-media').click();
    await page.waitForFunction(()=>document.querySelectorAll('#revision-media-pair img').length===2&&[...document.querySelectorAll('#revision-media-pair img')].every(i=>i.complete&&i.naturalWidth===512));
    assert.match(await page.locator('#revision-media-status').textContent(),/revisões 1 e 2/);
    const srcs=await page.locator('#revision-media-pair img').evaluateAll(images=>images.map(i=>i.src));assert.notEqual(srcs[0],srcs[1]);
    await page.locator('#revision-media-native').check();assert.equal(await page.locator('#revision-media-pair').evaluate(e=>e.classList.contains('native-size')),true);
    await page.locator('#revision-media').screenshot({path:path.join(output,credential.registration.product+'-images.png')});
    await page.setViewportSize({width:600,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.locator('#revision-media').screenshot({path:path.join(output,credential.registration.product+'-narrow.png')});await page.setViewportSize({width:1200,height:900});
    // Closing invalidates an in-flight read; its later reply may not repopulate media.
    await page.locator('#close-revision-media').click();delayed=true;const count=commands.filter(c=>c.action==='revision-media').length;
    await page.locator('#compare-media').click();for(let i=0;i<200&&!release;i++)await new Promise(r=>setTimeout(r,10));assert.ok(release);
    await page.locator('#close-revision-media').click();release();await page.locator('#compare-media').waitFor({state:'visible'});
    await page.waitForFunction(()=>!document.querySelector('#refresh').classList.contains('loading'));assert.equal(await page.locator('#revision-media').isHidden(),true);assert.equal(await page.locator('#revision-media-pair img').count(),0);
    assert.equal(commands.filter(c=>c.action==='revision-media').length,count+1);
    await page.locator('[data-compare-file="assets/sound.wav"]').click();await page.locator('#compare-media').click();
    const baseAudio=page.getByLabel('Áudio de origem, revisão 1',{exact:true}),targetAudio=page.getByLabel('Áudio de destino, revisão 2',{exact:true});
    await page.waitForFunction(()=>document.querySelectorAll('#revision-media-pair audio').length===2&&[...document.querySelectorAll('#revision-media-pair audio')].every(a=>a.readyState>=1));
    assert.equal(await baseAudio.evaluate(a=>a.paused),true);assert.equal(await targetAudio.evaluate(a=>a.paused),true);
    await baseAudio.press('Space');await page.waitForFunction(()=>!document.querySelector('[data-media-side=base] audio').paused);
    // The observed Chromium native play control is 25px inside this audio box.
    // Focusing the outer second audio is not a promise of its shadow control's
    // keyboard focus. Use the actual visible play button, never DOM .play().
    const targetBox=await targetAudio.boundingBox();assert.ok(targetBox);
    await targetAudio.click({position:{x:25,y:targetBox.height/2}});await page.waitForFunction(()=>!document.querySelector('[data-media-side=target] audio').paused&&document.querySelector('[data-media-side=base] audio').paused);
    await page.locator('#revision-media').screenshot({path:path.join(output,credential.registration.product+'-audio.png')});
    await page.locator('[data-tab="assets"]').click();assert.equal(await targetAudio.evaluate(a=>a.paused),true);await page.locator('[data-tab="history"]').click();assert.equal(await targetAudio.evaluate(a=>a.paused),true);
    await page.locator('#close-file-comparison').click();assert.equal(await page.locator('#revision-media-pair audio').count(),0);
    assert.equal((await client.getGameProject(project.id)).revision,3);assert.equal((await client.listGameProduction(project.id)).jobs.length,0);assert.equal((await client.getGameQuality(project.id)).ready,false);
    assert.deepEqual(await client.downloadGameFile(project.id,'assets/picture.png',1),picture());assert.deepEqual(await client.downloadGameFile(project.id,'assets/sound.wav',1),wave(220));
    assert.deepEqual(errors,[]);await save(credential.registration.product+'-commands.json',commands);
    results.push({product:credential.registration.product,bridge:'emulated',readOnly:true,exactHistoricalImages:true,narrowAndOriginalSize:true,lateReplyDiscarded:true,audioMetadataDecoded:true,noAutoplay:true,nativeKeyboardAndPointerPlayback:true,oneVersionPlaying:true,tabPauseNoResume:true,originalsPreserved:true,noBuildOrQualityEffect:true,physicalHearing:false,installed:false});
    await context.close();context=undefined;
  }
  await bootstrap.verifyBundle(engine,undefined,true);await save('report.json',{scope:'Actual packaged service, SDK and renderer; emulated Mac/VS Code host bridges, synthetic raster/WAV, Chromium DOM and native-control keyboard observations. Not physical hearing, artistic or installed acceptance.',manifestSha256:createHash('sha256').update(await readFile(path.join(engine,'manifest.json'))).digest('hex'),results,inferenceCalls:0});passed=true;console.log('MEDIA_COMPARISON_QUALIFIED '+output);
}catch(error){await save('failure.json',{message:error.message,results});if(page&&!page.isClosed())try{await page.screenshot({path:path.join(output,'failure.png'),fullPage:true});}catch{}throw error;}
finally{
  await context?.close();await browser?.close();for(const client of clients)client.close();
  if(child.exitCode===null){const done=once(child,'exit');child.kill('SIGTERM');await done;}await save('closure.json',{serviceExitCode:child.exitCode,browserClosed:true});assert.equal(child.exitCode,0);
  if(passed)await rm(state,{recursive:true,force:true});else console.error('Original fixture state preserved: '+state);
}
