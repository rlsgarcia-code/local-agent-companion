import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';

// Deliberate fault-injection port, not a browser substitute. Native transaction,
// concurrency and reload checks have a separate packaged-browser qualification.
function database(){
  const rows=new Map<string,unknown>();let abortPut=false,quota=false,closed=0;
  const factory={open:()=>{
    const request:any={};
    queueMicrotask(()=>{request.result={objectStoreNames:{contains:()=>true},close:()=>{closed++;},transaction:(_name:string,_mode:string)=>{
      let active=true,pending=0;const staged=new Map(rows),tx:any={error:null};
      tx.abort=()=>{if(!active)return;active=false;queueMicrotask(()=>tx.onabort?.());};
      function query(operation:()=>unknown,put=false){
        const q:any={};pending++;queueMicrotask(()=>{
          if(!active)return;
          q.result=operation();q.onsuccess?.();pending--;
          if(put&&(abortPut||quota)){tx.error={name:quota?'QuotaExceededError':'AbortError'};tx.abort();return;}
          if(!pending)queueMicrotask(()=>{if(!active||pending)return;active=false;rows.clear();for(const [key,value]of staged)rows.set(key,value);tx.oncomplete?.();});
        });return q;
      }
      tx.objectStore=()=>({get:(key:string)=>query(()=>staged.get(key)),put:(value:unknown,key:string)=>query(()=>{staged.set(key,value);},true),delete:(key:string)=>query(()=>{staged.delete(key);},true)});return tx;
    }};request.onsuccess?.();});return request;
  }};
  return {rows,factory,setAbort:(value:boolean)=>{abortPut=value;},setQuota:(value:boolean)=>{quota=value;},closed:()=>closed};
}
const modulePromise=import(path.resolve('packages/adapter-game-web/runtimes/game-save-1.0.0.mjs'));
const config={gameId:'test-game',slot:'campaign',version:1,validate:(v:any)=>Boolean(v&&Number.isInteger(v.letters)&&v.letters>=0&&v.letters<=5)};

test('save records preserve exact JSON state, compare expected content and isolate game/slot identities',async()=>{
  const {createGameSave}=await modulePromise,db=database(),save=createGameSave({...config,indexedDB:db.factory});
  try{
    assert.deepEqual(await save.load(),{status:'empty',stamp:null});
    const state={letters:3,name:'Maré 🛶\r\n',wind:-.125},saved=await save.save(state,{expected:null});assert.equal(saved.status,'saved');assert.equal(saved.revision,1);
    state.letters=4;const loaded=await save.load();assert.equal(loaded.data.letters,3);assert.equal(loaded.data.name,'Maré 🛶\r\n');assert.equal(loaded.stamp,saved.stamp);
    loaded.data.letters=1;assert.equal((await save.load()).data.letters,3);
    assert.equal((await save.save({wind:-.125,name:'Maré 🛶\r\n',letters:3},{expected:saved.stamp})).status,'unchanged');
    const before=[...db.rows];assert.equal((await save.save({letters:5},{expected:null})).status,'conflict');assert.deepEqual([...db.rows],before);
    const other=createGameSave({...config,slot:'other',indexedDB:db.factory});assert.equal((await other.load()).status,'empty');await other.close();
    const otherGame=createGameSave({...config,gameId:'other-game',indexedDB:db.factory});assert.equal((await otherGame.load()).status,'empty');await otherGame.close();
    assert.equal((await save.discard({expected:saved.stamp,confirm:false})).status,'blocked');assert.equal((await save.discard({expected:null,confirm:true})).status,'conflict');
    assert.equal((await save.discard({expected:saved.stamp,confirm:true})).status,'discarded');assert.equal((await save.load()).status,'empty');
  }finally{await save.close();}
  assert.equal((await save.load()).code,'closed');assert.ok(db.closed()>0);
});

test('a put request success is not a committed save; abort/quota leave the prior complete record intact',async()=>{
  const {createGameSave}=await modulePromise,db=database(),save=createGameSave({...config,indexedDB:db.factory});
  try{
    const seed=await save.save({letters:1},{expected:null}),before=[...db.rows];
    db.setAbort(true);const aborted=await save.save({letters:2},{expected:seed.stamp});assert.equal(aborted.status,'unavailable');assert.equal(aborted.code,'storage-aborted');assert.deepEqual([...db.rows],before);
    db.setAbort(false);db.setQuota(true);assert.equal((await save.save({letters:2},{expected:seed.stamp})).code,'storage-quota');assert.deepEqual([...db.rows],before);
    db.setQuota(false);assert.equal((await save.load()).data.letters,1);assert.equal((await save.save({letters:2},{expected:seed.stamp})).status,'saved');
  }finally{await save.close();}
});

test('migration is explicit, validated and idempotent by version/stamp; future/corrupt data are preserved',async()=>{
  const {createGameSave}=await modulePromise,db=database(),old=createGameSave({...config,indexedDB:db.factory});let calls=0;
  const next=createGameSave({...config,version:2,validate:(v:any)=>config.validate(v)&&v.bonus===5,migrations:{1:(v:any)=>{calls++;return {...v,bonus:5};}},indexedDB:db.factory});
  try{
    const original=await old.save({letters:3},{expected:null}),before=[...db.rows];assert.equal((await next.load()).status,'migration-required');assert.equal(calls,0);
    assert.equal((await next.save({letters:0,bonus:5},{expected:original.stamp})).status,'blocked');assert.deepEqual([...db.rows],before);
    const migrated=await next.migrate({expected:original.stamp});assert.equal(migrated.status,'migrated');assert.equal(calls,1);assert.equal((await next.load()).data.letters,3);
    assert.equal((await next.migrate({expected:original.stamp})).status,'conflict');assert.equal(calls,1);
    assert.equal((await old.load()).status,'incompatible');assert.equal((await old.save({letters:0},{expected:migrated.stamp})).status,'blocked');
    db.rows.set('test-game:campaign','PRIVATE_CORRUPT_JSON');const corrupt=await next.load();assert.equal(corrupt.status,'invalid');assert.doesNotMatch(JSON.stringify(corrupt),/PRIVATE_CORRUPT/);
    assert.equal((await next.save({letters:0,bonus:5},{expected:corrupt.stamp})).status,'blocked');assert.equal(db.rows.get('test-game:campaign'),'PRIVATE_CORRUPT_JSON');
    assert.equal((await next.discard({expected:corrupt.stamp,confirm:true})).status,'discarded');
  }finally{await old.close();await next.close();}
});

test('invalid state, accessors, cycles, large records and unavailable storage never become successful persistence',async()=>{
  const {createGameSave}=await modulePromise,db=database(),save=createGameSave({...config,maxBytes:1024,indexedDB:db.factory});let getterCalls=0;
  try{
    const accessor={letters:1,get secret(){getterCalls++;throw Error('PRIVATE_DATA');}},cycle:any={letters:1};cycle.self=cycle;
    const invalid=[{letters:6},accessor,cycle,{letters:1,missing:undefined},{letters:1,number:Infinity},{letters:1,date:new Date()},{letters:1,text:'🛶'.repeat(1024)},JSON.parse('{"letters":1,"__proto__":{}}')];
    for(const data of invalid){const result=await save.save(data,{expected:null});assert.equal(result.status,'invalid-input');assert.doesNotMatch(JSON.stringify(result),/PRIVATE_DATA/);assert.equal(db.rows.size,0);}
    assert.equal(getterCalls,0);assert.equal((await save.save({letters:1},{})).code,'expected-stamp-required');
    const unavailable=createGameSave({...config,indexedDB:null});assert.equal((await unavailable.load()).code,'storage-unavailable');await unavailable.close();
    assert.throws(()=>createGameSave({...config,maxBytes:100}));assert.throws(()=>createGameSave({...config,gameId:'../other'}));
  }finally{await save.close();}
});
