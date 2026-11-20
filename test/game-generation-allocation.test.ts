import test from 'node:test';
import assert from 'node:assert/strict';
import {additionalGenerationPlan,additionalGenerationApproval,originalGenerationPolicy,readAdditionalGenerationAllocation} from './game-generation-allocation';
import {Store} from '../packages/agent-service/src/store';
import {InferenceBudgets} from '../packages/agent-service/src/inference-budgets';
import {runSpec,type Registration} from '../packages/contracts/src/index';
import type {InferenceBudget} from '../packages/contracts/src/inference-budget';
import {randomUUID,createHash} from 'node:crypto';
import {mkdir,writeFile,rm,chmod} from 'node:fs/promises';
import path from 'node:path';
import {createGenerationState} from './game-generation-state';

test('one explicitly renewed evaluation block never reclaims old usage or adds unused old allowance to the new ceiling',()=>{
  const plan=additionalGenerationPlan({calls:75,chargedTokens:4143367,pendingCalls:0,blocks:1});
  assert.equal(plan.additionalCalls,127);assert.equal(plan.additionalTokens,4194303);assert.equal(plan.policy.namespace.maxBlocks,2);
  assert.deepEqual(plan.baseline,{calls:75,chargedTokens:4143367,pendingCalls:0,blocks:1});
  for(let calls=0;calls<=128;calls++){
    const p=additionalGenerationPlan({calls,chargedTokens:4194304,pendingCalls:0,blocks:1});
    assert.ok(p.additionalCalls<=128&&p.additionalCalls>=127);assert.ok(p.additionalTokens<=4194304);
  }
  for(const input of [{calls:1,chargedTokens:1,pendingCalls:0,blocks:1},{calls:75,chargedTokens:4143367,pendingCalls:1,blocks:1},{calls:75,chargedTokens:4143367,pendingCalls:0,blocks:2},{calls:129,chargedTokens:4194304,pendingCalls:0,blocks:1}])assert.throws(()=>additionalGenerationPlan(input));
});
test('only exact current exhausted scope grants under the second-block owner ceiling may be confirmed',()=>{
  const {policy}=additionalGenerationPlan({calls:75,chargedTokens:4143367,pendingCalls:0,blocks:1});
  const liveBudgets:InferenceBudget[]=[{scope:{kind:'namespace'},version:151,blocks:1,policy:policy.namespace,reservedTokensPerCall:65536,calls:75,chargedTokens:4143367,reportedInput:3994252,reportedOutput:18043,unreportedCalls:2,pendingCalls:0,authorizedCalls:101,authorizedTokens:4168835,exhausted:true,canContinue:true}],scope={runId:'run',policy,liveBudgets,projectIds:['project']};
  const request={runId:'run',kind:'approval',payload:{tool:'inference_budget',risk:'standard',budget:{budgets:liveBudgets}}};
  assert.equal(additionalGenerationApproval(request,scope),true);
  const sized=liveBudgets.map(b=>({...b,nextReservationTokens:200000}));
  assert.equal(additionalGenerationApproval({...request,payload:{...request.payload,budget:{budgets:sized}}},scope),true,'Authenticated live counters can verify a request-size-specific decision');
  assert.equal(additionalGenerationApproval({...request,payload:{...request.payload,budget:{budgets:[null]}}},scope),false);
  const otherStage:InferenceBudget={...liveBudgets[0]!,scope:{kind:'game-stage',projectId:'other',workflowId:'workflow',stage:'core'},policy:policy.stage};
  assert.equal(additionalGenerationApproval({...request,payload:{...request.payload,budget:{budgets:[otherStage]}}},{...scope,liveBudgets:[otherStage]}),false);
  for(const other of [{...request,runId:'other'},{...request,kind:'tool'},{...request,payload:{...request.payload,tool:'shell'}},{...request,payload:{...request.payload,budget:{budgets:[]}}}])assert.equal(additionalGenerationApproval(other,scope),false);
  for(const row of [{...liveBudgets[0]!,blocks:2},{...liveBudgets[0]!,exhausted:false},{...liveBudgets[0]!,scope:{kind:'namespace' as const},policy:policy.stage}]){
    const changed=[row];assert.equal(additionalGenerationApproval({...request,payload:{...request.payload,budget:{budgets:changed}}},{...scope,liveBudgets:changed}),false);
  }
});
test('the real persistent meter preserves75 old calls/two unknown reservations and refuses any third grant after the bounded additional allocation',()=>{
  const reg:Registration={id:'allocation-fixture',product:'companion-vscode',profile:'synthetic',workspace:'',providers:['ollama'],hostTools:[]};
  for(const missingUsage of [false,true]){
    const store=new Store(':memory:');
    try{
      const session=store.createSession(reg,'Synthetic owner allocation'),spec=runSpec.parse({runtime:'standard',mode:'plan',provider:{kind:'ollama',endpoint:'http://127.0.0.1:11434/v1',roles:{executor:'fixture'}},messages:[{role:'user',content:'No actual inference'}],systemPrompt:'Synthetic',tools:[]});
      const run=store.start(reg,session.id,'allocation',spec).run,scopes=[{kind:'namespace' as const}],old=new InferenceBudgets(store,originalGenerationPolicy);
      for(let i=0;i<75;i++){
        assert.equal(old.begin(reg,run.id,'old-'+i,scopes),null);
        old.finish(reg,run.id,'old-'+i,i<73?{input:i===72?54959:54963,output:0}:undefined);
      }
      const before=old.snapshot(reg,scopes).budgets[0]!;assert.equal(before.chargedTokens,4143367);assert.equal(before.unreportedCalls,2);
      const plan=additionalGenerationPlan({calls:before.calls,chargedTokens:before.chargedTokens,pendingCalls:before.pendingCalls,blocks:before.blocks});
      const meter=new InferenceBudgets(store,plan.policy),blocked=meter.begin(reg,run.id,'first-new',scopes)!;
      assert.ok(blocked);meter.grant(reg,'explicit-owner-grant',blocked);meter.grant(reg,'explicit-owner-grant',blocked);
      let admitted=0;
      for(let i=0;i<129;i++){
        const rejected=meter.begin(reg,run.id,'new-'+i,scopes);if(rejected)break;
        admitted++;meter.finish(reg,run.id,'new-'+i,missingUsage?undefined:{input:1,output:0});
      }
      const after=meter.snapshot(reg,scopes).budgets[0]!;
      assert.equal(admitted,missingUsage?63:127);assert.equal(after.calls,75+admitted);assert.equal(after.blocks,2);assert.equal(after.pendingCalls,0);
      assert.equal(after.unreportedCalls,2+(missingUsage?63:0));assert.equal(after.canContinue,false);assert.equal(after.exhausted,true);
      assert.ok(after.chargedTokens-before.chargedTokens<=4194304);
      assert.throws(()=>meter.grant(reg,'unauthorized-third',meter.snapshot(reg,scopes)),/does not allow another block/);
    }finally{store.close();}
  }
});
test('additional admission needs exact public/private owner proof, completed preparation and policy bytes; it cannot change the original run', {skip:process.platform==='win32'},async()=>{
  const state=await createGenerationState(),root=path.resolve('output/game-generation','allocation-test-'+randomUUID()),previous=path.join(root,'previous'),folder=path.join(root,'allocation');
  try{
    await mkdir(previous,{recursive:true});await mkdir(folder);
    const previousRunId=randomUUID(),sessionId=randomUUID(),plan=additionalGenerationPlan({calls:75,chargedTokens:4143367,pendingCalls:0,blocks:1}),bytes=JSON.stringify({schemaVersion:1,policy:plan.policy}),hash=(raw:string)=>createHash('sha256').update(raw).digest('hex');
    await writeFile(path.join(previous,'control.json'),JSON.stringify({stateDirectory:state,runId:previousRunId,sessionId}));
    await writeFile(path.join(state,'inference-limits.json'),bytes,{mode:0o600});
    const record={schemaVersion:1,kind:'generation-additional-block',authorizationId:randomUUID(),provider:'openai',model:'gpt-6-luna',previousAttempt:previous,stateDirectory:state,previousRunId,sessionId,baseline:plan.baseline,plan,
      policyBeforeSha256:'a'.repeat(64),policyAfterSha256:hash(bytes),authorizationReference:'Synthetic user authorization only; no inference',recordedAt:Date.now()},raw=JSON.stringify(record);
    await writeFile(path.join(folder,'authorization.json'),raw);await writeFile(path.join(state,'generation-additional-allocation.json'),raw,{mode:0o600});
    await assert.rejects(readAdditionalGenerationAllocation(folder,previous),/ENOENT/,'An intent alone cannot start inference');
    const prepared={authorizationSha256:hash(raw),ownerPolicyPrepared:true,newBudgetGrants:0,newProviderCalls:0,oldLedgerUnchanged:true,newCallsAvailableAfterExactGrant:plan.additionalCalls,newTokensAvailableAfterExactGrant:plan.additionalTokens,maximumUserAuthorizedCalls:128,maximumUserAuthorizedTokens:4194304,automaticRenewal:false};
    await writeFile(path.join(folder,'prepared.json'),JSON.stringify(prepared));assert.deepEqual((await readAdditionalGenerationAllocation(folder,previous)).plan,plan);
    await chmod(path.join(state,'generation-additional-allocation.json'),0o644);await assert.rejects(readAdditionalGenerationAllocation(folder,previous));await chmod(path.join(state,'generation-additional-allocation.json'),0o600);
    await writeFile(path.join(folder,'authorization.json'),JSON.stringify({...record,previousRunId:randomUUID()}));await assert.rejects(readAdditionalGenerationAllocation(folder,previous));
    await writeFile(path.join(folder,'authorization.json'),raw);await writeFile(path.join(state,'inference-limits.json'),bytes+'\n');await assert.rejects(readAdditionalGenerationAllocation(folder,previous),/policy bytes/);
  }finally{await rm(state,{recursive:true,force:true});await rm(root,{recursive:true,force:true});}
});
