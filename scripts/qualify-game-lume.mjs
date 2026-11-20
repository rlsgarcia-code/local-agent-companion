// Authored reference content through the real service. No model self-grading,
// debug/teleport endpoint, personal browser or implied physical/human acceptance.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,mkdir,readFile,writeFile,rm,readdir,lstat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import security from '../dist-tests/packages/agent-service/src/security.js';
import storage from '../dist-tests/packages/agent-service/src/store.js';
import sdk from '../dist-tests/packages/client-ts/src/index.js';
import domain from '../dist-tests/packages/contracts/src/games.js';
import exports from '../dist-tests/packages/client-ts/src/game-export.js';
import previewModule from '../dist-tests/packages/adapter-game-browser/src/preview.js';
import bootstrap from '../dist-tests/packages/client-ts/src/bootstrap.js';
import {observeLumeCampaign} from './lume-campaign-observer.mjs';

const args=process.argv.slice(2);assert.ok(args.every(arg=>arg==='--campaign'||arg.startsWith('--engine='))&&args.filter(arg=>arg.startsWith('--engine=')).length<=1,'Only --campaign and one --engine=<bundle> are supported');
const root=path.resolve('examples/games/lume'),baseOutput=path.resolve('output/playwright/lume'),output=path.join(baseOutput,'runs',`${new Date().toISOString().replace(/[:.]/g,'-')}-${randomUUID().slice(0,8)}`),engine=path.resolve(args.find(arg=>arg.startsWith('--engine='))?.slice(9)||'engine-dist');
await bootstrap.verifyBundle(engine,undefined,true);
await mkdir(output,{recursive:true});
const state=await mkdtemp(path.join(tmpdir(),'companion-lume-'));
const registration={id:'lume-qualification',product:'companion-mac',profile:'portfolio-development',workspace:'',providers:['ollama'],hostTools:[]};
const identity=await security.ensureIdentity(state),credential=await security.createClientCredential(state,registration),store=new storage.Store(path.join(state,'metadata.sqlite'));store.register(credential);store.close();
const delay=()=>new Promise(resolve=>setTimeout(resolve,50));
let child,client,preview,logs='',passed=false;
async function boot(){logs='';const env={...process.env};delete env.OPENAI_API_KEY;child=spawn(path.join(engine,process.platform==='win32'?'node.exe':'node'),[path.join(engine,'service.cjs'),state],{stdio:['ignore','pipe','pipe'],env});child.stdout.on('data',bytes=>{logs=(logs+bytes).slice(-100000);});child.stderr.on('data',bytes=>{logs=(logs+bytes).slice(-100000);});
  let ready=false;for(let i=0;i<600;i++){if(child.exitCode!==null)throw new Error(logs);try{if(JSON.parse(await readFile(path.join(state,'runtime.json'),'utf8')).pid===child.pid){ready=true;break;}}catch{}await delay();}assert.ok(ready,'Packaged service readiness');client=new sdk.AgentClient({address:security.ipcPath(state),certificate:identity.cert,credential});await client.connect();}
async function stop(){client?.close();if(child?.exitCode===null){const exited=once(child,'exit');child.kill('SIGTERM');await exited;}}
async function settled(id){for(let i=0;i<3000;i++){const job=await client.getGameProduction(id);if(!['queued','running','cancelling'].includes(job.state)){assert.equal(job.state,'completed',job.error);return job;}await delay();}throw new Error(`Observation expired; inspect original job ${id} before repeating`);}
async function save(name,bytes){const file=path.join(output,name);await mkdir(path.dirname(file),{recursive:true});await writeFile(file,bytes);}
async function files(directory=root){const result=[];for(const entry of await readdir(directory,{withFileTypes:true})){const file=path.join(directory,entry.name),stat=await lstat(file);assert.ok(!stat.isSymbolicLink());if(stat.isDirectory())result.push(...await files(file));else if(stat.isFile())result.push(file);}return result.sort();}
try{
  await boot();const document=JSON.parse(await readFile(path.join(root,'game.document.json'),'utf8'));
  for(const file of await files()){const name=path.relative(root,file).split(path.sep).join('/');document.files.push(await client.uploadGameFile(name,await readFile(file),name.endsWith('.json')?'application/json':'text/plain'));}
  document.assets=JSON.parse(await readFile(path.join(root,'data/asset-origins.json'),'utf8'));domain.gameDocument.parse(document);
  const project=await client.createGameProject('authored-lume-reference',document),build=await client.startGameBuild('build-lume-reference',project.id,project.revision);await settled(build.id);const artifact=await client.getGameArtifact(build.id);
  for(const file of artifact.files)await save(`build/${file.path}`,await client.downloadGameArtifactFile(build.id,file.path));
  const observation=await client.startGameValidation('observe-lume-reference',build.id,'web-browser-runtime-v1');await settled(observation.id);const reports=await client.getGameReports(build.id);
  for(const report of reports)for(const file of report.evidence??[])await save(`observations/${report.id}/${file.path}`,await client.downloadGameReportFile(report.id,file.path));
  // Save failures as well, on the exact source/build. Never omit a failed case.
  await save('reports.json',Buffer.from(JSON.stringify(reports,null,2)));
  for(const report of reports)for(const check of report.checks)assert.equal(check.status,'passed',JSON.stringify(report));
  assert.equal(reports.length,5);
  await stop();await boot();assert.deepEqual(await client.getGameProject(project.id),project);
  const exportParent=path.join(output,'source-export');await mkdir(exportParent,{recursive:true});const exported=await exports.exportGameDirectory({client,parent:exportParent,source:{projectId:project.id,revision:project.revision}});
  preview=await previewModule.openGamePreview({artifact,readFile:name=>client.downloadGameArtifactFile(build.id,name),signal:new AbortController().signal,headless:true});
  await preview.page.locator('#start').waitFor();await preview.page.screenshot({path:path.join(output,'title.png')});
  await preview.page.getByRole('button',{name:'Jogar',exact:true}).click();await preview.page.locator('#hud').waitFor();await preview.page.waitForTimeout(900);await preview.page.screenshot({path:path.join(output,'garden.png')});
  const campaign=args.includes('--campaign')?await observeLumeCampaign(preview.page,path.join(output,'campaign')):undefined;
  assert.deepEqual(preview.errors,[]);assert.deepEqual(preview.blocked,[]);await preview.close();preview=undefined;
  const quality=await client.getGameQuality(project.id);assert.equal(quality.ready,false,'Human/physical/content acceptance is still required');
  await save('evidence.json',Buffer.from(JSON.stringify({purpose:'Authored reference game, not proof of autonomous generation or physical/human acceptance',project,artifact,reports,quality,...(campaign?{campaign}:{}),editableSource:exported,manifest:JSON.parse(await readFile(path.join(engine,'manifest.json'),'utf8')),manifestSha256:createHash('sha256').update(await readFile(path.join(engine,'manifest.json'))).digest('hex')},null,2)));
  await writeFile(path.join(baseOutput,'latest.json'),JSON.stringify({output,sourceHash:project.contentHash,artifactHash:artifact.artifactHash},null,2));
  passed=true;
}catch(error){await save('failure.json',Buffer.from(JSON.stringify({message:error instanceof Error?error.message:String(error)},null,2)));throw error;}finally{await preview?.close();await stop();if(passed)await rm(state,{recursive:true,force:true});else console.error(`Original qualification state preserved: ${state}\n${logs}`);}
if(passed)console.log(`LUME_PACKAGED_REFERENCE_OBSERVED controls/pause/save/reload/touch-resize, ${args.includes('--campaign')?'twelve-garden campaign':'first-garden completion'}, source export and exact build ${output}`);
