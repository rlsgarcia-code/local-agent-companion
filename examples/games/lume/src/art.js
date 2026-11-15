import {position} from './simulation';
const C={night:0x091f29,mist:0x153b40,leaf:0x24635c,light:0x70b7a0,gold:0xf6cb79,stone:0x203c43,edge:0x456b61};
/** Original vector drawing, not a downloaded asset or a raster placeholder. */
export class Art{
  constructor(scene){this.scene=scene;this.g=scene.add.graphics();this.time=0;this.camera=0;this.reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;this.burst=[];}
  particles(x,y,n=14){if(this.reduced)return;for(let i=0;i<n;i++)this.burst.push({x,y,vx:Math.cos(i/n*Math.PI*2)*85,vy:Math.sin(i/n*Math.PI*2)*85-40,age:0});}
  draw(level,state,delta,title=false){
    this.time+=this.reduced?0:delta;const t=this.time,g=this.g;g.clear();
    const w=this.scene.scale.width,h=this.scene.scale.height,logical=Math.min(960,Math.max(480,w/h*540));
    const scale=Math.min(w/logical,h/540),width=w/scale,offset=(h-540*scale)/2;this.viewportWidth=width;
    g.setScale(scale);g.setPosition(0,offset);
    const target=title?Math.max(0,level.width*.65-width*.8):Math.max(0,Math.min(level.width-width,state.x-width*.36));
    this.camera+= (target-this.camera)*(1-Math.exp(-delta*6));const cam=this.camera;
    g.fillStyle(C.night);g.fillRect(0,-offset/scale,width,h/scale);
    // Quiet moon, distant hanging islands and foliage establish depth.
    const moon=width*.78-cam*.02;
    g.fillStyle(0x9bcab0,.045);g.fillCircle(moon,130,150);g.fillStyle(0xc9dbc0,.09);g.fillCircle(moon,130,93);g.fillStyle(0xdfdfb2,.65);g.fillCircle(moon,130,36);
    for(let i=0;i<9;i++){const x=((i*237-cam*.12)%(width+340)+(width+340))%(width+340)-150,y=175+Math.sin(i*2.1)*70;
      g.fillStyle(C.mist,.8);g.fillTriangle(x,y,x+220,y,x+115,y+130);g.fillRoundedRect(x,y-10,220,30,15);g.fillStyle(0x2a5c52,.6);g.fillEllipse(x+100,y-10,200,32);}
    for(let i=0;i<48;i++){const x=((i*163.7-cam*.28+Math.sin(t*.5+i)*9)%(width+100)+(width+100))%(width+100)-50,y=45+(i*73.1)%420+Math.sin(t*.4+i)*8;
      g.fillStyle(C.gold,.15+.22*(1+Math.sin(t+i))/2);g.fillCircle(x,y,i%6===0?2:1);}
    for(let i=0;i<14;i++){const x=((i*113-cam*.43)%(width+240)+(width+240))%(width+240)-100,h=100+(i*57)%180;
      g.lineStyle(3,0x29504b,.6);g.lineBetween(x,540,x+35,540-h);g.fillStyle(0x224a46,.8);g.fillEllipse(x+18,540-h*.7,65,18);g.fillEllipse(x+42,540-h,45,16);}
    for(const wind of level.winds){const x=wind.x-cam;g.fillStyle(0x79c5ad,.04);g.fillRoundedRect(x,wind.y,wind.width,wind.height,30);g.lineStyle(1,0x97d6bb,.25);
      for(let i=0;i<9;i++){const y=wind.y+((i*37-t*70)%wind.height+wind.height)%wind.height;g.lineBetween(x+wind.width*.3+Math.sin(i+t)*8,y,x+wind.width*.3+Math.sin(i+t)*8,y+19);}}
    for(const source of level.platforms){const p=position(source,state.time),x=p.x-cam;if(x+p.width< -30||x>width+30)continue;
      const h=p.id.startsWith('ground')?140:p.height+22;
      g.fillStyle(C.stone);g.fillRoundedRect(x,p.y,p.width,h,Math.min(12,h/2));
      if(!p.id.startsWith('ground')){g.fillStyle(0x152d36);g.fillTriangle(x+10,p.y+h-3,x+p.width-8,p.y+h-3,x+p.width*.55,p.y+h+30);}
      g.fillStyle(C.edge);g.fillRoundedRect(x,p.y-3,p.width,9,4);g.fillStyle(C.leaf);g.fillRoundedRect(x,p.y-5,p.width,6,3);
      for(let i=8;i<p.width;i+=33){g.fillStyle(C.light,.18);g.fillEllipse(x+i,p.y-4,14,5);}
      for(let i=20;i<p.width;i+=83){g.lineStyle(1,0x59836a,.35);g.lineBetween(x+i,p.y+8,x+i+8,p.y+25);g.lineBetween(x+i+8,p.y+25,x+i+5,p.y+41);}
    }
    for(const h of level.spikes){const x=h.x-cam;g.fillStyle(0xbc7272,.65);for(let i=0;i<3;i++)g.fillTriangle(x+i*13,h.y+h.height,x+i*13+7,h.y-4,x+i*13+13,h.y+h.height);}
    this.lantern(level.checkpoint.x-cam,level.checkpoint.y-12,state.checkpoint,t);
    const ex=level.exit.x-cam,ey=level.exit.y,lit=state.seeds.length>0;
    g.lineStyle(5,lit?C.gold:0x42625c,lit?.85:.6);g.strokeRoundedRect(ex-24,ey-56,48,85,22);g.fillStyle(C.gold,lit?.10:.02);g.fillRoundedRect(ex-20,ey-52,40,78,19);
    if(lit){g.fillStyle(C.gold,.08);g.fillCircle(ex,ey-18,65);g.fillStyle(C.gold,.9);g.fillEllipse(ex,ey-18+Math.sin(t*2)*3,12,21);}
    for(const seed of level.seeds)if(!state.seeds.includes(seed.id)){const x=seed.x-cam,y=seed.y+Math.sin(t*2+seed.x)*4;g.fillStyle(C.gold,.065);g.fillCircle(x,y,25);g.fillStyle(C.gold);g.fillEllipse(x,y,10,16);g.lineStyle(1,0xffe8af,.8);g.lineBetween(x-2,y+3,x+2,y-4);}
    // Lume: seed body, cream face and a sprout that follows the jump.
    if(!state.invulnerable||Math.floor(t*15)%3){const x=state.x-cam,y=state.y,squash=state.ground?1:1.08;
      g.fillStyle(0x000000,.19);g.fillEllipse(x,y+19,31,8);g.fillStyle(C.gold,.07);g.fillCircle(x,y,42);
      g.fillStyle(0xe1bb76);g.fillEllipse(x,y,25/squash,33*squash);g.fillStyle(0xffe9b1);g.fillEllipse(x+state.facing*3,y-4,19,21);
      g.fillStyle(0x263d3f);g.fillCircle(x+state.facing*4-4,y-5,1.6);g.fillCircle(x+state.facing*4+4,y-5,1.6);
      g.lineStyle(2,0x88b397);g.lineBetween(x,y-17,x+2+Math.sin(t*3)*2,y-25);g.fillStyle(0x83ba91);g.fillEllipse(x+8,y-25,15,6);
      const walk=Math.sin(t*18)*(Math.abs(state.vx)>20&&state.ground?3:0);g.fillStyle(0x987a53);g.fillEllipse(x-6,y+17+walk,7,5);g.fillEllipse(x+6,y+17-walk,7,5);
    }
    this.burst=this.burst.filter(p=>p.age<.7);for(const p of this.burst){p.age+=delta;p.x+=p.vx*delta;p.y+=p.vy*delta;p.vy+=120*delta;g.fillStyle(C.gold,Math.max(0,1-p.age/.7));g.fillCircle(p.x-cam,p.y,2);}
    // Foreground leaves frame the garden without covering the play surface.
    for(let i=0;i<9;i++){const x=((i*169-cam*.7)%(width+340)+(width+340))%(width+340)-80;g.fillStyle(0x0c282c,.9);g.fillEllipse(x,535+Math.sin(t+i)*2,120,36);g.fillEllipse(x+30,544,75,52);}
  }
  lantern(x,y,lit,t){const g=this.g;g.lineStyle(2,0x667d65);g.lineBetween(x,y-18,x,y+30);g.fillStyle(0x304d45);g.fillRoundedRect(x-10,y-20,20,30,6);g.fillStyle(lit?C.gold:0x688378,lit?.9:.6);g.fillRoundedRect(x-6,y-16,12,21,4);if(lit){g.fillStyle(C.gold,.1);g.fillCircle(x,y-7,32+Math.sin(t*2)*3);}}
}
