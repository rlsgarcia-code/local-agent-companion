// Development-only native SDK/service/graph qualification. Loopback SSE fixture,
// no real model, installed clients, parental authority or quality acceptance.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {once} from 'node:events';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import security from '../dist-tests/packages/agent-service/src/security.js';
import storage from '../dist-tests/packages/agent-service/src/store.js';
import sdk from '../dist-tests/packages/client-ts/src/index.js';
import bootstrap from '../dist-tests/packages/client-ts/src/bootstrap.js';
import fixtures from '../dist-tests/test/game-fixtures.js';

assert.equal(process.versions.node,'22.23.4');assert.equal(process.argv.length,4);
const arg=name=>{const value=process.argv.find(v=>v.startsWith(name+'='));assert.ok(value);return path.resolve(value.slice(name.length+1));};
const engine=arg('--engine'),output=arg('--output');await mkdir(output);await bootstrap.verifyBundle(engine,undefined,true);
const sha=value=>createHash('sha256').update(value).digest('hex'),manifest=await readFile(path.join(engine,'manifest.json'));
const save=(name,value)=>writeFile(path.join(output,name),JSON.stringify(value,null,2)+'\n');
const root=await mkdtemp(path.join(tmpdir(),'source-page-')),env={HOME:root,PATH:'/usr/bin:/bin',TMPDIR:tmpdir(),LANG:'en_US.UTF-8'};
const identity=await security.ensureIdentity(root),store=new storage.Store(path.join(root,'metadata.sqlite')),actors=[],services=[];
let active,wire,wireError,requests=0,approvals=0,unknown=false,passed=false;
for(const product of ['companion-mac','companion-vscode'])for(const runtime of ['standard','deep']){
  const credential=await security.createClientCredential(root,{id:'source-'+product+'-'+runtime,product,profile:'synthetic-'+runtime,workspace:'',providers:['ollama'],hostTools:[]});
  store.register(credential);actors.push({product,runtime,credential,results:[]});
}
store.close();await security.privateWrite(path.join(root,'qualification-clients.json'),JSON.stringify(actors.map(a=>a.credential)));
const mock=createServer((request,response)=>{
  const parts=[];let bytes=0;
  request.on('data',part=>{bytes+=part.length;if(bytes>8*1024*1024)request.destroy();else parts.push(part);});
  request.on('end',()=>{try{
    assert.ok(wire);assert.equal(request.method,'POST');assert.equal(request.url,'/v1/chat/completions');
    const input=JSON.parse(Buffer.concat(parts).toString('utf8'));requests++;wire.turn++;
    assert.ok(wire.turn<=2);let delta,finish;
    if(wire.turn===1){
      assert.ok(input.tools.some(tool=>tool.function?.name==='game_read_file'));
      delta={tool_calls:[{index:0,id:'fixture-source-page',type:'function',function:{name:'game_read_file',arguments:JSON.stringify(wire.args)}}]};finish='tool_calls';
    }else{
      const tool=input.messages.findLast(message=>message.role==='tool');assert.ok(tool);
      const result=JSON.parse(tool.content);assert.equal(result.kind,'text-source-page');assert.equal(result.projectId,wire.actor.project.id);
      assert.equal(result.revision,1);assert.equal(result.sourceHash,wire.actor.project.contentHash);assert.equal(result.file.sha256,wire.actor.file.sha256);
      assert.equal(result.offset,wire.args.textPage.cursor);assert.ok(result.cursor>result.offset);assert.ok(result.hasMore);
      assert.equal(result.totalBytes,wire.actor.bytes.length);assert.ok(Buffer.byteLength(result.content)<=257);
      assert.ok(Buffer.from(result.content).equals(wire.actor.bytes.subarray(result.offset,result.cursor)));
      wire.result={kind:result.kind,revision:result.revision,sourceHash:result.sourceHash,fileSha256:result.file.sha256,offset:result.offset,cursor:result.cursor,totalBytes:result.totalBytes,returnedBytes:Buffer.byteLength(result.content),hasMore:result.hasMore};
      delta={content:'Synthetic read completed; no game quality approved.'};finish='stop';
    }
    response.writeHead(200,{'content-type':'text/event-stream'});const common={id:'fixture-'+requests,object:'chat.completion.chunk',model:'source-page-fixture'};
    response.write('data: '+JSON.stringify({...common,choices:[{index:0,delta:{role:'assistant',...delta},finish_reason:finish}]})+'\n\n');
    response.write('data: '+JSON.stringify({...common,choices:[],usage:{prompt_tokens:100,completion_tokens:5,total_tokens:105}})+'\n\n');response.end('data: [DONE]\n\n');
  }catch(error){wireError=error;response.writeHead(500);response.end('Synthetic qualification failed.');}});
});
mock.listen(0,'127.0.0.1');await once(mock,'listening');const address=mock.address();assert.ok(address&&typeof address==='object');
async function start(){
  assert.ok(!active||active.exitCode!==null);active=spawn(path.join(engine,'node'),[path.join(engine,'service.cjs'),root],{env,stdio:'ignore'});services.push(active);
  let ready=false;for(let i=0;i<600;i++){assert.equal(active.exitCode,null);try{ready=JSON.parse(await readFile(path.join(root,'runtime.json'),'utf8')).pid===active.pid;}catch{}if(ready)break;await new Promise(r=>setTimeout(r,25));}
  assert.ok(ready,'Inspect original process on readiness timeout; do not restart');
  for(const actor of actors){actor.client=new sdk.AgentClient({address:security.ipcPath(root),certificate:identity.cert,credential:actor.credential});await actor.client.connect();const info=await actor.client.call('engine.info');assert.equal(info.build.manifestSha256,sha(manifest));assert.ok(info.capabilities.includes('game-source-text-pages-v1'));}
}
async function stop(){
  if(!active||active.exitCode!==null)return;assert.equal((await actors[0].client.call('engine.quiesceIfIdle',{})).accepted,true);
  for(const actor of actors)actor.client.close();const end=once(active,'exit');active.kill('SIGTERM');await end;assert.equal(active.exitCode,0);
}
async function readPage(actor,cursor,key){
  const session=await actor.client.call('sessions.create',{title:'Synthetic source page'});
  wire={actor,turn:0,args:{projectId:actor.project.id,path:actor.file.path,textPage:{revision:1,sha256:actor.file.sha256,cursor,limit:257}}};unknown=true;
  const run=await actor.client.startRun(session.id,key,{runtime:actor.runtime,mode:'plan',provider:{kind:'ollama',endpoint:`http://127.0.0.1:${address.port}/v1`,roles:{executor:'source-page-fixture'}},messages:[{role:'user',content:'Read the exact synthetic source page. Read only; no effects.'}],systemPrompt:'Use the authorized read-only game source tool.',tools:[]});
  const finished=await actor.client.waitForRun(run.id,session.id,()=>{},async()=>{approvals++;return false;},AbortSignal.timeout(30000));unknown=false;
  if(wireError)throw wireError;assert.equal(finished.state,'completed',finished.error);assert.equal(wire.turn,2);assert.ok(wire.result);
  actor.results.push({runId:run.id,state:finished.state,...wire.result});wire=undefined;
}
try{
  await save('control.json',{observerSha256:sha(await readFile(new URL(import.meta.url))),engineManifestSha256:sha(manifest),syntheticOnly:true,closedServiceEnvironment:true});
  await start();
  for(const [index,actor] of actors.entries()){
    actor.bytes=Buffer.from('\ufeff'+('Synthetic '+index+' 🛶 source\r\n').repeat(18000));const transfer=await actor.client.upload('original',actor.bytes,'application/octet-stream');
    actor.file={path:'src/main.ts',sha256:sha(actor.bytes),size:actor.bytes.length,mime:'text/javascript',transferId:transfer.id};
    actor.document={...fixtures.fixtureGameDocument(),files:[actor.file]};actor.project=await actor.client.createGameProject('seed',actor.document);
    assert.ok(actor.file.size>256*1024);await readPage(actor,0,'first');
    const changed=Buffer.from('Later source must not leak into the old pinned page'),replacement=await actor.client.upload('replacement',changed,'application/octet-stream');
    actor.current=await actor.client.commitGameRevision(actor.project.id,'later',1,{...actor.document,files:[{...actor.file,sha256:sha(changed),size:changed.length,transferId:replacement.id}]},'Synthetic later revision');assert.equal(actor.current.revision,2);
  }
  await stop();await start();for(const actor of actors){await readPage(actor,actor.results[0].cursor,'after-restart');assert.equal((await actor.client.call('games.projects.get',{id:actor.project.id})).revision,2);}await stop();
  assert.equal(requests,16);assert.equal(approvals,0);await bootstrap.verifyBundle(engine,undefined,true);assert.ok(manifest.equals(await readFile(path.join(engine,'manifest.json'))));
  await save('report.json',{scope:'Actual packaged Node/SDK/TLS/IPC/service and native Standard/Deep graphs via common Agent API; loopback SSE fixture. Not native UI/installed clients or real-model savings.',engineManifestSha256:sha(manifest),results:actors.map(({product,runtime,project,current,results})=>({product,runtime,projectId:project.id,currentRevision:current.revision,results})),requests,approvals,realModelCalls:0,sourceEffectsByModel:0,qualityApproved:false,installedAcceptance:false});passed=true;console.log('GAME_SOURCE_PAGES_QUALIFIED '+output);
}catch(error){await save('failure.json',{message:String(error?.message??error).slice(0,4000),privateState:root,unknown,services:services.map(s=>({pid:s.pid,exitCode:s.exitCode})),requests});process.exitCode=1;console.error(String(error?.message??error).slice(0,4000));}
finally{
  if(active?.exitCode===null&&!unknown)try{await stop();}catch{}
  if(active?.exitCode===null){for(const actor of actors)actor.client?.close();active.unref();}
  mock.closeAllConnections();await new Promise(resolve=>mock.close(resolve));const closed=services.every(s=>s.exitCode===0);if(passed&&closed)await rm(root,{recursive:true,force:true});
  await save('closure.json',{services:services.map(s=>({pid:s.pid,exitCode:s.exitCode,signalCode:s.signalCode})),privateStateRemoved:passed&&closed,unknown});
}
