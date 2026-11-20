// External normal-input observer. No game variables/storage/clock mutation.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,mkdtemp,lstat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright-core';
import {PNG} from 'pngjs';
import resourcesModule from '../dist-tests/packages/adapter-game-browser/src/resources.js';
import isolation from '../dist-tests/packages/adapter-game-browser/src/isolation.js';
import contracts from '../dist-tests/packages/contracts/src/game-production.js';
assert.equal(process.versions.node,'22.23.4');assert.equal(process.argv.length,4);
const source=path.resolve(process.argv[2]),output=path.resolve(process.argv[3]);await mkdir(output);
const sha=b=>createHash('sha256').update(b).digest('hex'),raw=await readFile(path.join(source,'artifact.json')),artifact=contracts.gameArtifact.parse(JSON.parse(raw));
const build=path.join(source,'build');
async function readBuildFile(name){const file=artifact.files.find(f=>f.path===name);assert.ok(file);let p=build;assert.ok(!(await lstat(p)).isSymbolicLink());for(const part of name.split('/')){p=path.join(p,part);assert.ok(!(await lstat(p)).isSymbolicLink());}const bytes=await readFile(p);assert.equal(bytes.length,file.size);assert.equal(sha(bytes),file.sha256);return bytes;}
for(const file of artifact.files)await readBuildFile(file.path);
const root=await mkdtemp('/private/tmp/wm-save-browser-'),env={HOME:root,PATH:'/usr/bin:/bin',TMPDIR:root,LANG:'en_US.UTF-8'},abort=new AbortController();
let server,browser,owned,resources,opened,passed=false;const steps=[],errors=[],blocked=[];
const save=(name,value)=>writeFile(path.join(output,name),JSON.stringify(value,null,2)+'\n');
const deadline=setTimeout(()=>{abort.abort();void server?.kill().catch(()=>{});},120000);
async function capture(label){if(await opened.page.getByRole('dialog').isVisible())await new Promise(r=>setTimeout(r,180));const file=label+'.png',bytes=await opened.page.screenshot({path:path.join(output,file),timeout:3000});const image={file,sha256:sha(bytes)};steps.push({action:'capture',image});return image;}
function visibleOverlay(bytes){const image=PNG.sync.read(bytes);assert.equal(image.width,1024);assert.equal(image.height,768);return [200,400,600,800].every(x=>{const p=(229*image.width+x)*4;return image.data[p]>220&&image.data[p+1]>170&&image.data[p+2]>70&&image.data[p+2]<200;});}
async function acknowledgeOverlay(expected,label){for(let i=0;i<8;i++){const bytes=await opened.page.locator('canvas').first().screenshot({timeout:2000}),shown=visibleOverlay(bytes);const file=`${label}-${i}.png`;await writeFile(path.join(output,file),bytes);steps.push({action:'observe-overlay-frame',expected,shown,image:{file,sha256:sha(bytes)}});if(shown===expected)return;await new Promise(r=>setTimeout(r,50));}throw Error('Rendered frame did not acknowledge pause/resume');}
async function saved(){const status=opened.page.locator('#wm-save-status');for(let i=0;i<200;i++){const text=await status.textContent(),match=/^Viagem salva · (\d)\/5 cartas · (\d+) pontos$/.exec(text??'');if(match)return {leg:Number(match[1]),score:Number(match[2]),text};await new Promise(r=>setTimeout(r,25));}throw Error('Visible save acknowledgment missing');}
async function button(label){await opened.page.getByRole('button',{name:label,exact:true}).click();steps.push({action:'visible-button',label});}
try{
 const module=pathToFileURL(path.resolve('dist-tests/packages/adapter-game-browser/src/browser.js')).href;
 const qualified=JSON.parse((await promisify(execFile)(process.execPath,['--input-type=module','-e',"const m=await import(process.argv[1]);const q=await m.default.qualifyBrowser();if(!q)throw Error('Qualified browser unavailable');process.stdout.write(JSON.stringify(q));",module],{env,maxBuffer:16384,timeout:10000})).stdout);
 await save('control.json',{observerSha256:sha(await readFile(new URL(import.meta.url))),artifactSha256:sha(raw),artifactHash:artifact.artifactHash,sourceHash:artifact.sourceHash,qualifiedBrowser:qualified,realModelCalls:0,manualSourceIntegration:true,protocol:'Only visible buttons/status, normal keyboard input, PNG overlay acknowledgment and normal reload. Pause between inspected frames. No variables, storage writes, clocks or synthetic quality collectors.'});
 server=await chromium.launchServer({executablePath:qualified.executablePath,headless:true,chromiumSandbox:true,host:'127.0.0.1',env,timeout:10000,args:['--force-webrtc-ip-handling-policy=disable_non_proxied_udp','--webrtc-ip-handling-policy=disable_non_proxied_udp']});owned=server.process();browser=await chromium.connect(server.wsEndpoint());assert.ok(qualified.version.includes(browser.version()));
 const access={artifact,readFile:readBuildFile};resources=await resourcesModule.serveArtifactResources({...access,signal:abort.signal});opened=await isolation.openGameArtifactPage(browser,access,{width:1024,height:768},errors,blocked,abort.signal,resources);
 await opened.page.getByRole('button',{name:'Iniciar viagem',exact:true}).waitFor();await capture('00-start-menu');await button('Iniciar viagem');await acknowledgeOverlay(false,'01-active');await opened.page.keyboard.press('P',{delay:40});await acknowledgeOverlay(true,'02-paused');await saved();
 const replay=path.resolve('output/playwright/windmail-route/mid-route-reload-20261113.jsonl'),commands=(await readFile(replay,'utf8')).trim().split('\n').map(line=>JSON.parse(line)).filter(c=>c.keys);assert.equal(commands.length,11);await save('replay.json',commands);
 for(const [index,command]of commands.entries()){
  assert.ok(command.keys.every(key=>['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(key)));assert.ok(command.ms>0&&command.ms<=2000);
  await opened.page.keyboard.press('P',{delay:40});await acknowledgeOverlay(false,`move-${index}-resume`);const began=performance.now();try{for(const key of command.keys)await opened.page.keyboard.down(key);await new Promise(r=>setTimeout(r,command.ms));}finally{for(const key of [...command.keys].reverse())await opened.page.keyboard.up(key);}
  steps.push({action:'normal-keys',command,heldMs:performance.now()-began});await capture(`move-${index}`);await opened.page.keyboard.press('P',{delay:40});await acknowledgeOverlay(true,`move-${index}-paused`);await saved();
 }
 const before=await saved();assert.ok(before.leg>0&&before.leg<5,'Route must earn actual progress before reload');await capture('20-before-reload');
 await opened.page.reload({waitUntil:'load',timeout:5000});await opened.page.getByRole('button',{name:'Continuar viagem',exact:true}).waitFor();const summary=await opened.page.locator('.wm-recovery-detail').textContent();assert.ok(summary.includes(`${before.leg} de 5 cartas entregues · ${before.score} pontos`));await capture('21-recovery-menu');
 await button('Continuar viagem');await acknowledgeOverlay(false,'22-recovered-active');await opened.page.keyboard.press('P',{delay:40});await acknowledgeOverlay(true,'23-recovered-paused');const recovered=await saved();assert.equal(recovered.leg,before.leg);assert.equal(recovered.score,before.score);await capture('24-recovered');
 await opened.page.keyboard.press('R',{delay:40});await opened.page.getByRole('button',{name:'Começar nova viagem',exact:true}).waitFor();await capture('25-confirm-new');await button('Voltar');assert.equal((await saved()).text,recovered.text);await capture('26-cancel-preserves');
 await opened.page.keyboard.press('R',{delay:40});await button('Começar nova viagem');await acknowledgeOverlay(false,'27-new-active');await saved();await opened.page.keyboard.press('P',{delay:40});await acknowledgeOverlay(true,'27-new-paused');const restarted=await saved();assert.equal(restarted.leg,0);assert.equal(restarted.score,0);await capture('28-new-trip');
 await opened.page.reload({waitUntil:'load',timeout:5000});await opened.page.getByRole('button',{name:'Continuar viagem',exact:true}).waitFor();assert.ok((await opened.page.locator('.wm-recovery-detail').textContent()).includes('0 de 5 cartas entregues · 0 pontos'));await capture('29-new-trip-recovered');
 assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);await save('observations.json',{before,recovered,restarted,summary,steps,errors,blocked});
 await opened.context.close();opened=undefined;await resources.close();resources=undefined;await server.close();assert.equal(owned.exitCode,0);assert.equal(browser.isConnected(),false);for(const file of artifact.files)await readBuildFile(file.path);assert.ok(raw.equals(await readFile(path.join(source,'artifact.json'))));
 await save('report.json',{scope:'Authored integration of Luna51: earned progress, visible save acknowledgment, normal reload/continue, cancellation of restart, confirmed new trip and reload. Pauses between inspected frames; PNGs require review.',artifactHash:artifact.artifactHash,sourceHash:artifact.sourceHash,before,recovered,restarted,errors,blocked,realModelCalls:0,manualSourceIntegration:true,qualityApproved:false,installed:false,humanPlaytest:false,collectorRegistered:false});passed=true;console.log('WINDMAIL_SAVE_OBSERVED '+output);
}catch(error){await save('failure.json',{message:String(error?.message??error).slice(0,2000),ownedPid:owned?.pid,privateRoot:root,steps,errors,blocked});if(opened)try{await capture('failure');}catch{}process.exitCode=1;console.error(String(error?.message??error).slice(0,2000));}
finally{clearTimeout(deadline);await opened?.context.close().catch(()=>{});await resources?.close().catch(()=>{});if(server&&owned?.exitCode===null)try{await server.close();}catch{await server.kill().catch(()=>{});}if(passed&&owned?.exitCode===0)await rm(root,{recursive:true,force:true});await save('closure.json',{ownedPid:owned?.pid,exitCode:owned?.exitCode,signalCode:owned?.signalCode,browserDisconnected:browser?!browser.isConnected():null,privateRootRemoved:passed&&owned?.exitCode===0});}
