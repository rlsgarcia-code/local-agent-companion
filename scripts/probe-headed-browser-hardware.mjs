// Readiness diagnostic only, not a game-performance collector or quality report.
// Own headed browser/profile; no game, personal browser, model or installation.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile,mkdir,mkdtemp,rm,lstat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright-core';
assert.equal(process.platform,'darwin','This first readiness diagnostic qualifies only its actual Mac host');
assert.equal(process.versions.node,'22.23.4');assert.equal(process.argv.length,3);assert.ok(process.argv[2].startsWith('--output='));
const output=path.resolve(process.argv[2].slice(9));await mkdir(output);
const root=await mkdtemp(path.join(tmpdir(),'game-gpu-probe-')),env={HOME:root,PATH:'/usr/bin:/bin',TMPDIR:root,LANG:'en_US.UTF-8'};
const run=promisify(execFile),sha=b=>createHash('sha256').update(b).digest('hex'),save=(name,value)=>writeFile(path.join(output,name),JSON.stringify(value,null,2)+'\n');
let server,browser,profile,owned,passed=false,timedOut=false,profileRemoved=false;
const deadline=setTimeout(()=>{timedOut=true;void server?.kill().catch(()=>{});},30000);
try{
 const module=pathToFileURL(path.resolve('dist-tests/packages/adapter-game-browser/src/browser.js')).href;
 const code="const module=await import(process.argv[1]);const result=await module.default.qualifyBrowser();if(!result)throw Error('No qualified installed Chromium browser');process.stdout.write(JSON.stringify(result));";
 const {stdout}=await run(process.execPath,['--input-type=module','-e',code,module],{env,maxBuffer:16384,timeout:10000});const qualified=JSON.parse(stdout);
 await save('control.json',{observerSha256:sha(await readFile(new URL(import.meta.url))),browserQualifierSourceSha256:sha(await readFile('packages/adapter-game-browser/src/browser.ts')),qualifiedBrowser:qualified,node:process.versions.node,headless:false,chromiumSandbox:true,personalProfileUsed:false});
 server=await chromium.launchServer({executablePath:qualified.executablePath,headless:false,chromiumSandbox:true,host:'127.0.0.1',timeout:10000,env,args:['--force-webrtc-ip-handling-policy=disable_non_proxied_udp','--webrtc-ip-handling-policy=disable_non_proxied_udp']});owned=server.process();
 browser=await chromium.connect(server.wsEndpoint());assert.ok(qualified.version.includes(browser.version()));
 const browserSession=await browser.newBrowserCDPSession(),command=await browserSession.send('Browser.getBrowserCommandLine');
 assert.ok(!command.arguments.some(arg=>arg.startsWith('--headless')||arg==='--no-sandbox'||arg==='--disable-gpu'));
 const profileFlag=command.arguments.find(arg=>arg.startsWith('--user-data-dir='));assert.ok(profileFlag);profile=profileFlag.slice('--user-data-dir='.length);
 assert.ok(path.basename(profile).startsWith('playwright_chromiumdev_profile-'));const info=await lstat(profile);assert.ok(info.isDirectory()&&!info.isSymbolicLink()&&info.uid===process.getuid()&&(info.mode&0o077)===0);
 const context=await browser.newContext({viewport:{width:960,height:540},permissions:[],acceptDownloads:false,serviceWorkers:'block'}),requests=[];
 await context.route('**/*',async route=>{requests.push(new URL(route.request().url()).protocol);await route.abort();});await context.routeWebSocket('**/*',socket=>socket.close());
 const page=await context.newPage();await page.goto('about:blank');await page.bringToFront();
 const session=await context.newCDPSession(page),tree=await session.send('Page.getFrameTree'),world=await session.send('Page.createIsolatedWorld',{frameId:tree.frameTree.frame.id,worldName:'companion-owned-gpu-readiness-v1'});
 const evaluated=await session.send('Runtime.evaluate',{contextId:world.executionContextId,returnByValue:true,expression:`(()=>{document.title='Companion · Verificação do navegador';const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;document.body.append(canvas);const gl=canvas.getContext('webgl2',{failIfMajorPerformanceCaveat:true});if(!gl)return {webgl2:false,visibility:document.visibilityState,focused:document.hasFocus()};gl.clearColor(.08,.22,.34,1);gl.clear(gl.COLOR_BUFFER_BIT);return {webgl2:true,visibility:document.visibilityState,focused:document.hasFocus(),renderer:gl.getParameter(gl.RENDERER),vendor:gl.getParameter(gl.VENDOR)};})()`});
 assert.ok(!evaluated.exceptionDetails);const canvasProbe=evaluated.result.value;
 const hardware=await browserSession.send('SystemInfo.getInfo'),version=await browserSession.send('Browser.getVersion');
 const aux=hardware.gpu.auxAttributes??{},features=hardware.gpu.featureStatus??{};
 const gpu={devices:hardware.gpu.devices.map(({vendorId,deviceId,vendorString,deviceString,driverVendor,driverVersion})=>({vendorId,deviceId,vendorString,deviceString,driverVendor,driverVersion})),attributes:Object.fromEntries(['glRenderer','glVendor','glVersion','displayType','isSandboxed','inProcessGpu'].filter(k=>aux[k]!==undefined).map(k=>[k,aux[k]])),features:Object.fromEntries(['webgl','webgl2','gpu_compositing','rasterization'].filter(k=>features[k]!==undefined).map(k=>[k,features[k]]))};
 const identifiers=JSON.stringify(gpu),softwareOrVirtual=/swiftshader|llvmpipe|softpipe|software raster|microsoft basic render|\bwarp\b|virtualbox|vmware|parallels|virgl/i.test(identifiers);
 const nativeMetal=/ANGLE Metal Renderer/i.test(String(aux.glRenderer??''));
 const browserReportsHardwareAcceleration=Boolean(canvasProbe.webgl2&&!softwareOrVirtual&&nativeMetal&&features.webgl==='enabled'&&features.gpu_compositing==='enabled');
 await page.screenshot({path:path.join(output,'owned-probe.png')});assert.deepEqual(requests,[]);
 await context.close();await server.close();assert.equal(owned.exitCode,0);assert.equal(browser.isConnected(),false);assert.equal(timedOut,false);
 try{await lstat(profile);}catch(error){if(error.code!=='ENOENT')throw error;profileRemoved=true;}
 assert.equal(profileRemoved,true,'Confirm removal of the actual temporary browser profile after its owned process exits');
 const after=(await run(process.execPath,['--input-type=module','-e',code,module],{env,maxBuffer:16384,timeout:10000})).stdout;assert.deepEqual(JSON.parse(after),qualified);
 await save('report.json',{scope:'Mac headed browser hardware readiness on a trusted blank probe, not a game, FPS/loading measurement, physical acceptance or quality collector.',qualifiedBrowser:qualified,runningBrowser:{product:version.product,protocolVersion:version.protocolVersion,revision:version.revision},host:{platform:process.platform,architecture:process.arch,modelName:hardware.modelName,modelVersion:hardware.modelVersion},gpu,canvasProbe,browserReportsHardwareAcceleration,softwareOrVirtualReported:softwareOrVirtual,interpretation:'Browser-reported GPU/feature information only. No game frame-rate or real-device acceptance is inferred.',physicalGamePerformanceApproved:false,qualityApproved:false,requests:0,personalProfileUsed:false,browserComponentsUnchanged:true,modelCalls:0});
 passed=true;console.log('HEADED_BROWSER_HARDWARE_READINESS_RECORDED '+output);
}catch(error){await save('failure.json',{message:error.message,ownedPid:owned?.pid,exitCode:owned?.exitCode,privateRoot:root,timedOut});throw error;}
finally{
 clearTimeout(deadline);if(server&&owned?.exitCode===null)try{await server.close();}catch{await server.kill().catch(()=>{});}
 if(passed&&owned?.exitCode===0)await rm(root,{recursive:true,force:true});
 await save('closure.json',{ownedPid:owned?.pid,exitCode:owned?.exitCode,signalCode:owned?.signalCode,browserDisconnected:browser?!browser.isConnected():null,temporaryBrowserProfileRemoved:profileRemoved,privateRootRemoved:passed&&owned?.exitCode===0});
}
