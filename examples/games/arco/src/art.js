import {WIDTH,HEIGHT,LAUNCH,preview} from './simulation';
import {TABLES} from './levels';
const colors={ink:0x243e42,teal:0x237477,brass:0xd99d41,blue:0x6b999d};
export function board(scene){
 const texture=scene.textures.createCanvas('workshop',WIDTH,HEIGHT),c=texture.context;
 c.fillStyle='#e2d3b9';c.fillRect(0,0,WIDTH,HEIGHT);c.fillStyle='#b7b5a0';c.fillRect(12,18,WIDTH-24,HEIGHT-26);c.fillStyle='#f2e8d4';c.fillRect(22,8,WIDTH-44,HEIGHT-24);
 c.strokeStyle='#d3c6ac';c.lineWidth=2;c.strokeRect(30,70,WIDTH-60,HEIGHT-88);
 c.fillStyle='#c9bfa8';for(let x=47;x<WIDTH-30;x+=18)for(let y=87;y<HEIGHT-30;y+=18){c.beginPath();c.arc(x,y,.65,0,Math.PI*2);c.fill();}
 c.strokeStyle='#526f70';c.lineWidth=5;c.beginPath();c.moveTo(30,HEIGHT-22);c.lineTo(30,70);c.lineTo(WIDTH-30,70);c.lineTo(WIDTH-30,HEIGHT-22);c.stroke();
 c.fillStyle='#81928b';for(const [x,y]of[[30,70],[WIDTH-30,70],[30,HEIGHT-22],[WIDTH-30,HEIGHT-22]]){c.beginPath();c.arc(x,y,5,0,Math.PI*2);c.fill();c.strokeStyle='#e9e1ca';c.lineWidth=1;c.beginPath();c.moveTo(x-2,y-2);c.lineTo(x+2,y+2);c.stroke();}
 c.fillStyle='#7c8e87';c.font='12px Georgia';c.textAlign='center';c.fillText('O F I C I N A   D E   L U Z',WIDTH/2,43);c.fillStyle='#9d9c84';c.fillRect(64,HEIGHT-25,WIDTH-128,3);
 texture.refresh();scene.add.image(WIDTH/2,HEIGHT/2,'workshop');
 const g=scene.add.graphics(),labels=TABLES.map(table=>table.lamps.map((lamp,i)=>scene.add.text(lamp.x,lamp.y,String(i+1),{fontFamily:'Georgia',fontSize:'16px',color:'#65563f'}).setOrigin(.5).setVisible(false)));
 const particles=[],trail=[];
 function hit(e,reduced){if(e.kind!=='lamp'&&e.kind!=='won')return;for(let i=0;i<(reduced?3:14);i++){const angle=Math.PI*2*i/14;particles.push({x:e.x,y:e.y,vx:Math.cos(angle)*(45+i%4*20),vy:Math.sin(angle)*(45+i%4*20),life:.7+i%3*.1});}}
 function draw(s,angle,speed,dragging,active,reduced,delta){
  g.clear();const table=TABLES[s.table],dt=Math.min(delta/1000,.035);for(const rows of labels)for(const label of rows)label.setVisible(false);
  if(table.wind){g.lineStyle(1,colors.blue,.5);for(let y=110;y<600;y+=90)for(let x=110;x<580;x+=150){const d=Math.sign(table.wind);g.beginPath();g.moveTo(x-15*d,y);g.lineTo(x+15*d,y);g.lineTo(x+7*d,y-4);g.moveTo(x+15*d,y);g.lineTo(x+7*d,y+4);g.strokePath();}}
  for(const pin of table.bumpers){g.fillStyle(0x9b9c86,.35);g.fillCircle(pin.x+3,pin.y+6,pin.r+2);g.fillStyle(colors.teal);g.fillCircle(pin.x,pin.y,pin.r);g.fillStyle(colors.blue);g.fillCircle(pin.x-2,pin.y-3,pin.r-5);g.lineStyle(2,0xd2e0cf,.85);g.strokeCircle(pin.x,pin.y,pin.r-9);g.fillStyle(colors.teal,.65);g.fillCircle(pin.x,pin.y,5);}
  for(const [i,lamp]of table.lamps.entries()){
   const lit=s.lit[i];g.fillStyle(0x8d8064,.25);g.fillCircle(lamp.x+2,lamp.y+4,21);g.fillStyle(lit?colors.brass:0xd6ccb6);g.fillCircle(lamp.x,lamp.y,20);g.lineStyle(1.5,lit?0x9a692d:0xb5a88c);g.strokeCircle(lamp.x,lamp.y,20);
   if(lit){g.fillStyle(0xfff3ba,.4);g.fillCircle(lamp.x,lamp.y,25);g.fillStyle(0xfff7c7);for(let n=0;n<6;n++){const a=n*Math.PI/3;g.fillCircle(lamp.x+Math.cos(a)*7,lamp.y+Math.sin(a)*7,4);}g.fillStyle(colors.brass);g.fillCircle(lamp.x,lamp.y,4);}else labels[s.table][i].setVisible(true);
  }
  g.lineStyle(2,colors.teal,.4);g.strokeCircle(LAUNCH.x,LAUNCH.y,23);g.strokeCircle(LAUNCH.x,LAUNCH.y,29);
  if(s.phase==='aim'){const a=angle*Math.PI/180;g.lineStyle(dragging?4:2,colors.teal,.8);g.beginPath();g.moveTo(LAUNCH.x,LAUNCH.y);g.lineTo(LAUNCH.x+Math.cos(a)*42,LAUNCH.y+Math.sin(a)*42);g.strokePath();for(const [i,p]of preview(s.table,angle,speed).entries()){g.fillStyle(colors.teal,(1-i/22)*.55);g.fillCircle(p.x,p.y,i<4?2.2:1.5);}g.fillStyle(0x344d50);g.fillCircle(LAUNCH.x+1,LAUNCH.y+4,10);g.fillStyle(0xfcf9e7);g.fillCircle(LAUNCH.x,LAUNCH.y,9);g.fillStyle(0xffffff);g.fillCircle(LAUNCH.x-3,LAUNCH.y-3,3);}
  if(s.ball){if(active){trail.push({x:s.ball.x,y:s.ball.y});if(trail.length>12)trail.shift();}for(const [i,p]of trail.entries()){g.fillStyle(colors.teal,i/trail.length*.25);g.fillCircle(p.x,p.y,2+i/trail.length*4);}g.fillStyle(colors.ink,.2);g.fillCircle(s.ball.x+2,s.ball.y+5,10);g.fillStyle(0xfefbed);g.fillCircle(s.ball.x,s.ball.y,9);g.lineStyle(1,colors.brass);g.strokeCircle(s.ball.x,s.ball.y,9);g.fillStyle(0xffffff);g.fillCircle(s.ball.x-3,s.ball.y-3,3);}else trail.length=0;
  for(let i=particles.length-1;i>=0;i--){const p=particles[i];if(active){p.life-=dt;p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=60*dt;}if(p.life<=0){particles.splice(i,1);continue;}g.fillStyle(colors.brass,Math.min(1,p.life*2));g.fillCircle(p.x,p.y,reduced?2:3);}
 }
 return{draw,hit};
}
