import assert from 'node:assert/strict';
import test from 'node:test';
import {fresh,REGIONS,SITES,ROCKS,walkable,move,nearby,interact,valid,type State,type Site} from '../examples/games/vigilia/src/world';
import {Save,KEY} from '../examples/games/vigilia/src/save';
import {gameDocument} from '../packages/contracts/src/games';
import {gameBrowserTestSuite} from '../packages/contracts/src/game-browser-tests';
import design from '../examples/games/vigilia/game.document.json';
import recipe from '../examples/games/vigilia/data/playtests.json';

// Grid search supplies only ordinary directional input through the real movement
// and collision code; it never changes the player position, ring or completion.
function walk(s:State,target:Site){
 const key=(x:number,z:number)=>`${x},${z}`,start=[Math.round(s.x*2),Math.round(s.z*2)],queue=[start],previous=new Map<string,string|null>([[key(start[0]!,start[1]!),null]]);let end:string|undefined;
 for(let i=0;i<queue.length;i++){
  const [x,z]=queue[i]!;if(Math.hypot(x!/2-target.x,z!/2-target.z)<1.3){end=key(x!,z!);break;}
  for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]){const nx=x!+dx!,nz=z!+dz!,k=key(nx,nz);if(!previous.has(k)&&walkable(nx/2,nz/2,s)){previous.set(k,key(x!,z!));queue.push([nx,nz]);}}
 }
 assert.ok(end,`No walking route to ${target.id}`);const path:number[][]=[];for(let k:string|null=end;k;k=previous.get(k)??null)path.push(k.split(',').map(Number));path.reverse();
 for(const point of path){let attempts=0;while(Math.hypot(s.x-point[0]!/2,s.z-point[1]!/2)>.07){assert.ok(attempts++<40,`Movement stuck at ${s.x},${s.z} to ${point}`);const dx=point[0]!/2-s.x,dz=point[1]!/2-s.z,n=Math.hypot(dx,dz);move(s,dx/n,dz/n,Math.min(1/60,n/5.5));}}
 assert.equal(nearby(s)?.id,target.id);assert.ok(valid(s));
}

test('Vigília campaign reaches all twelve memories, solves three distinct songs, walks all bridges and sends the ending through ordinary controls',()=>{
 const s=fresh();assert.ok(valid(s));assert.equal(new Set(REGIONS.map(r=>r.tuning.join(','))).size,3);assert.equal(SITES.filter(p=>p.kind==='memory').length,12);
 for(let region=0;region<3;region++){
  for(const p of SITES.filter(p=>p.region===region&&p.kind==='memory')){walk(s,p);const result=interact(s);assert.equal(result.kind,'memory');assert.ok(result.text.length>20);const count=s.notes.length;interact(s);assert.equal(s.notes.length,count);}
  for(const p of SITES.filter(p=>p.region===region&&p.kind==='ring')){walk(s,p);for(let i=0;i<REGIONS[region]!.tuning[p.index]!;i++)interact(s);}
  assert.equal(s.lit[region],true);assert.ok(valid(s));
 }
 walk(s,SITES.find(p=>p.kind==='home')!);assert.equal(interact(s).kind,'ending');assert.ok(s.ended);assert.equal(s.notes.length,12);assert.ok(valid(s));assert.ok(s.time>60&&s.time<1800);
 let text:string|null=null;const storage={getItem:()=>text,setItem:(_key:string,value:string)=>{text=value;}};const saved=new Save(storage);saved.value=s;saved.write();assert.deepEqual(new Save(storage).value,s);
});

test('shore, rocks and unopened bridges collide; normalized diagonals and long frames cannot bypass movement',()=>{
 const s=fresh();assert.equal(walkable(25,0,s),false);assert.equal(walkable(50,0,s),false);assert.equal(walkable(-15,0,s),false);assert.equal(walkable(0,14,s),false);for(const r of ROCKS)assert.equal(walkable(r.x,r.z,s),false);
 const a=fresh(),b=fresh();move(a,1,0,.05);move(b,1,1,.05);assert.ok(Math.abs(Math.hypot(a.x+7,a.z+10)-Math.hypot(b.x+7,b.z+10))<1e-8);const before=a.x;move(a,1,0,9999);assert.ok(a.x-before<=.27500001);
 const empty=interact(s);assert.equal(empty.kind,'home');assert.ok(!s.ended);
});

test('save round-trip preserves position, partial tuning, journal, preferences and ended campaign; malformed or incompatible originals remain untouched',()=>{
 let text:string|null=null,writes=0;const storage={getItem:(key:string)=>{assert.equal(key,KEY);return text;},setItem:(key:string,value:string)=>{assert.equal(key,KEY);text=value;writes++;}};
 const first=new Save(storage),s=first.value;walk(s,SITES.find(p=>p.id==='memory-0-0')!);interact(s);walk(s,SITES.find(p=>p.id==='ring-0-0')!);interact(s);s.muted=true;s.reducedMotion=true;first.write();assert.deepEqual(new Save(storage).value,s);
 const invalids=['not-json','null','{"version":99}',JSON.stringify({...s,x:1e6}),JSON.stringify({...s,time:null}),JSON.stringify({...s,ended:true}),JSON.stringify({...s,notes:['memory-2-0']}),JSON.stringify({...s,lit:[true,false,false]})];
 for(const input of invalids){text=input;const oldWrites=writes,bad=new Save(storage);assert.equal(bad.available,false,input);bad.write();assert.equal(writes,oldWrites);assert.equal(text,input);}
 const denied=new Save({getItem(){throw Error('denied');},setItem(){throw Error('denied');}});assert.equal(denied.available,false);assert.ok(valid(denied.value));move(denied.value,1,0,.05);denied.write();assert.ok(denied.value.x>-7);
});

test('the authored reference design and public browser recipe use the canonical contracts',()=>{gameDocument.parse(design);gameBrowserTestSuite.parse(recipe);});
