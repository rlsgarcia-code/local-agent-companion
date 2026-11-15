// Independent maintainer observer: public HUD/PNG feedback -> ordinary input.
// Never installed in a player, Agent Service, model tool or trusted collector.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {PNG} from 'pngjs';

assert.equal(process.versions.node,'22.23.4');assert.ok([4,5,6,7].includes(process.argv.length));
assert.ok(Object.keys(process.env).every(k=>['HOME','PATH','TMPDIR','LANG','__CF_USER_TEXT_ENCODING'].includes(k)),'Closed launcher environment required');
const source=path.resolve(process.argv[2]),output=path.resolve(process.argv[3]),campaign=path.join(output,'campaign');await mkdir(output);
const sha=b=>createHash('sha256').update(b).digest('hex'),save=(name,value)=>writeFile(path.join(output,name),JSON.stringify(value,null,2)+'\n');
const expected=process.argv[4]??'97df428421e5e52cd9c3598bb3aaec1f48d1b114f198c435583b4180634ee518';assert.match(expected,/^[a-f0-9]{64}$/);
const browserName=process.argv[5]??'chromium';assert.ok(['chromium','firefox','webkit'].includes(browserName));
const keyboardRecovery=process.argv[6]==='--keyboard-recovery';if(process.argv[6])assert.ok(keyboardRecovery);
const artifact=JSON.parse(await readFile(path.join(source,'artifact.json')));assert.equal(artifact.artifactHash,expected);
// Authored public course geometry, outside the game. Reefs are not removed,
// scores/positions are never written, and no route result certifies quality.
const routes=[[[251,238]],[[439,177]],[[600,150],[750,222]],[[790,350],[780,470],[716,508]],[[650,660],[430,690],[340,620],[353,523]]];
const wrap=a=>Math.atan2(Math.sin(a),Math.cos(a));
function boat(bytes,rect){
 const p=PNG.sync.read(bytes),hull=[],flag=[],paper=[];
 assert.ok(rect&&rect.x>=0&&rect.y>=0&&rect.x+rect.width<=p.width+1&&rect.y+rect.height<=p.height+1);
 for(let y=Math.ceil(rect.y);y<Math.floor(rect.y+rect.height);y++)for(let x=Math.ceil(rect.x);x<Math.floor(rect.x+rect.width);x++){
  const i=(y*p.width+x)*4,r=p.data[i],g=p.data[i+1],b=p.data[i+2];
  if(Math.abs(r-139)+Math.abs(g-69)+Math.abs(b-19)<15)hull.push([x,y]);
  // Closed sail is smaller: preserve antialiased flag pixels too. This is
  // outside PNG recognition only, never a change to game art or thresholds.
  if(Math.abs(r-255)+Math.abs(g-215)+Math.abs(b)<65)flag.push([x,y]);
  if(Math.abs(r-245)+Math.abs(g-245)+Math.abs(b-220)<35||Math.abs(r-232)+Math.abs(g-224)+Math.abs(b-208)<30)paper.push([x,y]);
 }
 assert.ok(hull.length>=30,'Distinct rendered brown hull required');
 const center=arr=>({x:arr.reduce((s,p)=>s+p[0],0)/arr.length,y:arr.reduce((s,p)=>s+p[1],0)/arr.length}),h=center(hull);
 const near=arr=>arr.filter(p=>Math.hypot((p[0]-h.x)/rect.width*1024,(p[1]-h.y)/rect.height*768)<36),visibleFlag=near(flag),visibleSail=near(paper);
 // A foreground port label can cover the flag. Require actual nearby ivory
 // sail pixels instead; record which visible cue was used, never read state.
 const cue=visibleFlag.length>=2?'gold-flag':'ivory-sail',points=cue==='gold-flag'?visibleFlag:visibleSail;
 assert.ok(points.length>=(cue==='gold-flag'?2:8),'Visible flag or nearby ivory sail required');const f=center(points);
 assert.ok(Math.hypot(f.x-h.x,f.y-h.y)>3,'Visible direction cue must differ from hull center');
 const angle=Math.atan2((f.y-h.y)*768/rect.height,(f.x-h.x)*1024/rect.width);
 return {x:(h.x-rect.x)/rect.width*1024+5*Math.cos(angle),y:(h.y-rect.y)/rect.height*768+5*Math.sin(angle),angle,hullPixels:hull.length,flagPixels:visibleFlag.length,sailPixels:visibleSail.length,cue};
}
await writeFile(path.join(output,'parent.mjs'),await readFile(new URL(import.meta.url)),{flag:'wx'});
const child=spawn(process.execPath,['scripts/observe-windmail-responsive-campaign.mjs',source,campaign,browserName,...(keyboardRecovery?['--keyboard-recovery']:[])],{env:{HOME:process.env.HOME,PATH:'/usr/bin:/bin',TMPDIR:'/private/tmp',LANG:'en_US.UTF-8'},stdio:['pipe','pipe','pipe']});
const exit=once(child,'exit'),commands=[],observed=[];let transcript='',buffer='',leg=0,waypoint=0,failure,chain=Promise.resolve();
const deadline=setTimeout(()=>{failure??=Error('Parent observer deadline; inspect same child/closure, never restart');child.stdin.end();},16*60*1000);
function send(command){assert.ok(commands.length<100,'Do not enlarge original campaign command bound');commands.push(command);child.stdin.write(JSON.stringify(command)+'\n');}
async function line(text){
 if(text.startsWith('WINDMAIL_RESPONSIVE_CAMPAIGN_READY ')){send({action:'toggle-sail'});return;}
 if(!text.startsWith('WINDMAIL_RESPONSIVE_CAMPAIGN_SHOT '))return;
 const name=text.slice('WINDMAIL_RESPONSIVE_CAMPAIGN_SHOT '.length);assert.ok(/^move-\d+\.png$/.test(name));
 const journal=JSON.parse(await readFile(path.join(campaign,'live-steps.json'))),frame=journal.steps.findLast(s=>s.action==='capture'&&s.image.file===name);assert.ok(frame?.presentation);
 const match=/^(\d)\/5$/.exec(frame.presentation.letters);assert.ok(match);const current=Number(match[1]);
 if(current===5){await save('controller.json',{commands,observed});child.stdin.end();return;}
 const bytes=await readFile(path.join(campaign,name));assert.equal(sha(bytes),frame.image.sha256);const measured=boat(bytes,frame.presentation.canvas);
 if(current!==leg){assert.ok(current===leg+1);leg=current;waypoint=0;}
 const course=routes[leg];let target=course[waypoint],distance=Math.hypot(target[0]-measured.x,target[1]-measured.y);
 if(waypoint<course.length-1&&distance<38){waypoint++;target=course[waypoint];distance=Math.hypot(target[0]-measured.x,target[1]-measured.y);}
 const error=wrap(Math.atan2(target[1]-measured.y,target[0]-measured.x)-measured.angle),turn=error>0?'ArrowRight':'ArrowLeft';let command;
 if(Math.abs(error)>.22)command={keys:['ArrowDown',turn],ms:Math.min(450,Math.max(60,Math.round((Math.abs(error)-.03)/3.4*1000)))};
 else if(Math.abs(error)>.08)command={keys:['ArrowUp',turn],ms:Math.max(35,Math.min(85,Math.round(Math.abs(error)/3.4*800)))};
 else command={keys:['ArrowUp'],ms:Math.max(80,Math.min(1900,Math.round((distance-14)/32*1000)))};
 observed.push({frame:name,imageSha256:frame.image.sha256,presentation:frame.presentation,measured,leg,waypoint,target,distance,error,command});
 await save('controller.json',{commands,observed});console.log('WINDMAIL_VISUAL '+JSON.stringify({step:commands.length,leg,x:Math.round(measured.x),y:Math.round(measured.y),target,distance:Math.round(distance),error:Number(error.toFixed(2)),command}));send(command);
}
child.stdout.on('data',bytes=>{transcript+=bytes;buffer+=bytes;let at;while((at=buffer.indexOf('\n'))>=0){const text=buffer.slice(0,at);buffer=buffer.slice(at+1);chain=chain.then(()=>line(text)).catch(error=>{failure??=error;child.stdin.end();});}});
child.stderr.on('data',bytes=>{transcript+=bytes;});child.stdin.on('error',error=>{if(error.code!=='EPIPE')failure??=error;});
try{
 await save('control.json',{scope:'Pixel/HUD-directed campaign through existing normal-input observer. No game-state introspection, storage writes, clocks, source changes, models or collector registration.',artifactHash:artifact.artifactHash,sourceHash:artifact.sourceHash,browserName,keyboardRecovery,observerPid:child.pid,parentSha256:sha(await readFile(new URL(import.meta.url))),childSha256:sha(await readFile('scripts/observe-windmail-responsive-campaign.mjs')),routes,commandLimit:100,childDeadlineMinutes:15,realModelCalls:0});
 const [code,signal]=await exit;await chain;if(failure)throw failure;assert.equal(code,0,'Original campaign observer failed; preserve its evidence');assert.equal(signal,null);
 const result=JSON.parse(await readFile(path.join(campaign,'report.json'))),closure=JSON.parse(await readFile(path.join(campaign,'closure.json')));
 assert.equal(result.completed.leg,5);if(browserName==='chromium')assert.equal(closure.exitCode,0);else assert.equal(closure.alternateClosure?.distributionUnchanged,true);assert.equal(closure.browserDisconnected,true);
 await save('report.json',{scope:'External normal-input/PNG observation, not autonomous generation, human/physical/artistic or installed acceptance.',artifactHash:artifact.artifactHash,sourceHash:artifact.sourceHash,commands:commands.length,result,closure,modelCalls:0,gameSourceChanged:false,qualityApproved:false,fullProductAcceptance:false});console.log('WINDMAIL_VISUAL_CAMPAIGN_OBSERVED '+output);
}catch(error){await save('failure.json',{message:String(error?.message??error).slice(0,2000),observerPid:child.pid,observerExitCode:child.exitCode,commands:commands.length});process.exitCode=1;console.error(String(error?.message??error).slice(0,2000));}
finally{clearTimeout(deadline);await writeFile(path.join(output,'observer.log'),transcript);await save('controller.json',{commands,observed});await save('closure.json',{observerPid:child.pid,exitCode:child.exitCode,signalCode:child.signalCode});}
