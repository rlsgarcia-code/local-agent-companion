// Authored portfolio game, no model calls, hidden game API or human acceptance.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {readFile,writeFile,mkdir,mkdtemp,cp,readdir,lstat,rm} from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import sdk from '../dist-tests/packages/client-ts/src/index.js';
import security from '../dist-tests/packages/agent-service/src/security.js';
import storage from '../dist-tests/packages/agent-service/src/store.js';
import bootstrap from '../dist-tests/packages/client-ts/src/bootstrap.js';
import exporting from '../dist-tests/packages/client-ts/src/game-export.js';
import previewModule from '../dist-tests/packages/adapter-game-browser/src/preview.js';
import domain from '../dist-tests/packages/contracts/src/games.js';
import simulation from '../dist-tests/examples/games/arco/src/simulation.js';
import levels from '../dist-tests/examples/games/arco/src/levels.js';

const root=path.resolve('examples/games/arco'),base=path.resolve('output/playwright/arco');
const output=path.join(base,'runs',new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID().slice(0,8));await mkdir(output,{recursive:true});
const privateParent=path.resolve('.cache/arco-qualification');await security.privateDirectory(privateParent);const privateRoot=await mkdtemp(path.join(privateParent,'case-')),state=path.join(privateRoot,'service'),engine=path.join(privateRoot,'engine');await mkdir(state,{mode:0o700});await cp('engine-dist',engine,{recursive:true});await bootstrap.verifyBundle(engine,undefined,true);
const identity=await security.ensureIdentity(state),credential=await security.createClientCredential(state,{id:'arco-reference-qualification',product:'companion-mac',profile:'portfolio-development',workspace:'',providers:['ollama'],hostTools:[]});
await writeFile(path.join(state,'inspection-credential.json'),JSON.stringify(credential),{mode:0o600});const store=new storage.Store(path.join(state,'metadata.sqlite'));store.register(credential);store.close();
const tick=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let child,client,preview,passed=false,pending=false,logs='';
async function save(name,value){const file=path.join(output,name);await mkdir(path.dirname(file),{recursive:true});await writeFile(file,Buffer.isBuffer(value)?value:JSON.stringify(value,null,2)+'\n');}
async function boot(){
 child=spawn(path.join(engine,'node'),[path.join(engine,'service.cjs'),state],{stdio:['ignore','pipe','pipe']});child.stdout.on('data',b=>logs=(logs+b).slice(-4000));child.stderr.on('data',b=>logs=(logs+b).slice(-4000));
 await save('control.json',{stateDirectory:state,servicePid:child.pid,engineManifestSha256:createHash('sha256').update(await readFile(path.join(engine,'manifest.json'))).digest('hex')});
 let ready=false;for(let i=0;i<1200;i++){assert.equal(child.exitCode,null,logs);try{if(JSON.parse(await readFile(path.join(state,'runtime.json'))).pid===child.pid){ready=true;break;}}catch{}await tick(100);}assert.ok(ready,'Inspect original bootstrap before restarting');client=new sdk.AgentClient({address:security.ipcPath(state),certificate:identity.cert,credential});await client.connect();
}
async function stop(){client?.close();if(child?.exitCode===null){if(pending){child.unref();return;}const exited=once(child,'exit');child.kill('SIGTERM');await exited;}}
async function settled(id){for(let i=0;i<3000;i++){const job=await client.getGameProduction(id);if(!['queued','running','cancelling'].includes(job.state)){pending=job.state==='awaiting_reconciliation';assert.equal(job.state,'completed',job.error);return;}await tick(100);}pending=true;throw Error('Inspect the original job '+id+'; no automatic repetition');}
async function files(directory=root){const result=[];for(const entry of await readdir(directory,{withFileTypes:true})){const file=path.join(directory,entry.name),stat=await lstat(file);assert.ok(!stat.isSymbolicLink());if(stat.isDirectory())result.push(...await files(file));else if(stat.isFile())result.push(file);}return result.sort();}
function route(index){
 const candidates=[];for(let angle=-168;angle<=-12;angle+=3)for(const speed of [350,520,700,860]){const s=simulation.fresh(index);simulation.launch(s,angle,speed);while(s.phase==='flight')simulation.step(s,1/30);candidates.push({angle,speed,lit:s.lit});}
 const s=simulation.fresh(index),shots=[];while(s.phase==='aim'){const best=candidates.map(c=>({c,n:c.lit.filter((hit,i)=>hit&&!s.lit[i]).length})).sort((a,b)=>b.n-a.n)[0];assert.ok(best.n);shots.push({angle:best.c.angle,speed:best.c.speed});simulation.launch(s,best.c.angle,best.c.speed);while(s.phase==='flight')simulation.step(s,1/30);}
 assert.equal(s.phase,'won');return shots;
}
try{
 await boot();const document=JSON.parse(await readFile(path.join(root,'game.document.json')));for(const file of await files()){const name=path.relative(root,file).split(path.sep).join('/');document.files.push(await client.uploadGameFile(name,await readFile(file),name.endsWith('.json')?'application/json':'text/plain'));}document.assets=JSON.parse(await readFile(path.join(root,'data/asset-origins.json')));domain.gameDocument.parse(document);
 const project=await client.createGameProject('arco-authored-reference',document);pending=true;const build=await client.startGameBuild('arco-build',project.id,project.revision);await settled(build.id);const artifact=await client.getGameArtifact(build.id);for(const file of artifact.files)await save('build/'+file.path,await client.downloadGameArtifactFile(build.id,file.path));
 pending=true;const validation=await client.startGameValidation('arco-observe',build.id,'web-browser-runtime-v1');await settled(validation.id);const reports=await client.getGameReports(build.id);await save('reports.json',reports);for(const report of reports)for(const file of report.evidence??[])await save('observations/'+report.id+'/'+file.path,await client.downloadGameReportFile(report.id,file.path));for(const report of reports)for(const check of report.checks)assert.equal(check.status,'passed',check.detail);
 await stop();await boot();assert.deepEqual(await client.getGameProject(project.id),project);const parent=path.join(output,'editable');await mkdir(parent);const exported=await exporting.exportGameDirectory({client,parent,source:{projectId:project.id,revision:1}});
 preview=await previewModule.openGamePreview({artifact,readFile:name=>client.downloadGameArtifactFile(build.id,name),signal:new AbortController().signal,headless:true});const page=preview.page;await page.setViewportSize({width:1100,height:1000});await page.getByRole('button',{name:'Começar',exact:true}).waitFor();assert.equal(await page.locator('header').count(),1);await page.waitForTimeout(300);await page.screenshot({path:path.join(output,'title.png')});await page.getByRole('button',{name:'Começar',exact:true}).click();await page.screenshot({path:path.join(output,'table.png')});
 // The observer uses only keyboard/focus/DOM. Search output is not shipped to
 // the game; no canvas evaluation, localStorage injection or debug completion.
 const campaign=[];for(let index=0;index<levels.TABLES.length;index++){
  let angle=-90;const shots=route(index);await page.locator('#chapter').filter({hasText:'Mesa '+(index+1)+' / 12'}).waitFor();
  for(const shot of shots){
   await page.locator('#launch:enabled').waitFor();await page.locator('canvas').focus();const key=shot.angle<angle?'ArrowLeft':'ArrowRight';for(let i=0;i<Math.abs(shot.angle-angle);i++)await page.keyboard.press(key);angle=shot.angle;await page.getByLabel('Força do lançamento').focus();await page.keyboard.press('Home');for(let i=0;i<(shot.speed-320)/10;i++)await page.keyboard.press('ArrowRight');await page.getByRole('button',{name:'Lançar ↗',exact:true}).click();
   await page.waitForFunction(()=>!document.getElementById('launch').disabled||document.getElementById('overlay').textContent.includes('Mesa acesa.')||document.getElementById('overlay').textContent.includes('A oficina')||document.getElementById('overlay').textContent.includes('Mais um arco?'),undefined,{timeout:15000});
  }
  assert.ok(!(await page.getByRole('heading',{name:'Mais um arco?',exact:true}).isVisible()));assert.ok(await page.locator('#overlay h2').isVisible(),'Predicted route did not complete table '+(index+1)+'; '+await page.locator('#progress').innerText());await page.screenshot({path:path.join(output,'campaign/'+String(index+1).padStart(2,'0')+'.png')}).catch(async error=>{await mkdir(path.join(output,'campaign'),{recursive:true});await page.screenshot({path:path.join(output,'campaign/'+String(index+1).padStart(2,'0')+'.png')});});campaign.push({table:levels.TABLES[index].id,shots,observedOutcome:await page.locator('#overlay h2').innerText()});await save('campaign-progress.json',campaign);console.log('ARCO_TABLE_OBSERVED '+(index+1));
  if(index<levels.TABLES.length-1)await page.getByRole('button',{name:'Próxima mesa',exact:true}).click();
 }
 await save('campaign.json',campaign);await page.getByRole('button',{name:'As mesas',exact:true}).click();assert.equal(await page.locator('[data-table]:disabled').count(),0);await page.reload();await page.getByRole('button',{name:'Continuar mesa',exact:true}).click();await page.locator('#overlay h2').filter({hasText:'A oficina'}).waitFor();
 await page.getByRole('button',{name:'As mesas',exact:true}).click();await page.locator('[data-table="0"]').click();await page.locator('canvas').focus();const mutationCount=page.locator('#progress').evaluate(node=>new Promise(resolve=>{let count=0;const observer=new MutationObserver(records=>count+=records.length);observer.observe(node,{childList:true,characterData:true,subtree:true});setTimeout(()=>{observer.disconnect();resolve(count);},500);}));await page.keyboard.press('Space');assert.ok(await mutationCount<=2,'Progress announcements must not repeat every frame');await page.getByRole('button',{name:'Pausa',exact:true}).click();await page.getByLabel('Reduzir efeitos e movimento').check();await page.getByRole('button',{name:'Continuar',exact:true}).click();await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(output,'portrait.png')});assert.equal(await page.locator('body').evaluate(node=>node.scrollWidth>window.innerWidth),false);
 assert.deepEqual(preview.errors,[]);assert.deepEqual(preview.blocked,[]);await preview.close();preview=undefined;const quality=await client.getGameQuality(project.id);assert.equal(quality.ready,false);await save('evidence.json',{scope:'Authored arcade/physics reference; real service/build/browser/control observations, no real-model, physical audio/touch/GPU, human or installed acceptance.',project,artifact,reports,campaign,quality,editableSource:exported,engineManifestSha256:createHash('sha256').update(await readFile(path.join(engine,'manifest.json'))).digest('hex')});await writeFile(path.join(base,'latest.json'),JSON.stringify({output,sourceHash:project.contentHash,artifactHash:artifact.artifactHash},null,2));passed=true;console.log('ARCO_REFERENCE_OBSERVED '+output);
}catch(error){await save('failure.json',{message:error instanceof Error?error.message:String(error)});try{await preview?.page.screenshot({path:path.join(output,'failure.png')});}catch{}throw error;}finally{await preview?.close();await stop();if(passed)await rm(privateRoot,{recursive:true,force:true});else console.error('Private original qualification state preserved: '+privateRoot+'\n'+logs);}
