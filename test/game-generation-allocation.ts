// Administrative qualification-driver arithmetic, never a model tool or RPC.
import assert from 'node:assert/strict';
import {z} from 'zod';
import {inferenceBudgetForReservation,type InferenceBudget,type InferenceBudgetPolicy} from '../packages/contracts/src/inference-budget';
import {contentHash} from '../packages/contracts/src/identity';
import {readFile,lstat,realpath} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';

const safe=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const additionalGenerationBaseline=z.object({calls:safe,chargedTokens:safe,pendingCalls:z.literal(0),blocks:z.literal(1)}).strict();
export const originalGenerationPolicy:InferenceBudgetPolicy={namespace:{callsPerBlock:128,tokensPerBlock:4194304,maxBlocks:1},stage:{callsPerBlock:128,tokensPerBlock:4194304,maxBlocks:1},unknownTokensPerCall:65536};
/** Round down the combined two-block ceiling so unused old allowance cannot
 * enlarge the newly authorized128 calls/4Mi tokens. No ledger reset or reserve refund. */
export function additionalGenerationPlan(input:unknown){
  const baseline=additionalGenerationBaseline.parse(input);
  assert.ok(baseline.calls<=128&&baseline.chargedTokens<=4194304,'Inspect an unexpected original allocation before renewal.');
  assert.ok(baseline.calls>=128||baseline.chargedTokens+65536>4194304,'The original namespace must be exhausted before an additional block.');
  const callsPerBlock=Math.floor((baseline.calls+128)/2),tokensPerBlock=Math.floor((baseline.chargedTokens+4194304)/2);
  const policy:InferenceBudgetPolicy={namespace:{callsPerBlock,tokensPerBlock,maxBlocks:2},stage:{...originalGenerationPolicy.stage,maxBlocks:2},unknownTokensPerCall:65536};
  const additionalCalls=callsPerBlock*2-baseline.calls,additionalTokens=tokensPerBlock*2-baseline.chargedTokens;
  assert.ok(additionalCalls>0&&additionalCalls<=128&&additionalTokens>=65536&&additionalTokens<=4194304);
  return {baseline,policy,additionalCalls,additionalTokens,maximumAdditionalCalls:128,maximumAdditionalTokens:4194304,automaticRenewal:false as const};
}
export async function readAdditionalGenerationAllocation(directory:string,previousPath:string){
  const root=await realpath('output/game-generation'),folder=await realpath(directory),previous=await realpath(previousPath);
  assert.ok(folder.startsWith(root+path.sep)&&previous.startsWith(root+path.sep));
  const raw=await readFile(path.join(folder,'authorization.json'));
  const record=z.object({schemaVersion:z.literal(1),kind:z.literal('generation-additional-block'),authorizationId:z.string().uuid(),
    provider:z.literal('openai'),model:z.literal('gpt-6-luna'),previousAttempt:z.string(),stateDirectory:z.string(),previousRunId:z.string().uuid(),sessionId:z.string().uuid(),
    baseline:additionalGenerationBaseline,plan:z.unknown(),policyBeforeSha256:z.string().regex(/^[a-f0-9]{64}$/),policyAfterSha256:z.string().regex(/^[a-f0-9]{64}$/),
    authorizationReference:z.string().min(1).max(200),recordedAt:safe}).strict().parse(JSON.parse(raw.toString('utf8')));
  const control=JSON.parse(await readFile(path.join(previous,'control.json'),'utf8')) as {stateDirectory:string;runId:string;sessionId:string};
  assert.equal(record.previousAttempt,previous);assert.equal(record.stateDirectory,control.stateDirectory);assert.equal(record.previousRunId,control.runId);assert.equal(record.sessionId,control.sessionId);
  const plan=additionalGenerationPlan(record.baseline);assert.deepEqual(record.plan,plan);
  const prepared=z.object({authorizationSha256:z.string().regex(/^[a-f0-9]{64}$/),ownerPolicyPrepared:z.literal(true),newBudgetGrants:z.literal(0),newProviderCalls:z.literal(0),oldLedgerUnchanged:z.literal(true),
    newCallsAvailableAfterExactGrant:safe,newTokensAvailableAfterExactGrant:safe,maximumUserAuthorizedCalls:z.literal(128),maximumUserAuthorizedTokens:z.literal(4194304),automaticRenewal:z.literal(false)})
    .strict().parse(JSON.parse(await readFile(path.join(folder,'prepared.json'),'utf8')));
  assert.equal(prepared.authorizationSha256,createHash('sha256').update(raw).digest('hex'));
  assert.equal(prepared.newCallsAvailableAfterExactGrant,plan.additionalCalls);assert.equal(prepared.newTokensAvailableAfterExactGrant,plan.additionalTokens);
  const privateProof=path.join(record.stateDirectory,'generation-additional-allocation.json'),info=await lstat(privateProof);
  assert.ok(info.isFile()&&!info.isSymbolicLink()&&info.nlink===1&&info.uid===process.getuid?.()&&(info.mode&0o077)===0&&info.size<=16384);
  assert.ok(raw.equals(await readFile(privateProof)),'Owner allocation proof differs; inspect without granting another block.');
  assert.equal(createHash('sha256').update(await readFile(path.join(record.stateDirectory,'inference-limits.json'))).digest('hex'),record.policyAfterSha256,'Owner policy bytes changed after preparation.');
  return {folder,record,plan};
}
/** A service-issued exact live budget snapshot within the installed owner ceiling.
 * This does not approve tools/credentials/models or a third block. */
export function additionalGenerationApproval(request:{runId:string;kind:string;payload:unknown},scope:{runId:string;policy:InferenceBudgetPolicy;liveBudgets:InferenceBudget[];projectIds:string[]}){
  if(request.runId!==scope.runId||request.kind!=='approval'||!request.payload||typeof request.payload!=='object')return false;
  const payload=request.payload as {tool?:unknown;risk?:unknown;budget?:{budgets?:unknown}};
  if(payload.tool!=='inference_budget'||payload.risk!=='standard'||!Array.isArray(payload.budget?.budgets)||!scope.liveBudgets.length)return false;
  const decisions=payload.budget.budgets as InferenceBudget[];
  if(!decisions.length||decisions.some(b=>!b||typeof b!=='object'))return false;
  const hinted=decisions.some(b=>b.nextReservationTokens!==undefined);
  const reservation=hinted?decisions[0]?.nextReservationTokens:Math.max(...scope.liveBudgets.map(b=>b.reservedTokensPerCall));
  if(!Number.isSafeInteger(reservation)||reservation!<Math.max(...scope.liveBudgets.map(b=>b.reservedTokensPerCall))||hinted&&decisions.some(b=>b.nextReservationTokens!==reservation))return false;
  let blocked:InferenceBudget[];try{blocked=scope.liveBudgets.map(b=>inferenceBudgetForReservation(b,reservation!,hinted)).filter(b=>b.exhausted);}catch{return false;}
  if(!blocked.length||contentHash(decisions)!==contentHash(blocked))return false;
  return blocked.every(raw=>{
    const b=raw as {scope:{kind:string;projectId?:string};blocks:number;policy:unknown;canContinue:boolean;exhausted:boolean};
    if(!b.scope||b.blocks!==1||!b.canContinue||!b.exhausted)return false;
    if(b.scope.kind!=='namespace'&&(b.scope.kind!=='game-stage'||!scope.projectIds.includes(b.scope.projectId??'')))return false;
    return contentHash(b.policy)===contentHash(b.scope.kind==='namespace'?scope.policy.namespace:scope.policy.stage);
  });
}
