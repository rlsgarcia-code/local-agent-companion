import test from 'node:test';
import assert from 'node:assert/strict';
import {VoyageSaveCoordinator,type RecordResult,type SaveNotice,type SavePort} from '../examples/game-integrations/windmail-save/coordinator';
import {legacyBest,validVoyageSave,type VoyageSave} from '../examples/game-integrations/windmail-save/state';
const data=(score=0):VoyageSave=>({format:2,best:0,muted:false,journey:{x:97,y:352,angle:-.55,speed:0,sail:true,wind:0,nextWind:0,windClock:0,elapsed:0,leg:0,score,streak:0,hits:0,lastHit:0,phase:'active'}});
const deferred=<T>()=>{let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return {promise,resolve};};
function setup(){
 const calls:{data:VoyageSave;expected:string|null}[]=[],notices:SaveNotice[]=[],pending:ReturnType<typeof deferred<RecordResult>>[]=[];
 let current:RecordResult={status:'empty',stamp:null};
 const port:SavePort={load:async()=>current,save:async(value,request)=>{calls.push({data:value,expected:request.expected});const wait=deferred<RecordResult>();pending.push(wait);return wait.promise;},discard:async request=>{assert.equal(request.confirm,true);assert.equal(request.expected,current.stamp);return {status:'discarded'};},close:async()=>{}};
 const coordinator=new VoyageSaveCoordinator(port,notice=>notices.push(notice));
 return {coordinator,calls,notices,pending,setCurrent:(value:RecordResult)=>{current=value;}};
}
test('Windmail validates complete bounded domain state and strict legacy score',()=>{
 const value=data();assert.equal(validVoyageSave(value),true);assert.equal(validVoyageSave({...value,extra:true}),false);
 for(const journey of [{...value.journey,x:NaN},{...value.journey,lastHit:1},{...value.journey,leg:5},{...value.journey,phase:'finished'}])assert.equal(validVoyageSave({...value,journey}),false);
 assert.equal(validVoyageSave({...value,journey:{...value.journey,leg:5,phase:'finished'}}),true);
 for(const old of [null,'NaN','Infinity','1e8','-1','1.5','1000000001'])assert.equal(legacyBest(old),0);assert.equal(legacyBest('1463'),1463);
});
test('Windmail coalesces queued checkpoints, snapshots latest state and waits for acknowledgment',async()=>{
 const s=setup();await s.coordinator.load();let score=1;const first=s.coordinator.checkpoint(()=>data(score));score=2;s.coordinator.checkpoint(()=>data(score));score=3;
 assert.equal(s.calls.length,1);assert.equal(s.notices.some(n=>n.phase==='saved'),false);
 s.pending[0]!.resolve({status:'saved',stamp:'one'});await new Promise<void>(resolve=>setImmediate(resolve));
 assert.equal(s.calls.length,2);assert.equal(s.calls[1]!.data.journey!.score,3);assert.equal(s.calls[1]!.expected,'one');assert.equal(s.notices.some(n=>n.phase==='saved'),false);
 s.pending[1]!.resolve({status:'saved',stamp:'two'});await first;assert.equal(s.notices.at(-1)!.phase,'saved');await s.coordinator.close();
});
test('Windmail never retries a conflict onto a changed record',async()=>{
 const s=setup();await s.coordinator.load();const work=s.coordinator.checkpoint(()=>data(20));s.pending[0]!.resolve({status:'conflict',stamp:'other'});await work;
 s.setCurrent({status:'loaded',stamp:'other',data:data(90)});assert.equal((await s.coordinator.retry()).status,'conflict');await s.coordinator.checkpoint(()=>data(30));assert.equal(s.calls.length,1);await s.coordinator.close();
});
test('Windmail refuses missing save acknowledgment and explicit volatile choice stops announcements',async()=>{
 const s=setup();await s.coordinator.load();const first=s.coordinator.checkpoint(()=>data());s.pending[0]!.resolve({status:'saved'});await first;assert.equal(s.notices.at(-1)!.phase,'error');
 const retry=s.coordinator.retry();await Promise.resolve();s.coordinator.withoutSaving();s.pending[1]!.resolve({status:'saved',stamp:'late'});await retry;
 assert.equal(s.notices.at(-1)!.phase,'volatile');await s.coordinator.close();assert.equal(s.notices.at(-1)!.phase,'closed');
});
