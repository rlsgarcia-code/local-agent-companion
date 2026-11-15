// External normal-input diagnostic of one immutable exported game. Not a
// collector, source repair, game-provided readiness signal or acceptance report.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,mkdtemp,lstat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright-core';
import resourcesModule from '../dist-tests/packages/adapter-game-browser/src/resources.js';
import isolation from '../dist-tests/packages/adapter-game-browser/src/isolation.js';
import pixels from '../dist-tests/packages/adapter-game-browser/src/pixels.js';
import contracts from '../dist-tests/packages/contracts/src/game-production.js';
assert.equal(process.versions.node,'22.23.4');assert.equal(process.argv.length,4);
const arg=name=>{const value=process.argv.find(a=>a.startsWith(name+'='));assert.ok(value);return path.resolve(value.slice(name.length+1));};
const attempt=arg('--attempt'),output=arg('--output');await mkdir(output);
const raw=await readFile(path.join(attempt,'report.json')),report=JSON.parse(raw),project=report.projects[0];assert.equal(report.projects.length,1);
const built=project.builds.find(b=>b.artifact.sourceHash===project.project.contentHash);assert.ok(built);const artifact=contracts.gameArtifact.parse(built.artifact);
assert.equal(artifact.engine,'phaser');const build=path.join(attempt,'projects',project.project.id,'builds',artifact.jobId),sha=b=>createHash('sha256').update(b).digest('hex');
async function readBuildFile(name){const file=artifact.files.find(f=>f.path===name);assert.ok(file);let p=build;assert.ok(!(await lstat(p)).isSymbolicLink());for(const component of name.split('/')){p=path.join(p,component);assert.ok(!(await lstat(p)).isSymbolicLink());}const bytes=await readFile(p);assert.equal(bytes.length,file.size);assert.equal(sha(bytes),file.sha256);return bytes;}
for(const file of artifact.files)await readBuildFile(file.path);
const root=await mkdtemp(path.join(tmpdir(),'game-input-observer-')),env={HOME:root,PATH:'/usr/bin:/bin',TMPDIR:root,LANG:'en_US.UTF-8'},abort=new AbortController();
let server,browser,owned,resources,opened,passed=false;const results=[];
const save=(name,value)=>writeFile(path.join(output,name),JSON.stringify(value,null,2)+'\n');
const deadline=setTimeout(()=>{abort.abort();void server?.kill().catch(()=>{});},45000);
try{
  const module=pathToFileURL(path.resolve('dist-tests/packages/adapter-game-browser/src/browser.js')).href;
  const qualified=JSON.parse((await promisify(execFile)(process.execPath,['--input-type=module','-e',"const m=await import(process.argv[1]);const q=await m.default.qualifyBrowser();if(!q)throw Error('Qualified browser unavailable');process.stdout.write(JSON.stringify(q));",module],{env,maxBuffer:16384,timeout:10000})).stdout);
  await save('control.json',{observerSha256:sha(await readFile(new URL(import.meta.url))),originalReportSha256:sha(raw),qualifiedBrowser:qualified,
    artifactHash:artifact.artifactHash,sourceHash:artifact.sourceHash,originalReportPreserved:true,modelCalls:0});
  server=await chromium.launchServer({executablePath:qualified.executablePath,headless:true,chromiumSandbox:true,host:'127.0.0.1',env,timeout:10000,
    args:['--force-webrtc-ip-handling-policy=disable_non_proxied_udp','--webrtc-ip-handling-policy=disable_non_proxied_udp']});owned=server.process();browser=await chromium.connect(server.wsEndpoint());assert.ok(qualified.version.includes(browser.version()));
  const access={artifact,readFile:readBuildFile};resources=await resourcesModule.serveArtifactResources({...access,signal:abort.signal});
  for(let repetition=1;repetition<=3;repetition++)for(const captureFirst of [false,true]){
    const name=`${repetition}-${captureFirst?'capture-first':'immediate-input'}`,dir=path.join(output,name);await mkdir(dir);const errors=[],blocked=[];
    opened=await isolation.openGameArtifactPage(browser,access,{width:1024,height:768},errors,blocked,abort.signal,resources);
    const {page}=opened,canvas=page.locator('canvas').first(),began=performance.now();
    if(captureFirst)await canvas.screenshot({path:path.join(dir,'before-input.png'),timeout:2000});
    const inputAfterLoadMs=performance.now()-began;
    await page.keyboard.press('Enter');await page.keyboard.press('P');const paused=await canvas.screenshot({path:path.join(dir,'paused.png'),timeout:2000});
    await new Promise(resolve=>setTimeout(resolve,500));const held=await canvas.screenshot({path:path.join(dir,'still-paused.png'),timeout:2000});
    await page.keyboard.press('P');const resumed=await canvas.screenshot({path:path.join(dir,'resumed.png'),timeout:2000});
    const unchangedRatio=pixels.imageDifference(paused,held),resumedRatio=pixels.imageDifference(paused,resumed);
    results.push({name,captureFirst,inputAfterLoadMs,unchangedRatio,resumedRatio,savedPixelConditions:{unchanged:unchangedRatio<=.001,changed:resumedRatio>.001},errors,blocked});
    await opened.context.close();opened=undefined;
  }
  await resources.close();resources=undefined;await server.close();assert.equal(owned.exitCode,0);assert.equal(browser.isConnected(),false);
  for(const file of artifact.files)await readBuildFile(file.path);assert.ok(raw.equals(await readFile(path.join(attempt,'report.json'))));
  await save('report.json',{scope:'Paired external keyboard/canvas observations of the exact unchanged export. One group adds an initial normal canvas capture; no game internals, clocks, save, code or QA reports edited. Not semantic, physical or quality acceptance.',
    artifactHash:artifact.artifactHash,sourceHash:artifact.sourceHash,qualifiedBrowser:qualified,results,originalBuildAndReportUnchanged:true,modelCalls:0,qualityApproved:false,collectorRegistered:false});
  passed=true;console.log('GAME_INPUT_STARTUP_DIAGNOSTIC '+output);
}catch(error){const message=String(error?.message??error).replace(/wss?:\/\/\S+/g,'[private browser control]').slice(0,3000);await save('failure.json',{message,ownedPid:owned?.pid,privateRoot:root});process.exitCode=1;console.error(message);}
finally{
  clearTimeout(deadline);await opened?.context.close().catch(()=>{});await resources?.close().catch(()=>{});
  if(server&&owned?.exitCode===null)try{await server.close();}catch{await server.kill().catch(()=>{});}
  if(passed&&owned?.exitCode===0)await rm(root,{recursive:true,force:true});
  await save('closure.json',{ownedPid:owned?.pid,exitCode:owned?.exitCode,signalCode:owned?.signalCode,browserDisconnected:browser?!browser.isConnected():null,privateRootRemoved:passed&&owned?.exitCode===0});
}
