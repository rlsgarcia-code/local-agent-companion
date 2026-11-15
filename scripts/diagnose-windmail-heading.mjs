// Maintainer-only visual diagnostic: ordinary inputs and composed PNG pixels.
// Not shipped with the game, a model tool or a trusted quality collector.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,mkdtemp,lstat,rm} from 'node:fs/promises';
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

assert.equal(process.versions.node,'22.23.4');
assert.equal(process.argv.length,4);
assert.ok(Object.keys(process.env).every(k=>['HOME','PATH','TMPDIR','LANG','__CF_USER_TEXT_ENCODING'].includes(k)),'Closed launcher environment required');
const source=path.resolve(process.argv[2]),output=path.resolve(process.argv[3]);await mkdir(output);
const sha=b=>createHash('sha256').update(b).digest('hex');
const save=(name,data)=>writeFile(path.join(output,name),JSON.stringify(data,null,2)+'\n');
const raw=await readFile(path.join(source,'artifact.json')),artifact=contracts.gameArtifact.parse(JSON.parse(raw));
assert.equal(artifact.artifactHash,'97df428421e5e52cd9c3598bb3aaec1f48d1b114f198c435583b4180634ee518');
async function readBuildFile(name){
 const file=artifact.files.find(f=>f.path===name);assert.ok(file);let p=path.join(source,'build');
 assert.ok(!(await lstat(p)).isSymbolicLink());for(const part of name.split('/')){p=path.join(p,part);assert.ok(!(await lstat(p)).isSymbolicLink());}
 const bytes=await readFile(p);assert.equal(bytes.length,file.size);assert.equal(sha(bytes),file.sha256);return bytes;
}
for(const file of artifact.files)await readBuildFile(file.path);
const root=await mkdtemp('/private/tmp/wm-heading-'),env={HOME:root,PATH:'/usr/bin:/bin',TMPDIR:root,LANG:'en_US.UTF-8'},abort=new AbortController();
let server,browser,owned,resources,opened,passed=false;const errors=[],blocked=[],observations=[];
const deadline=setTimeout(()=>{abort.abort();void server?.kill().catch(()=>{});},90000);
function pixels(bytes,rect){
 const p=PNG.sync.read(bytes),points=[],gold=[];
 for(let y=Math.ceil(rect.y);y<Math.floor(rect.y+rect.height);y++)for(let x=Math.ceil(rect.x);x<Math.floor(rect.x+rect.width);x++){
  const i=(y*p.width+x)*4,r=p.data[i],g=p.data[i+1],b=p.data[i+2];
  if(Math.abs(r-139)+Math.abs(g-69)+Math.abs(b-19)<15)points.push([x,y]);
  if(Math.abs(r-255)+Math.abs(g-215)+Math.abs(b)<15)gold.push([x,y]);
 }
 assert.ok(points.length>=40,'Rendered brown hull must be observable');assert.ok(gold.length>=2,'Rendered gold flag must be observable');
 const centroid=arr=>({x:arr.reduce((s,p)=>s+p[0],0)/arr.length,y:arr.reduce((s,p)=>s+p[1],0)/arr.length});
 const c=centroid(points),flag=centroid(gold);let xx=0,xy=0,yy=0;
 for(const [x,y]of points){xx+=(x-c.x)**2;xy+=(x-c.x)*(y-c.y);yy+=(y-c.y)**2;}
 return {hullPixels:points.length,flagPixels:gold.length,hull:c,flag,hullMajorAxisRadians:.5*Math.atan2(2*xy,xx-yy),hullToFlagRadians:Math.atan2(flag.y-c.y,flag.x-c.x)};
}
try{
 const module=pathToFileURL(path.resolve('dist-tests/packages/adapter-game-browser/src/browser.js')).href;
 const qualified=JSON.parse((await promisify(execFile)(process.execPath,['--input-type=module','-e',"const m=await import(process.argv[1]);const q=await m.default.qualifyBrowser();if(!q)throw Error('Qualified browser unavailable');process.stdout.write(JSON.stringify(q));",module],{env,maxBuffer:16384,timeout:10000})).stdout);
 await writeFile(path.join(output,'observer.mjs'),await readFile(new URL(import.meta.url)));
 await save('control.json',{artifactHash:artifact.artifactHash,sourceHash:artifact.sourceHash,qualifiedBrowser:qualified,observerSha256:sha(await readFile(new URL(import.meta.url))),realModelCalls:0,protocol:'Fresh isolated game. Two straight forward pulses, ordinary pause/resume. Observe only canvas DOM rectangle and composed hull/flag pixel colors. No game objects, clocks or storage writes.'});
 server=await chromium.launchServer({executablePath:qualified.executablePath,headless:true,chromiumSandbox:true,host:'127.0.0.1',env,timeout:10000,args:['--force-webrtc-ip-handling-policy=disable_non_proxied_udp','--webrtc-ip-handling-policy=disable_non_proxied_udp']});
 owned=server.process();browser=await chromium.connect(server.wsEndpoint());assert.ok(qualified.version.includes(browser.version()));
 const access={artifact,readFile:readBuildFile};resources=await resourcesModule.serveArtifactResources({...access,signal:abort.signal});
 opened=await isolation.openGameArtifactPage(browser,access,{width:1024,height:768},errors,blocked,abort.signal,resources);
 const page=opened.page;await page.getByRole('button',{name:'Iniciar viagem',exact:true}).waitFor();
 await page.screenshot({path:path.join(output,'00-menu.png'),timeout:3000});
 await page.getByRole('button',{name:'Iniciar viagem',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});
 await page.keyboard.press('M',{delay:40});
 async function capture(label){const rect=await page.locator('canvas').boundingBox();assert.ok(rect);const bytes=await page.screenshot({path:path.join(output,label+'.png'),timeout:3000});const observation={label,imageSha256:sha(bytes),canvas:rect,...pixels(bytes,rect)};observations.push(observation);await save('observations.json',observations);return observation;}
 await capture('01-before');await page.keyboard.press('P',{delay:40});await page.getByRole('dialog').waitFor({state:'visible'});
 for(let i=0;i<2;i++){
  await page.keyboard.press('P',{delay:40});await page.getByRole('dialog').waitFor({state:'hidden'});
  const began=performance.now();await page.keyboard.down('ArrowUp');try{await new Promise(r=>setTimeout(r,600));}finally{await page.keyboard.up('ArrowUp');}
  const heldMs=performance.now()-began;const after=await capture('0'+(i+2)+'-forward');after.heldMs=heldMs;
  await page.keyboard.press('P',{delay:40});await page.getByRole('dialog').waitFor({state:'visible'});
 }
 const first=observations[0],last=observations.at(-1),dx=last.hull.x-first.hull.x,dy=last.hull.y-first.hull.y,displacement=Math.hypot(dx,dy);
 assert.ok(displacement>60,'Two normal forward pulses must visibly displace the hull');
 const movement=Math.atan2(dy,dx),wrap=a=>Math.atan2(Math.sin(a),Math.cos(a)),toDegrees=a=>a*180/Math.PI;
 const flagError=Math.abs(toDegrees(wrap(movement-last.hullToFlagRadians)));
 const majorError=Math.abs(toDegrees(wrap(movement-last.hullMajorAxisRadians))),hullAxisError=Math.min(majorError,180-majorError);
 assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);
 for(const file of artifact.files)await readBuildFile(file.path);assert.ok(raw.equals(await readFile(path.join(source,'artifact.json'))));
 await save('report.json',{artifactHash:artifact.artifactHash,sourceHash:artifact.sourceHash,observations,displacementPixels:displacement,movementDegrees:toDegrees(movement),flagDirectionErrorDegrees:flagError,hullMajorAxisErrorDegrees:hullAxisError,errors,blocked,realModelCalls:0,sourceChanged:false,qualityApproved:false,humanPlaytest:false,scope:'Visual direction measurement in one straight near-start course only. Does not establish the cause of earlier failed routes, semantic bow direction or controls quality.'});
 await opened.context.close();opened=undefined;await resources.close();resources=undefined;await server.close();assert.equal(owned.exitCode,0);assert.equal(browser.isConnected(),false);passed=true;
 console.log('WINDMAIL_HEADING_OBSERVED '+JSON.stringify({output,displacement,flagError,hullAxisError}));
}catch(error){await save('failure.json',{message:String(error?.message??error).slice(0,2000),ownedPid:owned?.pid,privateRoot:root,observations,errors,blocked});process.exitCode=1;console.error(String(error?.message??error).slice(0,2000));}
finally{clearTimeout(deadline);await opened?.context.close().catch(()=>{});await resources?.close().catch(()=>{});if(server&&owned?.exitCode===null)try{await server.close();}catch{await server.kill().catch(()=>{});}const remove=passed&&owned?.exitCode===0;if(remove)await rm(root,{recursive:true,force:true});await save('closure.json',{ownedPid:owned?.pid,exitCode:owned?.exitCode,signalCode:owned?.signalCode,browserDisconnected:browser?!browser.isConnected():null,privateRootRemoved:Boolean(remove),passed});}
