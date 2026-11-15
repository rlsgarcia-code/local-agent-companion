// Interactive normal-input campaign and sustained-wind observer. No game variables/storage/clock mutation.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,mkdtemp,lstat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createInterface} from 'node:readline';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright-core';
import resourcesModule from '../dist-tests/packages/adapter-game-browser/src/resources.js';
import isolation from '../dist-tests/packages/adapter-game-browser/src/isolation.js';
import contracts from '../dist-tests/packages/contracts/src/game-production.js';
import {openInstalledBrowserPreview} from './game-qualification/installed-browser.mjs';
assert.equal(process.versions.node,'22.23.4');assert.ok([4,5,6].includes(process.argv.length));
const browserName=process.argv[4]??'chromium';assert.ok(['chromium','firefox','webkit'].includes(browserName));
const keyboardRecovery=process.argv[5]==='--keyboard-recovery';if(process.argv[5])assert.ok(keyboardRecovery);
assert.ok(Object.keys(process.env).every(key=>['HOME','PATH','TMPDIR','LANG','PLAYWRIGHT_BROWSERS_PATH','__CF_USER_TEXT_ENCODING'].includes(key)),'Use a closed launcher environment, never inherited provider credentials');
const source=path.resolve(process.argv[2]),output=path.resolve(process.argv[3]);await mkdir(output);
const sha=b=>createHash('sha256').update(b).digest('hex'),raw=await readFile(path.join(source,'artifact.json')),artifact=contracts.gameArtifact.parse(JSON.parse(raw));
const build=path.join(source,'build');
async function readBuildFile(name){const file=artifact.files.find(f=>f.path===name);assert.ok(file);let p=build;assert.ok(!(await lstat(p)).isSymbolicLink());for(const part of name.split('/')){p=path.join(p,part);assert.ok(!(await lstat(p)).isSymbolicLink());}const bytes=await readFile(p);assert.equal(bytes.length,file.size);assert.equal(sha(bytes),file.sha256);return bytes;}
for(const file of artifact.files)await readBuildFile(file.path);
const root=await mkdtemp('/private/tmp/wm-save-browser-'),env={HOME:root,PATH:'/usr/bin:/bin',TMPDIR:root,LANG:'en_US.UTF-8'},abort=new AbortController();
let server,browser,owned,resources,opened,alternatePreview,alternateClosure,input,passed=false;const steps=[];let errors=[],blocked=[];
const save=(name,value)=>writeFile(path.join(output,name),JSON.stringify(value,null,2)+'\n');
const deadline=setTimeout(()=>{abort.abort();input?.close();void server?.kill().catch(()=>{});},15*60*1000);
async function capture(label){if(await opened.page.getByRole('dialog').isVisible())await new Promise(r=>setTimeout(r,180));const file=label+'.png',bytes=await opened.page.screenshot({path:path.join(output,file),timeout:3000});const image={file,sha256:sha(bytes)},presentation={canvas:await opened.page.locator('canvas').boundingBox(),letters:await opened.page.locator('#wm-letters').textContent(),score:await opened.page.locator('#wm-score').textContent(),navigation:await opened.page.locator('#wm-navigation').textContent()};steps.push({action:'capture',image,presentation});return image;}
async function acknowledgeOverlay(expected,label){
 for(let i=0;i<8;i++){const shown=await opened.page.getByRole('dialog').isVisible();steps.push({action:'observe-public-dialog',expected,shown});if(shown===expected)return;await new Promise(r=>setTimeout(r,50));}throw Error('Public dialog did not acknowledge the UI action');
}
async function saved(){const status=opened.page.locator('#wm-save-status');for(let i=0;i<200;i++){const text=await status.textContent(),match=/^Viagem salva · (\d)\/5 cartas · (\d+) pontos$/.exec(text??'');if(match)return {leg:Number(match[1]),score:Number(match[2]),text};await new Promise(r=>setTimeout(r,25));}throw Error('Visible save acknowledgment missing');}
async function button(label){await opened.page.getByRole('dialog').getByRole('button',{name:label,exact:true}).click();steps.push({action:'visible-button',label});}
try{
 const module=pathToFileURL(path.resolve('dist-tests/packages/adapter-game-browser/src/browser.js')).href;
 const qualified=browserName==='chromium'?JSON.parse((await promisify(execFile)(process.execPath,['--input-type=module','-e',"const m=await import(process.argv[1]);const q=await m.default.qualifyBrowser();if(!q)throw Error('Qualified browser unavailable');process.stdout.write(JSON.stringify(q));",module],{env,maxBuffer:16384,timeout:10000})).stdout):undefined;
 await writeFile(path.join(output,'observer.mjs'),await readFile(new URL(import.meta.url)));
 await save('control.json',{observerSha256:sha(await readFile(new URL(import.meta.url))),artifactSha256:sha(raw),artifactHash:artifact.artifactHash,sourceHash:artifact.sourceHash,browserName,keyboardRecovery,qualifiedBrowser:qualified,realModelCalls:0,manualSourceIntegration:true,protocol:'Interactive 15-minute observer; timing replay failures are preserved. Only visible buttons/status, normal keyboard input, PNG overlay acknowledgment and normal reload. Pause between inspected frames. No variables, storage writes, clocks or synthetic quality collectors.'});
 if(browserName==='chromium'){
 server=await chromium.launchServer({executablePath:qualified.executablePath,headless:true,chromiumSandbox:true,host:'127.0.0.1',env,timeout:10000,args:['--force-webrtc-ip-handling-policy=disable_non_proxied_udp','--webrtc-ip-handling-policy=disable_non_proxied_udp']});owned=server.process();browser=await chromium.connect(server.wsEndpoint());assert.ok(qualified.version.includes(browser.version()));
 const access={artifact,readFile:readBuildFile};resources=await resourcesModule.serveArtifactResources({...access,signal:abort.signal});opened=await isolation.openGameArtifactPage(browser,access,{width:1024,height:768},errors,blocked,abort.signal,resources);
 }else{
  alternatePreview=await openInstalledBrowserPreview({name:browserName,artifact,readFile:readBuildFile,signal:abort.signal});opened={page:alternatePreview.page,context:alternatePreview.page.context()};errors=alternatePreview.errors;blocked=alternatePreview.blocked;await opened.page.setViewportSize({width:1024,height:768});await save('browser.json',alternatePreview.browserMetadata);
 }
 await opened.page.getByRole('button',{name:'Iniciar viagem',exact:true}).waitFor();await capture('00-start-menu');await button('Iniciar viagem');await acknowledgeOverlay(false,'01-active');await opened.page.keyboard.press('M',{delay:40});await opened.page.keyboard.press('P',{delay:40});await acknowledgeOverlay(true,'02-paused');await saved();
 console.log('WINDMAIL_RESPONSIVE_CAMPAIGN_READY '+output);
 input=createInterface({input:process.stdin,crlfDelay:Infinity});let index=0;
 for await(const line of input){
  assert.ok(index<100);assert.ok(line.length<1000);const command=JSON.parse(line);
  if(command.action==='toggle-sail'){
   assert.deepEqual(command,{action:'toggle-sail'});await opened.page.keyboard.press('P',{delay:40});await acknowledgeOverlay(false,`move-${index}-resume`);
   const label=await opened.page.locator('#wm-sail').textContent();await opened.page.getByRole('button',{name:label,exact:true}).click();steps.push({action:'visible-sail-button',label});
   await capture(`move-${index}`);await opened.page.keyboard.press('P',{delay:40});await acknowledgeOverlay(true,`move-${index}-paused`);await saved();await save('live-steps.json',{steps,errors,blocked});console.log('WINDMAIL_RESPONSIVE_CAMPAIGN_SHOT '+`move-${index}.png`);index++;continue;
  }
  assert.deepEqual(Object.keys(command).sort(),['keys','ms']);assert.ok(Array.isArray(command.keys)&&command.keys.length<=2);assert.ok(Number.isInteger(command.ms));
  assert.ok(command.keys.every(key=>['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(key)));assert.ok(command.ms>0&&command.ms<=2000);
  await opened.page.keyboard.press('P',{delay:40});await acknowledgeOverlay(false,`move-${index}-resume`);const began=performance.now();try{for(const key of command.keys)await opened.page.keyboard.down(key);await new Promise(r=>setTimeout(r,command.ms));}finally{for(const key of [...command.keys].reverse())await opened.page.keyboard.up(key);}
  steps.push({action:'normal-keys',command,heldMs:performance.now()-began});await capture(`move-${index}`);await opened.page.keyboard.press('P',{delay:40});await acknowledgeOverlay(true,`move-${index}-paused`);await save('live-steps.json',{steps,errors,blocked});console.log('WINDMAIL_RESPONSIVE_CAMPAIGN_SHOT '+`move-${index}.png`);index++;if((await saved()).leg===5){input.close();break;}
 }
 const completed=await saved();assert.equal(completed.leg,5,'Full route must complete five real deliveries');assert.ok(completed.score>0);await capture('30-completed');
 await saved();await capture('31-completed-muted');
 await opened.page.reload({waitUntil:'load',timeout:5000});await opened.page.getByRole('button',{name:'Ver resultado',exact:true}).waitFor();const summary=await opened.page.locator('.wm-recovery-detail').textContent();assert.ok(summary.includes(`5 de 5 cartas entregues · ${completed.score} pontos`));await capture('32-completed-recovered-menu');
 await button('Ver resultado');await acknowledgeOverlay(true,'33-result');const recovered={leg:5,score:completed.score,source:'visible recovered summary and result PNG'};await capture('34-result-recovered');
 // Viewing a finished result does not dispatch a new checkpoint. Its visible
 // recovered status differs from a save acknowledgment; preserve that distinction.
 assert.equal(await opened.page.locator('#wm-save-status').textContent(),`Viagem recuperada · 5/5 cartas · ${completed.score} pontos`);
 await button('JOGAR DE NOVO');await button('Começar nova viagem');await acknowledgeOverlay(false,'35-new-active');await saved();await opened.page.keyboard.press('P',{delay:40});await acknowledgeOverlay(true,'36-new-paused');const restarted=await saved();assert.equal(restarted.leg,0);assert.equal(restarted.score,0);await capture('37-new-keeps-best-mute');
 // Normal steering/reverse circles exercise >30 active seconds without reading
 // simulation state. No timestamp, variable, storage or game-source modification.
 await opened.page.keyboard.press('P',{delay:40});await acknowledgeOverlay(false,'38-wind-active');
 const windBegan=performance.now();try{await opened.page.keyboard.down('ArrowDown');await opened.page.keyboard.down('ArrowRight');for(let i=0;i<17;i++){await new Promise(r=>setTimeout(r,2000));if(i===13||i===16)await capture(`wind-${i}`);}}finally{await opened.page.keyboard.up('ArrowRight');await opened.page.keyboard.up('ArrowDown');}
 steps.push({action:'normal-sustained-reverse-steer',heldMs:performance.now()-windBegan,keys:['ArrowDown','ArrowRight']});await opened.page.keyboard.press('P',{delay:40});await acknowledgeOverlay(true,'39-wind-paused');const windSaved=await saved();assert.equal(windSaved.leg,0);await capture('40-wind-saved');
 await opened.page.reload({waitUntil:'load',timeout:5000});await opened.page.getByRole('button',{name:'Continuar viagem',exact:true}).waitFor();await capture('41-wind-recovered-menu');await button('Continuar viagem');await acknowledgeOverlay(false,'42-wind-resumed');if(keyboardRecovery){await opened.page.keyboard.press('P',{delay:40});steps.push({action:'normal-key',key:'P',context:'immediate-after-wind-recovery'});}else{await opened.page.locator('#wm-pause').click();steps.push({action:'visible-button',label:'Pausar',context:'after-wind-recovery'});}await acknowledgeOverlay(true,'43-wind-paused-again');assert.equal((await saved()).leg,windSaved.leg);await capture('44-wind-recovered');
 await opened.page.setViewportSize({width:390,height:844});await capture('45-portrait-paused');await button('Nova viagem');await opened.page.getByRole('dialog').getByRole('button',{name:'Começar nova viagem',exact:true}).waitFor();await capture('46-portrait-confirm');await button('Voltar');await capture('47-portrait-cancelled');await opened.page.setViewportSize({width:1024,height:768});
 assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);await save('observations.json',{completed,recovered,restarted,windSaved,summary,steps,errors,blocked});
 if(alternatePreview){const page=opened.page;alternateClosure=await alternatePreview.close();assert.equal(page.isClosed(),true);alternatePreview=undefined;opened=undefined;}
 else{await opened.context.close();opened=undefined;await resources.close();resources=undefined;await server.close();assert.equal(owned.exitCode,0);assert.equal(browser.isConnected(),false);}for(const file of artifact.files)await readBuildFile(file.path);assert.ok(raw.equals(await readFile(path.join(source,'artifact.json'))));
 await save('report.json',{scope:'Responsive authored export: full campaign with normal inputs, DOM pause/result, completion/reload, best/mute, new trip, wind recovery and portrait confirmation. Pauses between route frames; PNGs require review.',artifactHash:artifact.artifactHash,sourceHash:artifact.sourceHash,completed,recovered,restarted,windSaved,errors,blocked,realModelCalls:0,manualSourceIntegration:true,qualityApproved:false,installed:false,humanPlaytest:false,collectorRegistered:false});passed=true;console.log('WINDMAIL_RESPONSIVE_CAMPAIGN_OBSERVED '+output);
}catch(error){await save('failure.json',{message:String(error?.message??error).slice(0,2000),ownedPid:owned?.pid,privateRoot:root,steps,errors,blocked});if(opened)try{await capture('failure');}catch{}process.exitCode=1;console.error(String(error?.message??error).slice(0,2000));}
finally{clearTimeout(deadline);if(alternatePreview)try{alternateClosure=await alternatePreview.close();}catch{}await opened?.context.close().catch(()=>{});await resources?.close().catch(()=>{});if(server&&owned?.exitCode===null)try{await server.close();}catch{await server.kill().catch(()=>{});}const remove=passed&&(owned?.exitCode===0||alternateClosure?.browserDisconnected);if(remove)await rm(root,{recursive:true,force:true});await save('closure.json',{ownedPid:owned?.pid,exitCode:owned?.exitCode,signalCode:owned?.signalCode,browserDisconnected:browser?!browser.isConnected():alternateClosure?.browserDisconnected??null,privateRootRemoved:Boolean(remove),alternateClosure});}
