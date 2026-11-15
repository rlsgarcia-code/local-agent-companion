// Authored QA route, outside the exported game. Only ordinary keyboard/button
// inputs and visible minimap/HUD attributes: no evaluate of private state, test
// bridge, teleport, storage write or quality grant.
import assert from 'node:assert/strict';
import path from 'node:path';
import world from '../dist-tests/examples/games/vigilia/src/world.js';
export async function observeVigiliaCampaign(page,output){
 const evidence=[],oracle=world.fresh();
 async function position(){return {x:(Number(await page.locator('#map-player').getAttribute('cx'))-20)/1.1,z:(15-Number(await page.locator('#map-player').getAttribute('cy')))/.4};}
 async function route(site){
  const current=await position(),key=(x,z)=>`${x},${z}`,start=[Math.round(current.x*2),Math.round(current.z*2)],queue=[start],previous=new Map([[key(...start),null]]);let end;
  const clear=(x,z)=>[[0,0],[.22,0],[-.22,0],[0,.22],[0,-.22]].every(([dx,dz])=>world.walkable(x+dx,z+dz,oracle));
  for(let i=0;i<queue.length;i++){const [x,z]=queue[i];if(Math.hypot(x/2-site.x,z/2-site.z)<1.6){end=key(x,z);break;}for(const [dx,dz]of [[1,0],[-1,0],[0,1],[0,-1]]){const nx=x+dx,nz=z+dz,k=key(nx,nz);if(!previous.has(k)&&clear(nx/2,nz/2)){previous.set(k,key(x,z));queue.push([nx,nz]);}}}
  assert.ok(end,`No authored walking route to ${site.id}`);const nodes=[];for(let k=end;k;k=previous.get(k))nodes.push(k.split(',').map(n=>Number(n)/2));nodes.reverse();
  const points=nodes.filter((p,i)=>i===nodes.length-1||i===0||(p[0]-nodes[i-1][0])!==(nodes[i+1][0]-p[0])||(p[1]-nodes[i-1][1])!==(nodes[i+1][1]-p[1]));
  for(const [x,z] of points){let arrived=false;for(let tries=0;tries<40;tries++){
   const at=await position(),dx=x-at.x,dz=z-at.z;if(Math.hypot(dx,dz)<.12){arrived=true;break;}
   const horizontal=Math.abs(dx)>Math.abs(dz),distance=Math.abs(horizontal?dx:dz),key=horizontal?(dx>0?'ArrowRight':'ArrowLeft'):(dz>0?'ArrowUp':'ArrowDown');
   await page.keyboard.down(key);try{await page.waitForTimeout(Math.min(1600,Math.max(1,(distance-.06)/5.5*1000)));}finally{await page.keyboard.up(key);}
   await page.waitForTimeout(35);
  }assert.ok(arrived,`Observed movement did not reach waypoint ${x},${z} toward ${site.id}; original candidate preserved`);}
  const p=await position();assert.ok(Math.hypot(p.x-site.x,p.z-site.z)<1.85,`Not near ${site.id}`);
 }
 for(let region=0;region<3;region++){
  for(const site of world.SITES.filter(s=>s.region===region&&s.kind==='memory')){await route(site);await page.getByRole('button',{name:'E · Ler inscrição',exact:true}).click();await page.locator('#message').filter({hasText:world.REGIONS[region].memories[site.index]}).waitFor();evidence.push({site:site.id,observed:'inscription visible after ordinary walking/interaction'});}
  for(const site of world.SITES.filter(s=>s.region===region&&s.kind==='ring')){await route(site);for(let n=0;n<world.REGIONS[region].tuning[site.index];n++){await page.getByRole('button',{name:`E · Afinar ${site.name}`,exact:true}).click();await page.waitForTimeout(90);}}
  await page.locator('#count').filter({hasText:`${region+1} / 3 FARÓIS`}).waitFor();oracle.lit[region]=true;oracle.rings[region]=[...world.REGIONS[region].tuning];
  await page.screenshot({path:path.join(output,`island-${region+1}-lit.png`)});evidence.push({region,observed:'visible count and rendered island; not semantic/physical quality certification'});
 }
 await route(world.SITES.find(s=>s.kind==='home'));await page.getByRole('button',{name:'E · Enviar a luz',exact:true}).click();await page.getByRole('heading',{name:'A luz também é um caminho de volta.'}).waitFor();await page.locator('#ending-notes').filter({hasText:'12 de 12'}).waitFor();await page.screenshot({path:path.join(output,'ending.png')});
 await page.reload();await page.getByRole('button',{name:'Continuar viagem',exact:true}).click();await page.locator('#objective').filter({hasText:'Luz enviada.'}).waitFor();await page.locator('#count').filter({hasText:'12 / 12'}).waitFor();await page.screenshot({path:path.join(output,'ending-reloaded.png')});
 return {route:evidence,endingObserved:true,endingReloadObserved:true,method:'Ordinary directional input and contextual buttons; visible minimap coordinates for route following. No private state, teleport, game source execution or quality approval.'};
}
