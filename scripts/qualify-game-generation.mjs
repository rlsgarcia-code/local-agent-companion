// Opt-in real-model development evaluation. This is an SDK client/observer,
// never an agent/tool loop, source generator, installer or acceptance authority.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile,copyFile,cp,open,appendFile} from 'node:fs/promises';
import path from 'node:path';
import security from '../dist-tests/packages/agent-service/src/security.js';
import storage from '../dist-tests/packages/agent-service/src/store.js';
import sdk from '../dist-tests/packages/client-ts/src/index.js';
import bootstrap from '../dist-tests/packages/client-ts/src/bootstrap.js';
import exports from '../dist-tests/packages/client-ts/src/game-export.js';
import policy from '../dist-tests/test/game-generation-policy.js';
import continuation from '../dist-tests/test/game-generation-continuation.js';
import contextWindows from '../dist-tests/packages/contracts/src/model-context.js';
import generationState from '../dist-tests/test/game-generation-state.js';
import providerHelpers from '../dist-tests/test/game-generation-provider.js';
import recoveryAdmission from '../dist-tests/test/game-generation-recovery.js';
import allocation from '../dist-tests/test/game-generation-allocation.js';

const arg=name=>process.argv.find(value=>value.startsWith(`--${name}=`))?.slice(name.length+3);
const providerSelection=providerHelpers.generationProviderSelection(arg('ollama-model'),arg('openai-model'));
const {model,kind:provider}=providerSelection,caseId=arg('case'),runtime=arg('runtime')??'standard';
const roles={executor:model,planner:arg('planner-model')??model,evaluator:arg('evaluator-model')??model};
// Explicit metadata only. The driver neither discovers nor changes a server's
// window; the operator must verify the effective value for every selected alias.
const contextWindow=contextWindows.parseOptionalModelContextWindow(arg('context-window'));
const reasoningEffort=arg('reasoning-effort');
if(reasoningEffort)assert.ok(provider==='openai'&&['none','minimal','low','medium','high','xhigh','max'].includes(reasoningEffort),'Explicit OpenAI reasoning effort required; no provider default is changed.');
const modelProfiles=contextWindow===undefined&&!reasoningEffort?undefined:Object.fromEntries([...new Set(Object.values(roles))].map(alias=>[alias,{...(contextWindow===undefined?{}:{contextWindow}),...(reasoningEffort?{reasoningEffort}:{})}]));
const maxRejections=Number(arg('max-schema-rejections')??4);
if(!Object.values(roles).every(value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(value))||!caseId||!['standard','deep'].includes(runtime))
  throw Error('Explicit --case=<id> --ollama-model=<already-installed-name> OR --openai-model=<explicit-alias> [--planner-model=<name>] [--evaluator-model=<name>] [--runtime=standard|deep] required. No model is downloaded.');
assert.ok(Number.isInteger(maxRejections)&&maxRejections>=1&&maxRejections<=1000,'Invalid explicit development rejection budget');
const suiteBytes=await readFile('test/game-generation-cases.json'),suite=JSON.parse(suiteBytes),selected=suite.cases.find(row=>row.id===caseId);
assert.ok(selected,'Unknown case');assert.equal(suite.schemaVersion,1);
const suiteHash=createHash('sha256').update(suiteBytes).digest('hex');
const previousPath=arg('continue-attempt'),recoveryPath=arg('prepared-recovery'),feedbackFile=arg('feedback-file');
const additionalPath=arg('additional-allocation');
if(additionalPath)assert.ok(previousPath&&!recoveryPath&&provider==='openai'&&model==='gpt-6-luna','An additional owner allocation is only for this explicit Luna continuation.');
assert.ok(!(previousPath&&recoveryPath),'Choose original continuation OR explicit domain recovery, never both.');
assert.equal(Boolean(previousPath||recoveryPath),Boolean(feedbackFile),'Continuation/recovery requires bounded explicit feedback.');
if(recoveryPath)assert.ok(process.argv.includes('--authorized-recovery-block'),'A new recovery evaluation requires explicit operator authorization; preparation alone authorizes no inference.');
if(provider==='openai')assert.ok(recoveryPath||previousPath,'OpenAI qualification currently requires an explicit prepared provider-bound recovery.');
const apiKey=provider==='openai'?process.env.OPENAI_API_KEY:undefined;
if(provider==='openai')assert.ok(apiKey?.trim(),'OpenAI credential unavailable in process environment; no service or inference started. Never put a credential in CLI arguments.');
const additional=additionalPath?await allocation.readAdditionalGenerationAllocation(additionalPath,previousPath):null;
const previous=previousPath?await continuation.originalGenerationContinuation(previousPath,suiteHash,selected,provider,additional?.plan.policy):null;
const recovery=recoveryPath?await recoveryAdmission.preparedGenerationRecovery(recoveryPath,selected,provider):null,existing=previous??recovery;
const feedback=feedbackFile?await readFile(feedbackFile,'utf8'):null;
if(existing)assert.ok(feedback?.trim()&&Buffer.byteLength(feedback)<=8192,'Explicit bounded continuation feedback required.');
const engineSource=recovery?.engine??path.resolve(arg('engine')??'engine-dist');await bootstrap.verifyBundle(engineSource,undefined,true);
const sourceManifest=await readFile(path.join(engineSource,'manifest.json'));
const output=path.resolve('output/game-generation',caseId,`${new Date().toISOString().replace(/[:.]/g,'-')}-${randomUUID().slice(0,8)}`);
await mkdir(output,{recursive:true});
const state=existing?.state??await generationState.createGenerationState(),workspace=existing?.workspace??path.join(state,'workspace');
if(!existing)await mkdir(workspace,{mode:0o700});
// Bind this process to a verified private copy: later development builds cannot
// replace its modules while it is running. A partial/mixed copy fails verification.
const engine=path.join(state,existing?`engine-${createHash('sha256').update(sourceManifest).digest('hex')}-${randomUUID()}`:'engine');
await cp(engineSource,engine,{recursive:true,errorOnExist:true,force:false});
await bootstrap.verifyBundle(engine,undefined,true);
const manifest=await readFile(path.join(engine,'manifest.json'));assert.ok(manifest.equals(sourceManifest),'Engine changed during freezing; no service was started.');
const engineHash=createHash('sha256').update(manifest).digest('hex');
const registration=existing?.credential.registration??{id:`generation-${randomUUID()}`,product:'companion-vscode',profile:'unseen-game-development',workspace,providers:['ollama'],hostTools:[]};
const identity=existing?{cert:await readFile(path.join(state,'server.crt'),'utf8')}:await security.ensureIdentity(state);
const credential=existing?.credential??await security.createClientCredential(state,registration);
// Retain the existing credential only inside this private durable bootstrap.
// Without it, a later read-only inspector could not reconnect to the same run.
if(!existing){
  await writeFile(path.join(state,'inspection-credential.json'),JSON.stringify(credential),{mode:0o600,flag:'wx'});
  const store=new storage.Store(path.join(state,'metadata.sqlite'));store.register(credential);store.close();
}
if(!existing&&selected.engine==='godot'){
  await mkdir(path.join(state,'toolchains'),{mode:0o700});
  // An explicit existing provision only; no editor discovery/download/install.
  await copyFile(path.resolve('.cache/game-toolchains/godot.json'),path.join(state,'toolchains/godot.json'));
}
const log=await open(path.join(output,'service.log'),'a',0o600);
const child=spawn(path.join(engine,process.platform==='win32'?'node.exe':'node'),[path.join(engine,'service.cjs'),state],{stdio:['ignore',log.fd,log.fd],env:providerHelpers.generationServiceEnvironment(process.env)});
await log.close();
let client,run,session,settled=false,productionPending=Boolean(existing),cursor=0,writes=Promise.resolve(),lastState='starting',deltaBytes=0,events=0,cancelForRejections;
const rejectedCalls=new Set();
const tick=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const save=(name,value)=>writeFile(path.join(output,name),JSON.stringify(value,null,2)+'\n');
const record={schemaVersion:1,stateDirectory:state,servicePid:child.pid,registrationId:registration.id,case:selected,runtime,provider,model,roles,contextWindow,reasoningEffort,engineManifestSha256:engineHash,
  suiteSha256:suiteHash,scope:'Private authenticated development editor-profile API; new evaluations use durable state. No editor host, prepared game source or fixture supplied. Not installed UI/human/physical acceptance.'};
record.sourceProvided=Boolean(recovery||previous?.sourceProvided);
if(additional)record.additionalAllocation={path:additional.folder,authorizationId:additional.record.authorizationId,baseline:additional.plan.baseline,
  maximumNewCalls:additional.plan.additionalCalls,maximumNewTokens:additional.plan.additionalTokens,automaticRenewal:false,oldLedgerReset:false};
record.evaluationKind=recovery?'recovery-from-domain-export':previous?'continuation':'initial';
if(recovery){record.recovery={preparation:recovery.preparation,originalProject:recovery.control.originalProject,project:recovery.project,archiveSha256:recovery.control.archiveSha256,ceiling:recovery.ceiling,legacyResult:'unknown',legacyBudget:'unknown',operatorAuthorizedNewBlock:true};record.scope='Explicit prepared domain recovery with preserved model-authored source, not an unseen generation, checkpoint import or result of the unknown original run. No installed UI/human/physical acceptance.';}
if(previous)record.continuation={attempt:previous.attempt,runId:previous.control.runId,sessionId:previous.control.sessionId,
  engineManifestSha256:previous.control.engineManifestSha256,projects:previous.projects,feedbackSha256:createHash('sha256').update(feedback).digest('hex')};
if(previous)Object.assign(record,{sessionId:previous.control.sessionId,runId:previous.control.runId});
record.stopAfterRejectedToolCalls=maxRejections;
record.engineDirectory=engine;
record.harnessSha256=createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex');
record.approvalPolicySha256=createHash('sha256').update(await readFile('dist-tests/test/game-generation-policy.js')).digest('hex');
await save('control.json',record);
const heartbeat=setInterval(()=>console.log(`GENERATION_OBSERVING case=${caseId} state=${lastState} publicEvents=${events} textBytes=${deltaBytes} output=${output}`),10000);
async function allProjects(){const rows=[];let cursor=0;while(true){const page=await client.listGameProjects(cursor,30);rows.push(...page.projects);if(!page.hasMore)return rows;cursor=page.cursor;}}
async function allJobs(projectId){const rows=[];let cursor=0;while(true){const page=await client.listGameProduction(projectId,cursor,30);rows.push(...page.jobs);if(!page.hasMore)return rows;cursor=page.cursor;}}
async function approval(request){
  const projects=await allProjects(),jobs=[];
  for(const project of projects)jobs.push(...await allJobs(project.id));
  let approved=policy.generationApproval(request,{runId:run.id,engine:selected.engine,projects,jobs});
  if(additional&&request.payload?.tool==='inference_budget'){
    const live=await client.getInferenceBudgets(session.id);
    approved=allocation.additionalGenerationApproval(request,{runId:run.id,policy:additional.plan.policy,
      liveBudgets:live.budgets,projectIds:projects.map(p=>p.id)});
  }
  await appendFile(path.join(output,'approvals.jsonl'),JSON.stringify({id:request.id,runId:request.runId,kind:request.kind,payload:request.payload,approved})+'\n');
  console.log(`GENERATION_APPROVAL tool=${request.payload?.tool??request.kind} approved=${approved}`);
  return approved;
}
async function observeJob(jobId){
  for(let i=0;i<6000;i++){
    const job=await client.getGameProduction(jobId);
    if(!['queued','running','cancelling'].includes(job.state))return job;
    await tick(100);
  }
  productionPending=true;
  throw Error(`Observation window ended; inspect ORIGINAL ${jobId} in ${state}; no second job is permitted merely for this timeout.`);
}
async function reports(buildId){
  const result=await client.getGameReports(buildId);
  for(const report of result)for(const file of report.evidence??[]){
    const destination=path.join(output,'reports',report.id,file.path);await mkdir(path.dirname(destination),{recursive:true});
    await writeFile(destination,await client.downloadGameReportFile(report.id,file.path));
  }
  return result;
}
try{
  let ready=false;
  for(let i=0;i<600;i++){
    if(child.exitCode!==null)throw Error('The packaged engine exited; inspect service.log');
    try{if(JSON.parse(await readFile(path.join(state,'runtime.json'),'utf8')).pid===child.pid){ready=true;break;}}catch{}
    await tick(50);
  }
  assert.ok(ready,'Packaged service not ready; do not start a second service on observation timeout.');
  client=new sdk.AgentClient({address:security.ipcPath(state),certificate:identity.cert,credential});await client.connect();
  const engineInfo=await client.call('engine.info');await save('engine.json',engineInfo);
  if(contextWindow!==undefined)assert.ok(engineInfo.capabilities.includes('model-context-window-v1'),'The selected engine cannot honor an explicit context-window declaration.');
  if(previous){
    const original=await client.call('runs.get',{id:previous.control.runId});
    assert.equal(original.sessionId,previous.control.sessionId);assert.ok(['completed','failed','cancelled'].includes(original.state),'Original run is not terminal.');
    session=await client.call('sessions.get',{id:previous.control.sessionId});
    const active=await client.call('runs.list',{sessionId:session.id});assert.ok(active.every(row=>['completed','failed','cancelled'].includes(row.state)),'Inspect existing session execution before continuation.');
    for(const originalProject of previous.projects){
      const snapshot=await client.snapshotGameProject(originalProject.id);
      assert.equal(snapshot.project.revision,originalProject.revision);assert.equal(snapshot.project.contentHash,originalProject.contentHash,'Project changed since original observation.');
      assert.ok((await allJobs(originalProject.id)).every(job=>['completed','failed','cancelled'].includes(job.state)),'Inspect pending or unknown production before continuation.');
    }
    const linked=await client.linkedGameProject(session.id);assert.ok(linked&&previous.projects.some(row=>row.id===linked.id),'Original session project link changed.');
    const budgets=await client.getInferenceBudgets(session.id);
    if(provider==='openai')for(const budget of budgets.budgets){
      const expected=additional?(budget.scope.kind==='namespace'?additional.plan.policy.namespace:additional.plan.policy.stage):allocation.originalGenerationPolicy.namespace;
      assert.equal(budget.authorizedCalls,expected.callsPerBlock);assert.equal(budget.authorizedTokens,expected.tokensPerBlock);assert.equal(budget.policy.maxBlocks,expected.maxBlocks);assert.equal(budget.pendingCalls,0);
      if(additional&&budget.scope.kind==='namespace'){assert.equal(budget.calls,additional.plan.baseline.calls);assert.equal(budget.chargedTokens,additional.plan.baseline.chargedTokens);assert.equal(budget.blocks,1);}
    }
    await save('continuation-baseline.json',{originalRun:original,project:linked,budgets,projects:previous.projects});
  }else if(recovery){
    assert.ok(engineInfo.capabilities.includes('owner-inference-limits-v1'));
    session=await client.call('sessions.get',{id:recovery.control.sessionId});
    assert.deepEqual(await client.call('runs.list',{sessionId:session.id}),[],'This prepared session was already used; inspect its original run instead of starting another.');
    const snapshot=await client.snapshotGameProject(recovery.project.id);
    assert.equal(snapshot.project.revision,recovery.project.revision);assert.equal(snapshot.project.contentHash,recovery.project.contentHash);
    assert.equal((await client.linkedGameProject(session.id))?.id,recovery.project.id);
    const baseline=await client.getGameProduction(recovery.baseline.artifact.jobId);assert.equal(baseline.state,'completed');assert.equal(baseline.sourceHash,recovery.project.contentHash);
    assert.ok((await allJobs(recovery.project.id)).every(job=>['completed','failed','cancelled'].includes(job.state)));
    const budgets=await client.getInferenceBudgets(session.id);for(const budget of budgets.budgets){assert.equal(budget.calls,0);assert.equal(budget.pendingCalls,0);assert.equal(budget.authorizedCalls,128);assert.equal(budget.authorizedTokens,4194304);assert.equal(budget.policy.maxBlocks,1);}
    await save('recovery-baseline.json',{preparation:recovery.preparation,project:snapshot.project,budgets,sourceProvided:true,legacyCheckpointImported:false});
  }else session=await client.call('sessions.create',{title:`Unseen game: ${selected.id}`});
  const assistantMessageId=randomUUID();
  if(apiKey)await client.call('credentials.lease',{reference:'generation-openai',value:apiKey});
  const spec={runtime,mode:'execute',provider:providerHelpers.generationProviderSpec(providerSelection,roles,modelProfiles),
    messages:[{role:'user',content:selected.request}],systemPrompt:'Você é o Local Agent Companion. Execute o pedido com as capacidades realmente disponíveis e preserve o trabalho e as evidências. Não substitua implementação por instruções. Não invente resultados, imagens, testes, licenças ou aceite humano. Não há ferramentas de host registradas neste ambiente; use o projeto autenticado pelo serviço. Não há autorização para rede externa ou instalação de pacotes.',
    tools:[],recursionLimit:240,workspace:{threadId:session.id,assistantMessageId,responseLanguage:'pt-BR',maxConversationCharacters:48000,finalReview:'changes',memoryText:''}};
  if(existing)spec.messages.push({role:'user',content:feedback});
  await save('input.json',{case:selected,suiteSha256:record.suiteSha256,spec,stopAfterRejectedToolCalls:maxRejections,sourceProvided:record.sourceProvided,referenceGamesProvided:false,
    evaluationKind:record.evaluationKind,continuation:record.continuation,recovery:record.recovery});
  run=await client.startRun(session.id,recovery?`recover-${recovery.control.archiveSha256}`:previous?`continue-${previous.control.runId}`:`unseen-${selected.id}`,spec);
  productionPending=true; // Unknown until every project/job is inspected below.
  Object.assign(record,{sessionId:session.id,runId:run.id});await save('control.json',record);
  const observation=new AbortController();
  run=await client.waitForRun(run.id,session.id,event=>{
    events++;
    if(event.type==='text.delta'){deltaBytes+=Buffer.byteLength(String(event.data?.text??''));return;}
    writes=writes.then(()=>appendFile(path.join(output,'events.jsonl'),JSON.stringify(event)+'\n'));
    if(event.type==='game.activity')console.log(`GENERATION_TOOL ${event.data?.tool??'unknown'}`);
    if(event.type==='game.tool_rejected'&&event.data?.rejectedBeforeDispatch===true){
      rejectedCalls.add(event.data.callId);
      console.log(`GENERATION_ARGUMENT_REJECTION tool=${event.data.tool} count=${rejectedCalls.size}`);
      if(rejectedCalls.size>=maxRejections&&!cancelForRejections){
        cancelForRejections=(async()=>{
          await save('benchmark-stop.json',{reason:'Predeclared development budget of canonical pre-dispatch tool rejections reached; not an observation timeout.',maxRejections,rejectedCalls:[...rejectedCalls],runId:run.id});
          return client.call('runs.cancel',{id:run.id});
        })();
        cancelForRejections.catch(error=>{console.error(`Original cancellation acknowledgement requires inspection: ${error.message}`);});
      }
    }
  },approval,observation.signal,{onCursor:value=>{cursor=value;},onState:value=>{
    lastState=value;
    if(value==='awaiting_reconciliation')observation.abort(new Error('Original run awaits reconciliation; preserve it without retry.'));
  }});
  settled=true;await writes;await cancelForRejections;await save('run.json',run);
  const projects=await allProjects(),summaries=[];
  for(const project of projects){
    const directory=path.join(output,'projects',project.id);await mkdir(directory,{recursive:true});
    const snapshot=await client.snapshotGameProject(project.id);
    await writeFile(path.join(directory,'snapshot.json'),JSON.stringify(snapshot,null,2));
    const documentState={hasDesign:snapshot.revision.document.design!==null,fileCount:snapshot.revision.document.files.length,assetCount:snapshot.revision.document.assets.length};
    const sourceParent=path.join(directory,'editable');await mkdir(sourceParent,{recursive:true});
    const source=await exports.exportGameDirectory({client,parent:sourceParent,source:{projectId:project.id,revision:project.revision}});
    const initialJobs=await allJobs(project.id);
    for(const job of initialJobs)if(['queued','running','cancelling'].includes(job.state))await observeJob(job.id);
    const jobs=await allJobs(project.id);productionPending ||= jobs.some(job=>!['completed','failed','cancelled'].includes(job.state));
    const builds=[];
    for(const job of jobs.filter(job=>job.kind==='build'&&job.state==='completed')){
      const artifact=await client.getGameArtifact(job.id);
      for(const file of artifact.files){const destination=path.join(directory,'builds',job.id,file.path);await mkdir(path.dirname(destination),{recursive:true});await writeFile(destination,await client.downloadGameArtifactFile(job.id,file.path));}
      let collected=await reports(job.id),hostObservation=null;
      // Independent QA is explicitly attributed to the harness. Never credit a
      // missed model validation as an autonomous action or overwrite a failure.
      if(job.sourceHash===project.contentHash&&project.engine===selected.engine&&collected.length===0){
        const beforeJobs=await allJobs(project.id);
        try {
          const validation=await client.startGameValidation(`observer-${job.id}`,job.id,'web-browser-runtime-v1');
          hostObservation=await observeJob(validation.id);collected=await reports(job.id);
        } catch(error) {
          // A canonical recipe rejection is a negative observation, not a lost
          // run result. Unknown/transport/effect errors still preserve ownership.
          const afterJobs=await allJobs(project.id);
          if(error?.code!==-32602||JSON.stringify(afterJobs)!==JSON.stringify(beforeJobs))throw error;
          hostObservation={state:'rejected-before-admission',code:error.code,message:String(error.message).slice(0,2000)};
        }
      }
      builds.push({job,artifact,reports:collected,hostObservation});
    }
    const quality=await client.getGameQuality(project.id);
    summaries.push({project,documentState,source,jobs:await allJobs(project.id),builds,quality});
  }
  const current=summaries.flatMap(row=>row.builds.filter(build=>build.job.sourceHash===row.project.contentHash&&row.project.engine===selected.engine));
  productionPending=summaries.some(row=>row.jobs.some(job=>!['completed','failed','cancelled'].includes(job.state)));
  const observed=current.some(build=>build.reports.length>0&&build.reports.every(report=>report.checks.every(check=>check.status==='passed')));
  const runtimeOutcome=observed?'runtime-observed-not-accepted':current.some(build=>build.reports.some(report=>report.checks.some(check=>check.status==='failed')))?'runtime-observed-failed':current.some(build=>build.reports.length>0)?'runtime-observed-incomplete':null;
  await save('report.json',{schemaVersion:1,evaluationKind:record.evaluationKind,continuation:record.continuation,recovery:record.recovery,case:selected,suiteSha256:record.suiteSha256,runtime,provider,model,roles,contextWindow,reasoningEffort,engineManifestSha256:engineHash,runId:run.id,runState:run.state,completionOutcome:run.result?.completionOutcome,
    outcome:runtimeOutcome??(current.length?'built-not-observed':summaries.some(row=>row.documentState.fileCount>0)?'source-only':summaries.some(row=>row.documentState.hasDesign)?'design-only':projects.length?'draft-only':'no-project-produced'),projects:summaries,
    deltaBytes,events,cursor,rejectedToolCalls:rejectedCalls.size,stopAfterRejectedToolCalls:maxRejections,sourceProvided:record.sourceProvided,referenceGamesProvided:false,fullProductAcceptance:false,
    limits:'Actual configured provider/graph/tool calls and independent browser observations only. No artistic, physical, human, installed-client or complete generalization acceptance.'});
  console.log(`GENERATION_RECORDED observed=${observed} projects=${projects.length} currentBuilds=${current.length} output=${output}`);
  if(!observed)process.exitCode=1;
}catch(error){
  await writes;await save('observation-error.json',{message:String(error.message??error),runId:run?.id,sessionId:session?.id,cursor,servicePid:child.pid,state:lastState});
  console.error(`GENERATION_OBSERVATION_STOPPED ${String(error.message??error)}; inspect ORIGINAL run/service in ${state}; output=${output}`);process.exitCode=1;
}finally{
  clearInterval(heartbeat);client?.close();
  if((!run||settled)&&!productionPending&&child.exitCode===null){const exited=once(child,'exit');child.kill('SIGTERM');await exited;}
  else if(child.exitCode===null){child.unref();console.error(`Original service preserved alive: pid=${child.pid} state=${state}`);}
  // Private state is retained for audit/recovery and never copied into evidence.
}
