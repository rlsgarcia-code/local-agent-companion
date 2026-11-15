// Exact engine/SDK/TLS + real LangChain HTTP serialization. Deterministic local
// fake parent/vision server; not real model vision or artistic/game acceptance.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {PNG} from 'pngjs';
import sdk from '../dist-tests/packages/client-ts/src/index.js';
import bootstrap from '../dist-tests/packages/client-ts/src/bootstrap.js';
import security from '../dist-tests/packages/agent-service/src/security.js';
import storage from '../dist-tests/packages/agent-service/src/store.js';
import fixtures from '../dist-tests/test/game-fixtures.js';

const args=process.argv.slice(2);assert.equal(args.length,1);assert.ok(args[0].startsWith('--engine=')&&args[0].slice(9));const engine=path.resolve(args[0].slice(9));await bootstrap.verifyBundle(engine,undefined,true);
const output=path.resolve('output/game-generation/image-review-engine',new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID().slice(0,8));await mkdir(output,{recursive:true});
const state=await mkdtemp(path.join(tmpdir(),'image-review-engine-')),identity=await security.ensureIdentity(state),store=new storage.Store(path.join(state,'metadata.sqlite'));
const credential=await security.createClientCredential(state,{id:'image-review-fixture',product:'companion-vscode',profile:'fixture',workspace:'',providers:['ollama'],hostTools:[]});store.register(credential);store.close();
const image=new PNG({width:4,height:4});image.data.fill(255);const png=PNG.sync.write(image),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
let child,client,mock,activeRun,passed=false,project,requestFailure;const observations=[],requests=[],rootCounts=new Map();let visionRequests=0;
const server=createServer((request,response)=>{let body='';request.setEncoding('utf8');request.on('data',chunk=>{body+=chunk;if(Buffer.byteLength(body)>4*1024*1024)request.destroy();});request.on('end',()=>{try{
 assert.equal(request.url,'/v1/chat/completions');assert.equal(request.method,'POST');const input=JSON.parse(body);assert.ok(project);
 if(input.model==='fixture-vision'){
  const user=input.messages.find(message=>message.role==='user');assert.ok(user&&Array.isArray(user.content));assert.equal(user.content.find(part=>part.type==='image_url').image_url.url,'data:image/png;base64,'+png.toString('base64'));
  assert.ok(user.content.some(part=>part.type==='text'&&part.text.includes(project.contentHash)));assert.equal(input.stream,false);visionRequests++;
  response.writeHead(200,{'content-type':'application/json'});response.end(JSON.stringify({id:'vision-'+visionRequests,object:'chat.completion',created:1,model:input.model,choices:[{index:0,message:{role:'assistant',content:'VISION_FIXTURE_ONLY: supplied pixels are white; this is not artistic acceptance.'},finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:5,total_tokens:15}}));
  requests.push({model:input.model,imageSha256:sha(png),imageBytes:png.length,structuredImageInHumanMessage:true});return;
 }
 assert.equal(input.model,'fixture-parent');assert.equal(input.stream,true);assert.doesNotMatch(JSON.stringify(input.messages),/data:image/);
 const sessionKey=input.messages.filter(m=>m.role==='user').at(-1).content,step=(rootCounts.get(sessionKey)??0)+1;rootCounts.set(sessionKey,step);assert.ok(step<=2);
 if(step===2){const tool=input.messages.filter(m=>m.role==='tool').at(-1);assert.ok(tool);const opinion=JSON.parse(tool.content);assert.equal(opinion.kind,'game-visual-opinion');assert.equal(opinion.qualityApproved,false);assert.equal(opinion.binding.file.sha256,sha(png));assert.equal(opinion.binding.sourceHash,project.contentHash);}
 const common={id:'parent-'+requests.length,object:'chat.completion.chunk',created:1,model:input.model};response.writeHead(200,{'content-type':'text/event-stream'});
 const send=delta=>response.write('data: '+JSON.stringify({...common,choices:[{index:0,delta,finish_reason:null}]})+'\n\n');send({role:'assistant'});
 if(step===1)send({tool_calls:[{index:0,id:'inspect-pixels',type:'function',function:{name:'game_review_image',arguments:JSON.stringify({source:{kind:'project',projectId:project.id,revision:1,path:'assets/fixture.png'},focus:'Describe only the actual visible colors; do not approve quality.'})}}]});else send({content:'The advisory image review was received. Full game quality is not approved.'});
 response.write('data: '+JSON.stringify({...common,choices:[{index:0,delta:{},finish_reason:step===1?'tool_calls':'stop'}]})+'\n\n');response.write('data: '+JSON.stringify({...common,choices:[],usage:{prompt_tokens:10,completion_tokens:5,total_tokens:15}})+'\n\n');response.end('data: [DONE]\n\n');requests.push({model:input.model,step,imagesInToolMessages:false});
 }catch(error){requestFailure=error;if(!response.headersSent)response.writeHead(500);response.end('Synthetic image-review qualification rejected');}});});
async function stop(){client?.close();client=undefined;if(child?.exitCode===null){const exited=once(child,'exit');child.kill('SIGTERM');await exited;}if(child)assert.equal(child.exitCode,0);}
try{
 mock=server;await new Promise(resolve=>mock.listen(0,'127.0.0.1',resolve));const address=mock.address();assert.ok(address&&typeof address==='object');
 child=spawn(path.join(engine,'node'),[path.join(engine,'service.cjs'),state],{cwd:state,env:{HOME:state,PATH:'/usr/bin:/bin',TMPDIR:tmpdir(),LANG:'en_US.UTF-8'},stdio:'ignore'});
 let ready=false;for(let i=0;i<600;i++){assert.equal(child.exitCode,null);try{if(JSON.parse(await readFile(path.join(state,'runtime.json'),'utf8')).pid===child.pid){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,25));}assert.ok(ready,'Inspect this original bootstrap on timeout; do not create another service');
 client=new sdk.AgentClient({address:security.ipcPath(state),certificate:identity.cert,credential});await client.connect();assert.ok((await client.call('engine.info')).capabilities.includes('game-visual-opinion-v1'));
 const document=fixtures.fixtureGameDocument();document.files=[await client.uploadGameFile('assets/fixture.png',png,'image/png')];project=await client.createGameProject('fixture-image',document);
 for(const runtime of ['standard','deep']){
  const session=await client.call('sessions.create',{title:'Visual opinion '+runtime});await client.selectGameProject(session.id,project.id);
  const spec={runtime,mode:'plan',provider:{kind:'ollama',endpoint:`http://127.0.0.1:${address.port}/v1`,roles:{executor:'fixture-parent',vision:'fixture-vision'}},messages:[{role:'user',content:'Read exactly one saved PNG. Fixture '+runtime}],systemPrompt:'Use one read-only game_review_image. Do not edit or certify the game.',tools:[]};
  const key='one-image-'+runtime,before=requests.length,run=await client.startRun(session.id,key,spec);activeRun=run.id;const result=await client.waitForRun(run.id,session.id,()=>{},undefined,AbortSignal.timeout(30000));assert.equal(result.state,'completed',result.error);activeRun=undefined;if(requestFailure)throw requestFailure;assert.equal(requests.length-before,3);
  const events=await client.call('events.read',{sessionId:session.id,cursor:0});assert.doesNotMatch(JSON.stringify(events),/data:image/);assert.doesNotMatch(JSON.stringify(events.filter(event=>event.type==='text.delta')),/VISION_FIXTURE_ONLY/);
  await client.startRun(session.id,key,spec);assert.equal(requests.length-before,3);
  const budgets=await client.getInferenceBudgets(session.id);for(const budget of budgets.budgets){assert.equal(budget.pendingCalls,0);assert.equal(budget.unreportedCalls,0);assert.equal(budget.calls,runtime==='standard'?3:6);assert.equal(budget.chargedTokens,budget.calls*15);}
  assert.equal((await client.getGameQuality(project.id)).ready,false);assert.equal((await client.getGameProject(project.id)).revision,1);
  observations.push({runtime,actualModelTransport:'local deterministic HTTP/SSE only',parentRequests:2,visionRequests:1,exactImageBytesVerified:true,toolResponseTextOnly:true,privateHelperNotStreamed:true,idempotentStartWithoutNewCalls:true,cumulativeInferenceCalls:budgets.budgets[0].calls,allSharedScopesCharged:true,qualityApproved:false});
 }
 assert.equal(visionRequests,2);await stop();await bootstrap.verifyBundle(engine,undefined,true);
 await writeFile(path.join(output,'report.json'),JSON.stringify({scope:'Actual packaged Node/service/SDK/TLS/IPC and official Standard/Deep graphs with deterministic local parent SSE and vision HTTP replies. Verifies serialization, original PNG binding, budgets, privacy and read-only behavior; not a real model opinion, artistic/game/human acceptance, installed Mac/VS Code or KidOS integration.',engineManifestSha256:sha(await readFile(path.join(engine,'manifest.json'))),image:{sha256:sha(png),bytes:png.length,width:4,height:4,synthetic:true},requests,observations,ownedServiceExited:0,realProviderRequests:0,installed:false},null,2)+'\n');passed=true;console.log('GAME_IMAGE_REVIEW_ENGINE_OK '+output);
}catch(error){await writeFile(path.join(output,'failure.json'),JSON.stringify({message:error.message,activeRun,ownedServicePid:child?.pid,requestSummaries:requests},null,2)+'\n');throw error;}
finally{if(activeRun&&client)try{await client.call('runs.cancel',{id:activeRun});}catch{}await stop();await new Promise(resolve=>server.close(resolve));if(passed)await rm(state,{recursive:true,force:true});else console.error('Private owned state preserved: '+state);}
