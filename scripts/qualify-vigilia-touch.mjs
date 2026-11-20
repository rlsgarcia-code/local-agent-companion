// Exact exported game, no Agent Service/model. CDP supplies ordinary emulated
// touch contacts, never game code, private state, a storage write or a test bridge.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,realpath} from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import previewModule from '../dist-tests/packages/adapter-game-browser/src/preview.js';
const base=await realpath('output/playwright/vigilia/runs'),argument=process.argv.find(v=>v.startsWith('--attempt='))?.slice(10);assert.ok(argument,'Pass --attempt=<qualified original directory>');const attempt=await realpath(argument);assert.ok(attempt.startsWith(base+path.sep));
const evidence=JSON.parse(await readFile(path.join(attempt,'evidence.json'),'utf8')),artifact=evidence.artifact;assert.equal(evidence.project.engine,'babylon');assert.equal(artifact.sourceHash,evidence.project.contentHash);
const output=path.join(attempt,`touch-${new Date().toISOString().replace(/[:.]/g,'-')}-${randomUUID().slice(0,8)}`);await mkdir(output);
let preview,cdp;const position=async()=>({x:(Number(await preview.page.locator('#map-player').getAttribute('cx'))-20)/1.1,z:(15-Number(await preview.page.locator('#map-player').getAttribute('cy')))/.4});
try{
 const files=new Map();for(const f of artifact.files){const bytes=await readFile(path.join(attempt,'build',f.path));assert.equal(createHash('sha256').update(bytes).digest('hex'),f.sha256);files.set(f.path,bytes);}
 preview=await previewModule.openGamePreview({artifact,readFile:async name=>{assert.ok(files.has(name));return files.get(name);},signal:new AbortController().signal,headless:true});
 await preview.page.setViewportSize({width:390,height:844});await preview.page.getByRole('button',{name:'Começar viagem',exact:true}).click();await preview.page.locator('#hud').waitFor();await preview.page.waitForTimeout(400);
 cdp=await preview.page.context().newCDPSession(preview.page);await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:2});const points=[];for(const [i,input]of ['up','right'].entries()){const box=await preview.page.locator(`[data-input=${input}]`).boundingBox();assert.ok(box);points.push({id:i+1,x:box.x+box.width/2,y:box.y+box.height/2});}
 const before=await position();await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:points});try{await preview.page.waitForTimeout(450);await preview.page.screenshot({path:path.join(output,'two-contacts.png')});}finally{await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});}
 await preview.page.waitForTimeout(100);const after=await position();assert.ok(after.x-before.x>.5&&after.z-before.z>.5,'Both held directional contacts must move the traveller.');await preview.page.waitForTimeout(300);const stopped=await position();assert.ok(Math.hypot(stopped.x-after.x,stopped.z-after.z)<.01,'Cancelling contacts releases every held direction.');assert.deepEqual(preview.errors,[]);assert.deepEqual(preview.blocked,[]);
 await preview.page.screenshot({path:path.join(output,'released.png')});await writeFile(path.join(output,'report.json'),JSON.stringify({state:'passed',sourceHash:artifact.sourceHash,artifactHash:artifact.artifactHash,originalAttempt:attempt,method:'Chromium CDP emulated two simultaneous touch contacts and cancellation; only visible minimap positions read.',before,after,stopped,agentServiceStarted:false,modelUsed:false,physicalDeviceAcceptance:false,qualityApproved:false},null,2));console.log(`VIGILIA_EXPORTED_MULTITOUCH_OBSERVED ${output}`);
}catch(error){await writeFile(path.join(output,'failure.json'),JSON.stringify({state:'failed',message:error instanceof Error?error.message:String(error),sourceHash:artifact.sourceHash,artifactHash:artifact.artifactHash},null,2));throw error;}finally{await cdp?.detach().catch(()=>{});await preview?.close();}
