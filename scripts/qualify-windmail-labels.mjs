// Manual integration in an isolated metadata backup, never a new inference run.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir,mkdtemp,copyFile,chmod,lstat} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import Database from 'better-sqlite3';
import bootstrap from '../dist-tests/packages/client-ts/src/bootstrap.js';
import security from '../dist-tests/packages/agent-service/src/security.js';
import storage from '../dist-tests/packages/agent-service/src/store.js';
import sdk from '../dist-tests/packages/client-ts/src/index.js';
import {windmailLabelsIntegration} from './game-qualification/windmail-labels-patch.mjs';
import {windmailFocusIntegration} from './game-qualification/windmail-focus-patch.mjs';
assert.equal(process.versions.node,'22.23.4');
assert.ok(Object.keys(process.env).every(k=>['HOME','PATH','TMPDIR','LANG','__CF_USER_TEXT_ENCODING'].includes(k)),'Closed environment required');
assert.ok([3,4].includes(process.argv.length));const focus=process.argv[3]==='--focus';if(process.argv[3])assert.ok(focus);const mode=focus?'focus':'labels',baseRevision=focus?54:53,nextRevision=baseRevision+1;
const output=path.resolve(process.argv[2]);await mkdir(output);
const sha=b=>createHash('sha256').update(b).digest('hex');
const save=async(name,data)=>{const file=path.join(output,name);await mkdir(path.dirname(file),{recursive:true});await writeFile(file,Buffer.isBuffer(data)?data:JSON.stringify(data,null,2)+'\n');};
const attempt=path.resolve(focus?'output/game-generation/windmail-labels-20261113-a1':'output/game-generation/windmail-responsive-20261113-a4');
const controlRaw=await readFile(path.join(attempt,'control.json')),parentClosure=JSON.parse(await readFile(path.join(attempt,'closure.json'))),control={stateDirectory:parentClosure.privateState,servicePid:parentClosure.ownedPid,registrationId:focus?'windmail-labels-integration':'windmail-responsive-integration'},originalReport=await readFile(path.join(attempt,'report.json'));assert.equal(parentClosure.serviceExitCode,0);
const original=control.stateDirectory,engine=path.resolve('output/game-generation/game-save-runtime-20261113-a1/engine');
await bootstrap.verifyBundle(engine,undefined,true);const manifest=await readFile(path.join(engine,'manifest.json'));
assert.equal(sha(manifest),'d9f826ddfefb20e6c922a30dfcdc5d9e83e8396aeec2e6b26112f12265335d7b');
function guardPid(){try{process.kill(control.servicePid,0);assert.fail('Original service may still exist; inspect before copying');}catch(e){assert.equal(e.code,'ESRCH');}}
async function guardIpc(){const hash=sha(Buffer.from(path.resolve(original))).slice(0,24);for(const file of new Set([security.ipcPath(original),path.join('/tmp',`companion-${process.getuid()}-${hash}`,'agent.sock'),path.join('/private/tmp',`companion-${process.getuid()}-${hash}`,'agent.sock')]))try{await lstat(file);assert.fail('Original IPC still exists');}catch(e){assert.equal(e.code,'ENOENT');}}
const tables=['inference_budgets','inference_calls','inference_budget_grants'];
function ledger(db){return tables.map(name=>({name,sha256:sha(Buffer.from(JSON.stringify(db.prepare('SELECT * FROM '+name+' ORDER BY rowid').all()))),rows:db.prepare('SELECT count(*) AS n FROM '+name).get().n}));}
function terminal(db){assert.equal(db.prepare("SELECT count(*) AS n FROM runs WHERE state NOT IN ('completed','failed','cancelled')").get().n,0);for(const row of db.prepare('SELECT value FROM game_production_jobs').all())assert.ok(['completed','failed','cancelled'].includes(JSON.parse(row.value).state));}
guardPid();await guardIpc();const sourceDb=new Database(path.join(original,'metadata.sqlite'),{readonly:true,fileMustExist:true});terminal(sourceDb);const baseline=ledger(sourceDb);
const row=sourceDb.prepare('SELECT registration FROM clients WHERE id=?').get(control.registrationId);assert.ok(row);const priorRegistration=JSON.parse(row.registration);
const projectId='5006ab22-93d5-4991-b29f-dbd1f8e60bf7',beforeProject=JSON.parse(sourceDb.prepare('SELECT value FROM game_projects WHERE id=?').get(projectId).value);
assert.equal(beforeProject.revision,baseRevision);assert.equal(beforeProject.contentHash,focus?'0eb6abc90eb17421f2636061b677770fb540d0259480317e07b81e1ec88cbae4':'0dc538fbf892c5113da868d2519dadfa0b98553e3e058205ff66b7c11799131d');
// Short private path avoids macOS Unix-socket path limits; no endpoint fallback.
const state=await mkdtemp('/private/tmp/wm-save-');assert.ok(security.ipcPath(state).length<100);await chmod(state,0o700);
await sourceDb.backup(path.join(state,'metadata.sqlite'));await chmod(path.join(state,'metadata.sqlite'),0o600);sourceDb.close();
await copyFile(path.join(original,'inference-limits.json'),path.join(state,'inference-limits.json'));await chmod(path.join(state,'inference-limits.json'),0o600);
const identity=await security.ensureIdentity(state),store=new storage.Store(path.join(state,'metadata.sqlite'));
const credential=await security.createClientCredential(state,{id:`windmail-${mode}-integration`,product:priorRegistration.product,profile:priorRegistration.profile,workspace:priorRegistration.workspace,providers:[],hostTools:[],toolCatalog:[]});
assert.equal(security.namespace(credential.registration),security.namespace(priorRegistration));assert.deepEqual(ledger(store.db),baseline);store.register(credential);store.close();
await security.privateWrite(path.join(state,'qualification-client.json'),JSON.stringify(credential));
await save('control.json',{manualIntegration:true,sourceProvided:true,realModelCalls:0,originalAttempt:attempt,originalControlSha256:sha(controlRaw),originalReportSha256:sha(originalReport),originalProject:beforeProject,engineManifestSha256:sha(manifest),providerless:true,namespacePreserved:true,ledgerBaseline:baseline,observerSha256:sha(await readFile(new URL(import.meta.url)))});
const child=spawn(path.join(engine,'node'),[path.join(engine,'service.cjs'),state],{cwd:state,env:{HOME:state,PATH:'/usr/bin:/bin',TMPDIR:tmpdir(),LANG:'en_US.UTF-8'},stdio:'ignore'});
let client,activeBuild,passed=false;
async function stop(){if(child.exitCode===null){assert.ok(client);assert.equal((await client.call('engine.quiesceIfIdle',{})).accepted,true);client.close();client=undefined;const exit=once(child,'exit');child.kill('SIGTERM');await exit;}assert.equal(child.exitCode,0);}
try{
 let ready=false;for(let i=0;i<600;i++){assert.equal(child.exitCode,null);try{if(JSON.parse(await readFile(path.join(state,'runtime.json'),'utf8')).pid===child.pid){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,25));}assert.ok(ready,'Inspect original child, never restart on timeout');
 client=new sdk.AgentClient({address:security.ipcPath(state),certificate:identity.cert,credential});await client.connect();assert.equal((await client.call('engine.info')).build.manifestSha256,sha(manifest));
 const before=await client.getGameProject(projectId);assert.deepEqual(before,beforeProject);const revision=await client.getGameRevision(projectId,baseRevision),document=revision.document,files=new Map();
 for(const file of document.files){const bytes=await client.downloadGameFile(projectId,file.path,baseRevision);assert.equal(sha(bytes),file.sha256);assert.equal(bytes.length,file.size);files.set(file.path,bytes);}
 const changes=await (focus?windmailFocusIntegration:windmailLabelsIntegration)(files);
 for(const [name,bytes]of changes){const file=await client.uploadGameFile(name,bytes,name.endsWith('.css')?'text/css':'text/plain');document.files=document.files.filter(f=>f.path!==name);document.files.push(file);await save('integration-source/'+name,bytes);}
 const committed=await client.commitGameRevision(projectId,`manual-${mode}-integration-1`,baseRevision,document,focus?'Manual focus restoration and hidden-dialog input scope correction. Only src/ui.ts changes; simulation/assets/save and prior revisions preserved; no model invocation.':'Manual player-facing label visibility repair. Only presentation; simulation and save unchanged. Original Luna51 and responsive53 preserved; no model invocation.');assert.equal(committed.revision,nextRevision);await save('project.json',committed);await save('revision.json',await client.getGameRevision(projectId,nextRevision));
 const job=await client.startGameBuild(`manual-${mode}-build-1`,projectId,nextRevision);activeBuild=job.id;let done;
 for(let i=0;i<2400;i++){done=await client.getGameProduction(job.id);if(['completed','failed','cancelled','awaiting_reconciliation'].includes(done.state))break;await new Promise(r=>setTimeout(r,25));}
 if(['completed','failed','cancelled'].includes(done?.state))activeBuild=undefined;await save('build-job.json',done);assert.equal(done?.state,'completed',done?.error);
 const artifact=await client.getGameArtifact(job.id);for(const file of artifact.files){const bytes=await client.downloadGameArtifactFile(job.id,file.path);assert.equal(sha(bytes),file.sha256);await save('build/'+file.path,bytes);}await save('artifact.json',artifact);
 assert.ok(artifact.files.some(f=>f.path==='engine/GAME-SAVE-LICENSE.txt'));assert.equal((await client.getGameQuality(projectId)).ready,false);await stop();
 const copy=new Database(path.join(state,'metadata.sqlite'),{readonly:true,fileMustExist:true});assert.deepEqual(ledger(copy),baseline);terminal(copy);copy.close();
 guardPid();await guardIpc();const old=new Database(path.join(original,'metadata.sqlite'),{readonly:true,fileMustExist:true});assert.deepEqual(ledger(old),baseline);assert.deepEqual(JSON.parse(old.prepare('SELECT value FROM game_projects WHERE id=?').get(projectId).value),beforeProject);old.close();
 assert.ok(originalReport.equals(await readFile(path.join(attempt,'report.json'))));assert.ok(controlRaw.equals(await readFile(path.join(attempt,'control.json'))));await bootstrap.verifyBundle(engine,undefined,true);
 await save('report.json',{manualIntegration:true,sourceProvided:true,realModelCalls:0,originalRevisionUnchanged:baseRevision,integratedRevision:nextRevision,projectId,originalSourceHash:before.contentHash,sourceHash:committed.contentHash,artifactHash:artifact.artifactHash,engineManifestSha256:sha(manifest),originalAndCopiedInferenceLedgerUnchanged:true,namespacePreserved:true,privateMetadataCopy:true,graphCheckpointsCopied:false,installed:false,qualityApproved:false});passed=true;
 console.log('WINDMAIL_LABELS_BUILD_VERIFIED '+output);
}catch(error){await save('failure.json',{message:String(error?.message??error).slice(0,2500),ownedPid:child.pid,privateState:state,activeBuild});process.exitCode=1;console.error(String(error?.message??error).slice(0,2500));}
finally{if(activeBuild){client?.close();child.unref();await save('closure.json',{servicePreservedForInspection:true,ownedPid:child.pid,privateState:state,activeBuild});}else{if(child.exitCode===null)await stop();await save('closure.json',{serviceExitCode:child.exitCode,ownedPid:child.pid,privateState:state,privateStatePreserved:true,passed});}}
