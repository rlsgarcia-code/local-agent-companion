// Native Chromium HTTP/throttling observation of an existing immutable artifact.
// No inference, state injection, project mutation or installed release claim.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,realpath} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import path from 'node:path';
import {performance} from 'node:perf_hooks';
import {chromium} from 'playwright-core';
import browserModule from '../dist-tests/packages/adapter-game-browser/src/browser.js';
import resourceModule from '../dist-tests/packages/adapter-game-browser/src/resources.js';
import isolationModule from '../dist-tests/packages/adapter-game-browser/src/isolation.js';
import {detectBoat} from './game-qualification/mare-visual-controller.mjs';
const arg=process.argv.find(v=>v.startsWith('--attempt='))?.slice(10);assert.ok(arg,'Select the completed Maré build');
const attempt=await realpath(arg),base=await realpath('output/playwright/mare/runs');assert.ok(attempt.startsWith(base+path.sep));
const evidence=JSON.parse(await readFile(path.join(attempt,'evidence.json'))),artifact=evidence.artifact;assert.equal(artifact.engine,'godot');
const output=path.join(attempt,'loading-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID().slice(0,8));await mkdir(output);
const save=(name,value)=>writeFile(path.join(output,name),Buffer.isBuffer(value)?value:JSON.stringify(value,null,2)+'\n');
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const files=new Map();for(const file of artifact.files){const bytes=await readFile(path.join(attempt,'build',file.path));assert.equal(bytes.length,file.size);assert.equal(digest(bytes),file.sha256);files.set(file.path,bytes);}
const qualified=await browserModule.qualifyBrowser();assert.ok(qualified,'No qualified installed Chromium');
const observerFiles=['scripts/qualify-mare-loading.mjs','scripts/game-qualification/mare-visual-controller.mjs','packages/adapter-game-browser/src/resources.ts','packages/adapter-game-browser/src/encoding.ts','packages/adapter-game-browser/src/isolation.ts'];
const sources=[];for(const file of observerFiles)sources.push({path:file,sha256:digest(await readFile(file))});
await save('control.json',{scope:'Development HTTP encoding and emulated 20 Mb/s,100 ms RTT loading, no physical performance acceptance',sourceHash:artifact.sourceHash,artifactHash:artifact.artifactHash,originalEngineManifestSha256:evidence.engineManifestSha256,currentTransportSources:sources,browser:{version:qualified.version,sha256:qualified.sha256},profile:{downloadBytesPerSecond:2500000,uploadBytesPerSecond:1250000,latencyMs:100},noModelOrServiceStarted:true});
const results=[];
for(const mode of ['identity','gzip']){
 const signal=new AbortController(),errors=[],blocked=[],responses=new Map(),loaded=new Map();let resources,browser,context,page,cdp;
 const result={mode,state:'running'};
 try{
  resources=await resourceModule.serveArtifactResources({artifact,signal:signal.signal,readFile:async name=>{assert.ok(files.has(name));return files.get(name);}});
  browser=await chromium.launch({executablePath:qualified.executablePath,headless:true,chromiumSandbox:true,timeout:10000,args:['--force-webrtc-ip-handling-policy=disable_non_proxied_udp','--webrtc-ip-handling-policy=disable_non_proxied_udp']});assert.ok(qualified.version.includes(browser.version()));
  // Add throttling before production isolation's first navigation, without
  // modifying its guards or running code in the game.
  const facade={newContext:async options=>{
   context=await browser.newContext({...options,extraHTTPHeaders:{'Accept-Encoding':mode==='identity'?'identity':'gzip'}});
   return new Proxy(context,{get(target,key){if(key==='newPage')return async()=>{
    page=await target.newPage();cdp=await target.newCDPSession(page);await cdp.send('Network.enable');await cdp.send('Network.setCacheDisabled',{cacheDisabled:true});
    await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:100,downloadThroughput:2500000,uploadThroughput:1250000,connectionType:'wifi'});
    cdp.on('Network.responseReceived',event=>{const response=event.response,url=new URL(response.url);if(url.origin!==resources.origin)return;responses.set(event.requestId,{path:url.pathname,status:response.status,mime:response.mimeType,contentEncoding:Object.entries(response.headers).find(([key])=>key.toLowerCase()==='content-encoding')?.[1]??'identity',contentLength:Number(Object.entries(response.headers).find(([key])=>key.toLowerCase()==='content-length')?.[1]??0)});});
    cdp.on('Network.loadingFinished',event=>loaded.set(event.requestId,event.encodedDataLength));return page;
   };const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
  }};
  const started=performance.now();await isolationModule.openGameArtifactPage(facade,{artifact,readFile:async name=>files.get(name)},{width:960,height:540},errors,blocked,signal.signal,resources);
  let boat,bytes;while(performance.now()-started<60000){await page.keyboard.press('Enter');bytes=await page.screenshot();boat=detectBoat(bytes);if(boat)break;await new Promise(resolve=>setTimeout(resolve,200));}
  result.timeToPlayableObservationMs=performance.now()-started;assert.ok(boat,'No visible playable boat within observation ceiling');await save(mode+'-playable.png',bytes);
  result.boat=boat;result.responses=[...responses].map(([id,value])=>({...value,encodedDataLength:loaded.get(id)??null}));
  const wasm=result.responses.find(value=>value.path.endsWith('.wasm'));assert.ok(wasm);assert.equal(wasm.contentEncoding,mode);
  assert.equal(wasm.status,200);assert.ok(wasm.encodedDataLength>0);assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);
  result.errors=errors;result.blocked=blocked;result.meetsTenSecondObservation=result.timeToPlayableObservationMs<=10000;result.state='passed';
 }catch(error){result.state='failed';result.message=error instanceof Error?error.message:String(error);result.errors=errors;result.blocked=blocked;await page?.screenshot({path:path.join(output,mode+'-failure.png')}).catch(()=>{});}
 finally{await cdp?.detach().catch(()=>{});await context?.close().catch(()=>{});await browser?.close();await resources?.close();result.browserClosed=browser?!browser.isConnected():true;if(resources){await assert.rejects(fetch(resources.origin));result.listenerClosed=true;}results.push(result);await save('report.json',{state:results.every(r=>r.state==='passed')?'passed':'failed',results,fullProductAcceptance:false,physicalPerformanceAccepted:false,installedOrPublished:false});}
}
assert.ok(results.every(result=>result.state==='passed'),'Loading qualification failed; preserved both cases');
console.log('MARE_LOADING_RECORDED '+output);
