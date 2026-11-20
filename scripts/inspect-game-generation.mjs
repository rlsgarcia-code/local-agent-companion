// Read-only inspection of one ORIGINAL development attempt. No host.poll,
// approval, cancel, resume, registration, service launch or tool dispatch.
import assert from 'node:assert/strict';
import {readFile,realpath,lstat,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import sdk from '../dist-tests/packages/client-ts/src/index.js';
import security from '../dist-tests/packages/agent-service/src/security.js';
import generationState from '../dist-tests/test/game-generation-state.js';

const argument=process.argv.find(value=>value.startsWith('--attempt='))?.slice('--attempt='.length);
assert.ok(argument,'Pass --attempt=<original output directory>; no service will be started.');
const attempt=await realpath(argument),base=await realpath('output/game-generation');
assert.ok(attempt.startsWith(base+path.sep),'Only a generation evaluation output is accepted.');
const control=JSON.parse(await readFile(path.join(attempt,'control.json'),'utf8'));
const state=await generationState.assertGenerationStateDirectory(control.stateDirectory);
assert.match(control.registrationId,/^generation-[a-f0-9-]{36}$/);
const credentialPath=path.join(state,'inspection-credential.json');
const credentialStat=await lstat(credentialPath).catch(()=>{throw Error('This older attempt retained its credential only in the original observer memory. Keep observing that process; do not rekey or restart it to inspect.');});
assert.ok(credentialStat.isFile()&&!credentialStat.isSymbolicLink()&&credentialStat.nlink===1&&credentialStat.uid===process.getuid()&&(credentialStat.mode&0o077)===0,'Private original credential required.');
const credential=JSON.parse(await readFile(credentialPath,'utf8'));
assert.equal(credential.registration.id,control.registrationId);
assert.equal(credential.registration.product,'companion-vscode');
assert.equal(credential.registration.profile,'unseen-game-development');
assert.deepEqual(credential.registration.hostTools,[]);
assert.ok(['ollama','openai'].includes(control.provider??'ollama'),'Unknown original provider; no inference is permitted by inspection.');
assert.deepEqual(credential.registration.providers,[control.provider??'ollama'],'Original provider identity changed.');
const status=JSON.parse(await readFile(path.join(state,'runtime.json'),'utf8'));
assert.equal(status.pid,control.servicePid,'The original service identity changed; inspect before taking action.');
const client=new sdk.AgentClient({address:security.ipcPath(control.stateDirectory),certificate:await readFile(path.join(state,'server.crt'),'utf8'),credential});
try{
  await client.connect();
  const engine=await client.call('engine.info');assert.equal(engine.build.manifestSha256,control.engineManifestSha256);
  const run=await client.call('runs.get',{id:control.runId});assert.equal(run.sessionId,control.sessionId);
  const project=await client.linkedGameProject(control.sessionId),jobs=[];let documentState=null;
  if(project){
    const snapshot=await client.snapshotGameProject(project.id),revision=snapshot.revision;
    documentState={revision:revision.revision,sourceHash:revision.contentHash,hasDesign:revision.document.design!==null,fileCount:revision.document.files.length,assetCount:revision.document.assets.length,
      fileSample:revision.document.files.slice(0,8).map(({path,size,mime})=>({path,size,mime}))};
    let cursor=0;while(true){const page=await client.listGameProduction(project.id,cursor,30);jobs.push(...page.jobs);if(!page.hasMore)break;cursor=page.cursor;}
  }
  const budgets=await client.getInferenceBudgets(control.sessionId);
  const report={schemaVersion:1,timestamp:new Date().toISOString(),liveAuthenticatedService:true,originalServicePid:status.pid,engineManifestSha256:control.engineManifestSha256,
    caseId:control.case.id,run:{id:run.id,state:run.state,createdAt:run.createdAt,updatedAt:run.updatedAt,error:run.error,completionOutcome:run.result?.completionOutcome},
    project,documentState,jobs,budgets,note:'Read-only API inspection of the original attempt; no host requests polled, production started, service restarted or operation repeated. Project metadata and the revision-bound document snapshot may be read at different instants.'};
  const destination=path.join(attempt,'inspections');await mkdir(destination,{recursive:true});
  await writeFile(path.join(destination,`${report.timestamp.replace(/[:.]/g,'-')}.json`),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
}finally{client.close();}
