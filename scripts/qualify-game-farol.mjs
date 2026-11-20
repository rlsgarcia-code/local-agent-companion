// Authored puzzle through the packaged service and isolated Godot adapter.
// Browser observations never grant human, artistic or physical acceptance.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,mkdir,readFile,writeFile,rm,readdir,lstat,copyFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {PNG} from 'pngjs';
import security from '../dist-tests/packages/agent-service/src/security.js';
import storage from '../dist-tests/packages/agent-service/src/store.js';
import sdk from '../dist-tests/packages/client-ts/src/index.js';
import domain from '../dist-tests/packages/contracts/src/games.js';
import browserTests from '../dist-tests/packages/contracts/src/game-browser-tests.js';
import exports from '../dist-tests/packages/client-ts/src/game-export.js';
import previewModule from '../dist-tests/packages/adapter-game-browser/src/preview.js';

const root=path.resolve('examples/games/farol'),base=path.resolve('output/playwright/farol');
const output=path.join(base,'runs',`${new Date().toISOString().replace(/[:.]/g,'-')}-${randomUUID().slice(0,8)}`),engine=path.resolve('engine-dist');
const state=await mkdtemp('/tmp/cfarol-');
await mkdir(output,{recursive:true});
const registration={id:'farol-qualification',product:'companion-mac',profile:'portfolio-development',workspace:'',providers:['ollama'],hostTools:[]};
const identity=await security.ensureIdentity(state),credential=await security.createClientCredential(state,registration);
const store=new storage.Store(path.join(state,'metadata.sqlite'));store.register(credential);store.close();
await mkdir(path.join(state,'toolchains'),{mode:0o700});
await copyFile(path.resolve('.cache/game-toolchains/godot.json'),path.join(state,'toolchains/godot.json'));
const delay=()=>new Promise(resolve=>setTimeout(resolve,50));
let child,client,preview,logs='',passed=false;
async function boot(){
  child=spawn(path.join(engine,process.platform==='win32'?'node.exe':'node'),[path.join(engine,'service.cjs'),state],{stdio:['ignore','pipe','pipe']});
  for(const stream of [child.stdout,child.stderr])stream.on('data',bytes=>{logs=(logs+bytes).slice(-200000);});
  let ready=false;
  for(let i=0;i<600;i++){
    if(child.exitCode!==null)throw new Error(logs);
    try{if(JSON.parse(await readFile(path.join(state,'runtime.json'),'utf8')).pid===child.pid){ready=true;break;}}catch{}
    await delay();
  }
  assert.ok(ready,'Packaged service readiness');
  client=new sdk.AgentClient({address:security.ipcPath(state),certificate:identity.cert,credential});await client.connect();
}
async function stop(){client?.close();if(child?.exitCode===null){const exited=once(child,'exit');child.kill('SIGTERM');await exited;}}
async function settled(id){
  for(let i=0;i<6000;i++){
    const job=await client.getGameProduction(id);
    if(!['queued','running','cancelling'].includes(job.state)){
      await save(`jobs/${id}.json`,Buffer.from(JSON.stringify(job,null,2)));
      assert.equal(job.state,'completed',JSON.stringify(job));return job;
    }
    await delay();
  }
  throw new Error(`Observation expired; inspect original job ${id} in ${state} before repeating`);
}
async function save(name,bytes){const file=path.join(output,name);await mkdir(path.dirname(file),{recursive:true});await writeFile(file,bytes);}
async function files(directory=root){
  const result=[];
  for(const entry of await readdir(directory,{withFileTypes:true})){
    // No campaign solutions, editor caches, authoring programs or QA bridge in the game.
    if(['qa','.godot'].includes(entry.name))continue;
    const file=path.join(directory,entry.name),stat=await lstat(file);assert.ok(!stat.isSymbolicLink());
    if(stat.isDirectory())result.push(...await files(file));else if(stat.isFile())result.push(file);
  }
  return result.sort();
}
try{
  await boot();const document=JSON.parse(await readFile(path.join(root,'game.document.json'),'utf8'));
  for(const file of await files()){
    const name=path.relative(root,file).split(path.sep).join('/');
    if(name==='data/playtests.json')browserTests.gameBrowserTestSuite.parse(JSON.parse(await readFile(file,'utf8')));
    const mime=name.endsWith('.json')?'application/json':name.endsWith('.png')?'image/png':name.endsWith('.svg')?'image/svg+xml':'text/plain';
    document.files.push(await client.uploadGameFile(name,await readFile(file),mime));
  }
  document.assets=JSON.parse(await readFile(path.join(root,'data/asset-origins.json'),'utf8'));domain.gameDocument.parse(document);
  const project=await client.createGameProject('authored-farol-reference',document);
  await save('project.json',Buffer.from(JSON.stringify(project,null,2)));
  const build=await client.startGameBuild('build-farol-reference',project.id,project.revision);await settled(build.id);
  const artifact=await client.getGameArtifact(build.id);
  for(const file of artifact.files)await save(`build/${file.path}`,await client.downloadGameArtifactFile(build.id,file.path));
  // Godot exports the boot image independently of the project icon. Check the
  // actual build pixels, rather than treating the project setting as evidence.
  const splash=PNG.sync.read(await client.downloadGameArtifactFile(build.id,'index.png'));
  const expectedSplash=PNG.sync.read(await readFile(path.join(root,'icon.png')));
  assert.equal(splash.width,expectedSplash.width);assert.equal(splash.height,expectedSplash.height);
  // Resaving PNG can repair RGB in transparent edge pixels. Compare exact alpha
  // and premultiplied visible colors with at most one 8-bit rounding step.
  let splashDifference=0;
  for(let i=0;i<splash.data.length;i+=4){
    assert.equal(splash.data[i+3],expectedSplash.data[i+3],'Splash alpha is preserved');
    for(let channel=0;channel<3;channel++)splashDifference=Math.max(splashDifference,Math.abs(splash.data[i+channel]-expectedSplash.data[i+channel])*splash.data[i+3]/255);
  }
  assert.ok(splashDifference<=1,'Original lighthouse splash visible pixels are in the exported build');
  const observation=await client.startGameValidation('observe-farol-reference',build.id,'web-browser-runtime-v1');await settled(observation.id);
  const reports=await client.getGameReports(build.id);
  for(const report of reports)for(const file of report.evidence??[])await save(`observations/${report.id}/${file.path}`,await client.downloadGameReportFile(report.id,file.path));
  await save('reports.json',Buffer.from(JSON.stringify(reports,null,2)));
  for(const report of reports)for(const check of report.checks)assert.equal(check.status,'passed',JSON.stringify(report));
  assert.equal(reports.length,5);
  await stop();await boot();assert.deepEqual(await client.getGameProject(project.id),project);
  const exportParent=path.join(output,'source-export');await mkdir(exportParent,{recursive:true});
  const exported=await exports.exportGameDirectory({client,parent:exportParent,source:{projectId:project.id,revision:project.revision}});
  preview=await previewModule.openGamePreview({artifact,readFile:name=>client.downloadGameArtifactFile(build.id,name),signal:new AbortController().signal,headless:true});
  await preview.page.setViewportSize({width:960,height:640});
  await preview.page.locator('canvas').waitFor();await preview.page.waitForTimeout(3000);
  await preview.page.screenshot({path:path.join(output,'title.png')});
  await preview.page.keyboard.press('Enter');await preview.page.waitForTimeout(700);
  await preview.page.screenshot({path:path.join(output,'board.png')});
  await preview.page.keyboard.press('Space');await preview.page.waitForTimeout(500);
  await preview.page.screenshot({path:path.join(output,'first-island.png')});
  // Authored QA routes drive only ordinary canvas clicks. The game contains no
  // solution table, injected state, completion endpoint or privileged test bridge.
  const levels=JSON.parse(await readFile(path.join(root,'data/levels.json'),'utf8')).levels;
  const solutions=JSON.parse(await readFile(path.join(root,'qa/solutions.json'),'utf8'));
  const campaign=[];
  for(let i=0;i<levels.length;i++){
    if(i>0){
      const level=levels[i],cell=Math.min(904/level.width,405/level.height);
      const origin={x:28+(904-level.width*cell)/2,y:125+(405-level.height*cell)/2};
      for(const action of solutions[i].actions){
        const tile=level.tiles[action.tile];
        await preview.page.mouse.click(origin.x+(tile.x+.5)*cell,origin.y+(tile.y+.5)*cell,{button:action.direction<0?'right':'left'});
        await preview.page.waitForTimeout(80);
      }
      await preview.page.waitForTimeout(300);
    }
    const screenshot=await preview.page.screenshot();
    await save(`campaign/island-${String(i+1).padStart(2,'0')}.png`,screenshot);
    const pixels=PNG.sync.read(screenshot);
    // Independent rendered result controls, never a game-provided success flag.
    for(const [x,y] of [[432,294],[480,294],[528,294],[350,405]]){
      const offset=(y*pixels.width+x)*4;
      assert.ok(pixels.data[offset]>230&&pixels.data[offset+1]>170&&pixels.data[offset+2]<160,`Expected visible result stars/action on island ${i+1}`);
    }
    campaign.push({island:i+1,title:levels[i].title,actions:solutions[i].actions,observation:'Normal input path and rendered result controls; not human enjoyment/physical acceptance'});
    if(i<levels.length-1){await preview.page.keyboard.press('Enter');await preview.page.waitForTimeout(200);}
  }
  await save('campaign/trace.json',Buffer.from(JSON.stringify(campaign,null,2)));
  await preview.page.keyboard.press('Enter');await preview.page.waitForTimeout(200);
  await preview.page.screenshot({path:path.join(output,'campaign/map.png')});
  await preview.page.setViewportSize({width:844,height:390});await preview.page.waitForTimeout(300);
  await preview.page.screenshot({path:path.join(output,'campaign/wide-map.png')});
  await preview.page.mouse.click(75,345);await preview.page.waitForTimeout(200);
  await preview.page.screenshot({path:path.join(output,'campaign/wide-title.png')});
  await preview.page.keyboard.press('Enter');await preview.page.waitForTimeout(300);
  await preview.page.screenshot({path:path.join(output,'campaign/wide-board.png')});
  assert.deepEqual(preview.errors,[]);assert.deepEqual(preview.blocked,[]);await preview.close();preview=undefined;
  const quality=await client.getGameQuality(project.id);assert.equal(quality.ready,false,'Human/physical/content acceptance remains required');
  await save('evidence.json',Buffer.from(JSON.stringify({purpose:'Authored Godot puzzle, not autonomous generation or physical/human acceptance',project,artifact,reports,quality,editableSource:exported,splash:{width:splash.width,height:splash.height,exactAlpha:true,maxPremultipliedChannelDifference:splashDifference},manifestSha256:createHash('sha256').update(await readFile(path.join(engine,'manifest.json'))).digest('hex'),toolchain:JSON.parse(await readFile(path.join(state,'toolchains/godot.json'),'utf8'))},null,2)));
  await writeFile(path.join(base,'latest.json'),JSON.stringify({output,sourceHash:project.contentHash,artifactHash:artifact.artifactHash},null,2));
  passed=true;
}finally{
  await preview?.close();await stop();await save('service.log',Buffer.from(logs));
  if(passed)await rm(state,{recursive:true,force:true});else console.error(`Original qualification state preserved: ${state}; evidence ${output}\n${logs}`);
}
console.log(`FAROL_PACKAGED_REFERENCE_OBSERVED ${output}`);
