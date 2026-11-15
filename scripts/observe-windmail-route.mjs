// An external normal-input observer of one exact immutable export. No model,
// collector registration, runtime introspection, save/clock mutation or repair.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,mkdtemp,lstat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';
import {createInterface} from 'node:readline';
import {chromium} from 'playwright-core';
import {PNG} from 'pngjs';
import resourcesModule from '../dist-tests/packages/adapter-game-browser/src/resources.js';
import isolation from '../dist-tests/packages/adapter-game-browser/src/isolation.js';
import contracts from '../dist-tests/packages/contracts/src/game-production.js';
assert.equal(process.versions.node,'22.23.4');assert.equal(process.argv.length,4);
const arg=name=>{const value=process.argv.find(a=>a.startsWith(name+'='));assert.ok(value);return path.resolve(value.slice(name.length+1));};
const attempt=arg('--attempt'),output=arg('--output');await mkdir(output);
const raw=await readFile(path.join(attempt,'report.json')),report=JSON.parse(raw),project=report.projects[0];assert.equal(report.projects.length,1);
const built=project.builds.find(b=>b.artifact.sourceHash===project.project.contentHash);assert.ok(built);const artifact=contracts.gameArtifact.parse(built.artifact);
assert.equal(artifact.engine,'phaser');const build=path.join(attempt,'projects',project.project.id,'builds',artifact.jobId),sha=b=>createHash('sha256').update(b).digest('hex');
async function readBuildFile(name){const file=artifact.files.find(f=>f.path===name);assert.ok(file);let p=build;assert.ok(!(await lstat(p)).isSymbolicLink());for(const component of name.split('/')){p=path.join(p,component);assert.ok(!(await lstat(p)).isSymbolicLink());}const bytes=await readFile(p);assert.equal(bytes.length,file.size);assert.equal(sha(bytes),file.sha256);return bytes;}
for(const file of artifact.files)await readBuildFile(file.path);
const root=await mkdtemp(path.join(tmpdir(),'windmail-route-')),env={HOME:root,PATH:'/usr/bin:/bin',TMPDIR:root,LANG:'en_US.UTF-8'},abort=new AbortController();
let server,browser,owned,resources,opened,passed=false,ended=false;const steps=[],errors=[],blocked=[];
const save=(name,value)=>writeFile(path.join(output,name),JSON.stringify(value,null,2)+'\n');
let input;
const deadline=setTimeout(()=>{abort.abort();input?.close();void server?.kill().catch(()=>{});},15*60*1000);
async function capture(label){const file=label+'.png',bytes=await opened.page.locator('canvas').first().screenshot({path:path.join(output,file),timeout:2000});return {file,sha256:sha(bytes),bytes:bytes.length};}
function visibleOverlay(bytes){
  const image=PNG.sync.read(bytes);assert.equal(image.width,1024);assert.equal(image.height,768);
  // Public rendered gold frame, not game variables, canvas JS or OCR supplied
  // by the game. Retain every frame used to acknowledge the normal UI action.
  return [200,400,600,800].every(x=>{const p=(229*image.width+x)*4;return image.data[p]>220&&image.data[p+1]>170&&image.data[p+2]>70&&image.data[p+2]<200;});
}
async function acknowledgeOverlay(expected,label){
  for(let i=0;i<8;i++){
    const image=await capture(label+'-'+i),shown=visibleOverlay(await readFile(path.join(output,image.file)));
    steps.push({action:'observe-overlay-frame',expected,shown,image});
    if(shown===expected)return;
    await new Promise(resolve=>setTimeout(resolve,50));
  }
  throw Error('Rendered overlay did not acknowledge the normal UI action; preserve original frames, do not infer pause/resume.');
}
try{
  const module=pathToFileURL(path.resolve('dist-tests/packages/adapter-game-browser/src/browser.js')).href;
  const qualified=JSON.parse((await promisify(execFile)(process.execPath,['--input-type=module','-e',"const m=await import(process.argv[1]);const q=await m.default.qualifyBrowser();if(!q)throw Error('Qualified browser unavailable');process.stdout.write(JSON.stringify(q));",module],{env,maxBuffer:16384,timeout:10000})).stdout);
  await save('control.json',{observerSha256:sha(await readFile(new URL(import.meta.url))),originalReportSha256:sha(raw),qualifiedBrowser:qualified,artifactHash:artifact.artifactHash,sourceHash:artifact.sourceHash,modelCalls:0,
    protocol:'A ready menu is first captured. Enter/P are normal keys held40ms; screenshots acknowledge appearance/disappearance of the rendered overlay frame. Commands resume, hold allowlisted steering/throttle keys for <=2000ms, release, capture, then pause with acknowledged P. No automatic key retries. Pauses are game UI actions, not simulation clock changes. Finish closes original browser; observation timeout is not completion.'});
  server=await chromium.launchServer({executablePath:qualified.executablePath,headless:true,chromiumSandbox:true,host:'127.0.0.1',env,timeout:10000,args:['--force-webrtc-ip-handling-policy=disable_non_proxied_udp','--webrtc-ip-handling-policy=disable_non_proxied_udp']});
  owned=server.process();browser=await chromium.connect(server.wsEndpoint());assert.ok(qualified.version.includes(browser.version()));
  const access={artifact,readFile:readBuildFile};resources=await resourcesModule.serveArtifactResources({...access,signal:abort.signal});
  opened=await isolation.openGameArtifactPage(browser,access,{width:1024,height:768},errors,blocked,abort.signal,resources);
  steps.push({action:'initial-presentation-capture',image:await capture('00-menu')});
  await opened.page.keyboard.press('Enter',{delay:40});steps.push({action:'press',key:'Enter',delayMs:40});await acknowledgeOverlay(false,'01-start');
  await opened.page.keyboard.press('P',{delay:40});steps.push({action:'press',key:'P',delayMs:40});await acknowledgeOverlay(true,'01-paused');
  console.log('WINDMAIL_ROUTE_READY '+output);
  // Attach only when ready: a pre-piped replay must not lose line events while
  // browser/bootstrap setup is still awaiting. This is an observer input fix.
  input=createInterface({input:process.stdin,crlfDelay:Infinity});
  for await(const line of input){
    abort.signal.throwIfAborted();assert.ok(line.length<=1024);const command=JSON.parse(line);
    if(command.action==='finish'){assert.deepEqual(command,{action:'finish'});ended=true;break;}
    if(command.action==='reload'||command.action==='restart'){
      assert.deepEqual(command,{action:command.action});const label=String(steps.length).padStart(2,'0')+'-'+command.action;
      if(command.action==='reload'){
        await opened.page.reload({waitUntil:'load',timeout:5000});await acknowledgeOverlay(true,label+'-menu');
        steps.push({action:'normal-reload',image:await capture(label+'-menu')});
        await opened.page.keyboard.press('Enter',{delay:40});
      }else{await opened.page.keyboard.press('R',{delay:40});}
      await acknowledgeOverlay(false,label+'-active');steps.push({action:command.action==='reload'?'normal-reload-new-game':'normal-keyboard-restart',image:await capture(label+'-active')});
      await opened.page.keyboard.press('P',{delay:40});await acknowledgeOverlay(true,label+'-paused');await save('steps.json',{steps,errors,blocked});console.log('WINDMAIL_ROUTE_SHOT '+label+'-active.png');continue;
    }
    assert.ok(steps.length<600);assert.deepEqual(Object.keys(command).sort(),['keys','ms']);
    assert.ok(Array.isArray(command.keys)&&command.keys.length<=2&&new Set(command.keys).size===command.keys.length);
    assert.ok(command.keys.every(key=>['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(key)));assert.ok(Number.isInteger(command.ms)&&command.ms>=1&&command.ms<=2000);
    await opened.page.keyboard.press('P',{delay:40});await acknowledgeOverlay(false,String(steps.length).padStart(2,'0')+'-resume');
    const began=performance.now();
    try{for(const key of command.keys)await opened.page.keyboard.down(key);await new Promise(resolve=>setTimeout(resolve,command.ms));}
    finally{for(const key of [...command.keys].reverse())await opened.page.keyboard.up(key);}
    const heldMs=performance.now()-began,image=await capture(String(steps.length).padStart(2,'0')+'-route');
    steps.push({action:'normal-game-ui-resume-input-capture-pause',command,heldMs,image});await opened.page.keyboard.press('P',{delay:40});await acknowledgeOverlay(true,String(steps.length).padStart(2,'0')+'-pause');
    await save('steps.json',{steps,errors,blocked});console.log('WINDMAIL_ROUTE_SHOT '+image.file);
  }
  assert.ok(ended,'Input ended without explicit finish; do not infer route completion');assert.equal(errors.length,0);assert.equal(blocked.length,0);
  await opened.context.close();opened=undefined;await resources.close();resources=undefined;await server.close();assert.equal(owned.exitCode,0);assert.equal(browser.isConnected(),false);
  for(const file of artifact.files)await readBuildFile(file.path);assert.ok(raw.equals(await readFile(path.join(attempt,'report.json'))));
  await save('report.json',{scope:'External keyboard/canvas observation with normal game pause between inspected frames. Screenshots require review; no game-provided counters certify quality or human acceptance.',artifactHash:artifact.artifactHash,sourceHash:artifact.sourceHash,qualifiedBrowser:qualified,steps,errors,blocked,originalBuildAndReportUnchanged:true,modelCalls:0,qualityApproved:false,collectorRegistered:false});passed=true;console.log('WINDMAIL_ROUTE_OBSERVED '+output);
}catch(error){const message=String(error?.message??error).replace(/wss?:\/\/\S+/g,'[private browser control]').slice(0,3000);await save('failure.json',{message,ownedPid:owned?.pid,privateRoot:root,steps:steps.length});process.exitCode=1;console.error(message);}
finally{
  clearTimeout(deadline);input?.close();await opened?.context.close().catch(()=>{});await resources?.close().catch(()=>{});
  if(server&&owned?.exitCode===null)try{await server.close();}catch{await server.kill().catch(()=>{});}
  if(passed&&owned?.exitCode===0)await rm(root,{recursive:true,force:true});
  await save('closure.json',{ownedPid:owned?.pid,exitCode:owned?.exitCode,signalCode:owned?.signalCode,browserDisconnected:browser?!browser.isConnected():null,privateRootRemoved:passed&&owned?.exitCode===0});
}
