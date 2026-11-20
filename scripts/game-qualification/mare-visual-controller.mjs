// Independent QA observer: reads only composed PNG pixels and authored course
// coordinates, sends ordinary keyboard input. Never shipped inside the game.
import assert from 'node:assert/strict';
import {PNG} from 'pngjs';
export function boardGeometry(width,height){const portrait=width<height,unit=portrait?width/390:Math.min(width/1060,height/820),margin=22*unit,panelY=height-163*unit,area={x:margin,y:122*unit,w:width-2*margin,h:panelY-144*unit},scale=Math.min(area.w/960,area.h/600);return {x:area.x+(area.w-960*scale)/2,y:area.y+(area.h-600*scale)/2,w:960*scale,h:600*scale,scale};}
const distance=(data,i,c)=>Math.abs(data[i]-c[0])+Math.abs(data[i+1]-c[1])+Math.abs(data[i+2]-c[2]);
export function detectBoat(bytes,near){
 const png=PNG.sync.read(bytes),g=boardGeometry(png.width,png.height),{width,data}=png,seen=new Set(),heads=[];
 // The title screen contains the same decorative boat. Require the rendered
 // water rectangle before interpreting any hull as a playable course.
 let waterCorners=0;for(const [wx,wy]of [[6,6],[954,6],[6,594],[954,594]]){const x=Math.round(g.x+wx*g.scale),y=Math.round(g.y+wy*g.scale);if(x>=0&&x<png.width&&y>=0&&y<png.height&&distance(data,(y*width+x)*4,[33,73,91])<24)waterCorners++;}
 if(waterCorners<3)return null;
 const bounds={x:Math.max(0,Math.floor(g.x+1)),y:Math.max(0,Math.floor(g.y+1)),right:Math.min(png.width,Math.ceil(g.x+g.w-1)),bottom:Math.min(png.height,Math.ceil(g.y+g.h-1))};
 const dark=(x,y)=>x>=bounds.x&&x<bounds.right&&y>=bounds.y&&y<bounds.bottom&&distance(data,(y*width+x)*4,[16,43,61])<15;
 for(let y=bounds.y;y<bounds.bottom;y++)for(let x=bounds.x;x<bounds.right;x++){
  const id=y*width+x;if(seen.has(id)||!dark(x,y))continue;
  const queue=[[x,y]],component=[];seen.add(id);
  for(let cursor=0;cursor<queue.length;cursor++){const [px,py]=queue[cursor];component.push([px,py]);for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){const xx=px+dx,yy=py+dy,k=yy*width+xx;if(!seen.has(k)&&dark(xx,yy)){seen.add(k);queue.push([xx,yy]);}}}
  if(component.length<3||component.length>60)continue;
  const cx=component.reduce((n,p)=>n+p[0],0)/component.length,cy=component.reduce((n,p)=>n+p[1],0)/component.length;
  if(near&&Math.hypot((cx-g.x)/g.scale-near.x,(cy-g.y)/g.scale-near.y)>130)continue;
  let copper=0,aqua=0;const radius=Math.ceil(8*g.scale);
  for(let dy=-radius;dy<=radius;dy++)for(let dx=-radius;dx<=radius;dx++){
   const xx=Math.round(cx+dx),yy=Math.round(cy+dy);if(xx<0||xx>=png.width||yy<0||yy>=png.height||Math.hypot(dx,dy)<2*g.scale||Math.hypot(dx,dy)>7*g.scale)continue;
   const i=(yy*width+xx)*4;if(distance(data,i,[236,163,109])<24)copper++;if(distance(data,i,[156,210,200])<24)aqua++;
  }
  if(Math.max(copper,aqua)>=3)heads.push({x:cx,y:cy,color:copper>aqua?'copper':'aqua',copper,aqua});
 }
 let best;
 for(const a of heads.filter(h=>h.color==='copper'))for(const b of heads.filter(h=>h.color==='aqua')){
  const separation=Math.hypot(a.x-b.x,a.y-b.y)/g.scale;if(Math.abs(separation-15)>3)continue;
  const angle=Math.atan2(a.y-b.y,a.x-b.x),x=((a.x+b.x)/2-g.x)/g.scale+2.5*Math.cos(angle),y=((a.y+b.y)/2-g.y)/g.scale+2.5*Math.sin(angle),score=Math.abs(separation-15)+(near?Math.hypot(x-near.x,y-near.y)*0.03:0);
  // The two dark crew faces are not sufficient near hull shadows. Require
  // the observed ivory hull ahead of and behind the estimated center too.
  const paperNear=(wx,wy)=>{let n=0;const px=Math.round(g.x+wx*g.scale),py=Math.round(g.y+wy*g.scale);for(const [dx,dy]of [[0,0],[1,0],[-1,0],[0,1],[0,-1]]){const xx=px+dx,yy=py+dy;if(xx>=0&&xx<png.width&&yy>=0&&yy<png.height&&distance(data,(yy*width+xx)*4,[244,231,207])<30)n++;}return n>=2;};
  if(!paperNear(x+Math.cos(angle)*20,y+Math.sin(angle)*20)||!paperNear(x-Math.cos(angle)*20,y-Math.sin(angle)*20))continue;
  if(!best||score<best.score)best={x,y,angle,score,separation};
 }
 return best??null;
}
export function renderedResult(bytes){const png=PNG.sync.read(bytes),u=Math.min(png.width/1060,png.height/820);let gold=0;for(const [dx,dy]of [[-110,15],[-90,30],[110,15],[90,30]]){const x=Math.round(png.width/2+dx*u),y=Math.round(png.height*.48+dy*u),i=(y*png.width+x)*4;if(distance(png.data,i,[236,163,109])<20)gold++;}return gold===4;}
export function delivered(bytes,course,index,boat){
 const p=PNG.sync.read(bytes),g=boardGeometry(p.width,p.height),dock=course.docks[index];let aqua=0;
 // A moving aqua oar/head can temporarily cover an uncompleted dock label.
 // Do not read that label until the observed boat cannot supply its pixels.
 if(!boat||Math.hypot(boat.x-(dock[0]+10),boat.y-(dock[1]+52))<50)return false;
 // Completed dock number/check is solid aqua; an uncompleted number is paper.
 // This observes the actual label below the boat, never hidden progress state.
 for(let yy=42;yy<=62;yy++)for(let xx=-9;xx<=30;xx++){
  const x=Math.round(g.x+(dock[0]+xx)*g.scale),y=Math.round(g.y+(dock[1]+yy)*g.scale),i=(y*p.width+x)*4;
  if(x>=0&&x<p.width&&y>=0&&y<p.height&&distance(p.data,i,[156,210,200])<30)aqua++;
 }
 return aqua>=14;
}

export function brightGlyphDifference(a,b,rect){
 const x=PNG.sync.read(a),y=PNG.sync.read(b);assert.equal(x.width,y.width);assert.equal(x.height,y.height);
 assert.ok(rect.x>=0&&rect.y>=0&&rect.w>0&&rect.h>0&&rect.x+rect.w<=x.width&&rect.y+rect.h<=x.height,'Glyph observation requires an image-bound region');
 let xor=0,union=0,litA=0,litB=0;
 for(let yy=rect.y;yy<rect.y+rect.h;yy++)for(let xx=rect.x;xx<rect.x+rect.w;xx++){
  const i=(yy*x.width+xx)*4,aa=x.data[i]+x.data[i+1]+x.data[i+2]>430,bb=y.data[i]+y.data[i+1]+y.data[i+2]>430;
  if(aa)litA++;if(bb)litB++;if(aa||bb)union++;if(aa!==bb)xor++;
 }
 assert.ok(litA>=50&&litB>=50,'Both observations must contain a rendered label, not two empty backgrounds');
 return {difference:xor/union,litA,litB};
}
