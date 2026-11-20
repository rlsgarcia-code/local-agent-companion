import type {Level,Platform} from "./levels";
export type Input={left:boolean;right:boolean;jump:boolean};
export type Event="jump"|"land"|"seed"|"checkpoint"|"respawn"|"locked"|"complete";
export type State={x:number;y:number;vx:number;vy:number;ground:string|null;coyote:number;buffer:number;previousJump:boolean;checkpoint:boolean;seeds:string[];deaths:number;time:number;finished:boolean;invulnerable:number;lockCooldown:number;facing:number};
export function initial(level:Level,checkpoint=false,seeds:string[]=[]):State{return {x:checkpoint?level.checkpoint.x:80,y:checkpoint?level.checkpoint.y:441,vx:0,vy:0,ground:null,coyote:0,buffer:0,previousJump:false,checkpoint,seeds:[...new Set(seeds)].filter(s=>level.seeds.some(seed=>seed.id===s)),deaths:0,time:0,finished:false,invulnerable:.6,lockCooldown:0,facing:1};}
export function position(platform:Platform,time:number){const {motion}=platform,value=motion?Math.sin(time*Math.PI*2/motion.period)*motion.distance:0;return {...platform,x:platform.x+(motion?.axis==="x"?value:0),y:platform.y+(motion?.axis==="y"?value:0)};}
const overlap=(a:number,b:number,c:number,d:number)=>a<d&&b>c;
export function respawn(s:State,level:Level){s.x=s.checkpoint?level.checkpoint.x:80;s.y=s.checkpoint?level.checkpoint.y:441;s.vx=s.vy=0;s.ground=null;s.invulnerable=.9;s.deaths++;s.coyote=s.buffer=0;}
/** Fixed substeps keep collisions and moving platforms stable after a slow frame.
 * No browser/engine dependency; simulation never grants production authority. */
export function step(s:State,level:Level,input:Input,elapsed:number):Event[]{
  const events:Event[]=[];if(s.finished)return events;
  const frame=Math.max(0,Math.min(.06,Number.isFinite(elapsed)?elapsed:0));
  if(input.jump&&!s.previousJump)s.buffer=.13;
  if(!input.jump&&s.previousJump&&s.vy< -180)s.vy*=.48;
  s.previousJump=input.jump;
  for(let remaining=frame;remaining>1e-8;){const dt=Math.min(1/120,remaining);remaining-=dt;const previousTime=s.time;s.time+=dt;s.invulnerable=Math.max(0,s.invulnerable-dt);s.lockCooldown=Math.max(0,s.lockCooldown-dt);
    const platforms=level.platforms.map(p=>position(p,s.time));
    if(s.ground){const base=level.platforms.find(p=>p.id===s.ground);if(base){const before=position(base,previousTime),after=position(base,s.time);s.x+=after.x-before.x;s.y+=after.y-before.y;}}
    s.coyote=s.ground?.length ? .12 : Math.max(0,s.coyote-dt);s.buffer=Math.max(0,s.buffer-dt);
    const direction=Number(input.right)-Number(input.left),desired=direction*275,acceleration=s.ground?2000:1400;
    s.vx+=Math.sign(desired-s.vx)*Math.min(Math.abs(desired-s.vx),acceleration*dt);if(direction)s.facing=direction;
    if(s.buffer>0&&s.coyote>0){s.vy=-525;s.ground=null;s.coyote=s.buffer=0;events.push("jump");}
    const inWind=level.winds.some(w=>overlap(s.x-10,s.x+10,w.x,w.x+w.width)&&overlap(s.y-18,s.y+18,w.y,w.y+w.height));
    s.vy=Math.max(-560,Math.min(750,s.vy+(inWind?-900:1120)*dt));
    let x=s.x+s.vx*dt;
    for(const p of platforms)if(!p.oneWay&&overlap(s.y-17.9,s.y+17.9,p.y,p.y+p.height)&&overlap(x-11,x+11,p.x,p.x+p.width)){
      if(s.x+11<=p.x+.5&&s.vx>0){x=p.x-11;s.vx=0;}else if(s.x-11>=p.x+p.width-.5&&s.vx<0){x=p.x+p.width+11;s.vx=0;}}
    s.x=Math.max(12,Math.min(level.width-12,x));let y=s.y+s.vy*dt,landing:Platform|undefined;
    for(const p of platforms)if(overlap(s.x-10,s.x+10,p.x,p.x+p.width)){
      if(s.vy>=0&&s.y+18<=p.y+.6&&y+18>=p.y){if(!landing||p.y<landing.y)landing=p;}
      else if(!p.oneWay&&s.vy<0&&s.y-18>=p.y+p.height-.6&&y-18<=p.y+p.height){y=p.y+p.height+18;s.vy=0;}}
    const wasGround=s.ground;s.ground=null;if(landing){y=landing.y-18;s.vy=0;s.ground=landing.id;if(!wasGround)events.push("land");}s.y=y;
    if(s.y>650||s.invulnerable<=0&&level.spikes.some(h=>overlap(s.x-9,s.x+9,h.x,h.x+h.width)&&overlap(s.y-16,s.y+17,h.y,h.y+h.height))){respawn(s,level);events.push("respawn");continue;}
    for(const seed of level.seeds)if(!s.seeds.includes(seed.id)&&Math.hypot(s.x-seed.x,s.y-seed.y)<32){s.seeds.push(seed.id);events.push("seed");}
    if(!s.checkpoint&&Math.abs(s.x-level.checkpoint.x)<30&&Math.abs(s.y-level.checkpoint.y)<45){s.checkpoint=true;events.push("checkpoint");}
    if(Math.abs(s.x-level.exit.x)<38&&Math.abs(s.y-level.exit.y)<55){if(s.seeds.length){s.finished=true;events.push("complete");break;}else if(!s.lockCooldown){events.push("locked");s.lockCooldown=2;}}
  }
  return events;
}
