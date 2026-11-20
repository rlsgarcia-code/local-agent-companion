// Exported artifact only. Real Chromium touch dispatch and composed pixels;
// never inject game JavaScript, internal state, progress or browser storage.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,realpath} from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {PNG} from 'pngjs';
import previewModule from '../dist-tests/packages/adapter-game-browser/src/preview.js';
import {detectBoat,renderedResult,brightGlyphDifference} from './game-qualification/mare-visual-controller.mjs';
const arg=process.argv.find(v=>v.startsWith('--attempt='))?.slice(10);assert.ok(arg,'Choose the exact completed native Maré attempt');
const attempt=await realpath(arg),base=await realpath('output/playwright/mare/runs');assert.ok(attempt.startsWith(base+path.sep));
const evidence=JSON.parse(await readFile(path.join(attempt,'evidence.json'))),artifact=evidence.artifact;assert.equal(evidence.project.engine,'godot');assert.equal(artifact.sourceHash,evidence.project.contentHash);
const output=path.join(attempt,'touch-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID().slice(0,8));await mkdir(output);
const save=(name,value)=>writeFile(path.join(output,name),Buffer.isBuffer(value)?value:JSON.stringify(value,null,2)+'\n');
const tick=ms=>new Promise(r=>setTimeout(r,ms));let preview,cdp,startupPauseResumed=false;
const screenshot=async()=>Buffer.from((await cdp.send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false})).data,'base64');
function regionDifference(a,b,rect){const x=PNG.sync.read(a),y=PNG.sync.read(b);assert.equal(x.width,y.width);assert.equal(x.height,y.height);let changed=0,count=0;for(let yy=rect.y;yy<rect.y+rect.h;yy++)for(let xx=rect.x;xx<rect.x+rect.w;xx++){count++;const i=(yy*x.width+xx)*4;if(Math.abs(x.data[i]-y.data[i])+Math.abs(x.data[i+1]-y.data[i+1])+Math.abs(x.data[i+2]-y.data[i+2])>30)changed++;}return changed/count;}
function panelPixels(bytes){const p=PNG.sync.read(bytes),scale=p.width/390,points=[];for(const x of [22,206])for(const y of [706,736,796]){const i=(Math.round(y*scale)*p.width+Math.round(x*scale))*4;points.push(...p.data.subarray(i,i+3));}return points;}
await save('control.json',{scope:'Emulated two-contact browser controls/pause/reload, no model or service operation and no physical/human/audio quality acceptance',sourceHash:artifact.sourceHash,artifactHash:artifact.artifactHash,runnerSha256:createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex')});
try{
 const files=new Map();for(const file of artifact.files){const bytes=await readFile(path.join(attempt,'build',file.path));assert.equal(bytes.length,file.size);assert.equal(createHash('sha256').update(bytes).digest('hex'),file.sha256);files.set(file.path,bytes);}
 preview=await previewModule.openGamePreview({artifact,readFile:async name=>{assert.ok(files.has(name));return files.get(name);},signal:new AbortController().signal,headless:true});const page=preview.page;
 await page.setViewportSize({width:390,height:844});cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:2,mobile:true});await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:2});await tick(2500);
 await page.touchscreen.tap(165,565);await tick(250);
 let startup=await screenshot();if(renderedResult(startup)){await save('startup-paused.png',startup);await page.touchscreen.tap(195,431);await tick(200);startupPauseResumed=true;}
 const before=await screenshot(),initial=detectBoat(before);assert.equal(PNG.sync.read(before).width,780,'Expected actual DPR=2 composed pixels');assert.ok(initial,'Initial rendered boat missing');await save('before.png',before);
 const left={id:1,x:103,y:716},right={id:2,x:287,y:716};await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[left,right]});await tick(1300);
 const rowing=await screenshot(),both=detectBoat(rowing);await save('both-oars.png',rowing);assert.ok(both,'Rendered boat missing while rowing');assert.ok(both.x-initial.x>50,'Two touch oars did not advance the boat');assert.ok(Math.abs(both.angle)<.15,'Two equal touch oars unexpectedly turned the boat');
 // The installed Chromium was probed on an isolated DOM fixture: TouchMove
 // omitting a point leaves it pressed; TouchEnd names the point being released.
 // This is actual version-bound input behavior, not synthetic DOM dispatch.
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[left]});await tick(850);const oneBytes=await screenshot(),one=detectBoat(oneBytes);await save('one-oar.png',oneBytes);assert.ok(one);assert.ok(one.angle<both.angle-.15,'Releasing the left contact did not leave the right oar independent');
 await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});await tick(150);const cancelled=await screenshot();await save('cancelled.png',cancelled);const beforeBorders=panelPixels(before),afterBorders=panelPixels(cancelled);assert.ok(beforeBorders.every((v,i)=>Math.abs(v-afterBorders[i])<12),'Contact cancellation left an active oar border');
 await page.touchscreen.tap(325,46);await tick(150);const paused=await screenshot();await tick(350);const still=await screenshot();assert.ok(regionDifference(paused,still,{x:0,y:0,w:780,h:1688})<.001,'Touch pause did not freeze the canvas');await save('paused.png',paused);
 await page.touchscreen.tap(87,799);await tick(200);const muted=await screenshot();await save('muted.png',muted);assert.ok(brightGlyphDifference(paused,muted,{x:60,y:1568,w:228,h:60}).difference>.1,'Mute control did not change its visible label');
 await page.reload();await tick(2500);const restoredHome=await screenshot();await save('restored-home.png',restoredHome);const restoredMute=brightGlyphDifference(muted,restoredHome,{x:60,y:1568,w:228,h:60});assert.ok(restoredMute.difference<.005,'Muted preference did not retain its visible label after reload');
 await page.touchscreen.tap(165,565);await tick(250);const restoredBytes=await screenshot(),restored=detectBoat(restoredBytes);await save('restored-boat.png',restoredBytes);assert.ok(restored);assert.ok(Math.hypot(restored.x-one.x,restored.y-one.y)<60,'Checkpoint did not visually resume near the prior trajectory');
 assert.deepEqual(preview.errors,[]);assert.deepEqual(preview.blocked,[]);
 await save('report.json',{state:'passed',sourceHash:artifact.sourceHash,artifactHash:artifact.artifactHash,device:{emulated:true,width:390,height:844,deviceScaleFactor:2},initial,both,one,restored,startupPauseResumed,touchReleaseMethod:'CDP touchEnd names the released point; installed Chromium DOM-event fixture verified this behavior',simultaneousOarsAdvancedWithoutTurn:true,partialReleaseLeftRightOarIndependent:true,touchCancellationClearedBorders:true,pausedCanvasStable:true,muteLabelSurvivedReload:true,restoredMuteGlyphs:restoredMute,checkpointVisuallyResumed:true,noGameStateOrStorageInjection:true,serviceOrModelStarted:false,physicalAcceptance:false,audioQualityAccepted:false,humanQualityAccepted:false});console.log('MARE_TOUCH_RECORDED '+output);
}catch(error){await cdp?.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]}).catch(()=>{});await preview?.page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});await save('failure.json',{message:error instanceof Error?error.message:String(error),sourceHash:artifact.sourceHash,artifactHash:artifact.artifactHash});throw error;}
finally{await cdp?.detach().catch(()=>{});await preview?.close();await save('closure.json',{previewClosed:true,noServiceOrModelOperation:true});}
