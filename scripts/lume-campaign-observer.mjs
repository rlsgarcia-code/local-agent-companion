// Portfolio observer, deliberately outside the shipped game. It sees only the
// normal DOM progress indicator and PNGs, and sends ordinary keyboard/buttons.
// Authored layout data guides inputs; no game objects, storage, clocks or source
// are injected or changed. These observations do not establish human enjoyment.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {PNG} from 'pngjs';
import layouts from '../dist-tests/examples/games/lume/src/levels.js';

export function facePosition(bytes){
 const image=PNG.sync.read(bytes);assert.equal(image.width,960);assert.equal(image.height,540);
 let count=0,x=0,y=0;
 for(let row=90;row<520;row++)for(let col=0;col<960;col++){
  const offset=(row*960+col)*4;
  if(Math.abs(image.data[offset]-255)<=2&&Math.abs(image.data[offset+1]-233)<=2&&Math.abs(image.data[offset+2]-177)<=2){count++;x+=col;y+=row;}
 }
 return count>80?{x:x/count,y:y/count+4,pixels:count}:null;
}

// Observe natural CSS completion; do not disable animations, edit styles or
// advance the game/browser clock to obtain a more convenient capture.
export async function waitForLumePanel(page){
 await page.locator('#panel').waitFor({state:'visible'});
 await page.waitForFunction(()=>{const panel=document.getElementById('panel');return panel&&!panel.hidden&&Number(getComputedStyle(panel).opacity)>=.999;},undefined,{timeout:2000});
}

export async function observeLumeCampaign(page,directory){
 await mkdir(directory,{recursive:true});
 const campaign=[],held=new Set();let current,partialReload=false,releaseTimer,pendingRelease=Promise.resolve(),keyFailure;
 const setKey=async(key,down)=>{if(down&&!held.has(key)){await page.keyboard.down(key);held.add(key);}else if(!down&&held.has(key)){await page.keyboard.up(key);held.delete(key);}};
 const release=async()=>{clearTimeout(releaseTimer);releaseTimer=undefined;await pendingRelease;for(const key of [...held])await setKey(key,false);};
 const readX=async(level)=>Number.parseFloat(await page.locator('#progress').evaluate(node=>node.style.width))/100*level.width;
 const save=async(name,value)=>writeFile(path.join(directory,name),JSON.stringify(value,null,2)+'\n');
 try{
  for(let index=0;index<layouts.LEVELS.length;index++){
   const level=layouts.LEVELS[index],expected=`${String(index+1).padStart(2,'0')} · ${level.name}`;
   await page.locator('#level-name').filter({hasText:expected}).waitFor();
   assert.equal(await page.locator('#level-name').innerText(),expected);await page.locator('canvas').focus();
   const began=Date.now();let lastX=80,lastY=null,waitingForLanding=false,respawns=0,samples=0;const trace=[];
   current={garden:level.id,name:level.name,observations:trace};
   while(!await page.locator('#next').isVisible()){
    if(keyFailure)throw keyFailure;
    assert.ok(Date.now()-began<60000,`Garden ${index+1} did not complete; last normal HUD position ${lastX}`);
    const bytes=await page.locator('canvas').screenshot({timeout:2000});
    const face=facePosition(bytes),x=await readX(level),notice=await page.locator('#notice').innerText();samples++;
    if(x<lastX-100)respawns++;lastX=x;
    assert.ok(respawns<=4,`Repeated respawns in garden ${index+1}`);
    if(samples%8===0)trace.push({milliseconds:Date.now()-began,x,face,notice,keys:[...held]});
    if(index>=3&&index<=8&&!partialReload&&notice==='Ponto seguro aceso'){
     await release();const seeds=await page.locator('#seed-count').innerText();
     await page.screenshot({path:path.join(directory,'checkpoint-before.png')});
     await page.reload();await page.getByRole('button',{name:'Continuar',exact:true}).click();
     assert.equal(await page.locator('#level-name').innerText(),expected);
     await page.waitForFunction(value=>document.getElementById('seed-count').textContent===value,seeds,{timeout:2000});
     assert.equal(await page.locator('#seed-count').innerText(),seeds);
     const restoredX=await readX(level);assert.ok(Math.abs(restoredX-level.checkpoint.x)<20,'Reload did not return to the observed checkpoint');
     await page.screenshot({path:path.join(directory,'checkpoint-restored.png')});partialReload=true;lastX=restoredX;lastY=null;
     trace.push({checkpointReload:true,restoredX,seeds});continue;
    }
    const nearExit=x>level.width-200;
    if(face){
     const y=face.y;
     // Near-floor airborne pixels are not a landing. The non-Chromium failures
     // motivated a tighter observation at the last wind/ledge sequence.
     // Keep the original game untouched and require the face's grounded height.
     // A horizontally moving platform has the same visible foot height; its
     // authored travel bounds suffice here without querying its current phase.
     // Never infer a vertically moving platform's position from the game state.
     const ground=level.platforms.find(p=>(!p.motion||p.motion.axis==='x')&&x>=p.x-(p.motion?.distance??0)-8&&x<=p.x+p.width+(p.motion?.distance??0)+28&&Math.abs(y-(p.y-18))<2);
     if(ground||nearExit)waitingForLanding=false;
     const floor=level.platforms.find(p=>p.id.startsWith('ground')&&x>=p.x&&x<p.x+p.width+8&&p.x+p.width<level.width-20);
     if(!ground&&floor&&floor.x+floor.width-x<240&&lastY!==null&&y>lastY+3&&!waitingForLanding){waitingForLanding=true;trace.push({waitForLanding:true,x,y});}
     if(floor&&floor.x+floor.width-x<240)trace.push({ledgeSample:true,x,y,ground:ground?.id??null,waitingForLanding,keys:[...held]});
     if(ground&&!held.has('Space')&&!nearExit){
      const distance=ground.x+ground.width-x,edge=ground.x+ground.width<level.width-20&&distance<90&&distance> -28;
      const spike=level.spikes.some(h=>h.x-x<90&&h.x-x> -8);
      if(edge||spike){
       await setKey('Space',true);const jumpAt=Date.now(),jumpDuration=spike&&!edge&&distance<285?140:650;
       const observation={jump:true,x,y,edge,spike,holdMilliseconds:jumpDuration};trace.push(observation);
       // Release timing is independent of screenshot/DOM polling latency. It
       // changes only an ordinary key, never the game's clock or simulation.
       releaseTimer=setTimeout(()=>{releaseTimer=undefined;pendingRelease=setKey('Space',false).then(()=>{observation.releasedAfterMilliseconds=Date.now()-jumpAt;}).catch(error=>{keyFailure=error;});},jumpDuration);
      }
     }
     lastY=y;
    }
    await setKey('ArrowRight',!waitingForLanding&&(!nearExit||x<level.exit.x-9));await setKey('ArrowLeft',nearExit&&x>level.exit.x+9);
    await page.waitForTimeout(35);
   }
   await release();const heading=await page.locator('#panel h2').innerText(),stars=await page.locator('#panel .stars').getAttribute('aria-label');
   assert.equal(heading,index===11?'O jardim voltou a brilhar.':level.name);assert.match(stars??'',/^[123] de 3 sementes$/);
   await waitForLumePanel(page);await page.screenshot({path:path.join(directory,`${String(index+1).padStart(2,'0')}-completed.png`)});
   campaign.push({...current,observedHeading:heading,observedStars:stars,observedSummary:await page.locator('#panel .description').innerText(),respawnPositionResets:respawns,samples,durationMilliseconds:Date.now()-began});
   await save('campaign-progress.json',campaign);console.log(`LUME_GARDEN_OBSERVED ${index+1}/12`);
   if(index<11)await page.getByRole('button',{name:'Próximo jardim',exact:true}).click();
  }
  assert.ok(partialReload,'A mid-campaign checkpoint must be observed and reloaded');
  await page.getByRole('button',{name:'Os jardins',exact:true}).click();assert.equal(await page.locator('[data-level]').count(),12);assert.equal(await page.locator('[data-level]:disabled').count(),0);
  const starsBefore=await page.locator('[data-level] span').allTextContents();assert.ok(starsBefore.every(text=>text.includes('✦')));
  await waitForLumePanel(page);await page.screenshot({path:path.join(directory,'completed-map.png')});await page.reload();await page.getByRole('button',{name:'Os jardins',exact:true}).click();
  assert.equal(await page.locator('[data-level]:disabled').count(),0);assert.deepEqual(await page.locator('[data-level] span').allTextContents(),starsBefore);
  await waitForLumePanel(page);await page.screenshot({path:path.join(directory,'restored-map.png')});
  const result={scope:'Authored reference, normal keyboard/buttons, PNG/DOM observations and layout-guided observer outside the game; not autonomous generation, physical/human/artistic acceptance.',campaign,midCampaignCheckpointReload:true,allTwelveUnlockedAndStarsRetainedAfterReload:true};
  await save('campaign.json',result);return result;
 }catch(error){await release();await save('campaign-failure.json',{message:error instanceof Error?error.message:String(error),completed:campaign,current});try{await page.screenshot({path:path.join(directory,'failure.png')});}catch{}throw error;}
 finally{await release();}
}
