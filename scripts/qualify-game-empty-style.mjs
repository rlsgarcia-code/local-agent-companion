// Exact packaged compiler/SDK and real browsers. Synthetic CSP fixture only,
// never a portfolio game, model result, installed or physical acceptance.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {readFile,writeFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {tmpdir} from 'node:os';
import path from 'node:path';
import bootstrap from '../dist-tests/packages/client-ts/src/bootstrap.js';
import security from '../dist-tests/packages/agent-service/src/security.js';
import storage from '../dist-tests/packages/agent-service/src/store.js';
import sdk from '../dist-tests/packages/client-ts/src/index.js';
import fixtures from '../dist-tests/test/game-fixtures.js';
import {openInstalledBrowserPreview} from './game-qualification/installed-browser.mjs';
const args=process.argv.slice(2);assert.equal(args.length,1);assert.ok(args[0].startsWith('--engine=')&&args[0].slice(9));const engine=path.resolve(args[0].slice(9));await bootstrap.verifyBundle(engine,undefined,true);
const output=path.resolve('output/playwright/game-empty-style',new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID().slice(0,8));await mkdir(output,{recursive:true});
const state=await mkdtemp(path.join(tmpdir(),'empty-style-')),identity=await security.ensureIdentity(state),store=new storage.Store(path.join(state,'metadata.sqlite'));
const credential=await security.createClientCredential(state,{id:'empty-style-fixture',product:'companion-mac',profile:'fixture',workspace:'',providers:['ollama'],hostTools:[]});store.register(credential);store.close();
const sha=bytes=>createHash('sha256').update(bytes).digest('hex'),save=async(name,value)=>{const file=path.join(output,name);await mkdir(path.dirname(file),{recursive:true});await writeFile(file,Buffer.isBuffer(value)?value:JSON.stringify(value,null,2)+'\n');};
let child,client,preview,activeBuild,passed=false;const results=[],closures=[];
const source=`import './style.css';
const probe=document.createElement('p');probe.id='probe';probe.textContent='Isolated CSP fixture';document.body.append(probe);
function add(name,action){const button=document.createElement('button');button.textContent=name;button.addEventListener('click',action);document.body.append(button);}
function style(text){const node=document.createElement('style');node.textContent=text;document.head.append(node);}
add('Empty exact',()=>style('body {}'));
add('Empty changed',()=>style('body { }'));
add('Nonempty style',()=>style('#probe { color: rgb(255, 0, 0) !important; }'));
add('Style attribute',()=>probe.setAttribute('style','color: rgb(255, 0, 0) !important'));
add('Inline script',()=>{const node=document.createElement('script');node.textContent='document.body.dataset.inlineExecuted="yes"';document.body.append(node);});`;
async function stop(){client?.close();client=undefined;if(child?.exitCode===null){const exited=once(child,'exit');child.kill('SIGTERM');await exited;}if(child)assert.equal(child.exitCode,0);}
try{
 child=spawn(path.join(engine,'node'),[path.join(engine,'service.cjs'),state],{cwd:state,env:{HOME:state,PATH:'/usr/bin:/bin',TMPDIR:tmpdir(),LANG:'en_US.UTF-8'},stdio:'ignore'});
 let ready=false;for(let i=0;i<600;i++){assert.equal(child.exitCode,null);try{if(JSON.parse(await readFile(path.join(state,'runtime.json'),'utf8')).pid===child.pid){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,25));}assert.ok(ready,'Inspect this original service on timeout');
 client=new sdk.AgentClient({address:security.ipcPath(state),certificate:identity.cert,credential});await client.connect();
 for(const gameEngine of ['phaser','babylon']){
  const document=fixtures.fixtureGameDocument();document.engine=gameEngine;if(gameEngine==='babylon')document.brief.dimension='3d';document.files=[];
  for(const [name,data]of [['game.web.json',JSON.stringify({schemaVersion:1,entry:'src/main.ts',engineVersion:gameEngine==='phaser'?'4.2.1':'9.35.0'})],['src/main.ts',source],['src/style.css','#probe{color:rgb(18,52,86)}canvas{display:none}body{padding:16px}button{display:block;margin:12px}']])document.files.push(await client.uploadGameFile(name,Buffer.from(data),name.endsWith('.json')?'application/json':'text/plain'));
  const project=await client.createGameProject('csp-'+gameEngine,document),build=await client.startGameBuild('csp-build-'+gameEngine,project.id,1);activeBuild=build.id;
  let done;for(let i=0;i<600;i++){done=await client.getGameProduction(build.id);if(['completed','failed','cancelled','awaiting_reconciliation'].includes(done.state))break;await new Promise(resolve=>setTimeout(resolve,50));}assert.equal(done?.state,'completed',done?.error);activeBuild=undefined;
  const artifact=await client.getGameArtifact(build.id);await save(gameEngine+'/artifact.json',artifact);for(const file of artifact.files)await save(gameEngine+'/build/'+file.path,await client.downloadGameArtifactFile(build.id,file.path));
  const html=(await client.downloadGameArtifactFile(build.id,'index.html')).toString();assert.ok(html.includes("'sha256-"+createHash('sha256').update('body {}').digest('base64')+"'"));assert.doesNotMatch(html,/unsafe-inline|unsafe-eval|unsafe-hashes/);
  for(const name of ['firefox','webkit']){
   preview=await openInstalledBrowserPreview({name,artifact,readFile:file=>client.downloadGameArtifactFile(build.id,file),signal:new AbortController().signal});const page=preview.page;
   const color=()=>page.locator('#probe').evaluate(node=>getComputedStyle(node).color);assert.equal(await color(),'rgb(18, 52, 86)');assert.deepEqual(preview.errors,[]);
   await page.getByRole('button',{name:'Empty exact',exact:true}).click();await page.screenshot({path:path.join(output,gameEngine+'-'+name+'-allowed.png')});assert.deepEqual(preview.errors,[],'Exact empty rule and screenshot must produce no CSP messages');
   const checks=[];
   for(const action of ['Empty changed','Nonempty style','Style attribute','Inline script']){
    const before=preview.errors.length;await page.getByRole('button',{name:action,exact:true}).click();for(let i=0;i<100&&preview.errors.length===before;i++)await page.waitForTimeout(10);await page.waitForTimeout(50);assert.ok(preview.errors.length>before&&preview.errors.length<=before+2,action+' must be refused by the unchanged CSP policies');assert.equal(await color(),'rgb(18, 52, 86)');assert.equal(await page.locator('body').getAttribute('data-inline-executed'),null);checks.push({action,refused:true,computedColorUnchanged:true});
   }
   const errors=[...preview.errors];await page.screenshot({path:path.join(output,gameEngine+'-'+name+'-refused.png')});assert.deepEqual(preview.errors,errors,'Capturing must not add errors');assert.deepEqual(preview.blocked,[]);
   const browser=preview.browserMetadata,closure=await preview.close();preview=undefined;closures.push(closure);results.push({engine:gameEngine,browser:browser.name,version:browser.version,artifactHash:artifact.artifactHash,sourceHash:artifact.sourceHash,exactEmptyAllowed:true,checks,expectedCspErrors:errors,captureAddsErrors:false,distributionSha256:browser.distribution.sha256,closure});
  }
  assert.equal((await client.getGameQuality(project.id)).ready,false);assert.equal((await client.getGameProject(project.id)).revision,1);
 }
 await stop();await bootstrap.verifyBundle(engine,undefined,true);await save('report.json',{scope:'Actual packaged Node/SDK/TLS/compiler and patched Firefox/WebKit. Synthetic policy fixture, not gameplay/physical/artistic/installed acceptance.',engineManifestSha256:sha(await readFile(path.join(engine,'manifest.json'))),results,serviceExitCode:0,modelCalls:0,installed:false});passed=true;console.log('GAME_EMPTY_STYLE_QUALIFIED '+output);
}catch(error){await save('failure.json',{message:error.message,activeBuild,ownedServicePid:child?.pid,results});throw error;}
finally{if(preview)closures.push(await preview.close());if(activeBuild){client?.close();child?.unref();await save('closure.json',{servicePreservedForInspection:true,ownedServicePid:child?.pid,activeBuild,previews:closures});console.error('Inspect the original build/service; do not restart: '+state);}else{await stop();await save('closure.json',{serviceExited:child?.exitCode,previews:closures});if(passed)await rm(state,{recursive:true,force:true});else console.error('Failed original private state preserved: '+state);}}
