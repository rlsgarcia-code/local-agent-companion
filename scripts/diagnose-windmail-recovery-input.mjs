// Outside maintainer diagnostic: normal buttons/keys/reload and additive DOM
// event observation. No engine variables, storage writes, clocks or model calls.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import previewModule from '../dist-tests/packages/adapter-game-browser/src/preview.js';
import contracts from '../dist-tests/packages/contracts/src/game-production.js';
import {openInstalledBrowserPreview} from './game-qualification/installed-browser.mjs';
assert.equal(process.versions.node,'22.23.4');
assert.ok(Object.keys(process.env).every(k=>['HOME','PATH','TMPDIR','LANG','__CF_USER_TEXT_ENCODING'].includes(k)),'Closed environment required');
const args=process.argv.slice(4);assert.equal(new Set(args).size,args.length);assert.ok(args.length<=4);const wind=args.includes('--wind'),expectPaused=args.includes('--expect-paused'),browserArg=args.find(a=>a.startsWith('--browser='));const browserName=browserArg?.slice(10)??'chromium';assert.ok(['chromium','firefox','webkit'].includes(browserName));
const expected=args.find(a=>/^[a-f0-9]{64}$/.test(a))??'4152f055b3994b74c9f394fb517ac14fa5e322cd3d747c4a4aa1ac1788b1de9c';assert.ok(args.every(a=>a==='--wind'||a==='--expect-paused'||a===browserArg||a===expected));
const source=path.resolve(process.argv[2]),output=path.resolve(process.argv[3]);await mkdir(output);
const sha=b=>createHash('sha256').update(b).digest('hex'),raw=await readFile(path.join(source,'artifact.json')),artifact=contracts.gameArtifact.parse(JSON.parse(raw));
assert.equal(artifact.artifactHash,expected);
async function readBuildFile(name){const file=artifact.files.find(f=>f.path===name);assert.ok(file);let p=path.join(source,'build');assert.ok(!(await lstat(p)).isSymbolicLink());for(const part of name.split('/')){p=path.join(p,part);assert.ok(!(await lstat(p)).isSymbolicLink());}const b=await readFile(p);assert.equal(b.length,file.size);assert.equal(sha(b),file.sha256);return b;}
for(const file of artifact.files)await readBuildFile(file.path);
const save=(name,value)=>writeFile(path.join(output,name),JSON.stringify(value,null,2)+'\n');
const abort=new AbortController(),deadline=setTimeout(()=>abort.abort(),wind?240000:90000),cases=[];let preview,passed=false,closure;
async function screenshot(page,name){const bytes=await page.screenshot({path:path.join(output,name+'.png'),timeout:3000});return {file:name+'.png',sha256:sha(bytes)};}
async function saved(page){for(let i=0;i<200;i++){const text=await page.locator('#wm-save-status').textContent();if(/^Viagem salva · \d\/5 cartas · \d+ pontos$/.test(text??''))return text;await new Promise(r=>setTimeout(r,25));}throw Error('Normal save did not acknowledge');}
try{
 await writeFile(path.join(output,'observer.mjs'),await readFile(new URL(import.meta.url)));
 await save('control.json',{artifactHash:artifact.artifactHash,sourceHash:artifact.sourceHash,wind,browserName,expectPaused,observerSha256:sha(await readFile(new URL(import.meta.url))),scope:'Four independent fresh temporary profiles. Ordinary journey/save/reload, then immediate P, canvas focus plus P, first presentation frame plus P, or Pause button. Additive DOM event logging only. No hidden-state or storage access, game/source changes, model or quality collector.'});
 for(const method of ['immediate-P','focus-canvas-P','capture-first-P','pause-button']){
  const options={artifact,readFile:readBuildFile,signal:abort.signal};preview=browserName==='chromium'?await previewModule.openGamePreview({...options,headless:true}):await openInstalledBrowserPreview({...options,name:browserName});const page=preview.page;
  await page.getByRole('button',{name:'Iniciar viagem',exact:true}).click();
  if(wind){await page.keyboard.down('ArrowDown');await page.keyboard.down('ArrowRight');try{await new Promise(r=>setTimeout(r,34000));}finally{await page.keyboard.up('ArrowRight');await page.keyboard.up('ArrowDown');}}
  await page.locator('#wm-pause').click();await page.getByRole('dialog').waitFor();const saveText=await saved(page);
  await page.reload({waitUntil:'load',timeout:5000});await page.getByRole('button',{name:'Continuar viagem',exact:true}).waitFor();
  const events=[];page.on('console',message=>{if(message.type()==='debug'&&message.text().startsWith('WM_RECOVERY_EVENT ')&&events.length<100)try{events.push(JSON.parse(message.text().slice(18)));}catch{}});
  await page.evaluate(()=>{for(const phase of ['capture','bubble'])for(const type of ['keydown','keyup'])window.addEventListener(type,event=>{
   if(event.key.toLowerCase()!=='p')return;const target=event.target instanceof HTMLElement?event.target:null,layer=target?.closest('.wm-recovery-layer');
   console.debug('WM_RECOVERY_EVENT '+JSON.stringify({phase,type,key:event.key,target:target?.tagName,id:target?.id,activeTag:document.activeElement?.tagName,activeId:document.activeElement?.id,insideRecoveryLayer:!!layer,hiddenRecoveryLayer:layer instanceof HTMLElement?layer.hidden:null,trusted:event.isTrusted,defaultPrevented:event.defaultPrevented}));
  },phase==='capture');});
  await page.getByRole('button',{name:'Continuar viagem',exact:true}).click();const began=performance.now();let before;
  if(method==='focus-canvas-P')await page.locator('canvas').focus();
  if(method==='capture-first-P')before=await screenshot(page,method+'-before');
  const actionAfterClickMs=performance.now()-began;
  if(method==='pause-button')await page.locator('#wm-pause').click();else await page.keyboard.press('P',{delay:40});
  await new Promise(r=>setTimeout(r,200));const paused=await page.getByRole('dialog').isVisible(),image=await screenshot(page,method);
  const record={method,wind,saveText,actionAfterClickMs,paused,before,image,events,errors:preview.errors,blocked:preview.blocked,browser:preview.browserMetadata};cases.push(record);await save('observations.json',cases);
  if(expectPaused){assert.equal(paused,true);await page.keyboard.press('P',{delay:40});assert.equal(await page.getByRole('dialog').isVisible(),false);await page.keyboard.press('P',{delay:40});await page.getByRole('dialog').waitFor();record.repeatAfterDismissPaused=true;assert.ok(!events.some(e=>e.type==='keydown'&&e.hiddenRecoveryLayer===true),'Keyboard must not stay in a hidden dialog');}
  assert.deepEqual(preview.errors,[]);assert.deepEqual(preview.blocked,[]);const closing=page;closure=await preview.close();assert.ok(closing.isClosed());if(browserName!=='chromium')assert.equal(closure.distributionUnchanged,true);record.closure={pageCloseAcknowledged:true,processExitCodeRecorded:false,details:closure??null};await save('observations.json',cases);preview=undefined;
 }
 for(const file of artifact.files)await readBuildFile(file.path);assert.ok(raw.equals(await readFile(path.join(source,'artifact.json'))));
 if(expectPaused)assert.ok(cases.every(c=>c.paused),'Every normal immediate input method must pause');
 await save('report.json',{artifactHash:artifact.artifactHash,sourceHash:artifact.sourceHash,browserName,expectPaused,cases,scope:'Observed input routing after normal restore; a completed diagnostic is not a passed game, inferred cause, physical or quality acceptance.',gameSourceChanged:false,realModelCalls:0,qualityApproved:false});passed=true;console.log('WINDMAIL_RECOVERY_INPUT_OBSERVED '+JSON.stringify(cases.map(c=>({method:c.method,paused:c.paused,events:c.events.length}))));
}catch(error){await save('failure.json',{message:String(error?.message??error).slice(0,2000),completed:cases.length});process.exitCode=1;console.error(String(error?.message??error).slice(0,2000));}
finally{clearTimeout(deadline);if(preview)await preview.close().catch(()=>{});await save('closure.json',{passed,allPagesClosed:passed,processExitCodeRecorded:false,realModelCalls:0});}
