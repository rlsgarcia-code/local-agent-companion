// Read-only SDK export from the terminal private qualification copy. No graph,
// model, new revision, grant, original TLS key or original generation state.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {readFile,writeFile,mkdir,lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import Database from 'better-sqlite3';
import bootstrap from '../dist-tests/packages/client-ts/src/bootstrap.js';
import security from '../dist-tests/packages/agent-service/src/security.js';
import sdk from '../dist-tests/packages/client-ts/src/index.js';
assert.equal(process.versions.node,'22.23.4');assert.equal(process.argv.length,3);
assert.ok(Object.keys(process.env).every(k=>['HOME','PATH','TMPDIR','LANG','__CF_USER_TEXT_ENCODING'].includes(k)));
const source=path.resolve(process.argv[2]),out=path.join(source,'editable-export');await mkdir(out);
const closure=JSON.parse(await readFile(path.join(source,'closure.json'))),report=JSON.parse(await readFile(path.join(source,'report.json'))),state=closure.privateState;assert.equal(closure.serviceExitCode,0);assert.equal(closure.passed,true);
const revision=report.integratedRevision;assert.ok([53,54,55].includes(revision),'Only the explicit responsive/label/focus candidate is supported');
try{process.kill(closure.ownedPid,0);assert.fail('Previous owner still exists');}catch(e){assert.equal(e.code,'ESRCH');}
try{await lstat(security.ipcPath(state));assert.fail('Previous endpoint still exists');}catch(e){assert.equal(e.code,'ENOENT');}
const sha=b=>createHash('sha256').update(b).digest('hex'),engine=path.resolve('output/game-generation/game-save-runtime-20261113-a1/engine');await bootstrap.verifyBundle(engine,undefined,true);assert.equal(sha(await readFile(path.join(engine,'manifest.json'))),report.engineManifestSha256);
const ledger=()=>{const db=new Database(path.join(state,'metadata.sqlite'),{readonly:true,fileMustExist:true});try{return ['inference_budgets','inference_calls','inference_budget_grants'].map(table=>({table,sha256:sha(Buffer.from(JSON.stringify(db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all())))}));}finally{db.close();}};
const before=ledger(),credentialFile=path.join(state,'qualification-client.json'),stat=await lstat(credentialFile);assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&stat.uid===process.getuid()&&(stat.mode&0o077)===0&&stat.size<8192);
const credential=JSON.parse(await readFile(credentialFile,'utf8'));assert.deepEqual(credential.registration.providers,[]);assert.deepEqual(credential.registration.hostTools,[]);
const certificate=await readFile(path.join(state,'server.crt'),'utf8'),child=spawn(path.join(engine,'node'),[path.join(engine,'service.cjs'),state],{cwd:state,env:{HOME:state,PATH:'/usr/bin:/bin',TMPDIR:'/private/tmp',LANG:'en_US.UTF-8'},stdio:'ignore'});let client,passed=false;
try{
 let ready=false;for(let i=0;i<600;i++){assert.equal(child.exitCode,null);try{if(JSON.parse(await readFile(path.join(state,'runtime.json'))).pid===child.pid){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,25));}assert.ok(ready,'Inspect this owner on timeout, never start another');
 client=new sdk.AgentClient({address:security.ipcPath(state),certificate,credential});await client.connect();const project=await client.getGameProject(report.projectId);assert.equal(project.revision,revision);assert.equal(project.contentHash,report.sourceHash);
 const archive=await client.exportGameProject(project.id),written=new Set();await mkdir(path.join(out,'blobs'));let bytes=0;
 for(const revision of archive.revisions)for(const file of revision.document.files){if(written.has(file.sha256))continue;const data=await client.downloadGameFile(project.id,file.path,revision.revision);assert.equal(data.length,file.size);assert.equal(sha(data),file.sha256);await writeFile(path.join(out,'blobs',file.sha256),data,{flag:'wx'});written.add(file.sha256);bytes+=data.length;}
 await writeFile(path.join(out,'archive.json'),JSON.stringify(archive,null,2)+'\n',{flag:'wx'});
 const latest=await client.getGameRevision(project.id,revision);for(const file of latest.document.files){const target=path.join(out,'source',file.path);assert.ok(target.startsWith(path.join(out,'source')+path.sep));await mkdir(path.dirname(target),{recursive:true});await writeFile(target,await readFile(path.join(out,'blobs',file.sha256)),{flag:'wx'});}
 assert.deepEqual(await client.getGameProject(project.id),project);assert.equal((await client.call('engine.quiesceIfIdle',{})).accepted,true);passed=true;
 await writeFile(path.join(out,'report.json'),JSON.stringify({projectId:project.id,revision:project.revision,sourceHash:project.contentHash,archiveRevisions:archive.revisions.length,uniqueBlobs:written.size,bytes,currentSourceFiles:latest.document.files.length,engineModelCalls:0,projectUnchanged:true,providerless:true,qualityApproved:false,installed:false},null,2)+'\n');
}catch(error){await writeFile(path.join(out,'failure.json'),JSON.stringify({message:String(error?.message??error).slice(0,1800),ownedPid:child.pid,privateState:state},null,2)+'\n');process.exitCode=1;console.error(String(error?.message??error).slice(0,1800));}
finally{client?.close();if(child.exitCode===null){const exit=once(child,'exit');child.kill('SIGTERM');await exit;}assert.equal(child.exitCode,0);assert.deepEqual(ledger(),before);await writeFile(path.join(out,'closure.json'),JSON.stringify({ownedPid:child.pid,exitCode:child.exitCode,inferenceLedgerUnchanged:true,passed},null,2)+'\n');}
