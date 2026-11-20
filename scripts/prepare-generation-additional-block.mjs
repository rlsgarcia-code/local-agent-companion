// Explicit owner provisioning of a single already-authorized additional block.
// No credential read, provider, service, graph, registration or ledger write.
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFile,writeFile,mkdir,lstat,rename,open,realpath} from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';
import allocation from '../dist-tests/test/game-generation-allocation.js';
import limits from '../dist-tests/packages/agent-service/src/inference-limits.js';
import generation from '../dist-tests/test/game-generation-state.js';
import security from '../dist-tests/packages/agent-service/src/security.js';
assert.equal(process.versions.node,'22.23.4');assert.equal(process.argv.length,5);assert.ok(process.argv.includes('--authorized-additional-block'));
const option=name=>{const value=process.argv.find(a=>a.startsWith(name+'='));assert.ok(value);return path.resolve(value.slice(name.length+1));};
const attempt=await realpath(option('--attempt')),output=option('--output'),publicRoot=await realpath('output/game-generation');
assert.ok(attempt.startsWith(publicRoot+path.sep)&&output.startsWith(publicRoot+path.sep));
const control=JSON.parse(await readFile(path.join(attempt,'control.json'))),run=JSON.parse(await readFile(path.join(attempt,'run.json')));
assert.equal(control.provider,'openai');assert.equal(control.model,'gpt-6-luna');assert.equal(control.runId,run.id);assert.equal(run.state,'failed');
const state=await generation.assertGenerationStateDirectory(control.stateDirectory);
let latestPid;try{latestPid=JSON.parse(await readFile(path.join(state,'runtime.json'),'utf8')).pid;assert.ok(Number.isSafeInteger(latestPid)&&latestPid>0);}catch(e){if(e.code!=='ENOENT')throw e;}
for(const pid of new Set([control.servicePid,...(latestPid?[latestPid]:[])]))try{process.kill(pid,0);throw Error('Original/latest PID is live or reused; inspect without restarting.');}catch(e){if(e.code!=='ESRCH')throw e;}
try{await lstat(security.ipcPath(state));throw Error('Original endpoint exists; inspect without replacing it.');}catch(e){if(e.code!=='ENOENT')throw e;}
assert.deepEqual(await limits.readOwnerInferenceLimits(state),allocation.originalGenerationPolicy);
const file=path.join(state,'inference-limits.json'),beforeInfo=await lstat(file),before=await readFile(file),proof=path.join(state,'generation-additional-allocation.json');
try{await lstat(proof);throw Error('An additional allocation already exists; inspect it without preparing another.');}catch(e){if(e.code!=='ENOENT')throw e;}
const db=new Database(path.join(state,'metadata.sqlite'),{readonly:true,fileMustExist:true});
try{
  const original=db.prepare('SELECT namespace,state,session FROM runs WHERE id=?').get(control.runId);
  assert.equal(original.state,'failed');assert.equal(original.session,control.sessionId);
  assert.equal(db.prepare("SELECT count(*) AS n FROM runs WHERE namespace=? AND state NOT IN ('completed','failed','cancelled')").get(original.namespace).n,0);
  assert.equal(db.prepare("SELECT count(*) AS n FROM game_production_jobs WHERE namespace=? AND state NOT IN ('completed','failed','cancelled')").get(original.namespace).n,0);
  const rows=db.prepare('SELECT id,value FROM inference_budgets WHERE namespace=? ORDER BY id').all(original.namespace),values=rows.map(row=>JSON.parse(row.value));
  assert.ok(values.length&&values.every(b=>b.pendingCalls===0&&b.blocks===1));
  const namespace=values.find(b=>b.scope.kind==='namespace');assert.ok(namespace);
  const baseline={calls:namespace.calls,chargedTokens:namespace.chargedTokens,pendingCalls:0,blocks:1},plan=allocation.additionalGenerationPlan(baseline);
  const after=Buffer.from(JSON.stringify({schemaVersion:1,policy:plan.policy},null,2)+'\n'),sha=b=>createHash('sha256').update(b).digest('hex');
  const record={schemaVersion:1,kind:'generation-additional-block',authorizationId:randomUUID(),provider:'openai',model:'gpt-6-luna',previousAttempt:attempt,stateDirectory:state,
    previousRunId:control.runId,sessionId:control.sessionId,baseline,plan,policyBeforeSha256:sha(before),policyAfterSha256:sha(after),authorizationReference:'User reply to call_d0816a9c4f7f412cbb3f7f07ad58208d: authorize one additional128-call/4194304-token block, no automatic renewal',recordedAt:Date.now()};
  await mkdir(output);const raw=JSON.stringify(record,null,2)+'\n';
  await writeFile(path.join(output,'authorization.json'),raw,{flag:'wx'});
  await writeFile(path.join(output,'baseline.json'),JSON.stringify({originalRunId:control.runId,runState:original.state,namespaceBudgets:values,ledgerWrite:false,providerCalls:0},null,2)+'\n',{flag:'wx'});
  await writeFile(path.join(state,'inference-limits-before-'+record.authorizationId+'.json'),before,{mode:0o600,flag:'wx'});
  await writeFile(proof,raw,{mode:0o600,flag:'wx'});const handle=await open(proof,'r');try{await handle.sync();}finally{await handle.close();}
  const temp=file+'.prepared-'+record.authorizationId;await writeFile(temp,after,{mode:0o600,flag:'wx'});const pending=await open(temp,'r');try{await pending.sync();}finally{await pending.close();}
  const current=await lstat(file);assert.equal(current.ino,beforeInfo.ino);assert.equal(current.mtimeMs,beforeInfo.mtimeMs);assert.ok((await readFile(file)).equals(before));
  await rename(temp,file);const directory=await open(state,'r');try{await directory.sync();}finally{await directory.close();}
  assert.deepEqual(await limits.readOwnerInferenceLimits(state),plan.policy);
  assert.deepEqual(db.prepare('SELECT id,value FROM inference_budgets WHERE namespace=? ORDER BY id').all(original.namespace),rows);
  await writeFile(path.join(output,'prepared.json'),JSON.stringify({authorizationSha256:sha(Buffer.from(raw)),ownerPolicyPrepared:true,newBudgetGrants:0,newProviderCalls:0,oldLedgerUnchanged:true,
    newCallsAvailableAfterExactGrant:plan.additionalCalls,newTokensAvailableAfterExactGrant:plan.additionalTokens,maximumUserAuthorizedCalls:128,maximumUserAuthorizedTokens:4194304,automaticRenewal:false},null,2)+'\n',{flag:'wx'});
  console.log('ADDITIONAL_GENERATION_ALLOCATION_PREPARED '+output);
}finally{db.close();}
