// Packaged builds and native IndexedDB exercised by visible fixture buttons.
// No model, real game repair, installed UI, physical durability or quality claim.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
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
assert.equal(process.versions.node,'22.23.4');assert.equal(process.argv.length,4);
// macOS libc adds its text-encoding key after the four-field launcher environment.
assert.ok(Object.keys(process.env).every(key=>['HOME','PATH','TMPDIR','LANG','PLAYWRIGHT_BROWSERS_PATH','__CF_USER_TEXT_ENCODING'].includes(key)),'Run this fixture in a closed environment; never inherit provider credentials');
assert.ok(process.env.PLAYWRIGHT_BROWSERS_PATH&&path.isAbsolute(process.env.PLAYWRIGHT_BROWSERS_PATH),'Select the exact existing browser distribution directory; no download fallback');
const arg=name=>{const value=process.argv.find(v=>v.startsWith(name+'='));assert.ok(value);return path.resolve(value.slice(name.length+1));};
const engine=arg('--engine'),output=arg('--output');await mkdir(output);await bootstrap.verifyBundle(engine,undefined,true);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex'),manifest=await readFile(path.join(engine,'manifest.json'));
const lock=JSON.parse(await readFile(path.join(engine,'game-runtimes/save.lock.json'),'utf8'));
const state=await mkdtemp(path.join(tmpdir(),'native-save-')),identity=await security.ensureIdentity(state),store=new storage.Store(path.join(state,'metadata.sqlite'));
const credential=await security.createClientCredential(state,{id:'save-runtime',product:'companion-mac',profile:'synthetic-save',workspace:'',providers:['ollama'],hostTools:[]});store.register(credential);store.close();
await security.privateWrite(path.join(state,'qualification-client.json'),JSON.stringify(credential));
const save=async(name,value)=>{const target=path.join(output,name);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,Buffer.isBuffer(value)?value:JSON.stringify(value,null,2)+'\n');};
const child=spawn(path.join(engine,'node'),[path.join(engine,'service.cjs'),state],{cwd:state,env:{HOME:state,PATH:'/usr/bin:/bin',TMPDIR:tmpdir(),LANG:'en_US.UTF-8'},stdio:'ignore'});
let client,preview,activeBuild,passed=false;const results=[],builds=[],closures=[];
async function stop(){if(child.exitCode===null){if(client)assert.equal((await client.call('engine.quiesceIfIdle',{})).accepted,true);client?.close();client=undefined;const end=once(child,'exit');child.kill('SIGTERM');await end;}assert.equal(child.exitCode,0);}
const saveSource=`import {createGameSave,saveRuntimeVersion} from '@companion/game-save';
const status=document.createElement('pre');status.id='status';document.body.append(status);const error=document.createElement('p');error.id='error';document.body.append(error);
const valid=value=>Boolean(value&&Number.isInteger(value.letters)&&value.letters>=0&&value.letters<=5&&Number.isInteger(value.score)&&value.score>=0&&value.bonus===5);
const options=(slot,extra={})=>({gameId:'save-fixture',slot,version:2,validate:valid,migrations:{1:value=>({...value,bonus:5})},...extra});
let slot='campaign',extra={},controller=createGameSave(options(slot));
async function show(operation,result){status.textContent=JSON.stringify({busy:false,operation,result,current:await controller.load(),slot,moduleVersion:saveRuntimeVersion});}
function button(name,action){const node=document.createElement('button');node.textContent=name;node.addEventListener('click',()=>{status.textContent=JSON.stringify({busy:true,operation:name});Promise.resolve().then(action).then(result=>show(name,result)).catch(()=>{error.textContent='Fixture operation failed';});});document.body.append(node);}
async function select(target,overrides={}){await controller.close();slot=target;extra=overrides;controller=createGameSave(options(slot,extra));return controller.load();}
async function seed(target,version,data){const prior=createGameSave({...options(target),version,validate:value=>Boolean(value&&Number.isInteger(value.letters)&&Number.isInteger(value.score)),migrations:{}});try{const loaded=await prior.load();return await prior.save(data,{expected:loaded.stamp});}finally{await prior.close();}}
button('Deliver',async()=>{const loaded=await controller.load(),data=loaded.status==='loaded'?loaded.data:{letters:0,score:0,bonus:5};return controller.save({...data,letters:Math.min(5,data.letters+1),score:data.score+100},{expected:loaded.stamp});});
button('Race connections',async()=>{const a=createGameSave(options(slot)),b=createGameSave(options(slot));try{const [one,two]=await Promise.all([a.load(),b.load()]);const pair=await Promise.all([a.save({letters:3,score:300,bonus:5},{expected:one.stamp}),b.save({letters:4,score:400,bonus:5},{expected:two.stamp})]);return {statuses:pair.map(value=>value.status).sort()};}finally{await a.close();await b.close();}});
button('Oversize',async()=>{const loaded=await controller.load();return controller.save({letters:1,score:100,bonus:5,note:'x'.repeat(300000)},{expected:loaded.stamp});});
button('Seed legacy',async()=>{await seed('legacy',1,{letters:2,score:200});return select('legacy');});
button('Seed bad migration',async()=>{await seed('bad-migration',1,{letters:2,score:200});return select('bad-migration',{migrations:{1:()=>{throw Error('PRIVATE_MIGRATION_DETAILS');}}});});
button('Migrate',async()=>controller.migrate({expected:(await controller.load()).stamp}));
button('Seed future',async()=>{await seed('future',3,{letters:2,score:200,bonus:5});return select('future');});
button('Seed corrupt',async()=>{
 await controller.close();const opened=await new Promise((resolve,reject)=>{const request=indexedDB.open('companion-game-saves-v1',1);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(Error('Fixture seed failed'));});
 try{await new Promise((resolve,reject)=>{const tx=opened.transaction('slots','readwrite',{durability:'strict'});tx.objectStore('slots').put('PRIVATE_CORRUPT_JSON','save-fixture:corrupt');tx.oncomplete=resolve;tx.onabort=()=>reject(Error('Fixture seed aborted'));});}finally{opened.close();}return select('corrupt');
});
button('Decline discard',async()=>controller.discard({expected:(await controller.load()).stamp,confirm:false}));
button('Discard slot',async()=>controller.discard({expected:(await controller.load()).stamp,confirm:true}));
button('Campaign',async()=>select('campaign'));
button('Blocked storage',async()=>select('unavailable',{indexedDB:null}));
button('Close controller',async()=>{await controller.close();return controller.load();});
button('Reopen controller',async()=>{controller=createGameSave(options(slot,extra));return controller.load();});
show('initial',null).catch(()=>{error.textContent='Fixture bootstrap failed';});`;
function source(engine){
  const visual=engine==='phaser'?`import Phaser from 'phaser';new Phaser.Game({type:Phaser.CANVAS,canvas:document.querySelector('#game'),width:640,height:160,backgroundColor:'#123644',scene:{create(){this.add.circle(320,80,42,0x60d0b2);}}});`:`import {Engine,Scene,FreeCamera,Vector3,MeshBuilder,HemisphericLight} from 'babylonjs';const engine=new Engine(document.querySelector('#game'),true),scene=new Scene(engine),camera=new FreeCamera('camera',new Vector3(0,0,-6),scene);camera.setTarget(Vector3.Zero());new HemisphericLight('light',Vector3.Up(),scene);MeshBuilder.CreateSphere('fixture',{diameter:2},scene);engine.runRenderLoop(()=>scene.render());`;
  return `import './style.css';${visual}\n${saveSource}`;
}
try{
  await save('control.json',{observerSha256:sha(await readFile(new URL(import.meta.url))),engineManifestSha256:sha(manifest),saveLock:lock,realModelCalls:0,fixtureOwnStorageFaults:true});
  let ready=false;for(let i=0;i<600;i++){assert.equal(child.exitCode,null);try{if(JSON.parse(await readFile(path.join(state,'runtime.json'),'utf8')).pid===child.pid){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,25));}assert.ok(ready,'Inspect original process on timeout; do not restart');
  client=new sdk.AgentClient({address:security.ipcPath(state),certificate:identity.cert,credential});await client.connect();assert.equal((await client.call('engine.info')).build.manifestSha256,sha(manifest));
  for(const gameEngine of ['phaser','babylon']){
    const document=fixtures.fixtureGameDocument();document.title='Native game save '+gameEngine;document.engine=gameEngine;if(gameEngine==='babylon')document.brief.dimension='3d';document.files=[];
    for(const [name,text]of [['game.web.json',JSON.stringify({schemaVersion:1,entry:'src/main.ts',engineVersion:gameEngine==='phaser'?'4.2.1':'9.35.0'})],['src/main.ts',source(gameEngine)],['src/style.css','body{font:14px system-ui;background:#eef3f4;color:#123644;overflow:auto;padding:16px;box-sizing:border-box}#game{height:160px;width:640px;max-width:100%}button{padding:8px;margin:8px 8px 0 0}pre{white-space:pre-wrap;overflow-wrap:anywhere}#error{color:#a00020}']])document.files.push(await client.uploadGameFile(name,Buffer.from(text),name.endsWith('.json')?'application/json':'text/plain'));
    const project=await client.createGameProject('save-'+gameEngine,document),job=await client.startGameBuild('build-'+gameEngine,project.id,project.revision);activeBuild=job.id;let done;
    for(let i=0;i<2400;i++){done=await client.getGameProduction(job.id);if(['completed','failed','cancelled','awaiting_reconciliation'].includes(done.state))break;await new Promise(r=>setTimeout(r,25));}
    if(['completed','failed','cancelled'].includes(done?.state))activeBuild=undefined;assert.equal(done?.state,'completed',done?.error);
    const artifact=await client.getGameArtifact(job.id),files=new Map();for(const file of artifact.files){const bytes=await client.downloadGameArtifactFile(job.id,file.path);files.set(file.path,bytes);await save(gameEngine+'/build/'+file.path,bytes);}
    assert.ok(files.has('engine/GAME-SAVE-LICENSE.txt'));await save(gameEngine+'/artifact.json',artifact);builds.push({gameEngine,artifact,files});assert.equal((await client.getGameQuality(project.id)).ready,false);
  }
  await stop();
  for(const {gameEngine,artifact,files}of builds)for(const name of ['chromium','firefox','webkit']){
    const options={artifact,readFile:async file=>files.get(file),signal:AbortSignal.timeout(120000)};
    preview=name==='chromium'?await previewModule.openGamePreview({...options,headless:true}):await openInstalledBrowserPreview({...options,name});const page=preview.page,checks=[];
    async function status(operation){for(let i=0;i<200;i++){const raw=await page.locator('#status').textContent();if(raw){const value=JSON.parse(raw);if(!value.busy&&value.operation===operation)return value;}assert.equal(await page.locator('#error').textContent(),'');await new Promise(r=>setTimeout(r,25));}throw Error('Inspect original fixture; UI operation did not settle');}
    async function click(operation){await page.getByRole('button',{name:operation,exact:true}).click();const value=await status(operation);checks.push({operation,result:value.result,current:value.current,slot:value.slot});return value;}
    assert.equal((await status('initial')).current.status,'empty');
    let current=await click('Deliver');assert.equal(current.result.status,'saved');assert.equal(current.current.data.letters,1);
    current=await click('Deliver');assert.equal(current.current.data.letters,2);const original=current.current;
    await page.reload({waitUntil:'load',timeout:5000});current=await status('initial');assert.equal(current.current.stamp,original.stamp);assert.deepEqual(current.current.data,original.data);checks.push({operation:'normal-reload',current:current.current});
    current=await click('Race connections');assert.deepEqual(current.result.statuses,['conflict','saved']);assert.ok([3,4].includes(current.current.data.letters));const race=current.current;
    current=await click('Oversize');assert.equal(current.result.status,'invalid-input');assert.equal(current.current.stamp,race.stamp);
    current=await click('Close controller');assert.equal(current.current.code,'closed');current=await click('Reopen controller');assert.equal(current.current.stamp,race.stamp);
    current=await click('Seed legacy');assert.equal(current.current.status,'migration-required');current=await click('Deliver');assert.equal(current.result.status,'blocked');
    current=await click('Migrate');assert.equal(current.result.status,'migrated');assert.deepEqual(current.current.data,{bonus:5,letters:2,score:200});const migrated=current.current.stamp;
    current=await click('Migrate');assert.equal(current.result.status,'blocked');assert.equal(current.current.stamp,migrated);
    current=await click('Seed bad migration');assert.equal(current.current.status,'migration-required');const old=current.current.stamp;
    current=await click('Migrate');assert.equal(current.result.status,'invalid-input');assert.equal(current.current.stamp,old);assert.doesNotMatch(JSON.stringify(current),/PRIVATE_MIGRATION/);
    current=await click('Seed future');assert.equal(current.current.status,'incompatible');const future=current.current.stamp;
    current=await click('Deliver');assert.equal(current.result.status,'blocked');assert.equal(current.current.stamp,future);
    current=await click('Seed corrupt');assert.equal(current.current.status,'invalid');assert.doesNotMatch(JSON.stringify(current),/PRIVATE_CORRUPT/);const corrupt=current.current.stamp;
    current=await click('Deliver');assert.equal(current.result.status,'blocked');assert.equal(current.current.stamp,corrupt);
    current=await click('Decline discard');assert.equal(current.result.status,'blocked');assert.equal(current.current.stamp,corrupt);
    current=await click('Discard slot');assert.equal(current.result.status,'discarded');assert.equal(current.current.status,'empty');
    current=await click('Campaign');assert.equal(current.current.stamp,race.stamp);
    current=await click('Blocked storage');assert.equal(current.current.status,'unavailable');current=await click('Campaign');assert.equal(current.current.stamp,race.stamp);
    assert.equal(await page.locator('#error').textContent(),'');assert.deepEqual(preview.errors,[]);assert.deepEqual(preview.blocked,[]);
    await page.screenshot({path:path.join(output,gameEngine+'-'+name+'.png'),fullPage:true});const metadata=preview.browserMetadata;if(metadata)await save(gameEngine+'-'+name+'-browser.json',metadata);
    const closingPage=page,closure=await preview.close();assert.equal(closingPage.isClosed(),true);preview=undefined;closures.push({gameEngine,name,pageClosed:true,closeAcknowledged:true,closure});
    results.push({gameEngine,browser:name,checks,serviceStoppedDuringPlayback:child.exitCode===0,realModelCalls:0,consumerBrowserAcceptance:false,qualityApproved:false});console.log('NATIVE_GAME_SAVE_OBSERVED '+gameEngine+' '+name);
  }
  await bootstrap.verifyBundle(engine,undefined,true);assert.ok(manifest.equals(await readFile(path.join(engine,'manifest.json'))));
  await save('report.json',{scope:'Real packaged SDK/service compilation; exported Phaser/Babylon fixtures and native IndexedDB via visible buttons/reload in Chromium and existing patched Firefox/WebKit. No engine service during playback, real game repair, installed client, physical disk/power-loss or consumer-browser acceptance.',engineManifestSha256:sha(manifest),saveRuntimeVersion:lock.version,results,realModelCalls:0,qualityApproved:false});passed=true;console.log('GAME_SAVE_RUNTIME_QUALIFIED '+output);
}catch(error){await save('failure.json',{message:String(error?.message??error).slice(0,3000),activeBuild,ownedServicePid:child.pid,privateState:state,results});if(preview)try{await preview.page.screenshot({path:path.join(output,'failure.png'),fullPage:true});await save('failure-ui.json',{error:await preview.page.locator('#error').textContent(),status:await preview.page.locator('#status').textContent(),browserErrors:preview.errors,blocked:preview.blocked});}catch{}process.exitCode=1;console.error(String(error?.message??error).slice(0,3000));}
finally{
  if(preview)try{closures.push(await preview.close());}catch{}
  if(activeBuild){client?.close();child.unref();await save('closure.json',{servicePreservedForInspection:true,ownedServicePid:child.pid,activeBuild,previews:closures});}
  else{await stop();if(passed)await rm(state,{recursive:true,force:true});await save('closure.json',{servicePid:child.pid,serviceExitCode:child.exitCode,privateStateRemoved:passed,previews:closures});}
}
