import assert from "node:assert/strict";
import test from "node:test";
import {LEVELS} from "../examples/games/lume/src/levels";
import {initial,step,position,respawn} from "../examples/games/lume/src/simulation";
import {Save,fresh,valid} from "../examples/games/lume/src/save";
import {gameBrowserTestSuite} from "../packages/contracts/src/game-browser-tests";

test("Lume's twelve distinct gardens have safe checkpoints and a playable route through real collision physics",()=>{
  assert.equal(LEVELS.length,12);assert.equal(new Set(LEVELS.map(l=>l.name)).size,12);
  for(const level of LEVELS){
    assert.equal(level.seeds.length,3);assert.ok(level.platforms.some(p=>p.x<level.checkpoint.x-20&&p.x+p.width>level.checkpoint.x+20&&p.y===460));
    const s=initial(level);let releasing=false,shortJump=false,jumpAt=0;
    for(let i=0;i<6000&&!s.finished;i++){
      const ground=level.platforms.find(p=>p.id===s.ground),p=ground?position(ground,s.time):null;
      const edge=p&&p.x+p.width<level.width-20&&p.x+p.width-s.x<60;
      const spike=level.spikes.some(h=>h.x>s.x&&h.x-s.x<60);
      let jump=!s.ground&&s.previousJump&&(!shortJump||s.time-jumpAt<.14);
      if(s.ground){if(s.previousJump){jump=false;releasing=true;}else{jump=Boolean(edge||spike);releasing=false;if(jump){jumpAt=s.time;shortJump=Boolean(spike&&!edge&&p&&p.x+p.width-s.x<285);}}}
      const nearExit=s.x>level.width-200;
      step(s,level,{left:nearExit&&s.x>level.exit.x+5,right:!nearExit||s.x<level.exit.x-5,jump:nearExit?false:jump},1/120);
      if(s.deaths>5)break;
    }
    assert.ok(s.finished,`${level.name}: route did not finish at x=${s.x.toFixed(1)} y=${s.y.toFixed(1)} deaths=${s.deaths} release=${releasing}`);
    assert.ok(s.seeds.length>=1);assert.ok(s.time<100);assert.equal(s.deaths,0,level.name);
  }
});

test("jump release changes height and reset preserves collected seeds and checkpoint",()=>{
  const l=LEVELS[0]!,short=initial(l),long=initial(l);
  for(let i=0;i<30;i++){step(short,l,{left:false,right:false,jump:false},1/120);step(long,l,{left:false,right:false,jump:false},1/120);}
  let a=short.y,b=long.y;
  for(let i=0;i<100;i++){step(short,l,{left:false,right:false,jump:i<10},1/120);step(long,l,{left:false,right:false,jump:i<70},1/120);a=Math.min(a,short.y);b=Math.min(b,long.y);}
  assert.ok(a>b+35,`short ${a}, long ${b}`);
  long.checkpoint=true;long.seeds=["a"];long.x=l.width-10;respawn(long,l);assert.equal(long.x,l.checkpoint.x);assert.deepEqual(long.seeds,["a"]);assert.equal(long.deaths,1);assert.ok(!long.finished);
});

test("progress survives reload, preserves elapsed time and tolerates unavailable or incompatible storage without overwriting it",()=>{
  let text:string|null=null,writes=0;const storage={getItem:()=>text,setItem:(_key:string,value:string)=>{writes++;text=value;}};
  const first=new Save(storage);first.value.current={level:0,checkpoint:true,seeds:["a"],elapsed:23.4,deaths:2};first.write();
  const recovered=new Save(storage);assert.deepEqual(recovered.value,first.value);recovered.finish(0,2,31.4);assert.equal(recovered.value.unlocked,1);assert.equal(recovered.value.stars[0],2);
  recovered.finish(0,1,35);assert.equal(recovered.value.stars[0],2);assert.equal(recovered.value.bestSeconds[0],31.4);
  text='{"version":99}';const before=writes,incompatible=new Save(storage);assert.equal(incompatible.available,false);incompatible.write();assert.equal(writes,before);assert.equal(text,'{"version":99}');
  const unavailable=new Save({getItem(){throw new Error("denied");},setItem(){throw new Error("denied");}});assert.equal(unavailable.available,false);unavailable.finish(0,1,10);assert.equal(unavailable.value.unlocked,1);
  assert.equal(valid({...fresh(),current:{level:0,checkpoint:true,seeds:[],elapsed:Infinity,deaths:0}}),false);
});

test("browser held-key recipes require balanced transitions and cannot reload with keys pressed",()=>{
  const recipe=(steps:unknown[])=>({schemaVersion:1,scenarios:[{id:"held-input",steps}]});
  assert.ok(gameBrowserTestSuite.safeParse(recipe([{action:"key-down",key:"ArrowRight"},{action:"wait",ms:300},{action:"press",key:"Space"},{action:"key-up",key:"ArrowRight"}])).success);
  for(const steps of [[{action:"key-up",key:"a"}],[{action:"key-down",key:"a"}],[{action:"key-down",key:"a"},{action:"key-down",key:"a"},{action:"key-up",key:"a"}],[{action:"key-down",key:"a"},{action:"reload"},{action:"key-up",key:"a"}],[{action:"key-down",key:"a"},{action:"press",key:"a"},{action:"key-up",key:"a"}]])assert.equal(gameBrowserTestSuite.safeParse(recipe(steps)).success,false);
});
