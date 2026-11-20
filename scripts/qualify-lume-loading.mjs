// Exact exported game, owned headed browser and native request diagnostics.
// No Agent Service/model, save injection, physical FPS or quality report.
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile,mkdir,mkdtemp,rm,lstat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright-core';
import resourcesModule from '../dist-tests/packages/adapter-game-browser/src/resources.js';
import isolation from '../dist-tests/packages/adapter-game-browser/src/isolation.js';
import loading from '../dist-tests/packages/adapter-game-browser/src/loading.js';
import production from '../dist-tests/packages/contracts/src/game-production.js';
import {facePosition} from './lume-campaign-observer.mjs';
assert.equal(process.platform,'darwin');assert.equal(process.versions.node,'22.23.4');assert.equal(process.argv.length,4);
const option=name=>{const arg=process.argv.find(a=>a.startsWith(name+'='));assert.ok(arg);return path.resolve(arg.slice(name.length+1));};
const input=option('--attempt'),output=option('--output');await mkdir(output);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex'),save=(name,value)=>writeFile(path.join(output,name),JSON.stringify(value,null,2)+'\n'),run=promisify(execFile);
const evidenceRaw=await readFile(path.join(input,'evidence.json')),evidence=JSON.parse(evidenceRaw),artifact=production.gameArtifact.parse(evidence.artifact);assert.equal(artifact.engine,'phaser');assert.equal(evidence.campaign?.campaign?.length,12);
const files=new Map(artifact.files.map(f=>[f.path,f]));
async function readBuildFile(name){
 const file=files.get(name);assert.ok(file);let target=path.join(input,'build');assert.ok(!(await lstat(target)).isSymbolicLink());
 for(const part of name.split('/')){target=path.join(target,part);assert.ok(!(await lstat(target)).isSymbolicLink());}
 const info=await lstat(target);assert.ok(info.isFile());const bytes=await readFile(target);assert.equal(bytes.length,file.size);assert.equal(sha(bytes),file.sha256);return bytes;
}
for(const name of files.keys())await readBuildFile(name);
const root=await mkdtemp(path.join(tmpdir(),'lume-loading-')),env={HOME:root,PATH:'/usr/bin:/bin',TMPDIR:root,LANG:'en_US.UTF-8'},abort=new AbortController();
let server,browser,owned,profile,recorder,resources,opened,passed=false,profileRemoved=false,held=false;
const deadline=setTimeout(()=>{abort.abort();void server?.kill().catch(()=>{});},60000);
const publicError=error=>String(error?.message??error).replace(/wss?:\/\/\S+/g,'[private browser control]').slice(0,3000);
async function isolatedFetch(page,name){
 const session=await page.context().newCDPSession(page);
 try{const tree=await session.send('Page.getFrameTree'),world=await session.send('Page.createIsolatedWorld',{frameId:tree.frameTree.frame.id,worldName:'owned-network-calibration'});
  const result=await session.send('Runtime.evaluate',{contextId:world.executionContextId,awaitPromise:true,returnByValue:true,expression:`fetch(${JSON.stringify(name)}).then(r=>{if(!r.ok)throw Error('Calibration response failed');return r.arrayBuffer();}).then(b=>b.byteLength)`});assert.ok(!result.exceptionDetails);return result.result.value;
 }finally{await session.detach().catch(()=>{});}
}
try{
 const module=pathToFileURL(path.resolve('dist-tests/packages/adapter-game-browser/src/browser.js')).href,code="const m=await import(process.argv[1]);const q=await m.default.qualifyBrowser();if(!q)throw Error('Qualified Chromium unavailable');process.stdout.write(JSON.stringify(q));";
 const qualified=JSON.parse((await run(process.execPath,['--input-type=module','-e',code,module],{env,maxBuffer:16384,timeout:10000})).stdout);
 await save('control.json',{observerSha256:sha(await readFile(new URL(import.meta.url))),loadingSourceSha256:sha(await readFile('packages/adapter-game-browser/src/loading.ts')),isolationSourceSha256:sha(await readFile('packages/adapter-game-browser/src/isolation.ts')),pixelObserverSha256:sha(await readFile('scripts/lume-campaign-observer.mjs')),originalEvidenceSha256:sha(evidenceRaw),artifactHash:artifact.artifactHash,sourceHash:artifact.sourceHash,qualifiedBrowser:qualified,qualificationOnly:true});
 server=await chromium.launchServer({executablePath:qualified.executablePath,headless:false,chromiumSandbox:true,host:'127.0.0.1',timeout:10000,env,args:['--force-webrtc-ip-handling-policy=disable_non_proxied_udp','--webrtc-ip-handling-policy=disable_non_proxied_udp']});owned=server.process();browser=await chromium.connect(server.wsEndpoint());assert.ok(qualified.version.includes(browser.version()));
 const browserSession=await browser.newBrowserCDPSession(),command=await browserSession.send('Browser.getBrowserCommandLine');
 assert.ok(!command.arguments.some(a=>a.startsWith('--headless')||a==='--no-sandbox'||a==='--disable-gpu'));profile=command.arguments.find(a=>a.startsWith('--user-data-dir='))?.slice(16);assert.ok(profile&&path.basename(profile).startsWith('playwright_chromiumdev_profile-'));const profileInfo=await lstat(profile);assert.ok(profileInfo.uid===process.getuid()&&!profileInfo.isSymbolicLink()&&(profileInfo.mode&0o077)===0);
 // A separate registered resource projection calibrates actual browser transfers.
 // It is not a fabricated GameArtifact or a production receipt.
 const calibrationFiles=new Map([['index.html',Buffer.from('<!doctype html><title>Calibration</title><link rel="icon" href="data:,">')],['payload.bin',randomBytes(4*1024*1024)]]),calibration={engine:'phaser',entrypoint:'index.html',files:[...calibrationFiles].map(([name,bytes])=>({path:name,size:bytes.length,sha256:sha(bytes),mime:name.endsWith('html')?'text/html':'application/octet-stream'}))};
 const calibrationAccess={artifact:calibration,readFile:async name=>calibrationFiles.get(name)};
 resources=await resourcesModule.serveArtifactResources({...calibrationAccess,signal:abort.signal});const calibrationErrors=[],calibrationBlocked=[];
 opened=await isolation.openGameArtifactPage(browser,calibrationAccess,{width:960,height:540},calibrationErrors,calibrationBlocked,abort.signal,resources,async page=>{recorder=await loading.prepareColdNetworkMeasurement(page,resources.origin,calibration.files);});
 assert.equal(await isolatedFetch(opened.page,'/payload.bin'),4*1024*1024);
 for(let i=0;i<100&&!recorder.snapshot().requests.some(r=>r.file==='payload.bin'&&r.finished!==undefined&&r.appliedRuleId);i++)await new Promise(r=>setTimeout(r,20));
 const calibrationTrace=recorder.snapshot(),payload=calibrationTrace.requests.find(r=>r.file==='payload.bin');assert.equal(payload.appliedRuleId,calibrationTrace.ruleId);assert.ok(payload.durationMs>=1500&&payload.encodedBytes>=4*1024*1024);assert.equal(payload.fromDiskCache,false);assert.equal(payload.fromServiceWorker,false);assert.deepEqual(calibrationErrors,[]);assert.deepEqual(calibrationBlocked,[]);
 await save('calibration.json',{...calibrationTrace,knownPayloadBytes:4*1024*1024,knownPayloadSha256:calibration.files[1].sha256});await recorder.close();recorder=undefined;await opened.context.close();opened=undefined;await resources.close();resources=undefined;
 const errors=[],blocked=[],access={artifact,readFile:readBuildFile};resources=await resourcesModule.serveArtifactResources({...access,signal:abort.signal});let navigationStarted;
 opened=await isolation.openGameArtifactPage(browser,access,{width:960,height:540},errors,blocked,abort.signal,resources,async page=>{recorder=await loading.prepareColdNetworkMeasurement(page,resources.origin,artifact.files);navigationStarted=performance.now();});
 const page=opened.page,loadedMs=performance.now()-navigationStarted;await page.bringToFront();
 await page.getByRole('button',{name:'Jogar',exact:true}).waitFor({state:'visible',timeout:5000});const startControlObservedMs=performance.now()-navigationStarted;
 await page.getByRole('button',{name:'Jogar',exact:true}).click();await page.locator('#hud').waitFor({state:'visible',timeout:5000});const hudObservedMs=performance.now()-navigationStarted;
 const first=await page.locator('canvas').screenshot({timeout:2000});await writeFile(path.join(output,'first-scene.png'),first);const firstCapturedSceneMs=performance.now()-navigationStarted,beforeFace=facePosition(first);assert.ok(beforeFace,'The existing external PNG observer must locate the character');
 const beforeProgress=Number.parseFloat(await page.locator('#progress').evaluate(node=>node.style.width));await page.locator('canvas').focus();
 const keyBegan=performance.now();await page.keyboard.down('ArrowRight');held=true;try{await new Promise(r=>setTimeout(r,250));}finally{await page.keyboard.up('ArrowRight');held=false;}
 const keyHoldMs=performance.now()-keyBegan,afterBytes=await page.locator('canvas').screenshot({timeout:2000}),afterFace=facePosition(afterBytes);await writeFile(path.join(output,'after-input.png'),afterBytes);assert.ok(afterFace&&afterFace.x>beforeFace.x+15,'Normal input must move the externally observed character');
 const afterProgress=Number.parseFloat(await page.locator('#progress').evaluate(node=>node.style.width));assert.ok(Number.isFinite(beforeProgress)&&Number.isFinite(afterProgress)&&afterProgress>beforeProgress);const inputResponseObservedMs=performance.now()-navigationStarted;
 const trace=recorder.snapshot();assert.ok(trace.requests.filter(r=>r.file).every(r=>r.status===200&&!r.failed&&!r.fromDiskCache&&!r.fromServiceWorker&&!r.servedFromCache&&r.appliedRuleId===trace.ruleId&&r.finished!==undefined));
 assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);await save('network.json',trace);
 const system=await browserSession.send('SystemInfo.getInfo'),aux=system.gpu.auxAttributes??{},features=system.gpu.featureStatus??{};
 const gpu={renderer:aux.glRenderer??null,vendor:aux.glVendor??null,displayType:aux.displayType??null,webgl:features.webgl??null,compositing:features.gpu_compositing??null};
 assert.ok(/ANGLE Metal Renderer/i.test(String(gpu.renderer))&&!/swiftshader|llvmpipe|software|virtualbox|vmware/i.test(String(gpu.renderer))&&gpu.webgl==='enabled'&&gpu.compositing==='enabled');
 await recorder.close();recorder=undefined;await opened.context.close();opened=undefined;await resources.close();resources=undefined;await server.close();assert.equal(owned.exitCode,0);assert.equal(browser.isConnected(),false);
 try{await lstat(profile);}catch(error){if(error.code!=='ENOENT')throw error;profileRemoved=true;}assert.equal(profileRemoved,true);
 const afterQualified=JSON.parse((await run(process.execPath,['--input-type=module','-e',code,module],{env,maxBuffer:16384,timeout:10000})).stdout);assert.deepEqual(afterQualified,qualified);for(const name of files.keys())await readBuildFile(name);
 await save('report.json',{scope:'Headed installed Chrome and exact exported Lume, cold browser HTTP cache/native emulation and external PNG/HUD/input timing. Diagnostic observations, not physical FPS/RTT, full-game loading certification or quality acceptance.',input,artifactHash:artifact.artifactHash,sourceHash:artifact.sourceHash,qualifiedBrowser:qualified,viewport:{width:960,height:540},gpu,networkProfile:loading.coldNetworkProfile,timings:{loadedMs,startControlObservedMs,hudObservedMs,firstCapturedSceneMs,inputResponseObservedMs,keyHoldMs},normalRightInput:{beforeFace,afterFace,beforeProgress,afterProgress},originalFilesUnchanged:true,allRegisteredHttpRequestsBoundToRule:true,registeredHttpResourcesCacheHitsObserved:false,unregisteredRequestRows:trace.requests.filter(r=>!r.file).length,unregisteredRowsServedFromCache:trace.requests.filter(r=>!r.file&&r.servedFromCache).length,errors:[],blocked:[],physicalGamePerformanceApproved:false,qualityApproved:false,agentServiceStarted:false,modelCalls:0});passed=true;console.log('LUME_COLD_NETWORK_OBSERVATIONS_RECORDED '+output);
}catch(error){if(opened)try{await opened.page.screenshot({path:path.join(output,'failure.png')});}catch{}await save('failure.json',{message:publicError(error),ownedPid:owned?.pid,exitCode:owned?.exitCode,privateRoot:root});process.exitCode=1;console.error(publicError(error));}
finally{
 clearTimeout(deadline);if(held&&opened)await opened.page.keyboard.up('ArrowRight').catch(()=>{});await recorder?.close();await opened?.context.close().catch(()=>{});await resources?.close().catch(()=>{});
 if(server&&owned?.exitCode===null)try{await server.close();}catch{await server.kill().catch(()=>{});}
 if(passed&&owned?.exitCode===0)await rm(root,{recursive:true,force:true});
 await save('closure.json',{ownedPid:owned?.pid,exitCode:owned?.exitCode,signalCode:owned?.signalCode,browserDisconnected:browser?!browser.isConnected():null,temporaryProfileRemoved:profileRemoved,privateRootRemoved:passed&&owned?.exitCode===0});
}
