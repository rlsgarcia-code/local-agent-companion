// Exact development engine and SDK/TLS only. A prepared editor inventory and
// shipped C# source must not create production availability or engine fallback.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {readFile,writeFile,mkdir,mkdtemp,rm,copyFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import path from 'node:path';
import sdk from '../dist-tests/packages/client-ts/src/index.js';
import bootstrap from '../dist-tests/packages/client-ts/src/bootstrap.js';
import security from '../dist-tests/packages/agent-service/src/security.js';
import storage from '../dist-tests/packages/agent-service/src/store.js';
import fixtures from '../dist-tests/test/game-fixtures.js';

const args=process.argv.slice(2);assert.equal(args.length,2);assert.equal(new Set(args.map(arg=>arg.split('=')[0])).size,2);assert.ok(args.every(arg=>arg.startsWith('--engine=')||arg.startsWith('--prepared=')));
const engine=path.resolve(args.find(arg=>arg.startsWith('--engine=')).slice(9)),prepared=path.resolve(args.find(arg=>arg.startsWith('--prepared=')).slice(11));
await bootstrap.verifyBundle(engine,undefined,true);const preparedBytes=await readFile(prepared),preparedValue=JSON.parse(preparedBytes);assert.equal(preparedValue.status,'prepared-unqualified');assert.equal(preparedValue.available,false);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex'),driver=await readFile(path.join(engine,'game-editors/unity/CompanionWebBuild.cs'));
assert.deepEqual(driver,await readFile('packages/adapter-game-unity/editor/CompanionWebBuild.cs'));assert.deepEqual(await readFile(path.join(engine,'game-editors/unity/toolchain.lock.json')),await readFile('packages/adapter-game-unity/toolchain.lock.json'));
assert.deepEqual(await readFile(path.join(engine,'game-editors/unity/project-modules.lock.json')),await readFile('packages/adapter-game-unity/project-modules.lock.json'));
const output=path.resolve('output/game-generation/unity-source-engine',new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID().slice(0,8));await mkdir(output,{recursive:true});
const state=await mkdtemp(path.join(tmpdir(),'unity-source-engine-'));await mkdir(path.join(state,'toolchains'),{mode:0o700});await copyFile(prepared,path.join(state,'toolchains/unity.json'));
const identity=await security.ensureIdentity(state),credentials=[];const store=new storage.Store(path.join(state,'metadata.sqlite'));
for(const product of ['companion-mac','companion-vscode']){const credential=await security.createClientCredential(state,{id:'unity-source-'+product,product,profile:'fixture',workspace:'',providers:['ollama'],hostTools:[]});store.register(credential);credentials.push(credential);}store.close();
let child,client,passed=false;const observations=[];
async function stop(){client?.close();client=undefined;if(child?.exitCode===null){const exited=once(child,'exit');child.kill('SIGTERM');await exited;}if(child)assert.equal(child.exitCode,0);}
try{
 const env={PATH:'/usr/bin:/bin:/usr/sbin:/sbin',HOME:state,LANG:'en_US.UTF-8',...(process.env.TMPDIR?{TMPDIR:process.env.TMPDIR}:{})};child=spawn(path.join(engine,'node'),[path.join(engine,'service.cjs'),state],{env,stdio:'ignore'});let ready=false;
 for(let i=0;i<600;i++){assert.equal(child.exitCode,null,'The exact owned service exited');try{if(JSON.parse(await readFile(path.join(state,'runtime.json'),'utf8')).pid===child.pid){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,25));}assert.ok(ready,'Inspect the original bootstrap on observation timeout; no automatic restart');
 for(const credential of credentials){
  client=new sdk.AgentClient({address:security.ipcPath(state),certificate:identity.cert,credential});await client.connect();const capabilities=await client.gameProductionCapabilities();
  assert.equal(capabilities.adapters.some(adapter=>adapter.engine==='unity'),false,'Source-only preparation must not register a production adapter');
  assert.equal(capabilities.collectors.some(collector=>collector.engines.includes('unity')),false,'A synthetic player cannot enable Unity QA collectors');
  const document=fixtures.fixtureGameDocument();document.engine='unity';document.title='Synthetic unavailable Unity guard';const project=await client.createGameProject('unity-no-fallback',document);assert.equal((await client.listGameProduction(project.id)).jobs.length,0);
  await assert.rejects(client.startGameBuild('unity-build-not-admitted',project.id,project.revision),error=>error.code===-32011&&/No qualified production adapter/.test(error.message));
  assert.equal((await client.listGameProduction(project.id)).jobs.length,0);assert.deepEqual(await client.getGameProject(project.id),project);
  observations.push({product:credential.registration.product,unityAdapterRegistered:false,unityCollectorRegistered:false,buildRejectedBeforeJobCreation:true,projectAndEnginePreserved:true});client.close();client=undefined;
 }
 await stop();await bootstrap.verifyBundle(engine,undefined,true);assert.deepEqual(await readFile(prepared),preparedBytes);
 await writeFile(path.join(output,'report.json'),JSON.stringify({scope:'Source-only Unity packaging and availability guard through actual bundled Node/service/SDK/TLS, two authenticated products and synthetic project metadata. No editor, compiler, game, license or inference execution.',engineManifestSha256:sha(await readFile(path.join(engine,'manifest.json'))),driverSha256:sha(driver),preparedInventoryUnchanged:true,observations,ownedServiceClosed:true,unityEditorInvocations:0,realInferenceCalls:0,installed:false},null,2)+'\n');passed=true;console.log('UNITY_SOURCE_ENGINE_GUARD_OK '+output);
}catch(error){await writeFile(path.join(output,'failure.json'),JSON.stringify({message:error instanceof Error?error.message:String(error)},null,2)+'\n');throw error;}
finally{await stop();if(passed)await rm(state,{recursive:true,force:true});else console.error('Owned fixture retained: '+state);}
