import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,rm,readFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {PNG} from 'pngjs';
import {BaseChatModel} from '@langchain/core/language_models/chat_models';
import {AIMessage,type BaseMessage} from '@langchain/core/messages';
import type {ChatResult} from '@langchain/core/outputs';
import {prepareGameReviewImage,GAME_REVIEW_IMAGE_BYTES} from '../packages/game-production/src/image-review';
import {gameImageReview} from '../packages/contracts/src/game-image-review';
import {AgentService} from '../packages/agent-service/src/service';
import {Store} from '../packages/agent-service/src/store';
import {Transfers} from '../packages/agent-service/src/transfers';
import {executeGraph} from '../packages/agent-core/src/index';
import {runSpec,type Run,type Registration} from '../packages/contracts/src/index';
import type {GameProject} from '../packages/contracts/src/games';
import type {InferenceBudgetSnapshot} from '../packages/contracts/src/inference-budget';
import {fixtureGameDocument} from './game-fixtures';
const sha=(data:Uint8Array)=>createHash('sha256').update(data).digest('hex');
const png=()=>{const image=new PNG({width:2,height:2});image.data.fill(255);return PNG.sync.write(image);};
const bind={projectId:'fixture',revision:1,sourceHash:'a'.repeat(64)};
test('game image preparation preserves exact PNG bytes/binding and rejects bogus, corrupt, oversized or unsafe images before any model',()=>{
 const data=png(),file={path:'assets/grass.png',mime:'image/png',size:data.length,sha256:sha(data),transferId:'PRIVATE_TRANSFER'},result=prepareGameReviewImage(file,()=>data,bind);assert.deepEqual(Buffer.from(result.data,'base64'),data);assert.equal(result.binding.width,2);assert.equal(result.binding.height,2);assert.doesNotMatch(JSON.stringify(result.binding),/PRIVATE_TRANSFER/);
 for(const value of [{...file,mime:'image/jpeg'},{...file,size:GAME_REVIEW_IMAGE_BYTES+1},{...file,size:0}])assert.throws(()=>prepareGameReviewImage(value,()=>{throw Error('Must not read unsupported or oversized input');},bind));
 for(const content of [Buffer.from([0,1]),Buffer.from(data)]){if(content.length>2)content[content.length-1]=content[content.length-1]!^255;assert.throws(()=>prepareGameReviewImage({...file,size:content.length,sha256:sha(content)},()=>content,bind));}
 const bomb=Buffer.from(data);bomb.writeUInt32BE(4096,16);bomb.writeUInt32BE(4096,20);assert.throws(()=>prepareGameReviewImage({...file,sha256:sha(bomb)},()=>bomb,bind));
 assert.throws(()=>prepareGameReviewImage(file,()=>Buffer.from('changed'),bind));
 for(const source of [{kind:'project',projectId:'x',revision:1,path:'../outside'},{kind:'report',reportId:'x',path:'/host'},{kind:'url',url:'https://elsewhere.invalid'}])assert.equal(gameImageReview.safeParse({source,focus:'Inspect'}).success,false);
 assert.equal(gameImageReview.safeParse({source:{kind:'project',projectId:'x',revision:1,path:'image.png'},focus:'Inspect',model:'forged'}).success,false);
});
class FixtureModel extends BaseChatModel{
 calls=0;seen:BaseMessage[][]=[];
 constructor(readonly kind:'parent'|'vision',readonly args:unknown,readonly failure=false){super({});}
 _llmType(){return 'game-image-fixture-'+this.kind;}
 bindTools(){return this;}
 async _generate(messages:BaseMessage[]):Promise<ChatResult>{
  this.calls++;this.seen.push(messages);
  if(this.kind==='vision'&&this.failure)throw Error('SIMULATED_MODEL_TRANSPORT_FAILURE');
  const content=this.kind==='vision'?'MODEL_VISUAL_OPINION: white pixels; gameplay remains unverified.':'Review complete as advice only; game quality remains unapproved.';
  const message=new AIMessage({id:this.kind+'-'+this.calls,content:this.kind==='parent'&&this.calls===1?'':content,usage_metadata:{input_tokens:10,output_tokens:5,total_tokens:15},
   ...(this.kind==='parent'&&this.calls===1?{tool_calls:[{id:'read-exact-image',name:'game_review_image',args:this.args as Record<string,unknown>}]}:{})});
  return {generations:[{message,text:message.text}]};
 }
}
const reg:Registration={id:'image-review',product:'companion-vscode',profile:'default',workspace:'',providers:['ollama'],hostTools:[]};
async function fixture(runtime:'standard'|'deep',options:{configured?:boolean;failure?:boolean;limited?:boolean;report?:boolean}={}){
 const directory=await mkdtemp(path.join(tmpdir(),'game-image-review-')),store=new Store(path.join(directory,'metadata.sqlite'));let parent:FixtureModel,vision:FixtureModel;
 const service=new AgentService(store,directory,(spec,context)=>executeGraph(spec,{...context,models:{executor:parent,planner:parent,evaluator:parent,vision}}),{},options.limited?{inferenceBudgetPolicy:{namespace:{callsPerBlock:1,tokensPerBlock:1000,maxBlocks:1},stage:{callsPerBlock:1,tokensPerBlock:1000,maxBlocks:1},unknownTokensPerCall:1}}:options.report?{
 gameAdapters:[{id:'image-build-fixture',engine:'phaser',products:['companion-vscode'],authority:'workspace',toolchain:{id:'fixture',version:'1',sha256:'a'.repeat(64)},probe:async()=>({available:true}),build:async()=>({entrypoint:'index.html',files:[{path:'index.html',mime:'text/html',data:Buffer.from('Synthetic build, not gameplay')} ]})}],
 gameCollectors:[{id:'image-report-fixture',engines:['phaser'],products:['companion-vscode'],authority:'workspace',toolchain:{id:'fixture',version:'1',sha256:'a'.repeat(64)},categories:['visual'],validate:async()=>[{category:'visual',checks:[{id:'synthetic-frame',status:'unverified',detail:'Synthetic PNG for binding test, not visual acceptance'}],environment:{platform:'test',device:'fixture',browser:'none',input:[],scope:'static'},metrics:{synthetic:true},evidenceFiles:[{path:'frame.png',mime:'image/png',data:png()}]}]}]}:{});
 const session=store.createSession(reg,'Review pixels'),data=png(),transfers=new Transfers(store),transfer=transfers.begin(reg,{key:'image',size:data.length,sha256:sha(data),mime:'application/octet-stream'});transfers.append(reg,transfer.id,0,data);transfers.commit(reg,transfer.id);
 const doc=fixtureGameDocument();doc.files=[{path:'assets/grass.png',mime:'image/png',size:data.length,sha256:sha(data),transferId:transfer.id}];
 const project=await service.dispatch(reg,'games.projects.create',{requestId:'project',document:doc},'test') as GameProject;
 await service.dispatch(reg,'games.projects.select',{sessionId:session.id,projectId:project.id},'test');
 let source:Record<string,unknown>={kind:'project',projectId:project.id,revision:1,path:'assets/grass.png'};
 if(options.report){
  const settled=async(id:string)=>{for(let i=0;i<1000;i++){const job=await service.dispatch(reg,'games.production.get',{id},'test') as {state:string};if(job.state==='completed')return;if(job.state==='failed')throw Error('Synthetic job failed');await new Promise(resolve=>setTimeout(resolve,2));}throw Error('Original synthetic job pending');};
  const build=await service.dispatch(reg,'games.builds.start',{requestId:'build',projectId:project.id,revision:1},'test') as {id:string};await settled(build.id);
  const validation=await service.dispatch(reg,'games.validation.start',{requestId:'validate',buildId:build.id,collectorId:'image-report-fixture'},'test') as {id:string};await settled(validation.id);
  const reports=await service.dispatch(reg,'games.validation.reports',{id:build.id},'test') as {id:string};const rows=JSON.parse(transfers.bytes(reg,reports.id).toString());source={kind:'report',reportId:rows[0].id,path:'frame.png'};
 }
 const args={source,focus:'Describe the visible colors and composition only'};parent=new FixtureModel('parent',args);vision=new FixtureModel('vision',args,options.failure);
 const spec=runSpec.parse({runtime,mode:'plan',provider:{kind:'ollama',endpoint:'http://127.0.0.1:11434/v1',roles:{executor:'fixture-parent',...(options.configured===false?{}:{vision:'fixture-vision'})}},messages:[{role:'user',content:'Inspect the saved game image without editing or claiming acceptance.'}],systemPrompt:'Use the requested read-only review tool once.',tools:[]});
 return {directory,store,service,session,data,project,args,parent,vision,spec,async quality(){const value=await service.dispatch(reg,'games.quality.get',{projectId:project.id},'test') as {id:string};return JSON.parse(transfers.bytes(reg,value.id).toString());},async run(key='review'){const run=await service.dispatch(reg,'runs.start',{sessionId:session.id,key,spec},'test') as Run;
  for(let i=0;i<1000;i++){const current=store.run(reg,run.id);if(['completed','failed','awaiting_reconciliation'].includes(current.state))return current;await new Promise(resolve=>setTimeout(resolve,5));}throw Error('Original review did not settle');},async close(){await service.close();await rm(directory,{recursive:true,force:true});}};
}
for(const runtime of ['standard','deep']as const)test(`${runtime} graph reviews actual bound pixels privately through configured vision, charges the shared budget and replays without a model or image leak`,async()=>{
 const f=await fixture(runtime);try{
 const before=JSON.stringify(await f.quality());const run=await f.run();assert.equal(run.state,'completed',run.error);assert.equal(f.parent.calls,2);assert.equal(f.vision.calls,1);
 const messages=f.vision.seen[0]!,human=messages.at(-1)!;assert.ok(Array.isArray(human.content));const image=human.content.find(block=>block.type==='image_url') as unknown as {image_url:{url:string}};assert.equal(image.image_url.url,'data:image/png;base64,'+f.data.toString('base64'));
 assert.ok(String(JSON.stringify(human.content)).includes(f.project.contentHash));assert.ok(f.parent.seen[1]!.some(message=>message.getType()==='tool'&&String(message.content).includes('game-visual-opinion')));
 assert.doesNotMatch(JSON.stringify(f.parent.seen),/data:image/);
 const budget=await f.service.dispatch(reg,'inference.budgets.get',{sessionId:f.session.id},'test') as InferenceBudgetSnapshot;assert.equal(budget.budgets[0]!.calls,3);assert.equal(budget.budgets[0]!.reportedInput,30);assert.equal(budget.budgets[0]!.reportedOutput,15);assert.equal(budget.budgets[0]!.pendingCalls,0);assert.equal(budget.budgets.length,2);assert.equal(budget.budgets[1]!.calls,3);
 const receipt=f.store.db.prepare("SELECT value FROM receipts WHERE run=? AND status='completed'").all(run.id) as {value:string}[];assert.ok(receipt.some(row=>row.value.includes('game-visual-opinion')));assert.doesNotMatch(JSON.stringify(receipt),/data:image/);
 const events=await f.service.dispatch(reg,'events.read',{sessionId:f.session.id,cursor:0},'test');assert.doesNotMatch(JSON.stringify(events),new RegExp(f.data.toString('base64')));
 const deltas=(events as {type:string;data:unknown}[]).filter(event=>event.type==='text.delta');assert.doesNotMatch(JSON.stringify(deltas),/MODEL_VISUAL_OPINION/,'private helper must not stream as an assistant answer');
 const replay=await f.run();assert.equal(replay.id,run.id);assert.equal(f.parent.calls,2);assert.equal(f.vision.calls,1);assert.equal(JSON.stringify(await f.quality()),before);
 }finally{await f.close();}
});
test('unconfigured vision never selects an alternate alias or reads/sends an image',async()=>{
 const f=await fixture('standard',{configured:false});try{const run=await f.run();assert.equal(run.state,'completed',run.error);assert.equal(f.vision.calls,0);assert.ok(f.parent.seen[1]!.some(message=>String(message.content).includes('vision model role')));const budget=await f.service.dispatch(reg,'inference.budgets.get',{sessionId:f.session.id},'test') as InferenceBudgetSnapshot;assert.equal(budget.budgets[0]!.calls,2);}finally{await f.close();}
});
test('unknown model result preserves reconciliation and missing usage without retrying the visual invocation',async()=>{
 const f=await fixture('standard',{failure:true});try{const run=await f.run();assert.equal(run.state,'awaiting_reconciliation',run.error);assert.equal(f.vision.calls,1);assert.equal(f.parent.calls,1);
 const budget=await f.service.dispatch(reg,'inference.budgets.get',{sessionId:f.session.id},'test') as InferenceBudgetSnapshot;assert.equal(budget.budgets[0]!.unreportedCalls,1);assert.ok(f.store.db.prepare("SELECT id FROM receipts WHERE run=? AND status='started'").get(run.id));
 assert.equal((await f.service.dispatch({...reg,product:'kidos'},'engine.info',{},'test') as {capabilities:string[]}).capabilities.includes('game-visual-opinion-v1'),false);
 }finally{await f.close();}
});

test('the owner inference ceiling blocks visual admission without a model call, grant or unknown image operation',async()=>{
 const f=await fixture('standard',{limited:true});try{const run=await f.run();assert.equal(f.vision.calls,0);assert.equal(f.parent.calls,1);assert.notEqual(run.state,'awaiting_reconciliation');
 const budget=await f.service.dispatch(reg,'inference.budgets.get',{sessionId:f.session.id},'test') as InferenceBudgetSnapshot;assert.equal(budget.budgets[0]!.calls,1);assert.equal(budget.budgets[0]!.pendingCalls,0);assert.equal(budget.budgets[0]!.blocks,1);assert.equal(f.store.db.prepare("SELECT id FROM receipts WHERE run=? AND status='started'").get(run.id),undefined);
 }finally{await f.close();}
});
test('another profile cannot send a project image to the reviewer, even with valid foreign IDs',async()=>{
 const f=await fixture('standard');try{const foreign={...reg,profile:'other'},session=f.store.createSession(foreign,'Foreign image');const run=await f.service.dispatch(foreign,'runs.start',{sessionId:session.id,key:'foreign',spec:f.spec},'test') as Run;
 for(let i=0;i<1000&&f.store.run(foreign,run.id).state==='running';i++)await new Promise(resolve=>setTimeout(resolve,5));assert.equal(f.store.run(foreign,run.id).state,'completed');assert.equal(f.vision.calls,0);assert.ok(f.parent.seen[1]!.some(message=>String(message.content).includes('not found')));
 }finally{await f.close();}
});

test('visual review uses an immutable report PNG after a later project revision and cannot transfer its opinion into quality',async()=>{
 const f=await fixture('standard',{report:true});try{
 const original=await f.service.dispatch(reg,'games.revisions.get',{projectId:f.project.id,revision:1},'test') as {id:string};const revision=JSON.parse(new Transfers(f.store).bytes(reg,original.id).toString());revision.document.title='Later revision';await f.service.dispatch(reg,'games.revisions.commit',{projectId:f.project.id,requestId:'later',expectedRevision:1,document:revision.document,message:'Preserve later work'},'test');
 const result=await f.run();assert.equal(result.state,'completed',result.error);assert.equal(f.vision.calls,1);const input=JSON.stringify(f.vision.seen[0]);assert.ok(input.includes(f.project.contentHash));assert.ok(input.includes(String(f.args.source.reportId)));assert.equal((await f.quality()).ready,false);assert.equal((await f.service.dispatch(reg,'games.projects.get',{id:f.project.id},'test') as GameProject).revision,2);
 }finally{await f.close();}
});
