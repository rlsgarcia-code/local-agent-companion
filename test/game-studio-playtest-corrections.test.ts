import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {GameStudioController} from '../packages/client-ts/src/game-studio';
import type {AgentClient} from '../packages/client-ts/src/index';
import {contentHash} from '../packages/contracts/src/identity';
import type {GamePlaytestCorrect} from '../packages/contracts/src/game-playtests';

function fixture(){
  const projectId=randomUUID(),studyId=randomUUID(),participantId=randomUUID(),artifactHash='a'.repeat(64);
  const request:GamePlaytestCorrect={requestId:randomUUID(),studyId,participantId,expectedResponseHash:'b'.repeat(64),reason:'Synthetic transcription error',correctionConfirmed:true,
    answers:{consentConfirmed:true,distinctParticipantConfirmed:true,understoodWithoutHelp:false,actionSeconds:null,experienceScore:2,
      environment:{platform:'synthetic',device:'fixture',browser:'none',input:['keyboard']},notes:'No actual participant'}};
  const command={action:'correct-playtest',projectId,artifactHash,request};
  const state={write:true,selected:projectId,supported:true,approvals:0,writes:0,receipt:undefined as unknown,afterApproval:()=>{}};
  const client={linkedGameProject:async()=>({id:state.selected}),call:async()=>({capabilities:['game-playtest-studio-v1',...(state.supported?['game-playtest-corrections-v1']:[])]}),
    getGamePlaytest:async()=>({study:{id:studyId,projectId,artifactHash,title:'Synthetic study',revision:1}}),inspectGamePlaytest:async()=>state.receipt??{state:'missing'},
    correctGamePlaytest:async(input:unknown)=>{state.writes++;assert.deepEqual(input,request);return {studyId,withdrawn:false};}} as unknown as AgentClient;
  const controller=new GameStudioController(client,randomUUID(),{canWrite:()=>state.write,approve:async()=>{state.approvals++;state.afterApproval();return true;},preview:async()=>{},exportSource:async()=>false,exportBuild:async()=>false,exportAsset:async()=>false});
  return {state,request,command,controller,studyId,participantId};
}
test('correction requires supported service and retains pre/post-confirmation host authority',async()=>{
  const good=fixture();assert.deepEqual(await good.controller.dispatch(good.command),{playtestMutationAcknowledged:true,studyId:good.studyId,withdrawn:false});assert.equal(good.state.writes,1);assert.equal(good.state.approvals,1);
  for(const reason of ['read-only','old-service','selection-changed','write-revoked'] as const){
    const f=fixture();
    if(reason==='read-only')f.state.write=false;
    if(reason==='old-service')f.state.supported=false;
    if(reason==='selection-changed')f.state.afterApproval=()=>{f.state.selected=randomUUID();};
    if(reason==='write-revoked')f.state.afterApproval=()=>{f.state.write=false;};
    const result=await f.controller.dispatch(f.command) as {playtestEditRejected?:boolean};assert.equal(result.playtestEditRejected,true,reason);assert.equal(f.state.writes,0,reason);
  }
});
test('exact known correction receipt recovers read-only, including old service and later withdrawal; missing/mismatch never settles it',async()=>{
  const f=fixture();f.state.write=false;f.state.supported=false;
  f.state.receipt={state:'acknowledged',bindingHash:contentHash({kind:'correct',input:f.request}),studyId:f.studyId,participantId:f.participantId,withdrawn:true};
  const resume={action:'resume-playtest',projectId:f.command.projectId,command:f.command};
  assert.deepEqual(await f.controller.dispatch(resume),{playtestMutationAcknowledged:true,studyId:f.studyId,withdrawn:true,recovered:true});
  assert.equal(f.state.writes,0);assert.equal(f.state.approvals,0);
  f.state.receipt={state:'missing'};assert.equal((await f.controller.dispatch(resume) as {playtestEditRejected:boolean}).playtestEditRejected,true);
  f.state.receipt={state:'acknowledged',bindingHash:'c'.repeat(64),studyId:f.studyId,participantId:f.participantId};
  assert.equal((await f.controller.dispatch(resume) as {playtestEditRejected:boolean}).playtestEditRejected,true);assert.equal(f.state.writes,0);
});
