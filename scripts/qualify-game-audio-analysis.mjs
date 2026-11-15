// Synthetic digital audio and renderer qualification, not musical/physical acceptance.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {readFile,writeFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
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
import {qualifyAudioEditor} from './qualify-game-audio-editor.mjs';

assert.equal(process.argv.length,3);assert.ok(process.argv[2].startsWith('--engine='));
const engine=path.resolve(process.argv[2].slice(9));await bootstrap.verifyBundle(engine,undefined,true);
const output=path.resolve('output/playwright/game-audio-analysis',new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID().slice(0,8));await mkdir(output,{recursive:true});
const state=await mkdtemp(path.join(tmpdir(),'game-audio-analysis-')),identity=await security.ensureIdentity(state),store=new storage.Store(path.join(state,'metadata.sqlite')),credentials=[];
for(const product of ['companion-mac','companion-vscode']){const credential=await security.createClientCredential(state,{id:'audio-'+product,product,profile:'fixture',workspace:'',providers:['ollama'],hostTools:[]});store.register(credential);credentials.push(credential);}store.close();
const save=async(name,value)=>writeFile(path.join(output,name),JSON.stringify(value,null,2)+'\n');
const child=spawn(path.join(engine,'node'),[path.join(engine,'service.cjs'),state],{cwd:state,env:{HOME:state,PATH:'/usr/bin:/bin',TMPDIR:tmpdir(),LANG:'en_US.UTF-8'},stdio:'ignore'});
let browser,context,page,passed=false;const clients=[],jobs=new Map(),results=[];
async function settled(client,id){
  jobs.set(id,client);for(let i=0;i<4800;i++){const job=await client.getGameProduction(id);if(['completed','failed','cancelled','awaiting_reconciliation'].includes(job.state)){assert.equal(job.state,'completed',job.error);return job;}await new Promise(resolve=>setTimeout(resolve,25));}
  throw Error('Inspect original job '+id+'; do not automatically repeat');
}
try{
  let ready=false;for(let i=0;i<600;i++){assert.equal(child.exitCode,null);try{if(JSON.parse(await readFile(path.join(state,'runtime.json'),'utf8')).pid===child.pid){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,25));}assert.ok(ready);
  const qualified=await browserModule.qualifyBrowser();assert.ok(qualified);browser=await chromium.launch({executablePath:qualified.executablePath,headless:true,chromiumSandbox:true});
  for(const [index,credential]of credentials.entries()){
    const client=new sdk.AgentClient({address:security.ipcPath(state),certificate:identity.cert,credential});clients.push(client);await client.connect();
    assert.ok((await client.call('engine.info')).capabilities.includes('game-audio-analysis-v1'));
    const process=client.processGameAsset.bind(client);client.processGameAsset=async(...args)=>{const job=await process(...args);jobs.set(job.id,client);return job;};
    const session=await client.call('sessions.create',{title:'Waveform qualification'}),seed=await client.createGameProject('seed',fixtures.fixtureGameDocument());await client.selectGameProject(session.id,seed.id);
    let approve=true;const controller=new studio.GameStudioController(client,session.id,{canWrite:()=>true,approve:async()=>approve,preview:async()=>{throw Error('No game preview requested');},exportSource:async()=>false,exportBuild:async()=>false,exportAsset:async()=>false});
    assert.equal((await controller.snapshot()).canAnalyzeAudio,true);
    const draftStore=fileDrafts.fileGameStudioDraftStore(path.join(state,'host-'+index),drafts.gameStudioDraftKey(credential.registration,session.id));
    context=await browser.newContext({viewport:{width:1200,height:900}});page=await context.newPage();const errors=[];
    page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
    await page.exposeFunction('__audioStudio',command=>draftStore.handles(command)?draftStore.dispatch(command):controller.dispatch(command));
    await page.addInitScript(({editor})=>{if(!editor)window.gameStudioHost={request:command=>window.__audioStudio(command)};
      else window.acquireVsCodeApi=()=>({postMessage:message=>window.__audioStudio(message.command).then(value=>window.postMessage({type:'game-studio-response',id:message.id,value},'*')).catch(error=>window.postMessage({type:'game-studio-response',id:message.id,error:error.message},'*'))});
    },{editor:index===1});
    await page.goto(pathToFileURL(path.resolve('packages/game-studio-ui/index.html')).href);await page.getByRole('heading',{name:seed.title,exact:true}).waitFor();
    const result=await qualifyAudioEditor({page,client,controller,product:credential.registration.product,output,settled,setApproval:value=>{approve=value;},enableWaveform:true});
    await page.setViewportSize({width:600,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.locator('#candidate-waveform').screenshot({path:path.join(output,credential.registration.product+'-waveform-narrow.png')});
    assert.deepEqual(errors,[]);results.push({...result,product:credential.registration.product,bridge:'emulated',worker:'actual packaged',modelCalls:0,qualityApproved:false,installed:false});await context.close();context=undefined;
  }
  await bootstrap.verifyBundle(engine,undefined,true);await save('report.json',{scope:'Actual packaged Node/service/SDK/TLS/media worker, shared renderer and private draft files; emulated native host bridges. Synthetic WAV and digital measurements, not hearing/music/artistic/installed acceptance.',manifestSha256:createHash('sha256').update(await readFile(path.join(engine,'manifest.json'))).digest('hex'),results});passed=true;console.log('AUDIO_ANALYSIS_QUALIFIED '+output);
}catch(error){await save('failure.json',{message:error.message,results,ownedServicePid:child.pid});if(page&&!page.isClosed())try{await page.screenshot({path:path.join(output,'failure.png'),fullPage:true});}catch{}throw error;}
finally{
  await context?.close();await browser?.close();const unresolved=[];
  for(const [id,client]of jobs){try{const job=await client.getGameProduction(id);if(!['completed','failed','cancelled'].includes(job.state))unresolved.push({id,state:job.state});}catch{unresolved.push({id,state:'inspection-unavailable'});}}
  for(const client of clients)client.close();
  if(unresolved.length){child.unref();await save('closure.json',{servicePreservedForInspection:true,ownedServicePid:child.pid,unresolved,browserClosed:true});console.error('Inspect original service/jobs at '+state);}
  else{if(child.exitCode===null){const done=once(child,'exit');child.kill('SIGTERM');await done;}await save('closure.json',{serviceExitCode:child.exitCode,browserClosed:true});assert.equal(child.exitCode,0);if(passed)await rm(state,{recursive:true,force:true});else console.error('Original fixture state preserved: '+state);}
}
