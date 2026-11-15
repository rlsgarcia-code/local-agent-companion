// Authored independent campaign QA, not a model/agent loop. Only composed PNGs
// and ordinary input. No game JS evaluation, storage writes or test bridge.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,appendFile,realpath} from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import previewModule from '../dist-tests/packages/adapter-game-browser/src/preview.js';
import {detectBoat,renderedResult,delivered} from './game-qualification/mare-visual-controller.mjs';
const arg=process.argv.find(v=>v.startsWith('--attempt='))?.slice(10);assert.ok(arg,'Choose the exact completed native Maré attempt');
const original=await realpath(arg),base=await realpath('output/playwright/mare/runs');assert.ok(original.startsWith(base+path.sep));
const evidence=path.join(original,'evidence.json'),record=JSON.parse(await readFile(evidence)),artifact=record.artifact;assert.equal(record.project.engine,'godot');assert.equal(artifact.sourceHash,record.project.contentHash);
const output=path.join(original,'campaign-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID().slice(0,8));await mkdir(output);
const exported=await realpath(typeof record.editableSource==='string'?record.editableSource:record.editableSource.directory);assert.ok(exported.startsWith(await realpath(path.join(original,'source-export'))+path.sep));
const source=JSON.parse(await readFile(path.join(exported,'project.json'))),coursesFile=source.files.find(f=>f.path==='data/courses.json');
const courseBytes=await readFile(path.join(exported,'source','data/courses.json'));assert.equal(createHash('sha256').update(courseBytes).digest('hex'),coursesFile.sha256);const courses=JSON.parse(courseBytes).courses;assert.equal(courses.length,12);
const save=(name,value)=>writeFile(path.join(output,name),Buffer.isBuffer(value)?value:JSON.stringify(value,null,2)+'\n');
const tick=ms=>new Promise(r=>setTimeout(r,ms)),wrap=n=>((n+Math.PI)%(2*Math.PI)+2*Math.PI)%(2*Math.PI)-Math.PI,clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
await save('control.json',{scope:'Normal-input campaign of the exact authored build, using a standalone PNG observer. No player-source QA code, injected state, completion endpoint, storage manipulation, model calls or service operations.',sourceHash:artifact.sourceHash,artifactHash:artifact.artifactHash,engineManifestSha256:record.engineManifestSha256,scriptSha256:createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex'),observerSha256:createHash('sha256').update(await readFile(new URL('./game-qualification/mare-visual-controller.mjs',import.meta.url))).digest('hex')});
let preview,held=new Set(),active,frame=0;
async function controls(left,right){
 const desired=new Set();if(left>0)desired.add('w');if(left<0)desired.add('s');if(right>0)desired.add('ArrowUp');if(right<0)desired.add('ArrowDown');
 for(const key of held)if(!desired.has(key))await preview.page.keyboard.up(key);
 for(const key of desired)if(!held.has(key))await preview.page.keyboard.down(key);
 held=desired;
}
const campaign=[];
try{
 preview=await previewModule.openGamePreview({artifact,readFile:name=>readFile(path.join(original,'build',name)),signal:new AbortController().signal,headless:true});
 await preview.page.setViewportSize({width:1060,height:820});await preview.page.waitForTimeout(2500);await preview.page.keyboard.press('Enter');await tick(300);
 for(let index=0;index<courses.length;index++){
  const course=courses[index],started=performance.now();let prior=null,priorAt=0,omega=0,vx=0,vy=0,dock=0,finished=false,leftCarry=0,rightCarry=0,missing=0,nextLog=0;
  active={course:index+1,id:course.id};await preview.page.screenshot({path:path.join(output,`course-${index+1}-start.png`)});
  while(performance.now()-started<150000){
   frame++;const bytes=await preview.page.screenshot(),at=performance.now(),boat=detectBoat(bytes,prior)??detectBoat(bytes);
   if(!boat&&renderedResult(bytes)){
    await controls(0,0);await save(`course-${index+1}-finished.png`,bytes);finished=true;break;
   }
   if(!boat){await controls(0,0);missing++;assert.ok(missing<20,'Rendered boat could not be reacquired');await tick(70);continue;}
   missing=0;
   const dt=prior?Math.max(.02,(at-priorAt)/1000):.1;
   if(prior&&Math.hypot(boat.x-prior.x,boat.y-prior.y)<80){omega=omega*.65+wrap(boat.angle-prior.angle)/dt*.35;vx=vx*.65+(boat.x-prior.x)/dt*.35;vy=vy*.65+(boat.y-prior.y)/dt*.35;}else{omega=0;vx=0;vy=0;}
   while(dock<3&&delivered(bytes,course,dock,boat))dock++;
   const target=course.docks[Math.min(dock,2)],dx=target[0]-boat.x,dy=target[1]-boat.y,distance=Math.hypot(dx,dy),error=wrap(Math.atan2(dy,dx)-boat.angle),speed=Math.hypot(vx,vy);
   let left,right;
   if(Math.abs(error)>.11){const turn=clamp(error*2.8-omega*1.1,-1,1);left=turn;right=-turn;}
   else{const throttle=distance<130&&speed>75?-.65:distance<70?.3:1,correction=clamp(error*2.2-omega*.7,-.65,.65);left=clamp(throttle+correction,-1,1);right=clamp(throttle-correction,-1,1);}
   leftCarry+=Math.abs(left);rightCarry+=Math.abs(right);const leftKey=leftCarry>=1?Math.sign(left):0,rightKey=rightCarry>=1?Math.sign(right):0;if(leftKey)leftCarry-=1;if(rightKey)rightCarry-=1;
   await controls(leftKey,rightKey);await appendFile(path.join(output,'trace.jsonl'),JSON.stringify({frame,course:index+1,dock,elapsedMs:Math.round(at-started),boat:{x:boat.x,y:boat.y,angle:boat.angle},target,distance,speed,omega,left:leftKey,right:rightKey})+'\n');
   if(at-started>=nextLog){console.log(`MARE_CAMPAIGN course=${index+1} dock=${dock} elapsed=${Math.round((at-started)/1000)} x=${Math.round(boat.x)} y=${Math.round(boat.y)}`);nextLog+=5000;}
   prior=boat;priorAt=at;await tick(65);
  }
  assert.ok(finished,`Course ${index+1} did not reach its rendered result through normal controls`);
  campaign.push({course:index+1,id:course.id,wallSeconds:(performance.now()-started)/1000,observedDockLabels:dock,result:'Rendered result action appeared after normal paddle controls'});await save('campaign.json',campaign);
  assert.deepEqual(preview.errors,[]);assert.deepEqual(preview.blocked,[]);await preview.page.keyboard.press('Enter');await tick(250);
 }
 await preview.page.screenshot({path:path.join(output,'ending.png')});assert.equal(campaign.length,12);
 // Recovery is exercised by the real UI/IDBFS. Never set or restore storage.
 await preview.page.keyboard.press('Enter');await tick(200);await preview.page.screenshot({path:path.join(output,'completed-map.png')});
 await preview.page.reload();await preview.page.waitForTimeout(2500);await preview.page.keyboard.press('Enter');await tick(250);const restored=await preview.page.screenshot();await save('restored-last-course.png',restored);
 const continued=detectBoat(restored),last=courses.at(-1);assert.ok(continued,'Continued campaign did not render its boat');assert.ok(Math.hypot(continued.x-last.start[0],continued.y-last.start[1])<10,'Reload did not return to the final unlocked course');
 await preview.page.keyboard.press('p');await tick(150);await preview.page.mouse.click(530,555);await tick(200);await preview.page.screenshot({path:path.join(output,'restored-map.png')});
 assert.deepEqual(preview.errors,[]);assert.deepEqual(preview.blocked,[]);
 await save('report.json',{state:'passed',scope:'Standalone composed-pixel/ordinary-input observation, not human, physical, artistic or product acceptance',sourceHash:artifact.sourceHash,artifactHash:artifact.artifactHash,campaign,checkpointAfterEndingReload:true,restoredBoat:continued,errors:preview.errors,blocked:preview.blocked,fullProductAcceptance:false});console.log('MARE_CAMPAIGN_RECORDED '+output);
}catch(error){await controls(0,0).catch(()=>{});await preview?.page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});await save('failure.json',{message:error instanceof Error?error.message:String(error),active,completed:campaign.length,frame});throw error;}
finally{await preview?.close();await save('closure.json',{previewClosed:true,noModelOrServiceOperation:true});}
