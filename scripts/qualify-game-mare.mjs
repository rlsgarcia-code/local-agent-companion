// Authored cooperative reference via the common service. No inference, game
// controller bridge or acceptance authority. QA scripts never enter the build.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {readFile,writeFile,mkdir,lstat,readdir,copyFile,cp} from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {PNG} from 'pngjs';
import security from '../dist-tests/packages/agent-service/src/security.js';
import storage from '../dist-tests/packages/agent-service/src/store.js';
import sdk from '../dist-tests/packages/client-ts/src/index.js';
import bootstrap from '../dist-tests/packages/client-ts/src/bootstrap.js';
import domain from '../dist-tests/packages/contracts/src/games.js';
import tests from '../dist-tests/packages/contracts/src/game-browser-tests.js';
import exports from '../dist-tests/packages/client-ts/src/game-export.js';
import previewModule from '../dist-tests/packages/adapter-game-browser/src/preview.js';
import providerHelpers from '../dist-tests/test/game-generation-provider.js';
const stamp=new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID().slice(0,8),root=path.resolve('examples/games/mare');
const output=path.resolve('output/playwright/mare/runs',stamp),state=path.resolve('.cache/mare-qualification',stamp),engine=path.join(state,'engine');
await mkdir(output,{recursive:true});await mkdir(state,{recursive:true,mode:0o700});
await cp('engine-dist',engine,{recursive:true,errorOnExist:true,force:false});await bootstrap.verifyBundle(engine,undefined,true);
const sha=data=>createHash('sha256').update(data).digest('hex');
const engineHash=sha(await readFile(path.join(engine,'manifest.json')));
const identity=await security.ensureIdentity(state),registration={id:'mare-'+randomUUID(),product:'companion-mac',profile:'authored-coop-qualification',workspace:'',providers:['ollama'],hostTools:[]},credential=await security.createClientCredential(state,registration);
await writeFile(path.join(state,'inspection-credential.json'),JSON.stringify(credential),{mode:0o600,flag:'wx'});
const store=new storage.Store(path.join(state,'metadata.sqlite'));store.register(credential);store.close();
await mkdir(path.join(state,'toolchains'),{mode:0o700});await copyFile('.cache/game-toolchains/godot.json',path.join(state,'toolchains/godot.json'));
const save=async(name,value)=>{const file=path.join(output,name);await mkdir(path.dirname(file),{recursive:true});await writeFile(file,Buffer.isBuffer(value)?value:JSON.stringify(value,null,2)+'\n');};
const tick=ms=>new Promise(r=>setTimeout(r,ms));let child,client,preview,unknown=false,logs='',passed=false;
async function boot(){
 child=spawn(path.join(engine,'node'),[path.join(engine,'service.cjs'),state],{stdio:['ignore','pipe','pipe'],env:providerHelpers.generationServiceEnvironment(process.env)});for(const stream of [child.stdout,child.stderr])stream.on('data',b=>logs=(logs+b).slice(-16000));
 await save('control.json',{stateDirectory:state,servicePid:child.pid,registrationId:registration.id,engineManifestSha256:engineHash,runnerSha256:sha(await readFile(new URL(import.meta.url)))});
 let ready=false;for(let i=0;i<600;i++){assert.equal(child.exitCode,null,'Packaged service exited');try{if(JSON.parse(await readFile(path.join(state,'runtime.json'))).pid===child.pid){ready=true;break;}}catch{}await tick(50);}assert.ok(ready,'Inspect exact original bootstrap before any restart');
 client=new sdk.AgentClient({address:security.ipcPath(state),certificate:identity.cert,credential});await client.connect();assert.equal((await client.call('engine.info')).build.manifestSha256,engineHash);
}
async function stop(){client?.close();if(child?.exitCode===null){const done=once(child,'exit');child.kill('SIGTERM');await done;}}
async function settle(id){
 for(let i=0;i<3000;i++){const job=await client.getGameProduction(id);if(['completed','failed','cancelled'].includes(job.state)){unknown=false;await save('jobs/'+id+'.json',job);assert.equal(job.state,'completed',job.error);return job;}assert.notEqual(job.state,'awaiting_reconciliation','Preserve unknown production for exact inspection');await tick(100);}throw Error('Observation ended; inspect original job '+id+' in '+state);
}
async function files(directory=root){const result=[];for(const entry of await readdir(directory,{withFileTypes:true})){if(['qa','.godot'].includes(entry.name))continue;const name=path.join(directory,entry.name),stat=await lstat(name);assert.ok(!stat.isSymbolicLink());if(stat.isDirectory())result.push(...await files(name));else if(stat.isFile())result.push(name);}return result.sort();}
function difference(a,b){const x=PNG.sync.read(a),y=PNG.sync.read(b);assert.equal(x.width,y.width);assert.equal(x.height,y.height);let changed=0;for(let i=0;i<x.data.length;i+=4)if(Math.abs(x.data[i]-y.data[i])+Math.abs(x.data[i+1]-y.data[i+1])+Math.abs(x.data[i+2]-y.data[i+2])>30)changed++;return changed/(x.width*x.height);}
try{
 await boot();const document=JSON.parse(await readFile(path.join(root,'game.document.json')));assert.ok(tests.checkGameBrowserRecipe(await readFile(path.join(root,'data/playtests.json')),document.design.playtests).valid);
 for(const file of await files()){const name=path.relative(root,file).split(path.sep).join('/'),mime=name.endsWith('.json')?'application/json':name.endsWith('.png')?'image/png':name.endsWith('.svg')?'image/svg+xml':'text/plain';document.files.push(await client.uploadGameFile(name,await readFile(file),mime));}
 document.assets=JSON.parse(await readFile(path.join(root,'data/asset-origins.json')));domain.gameDocument.parse(document);
 unknown=true;const project=await client.createGameProject('authored-mare-reference',document);unknown=false;await save('project.json',project);
 unknown=true;const build=await client.startGameBuild('mare-reference-build',project.id,project.revision);await settle(build.id);const artifact=await client.getGameArtifact(build.id);
 for(const file of artifact.files)await save('build/'+file.path,await client.downloadGameArtifactFile(build.id,file.path));
 unknown=true;const validation=await client.startGameValidation('mare-runtime-observation',build.id,'web-browser-runtime-v1');await settle(validation.id);
 const reports=await client.getGameReports(build.id);await save('reports.json',reports);for(const report of reports)for(const file of report.evidence??[])await save('observations/'+report.id+'/'+file.path,await client.downloadGameReportFile(report.id,file.path));
 for(const report of reports)for(const check of report.checks)assert.equal(check.status,'passed',JSON.stringify(report));assert.equal(reports.length,3);
 await stop();await boot();assert.deepEqual(await client.getGameProject(project.id),project);
 const parent=path.join(output,'source-export');await mkdir(parent);const exported=await exports.exportGameDirectory({client,parent,source:{projectId:project.id,revision:project.revision}});
 preview=await previewModule.openGamePreview({artifact,readFile:name=>client.downloadGameArtifactFile(build.id,name),signal:new AbortController().signal,headless:true});
 await preview.page.setViewportSize({width:1060,height:820});await preview.page.waitForTimeout(2500);await preview.page.screenshot({path:path.join(output,'home.png')});await preview.page.keyboard.press('Enter');await preview.page.waitForTimeout(300);await preview.page.screenshot({path:path.join(output,'board.png')});
 await preview.page.keyboard.down('w');await preview.page.keyboard.down('ArrowUp');await preview.page.waitForTimeout(1000);await preview.page.keyboard.up('w');await preview.page.keyboard.up('ArrowUp');await preview.page.screenshot({path:path.join(output,'rowing.png')});
 await preview.page.keyboard.press('p');await preview.page.waitForTimeout(300);const paused=await preview.page.screenshot();await tick(350);const stable=await preview.page.screenshot();assert.ok(difference(paused,stable)<0.001,'Paused canvas did not remain stable');await save('paused.png',paused);
 await preview.page.reload();await preview.page.waitForTimeout(2500);await preview.page.keyboard.press('Enter');await preview.page.waitForTimeout(300);await preview.page.screenshot({path:path.join(output,'restored.png')});
 await preview.page.setViewportSize({width:390,height:844});await preview.page.waitForTimeout(300);await preview.page.screenshot({path:path.join(output,'portrait-paused.png')});await preview.page.keyboard.press('p');await preview.page.waitForTimeout(200);await preview.page.screenshot({path:path.join(output,'portrait-board.png')});
 assert.deepEqual(preview.errors,[]);assert.deepEqual(preview.blocked,[]);await preview.close();preview=undefined;
 const quality=await client.getGameQuality(project.id);assert.equal(quality.ready,false);
 await save('evidence.json',{scope:'Authored local cooperative reference: isolated web build, canonical boot/control/pause recipes, source export and service restart. Full campaign through browser controls, physical two-player/audio/input tests and human quality remain pending.',project,artifact,reports,quality,editableSource:exported,engineManifestSha256:engineHash,fullProductAcceptance:false});passed=true;
 console.log('MARE_WEB_OBSERVED '+output);
}catch(error){await save('failure.json',{message:error instanceof Error?error.message:String(error),unknownOperation:unknown});throw error;}
finally{await preview?.close();if(!unknown)await stop();else if(child?.exitCode===null)child.unref();await save('service.log',Buffer.from(logs));await save('closure.json',{ownedServiceStopped:!unknown&&child?.exitCode!==null,privateStatePreserved:true,passed,unknownOperation:unknown});if(!passed)console.error('Original Maré state: '+state+'; evidence '+output);}
