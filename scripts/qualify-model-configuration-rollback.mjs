// Disposable binary/configuration rollback only. No model, installer or user state.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import verification from './smoke-engine-rollback.cjs';
import bootstrap from '../dist-tests/packages/client-ts/src/bootstrap.js';
import security from '../dist-tests/packages/agent-service/src/security.js';
import storage from '../dist-tests/packages/agent-service/src/store.js';
import sdk from '../dist-tests/packages/client-ts/src/index.js';
const names=['--engine','--previous-engine','--previous-sdk','--report'];
assert.equal(process.argv.length,names.length+2);
const option=name=>{const v=process.argv.find(a=>a.startsWith(name+'='));if(!v)throw Error('Missing '+name);return path.resolve(v.slice(name.length+1));};
const [engine,previousEngine,previousSdk,report]=names.map(option);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const hash=value=>sha(JSON.stringify(canonical(value)));
const key=await readFile('release-keys/companion-ed25519.pub','utf8');
const old=await verification.verifiedSdk(previousSdk,key);
await old.verifyBundle(previousEngine,key,false);
await bootstrap.verifyBundle(engine,undefined,true);
const currentRaw=await readFile(path.join(engine,'manifest.json')),priorRaw=await readFile(path.join(previousEngine,'manifest.json'));
const currentManifest=JSON.parse(currentRaw),priorManifest=JSON.parse(priorRaw);
assert.equal(currentManifest.development,true,'This runner does not approve a release or relax installed trust');
assert.notEqual(currentManifest.version,priorManifest.version);
const root=await mkdtemp(path.join(tmpdir(),'model-rollback-')),state=path.join(root,'state'),actors=[];
let active,passed=false;
await mkdir(state,{mode:0o700});await security.ensureIdentity(state);
const store=new storage.Store(path.join(state,'metadata.sqlite'));
try{
  for(const product of ['companion-mac','companion-vscode']){
    const credential=await security.createClientCredential(state,{id:'model-rollback-'+product,product,profile:'disposable',workspace:'',providers:['ollama'],hostTools:[]});
    store.register(credential);actors.push({product,credential});
  }
}finally{store.close();}
async function start(bundle,Client){
  assert.ok(!active||active.exitCode!==null,'Confirm prior process exit before changing version');
  active=spawn(path.join(bundle,process.platform==='win32'?'node.exe':'node'),[path.join(bundle,'service.cjs'),state],
    {env:{HOME:root,PATH:process.platform==='win32'?path.join(process.env.SystemRoot,'System32'):'/usr/bin:/bin',TMPDIR:tmpdir(),LANG:'en_US.UTF-8',
      ...(process.platform==='win32'?{SystemRoot:process.env.SystemRoot,LOCALAPPDATA:root,TEMP:root,TMP:root}: {})},stdio:'ignore',windowsHide:true});
  for(let i=0;i<400;i++){
    if(active.exitCode!==null)throw Error('Owned engine exited during startup');
    let ready=false;try{ready=JSON.parse(await readFile(path.join(state,'runtime.json'),'utf8')).pid===active.pid;}catch{}
    if(ready){
      for(const actor of actors){actor.client=new Client({address:security.ipcPath(state),certificate:await readFile(path.join(state,'server.crt'),'utf8'),credential:actor.credential});await actor.client.connect();}
      return actors[0].client.call('engine.info');
    }
    await new Promise(resolve=>setTimeout(resolve,25));
  }
  throw Error('Owned engine did not become ready');
}
async function stop(requireIdle=true){
  if(!active||active.exitCode!==null)return;
  if(requireIdle)assert.equal((await actors[0].client.call('engine.quiesceIfIdle')).accepted,true,'No rollback with active work');
  for(const actor of actors){actor.client?.close();actor.client=undefined;}
  const exited=once(active,'exit');
  active.kill('SIGTERM');const timer=setTimeout(()=>active.kill('SIGKILL'),10000);
  try{await exited;if(requireIdle)assert.equal(active.exitCode,0);}finally{clearTimeout(timer);}
}
async function historyHash(actor,id,configuration){
  const domain=await actor.client.exportSession(id);
  // Export also contains the CURRENT product configuration. Compare it exactly
  // against this phase's settings; compare all other domain fields separately.
  const {modelConfiguration:exportedConfiguration,...productState}=domain.productState;
  assert.deepEqual(exportedConfiguration,configuration);
  return hash({...domain,productState});
}
try{
  const initial=await start(engine,sdk.AgentClient);
  for(const actor of actors){
    actor.configuration=await actor.client.call('models.configure',{revision:0,roles:{executor:'fixture-'+actor.product},
      webResearch:{enabled:true,allowedDomains:['example.org']},contextWindows:{['fixture-'+actor.product]:8192}});
    actor.session=await actor.client.importSession('after-update',{schemaVersion:1,messages:[{id:'after-'+actor.product,role:'user',content:'Synthetic history; no inference or tools.'}]});
    actor.domainHash=await historyHash(actor,actor.session.id,actor.configuration);
  }
  assert.notEqual(actors[0].session.id,actors[1].session.id);
  await stop();
  const previous=await start(previousEngine,old.Client);
  for(const actor of actors){
    const configuration=await actor.client.call('models.configuration');
    assert.equal(configuration.revision,actor.configuration.revision);
    assert.equal(Object.hasOwn(configuration,'webResearch'),false);
    assert.equal(Object.hasOwn(configuration,'contextWindows'),false);
    assert.equal(await historyHash(actor,actor.session.id,configuration),actor.domainHash);
    actor.legacy=await actor.client.call('models.configure',{...configuration,roles:{executor:'edited-on-previous-'+actor.product}});
    actor.legacySession=await actor.client.importSession('during-rollback',{schemaVersion:1,messages:[{id:'prior-'+actor.product,role:'user',content:'Synthetic history created by the prior engine.'}]});
    actor.legacyDomainHash=await historyHash(actor,actor.legacySession.id,actor.legacy);
  }
  await stop();
  const reactivated=await start(engine,sdk.AgentClient);
  for(const actor of actors){
    const configuration=await actor.client.call('models.configuration');
    assert.equal(configuration.revision,actor.legacy.revision);
    assert.deepEqual(configuration.roles,actor.legacy.roles);
    assert.deepEqual(configuration.webResearch,actor.configuration.webResearch);
    assert.deepEqual(configuration.contextWindows,actor.configuration.contextWindows);
    assert.equal(await historyHash(actor,actor.session.id,configuration),actor.domainHash);
    assert.equal(await historyHash(actor,actor.legacySession.id,configuration),actor.legacyDomainHash);
    await assert.rejects(actor.client.exportSession(actors.find(other=>other!==actor).session.id));
  }
  await stop();
  const result={state:'passed',scope:'disposable real-binary configuration/history rollback; no installed, credential, checkpoint or UI acceptance',
    current:{version:initial.version,manifestSha256:sha(currentRaw),development:true},
    previous:{version:previous.version,manifestSha256:sha(priorRaw),officialSignatureVerified:true},reactivated:reactivated.version,
    productNamespaces:actors.map(a=>a.product),priorStrictSchemaReadable:true,legacyEditsRetained:true,newPreferencesRetained:true,
    historiesFromBothVersionsRetained:true,modelCalls:0,tools:0};
  await writeFile(report,JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
  console.log(JSON.stringify(result));passed=true;
}finally{
  await stop(false);
  if(passed)await rm(root,{recursive:true,force:true});
  else console.error('Failed disposable state retained at '+root);
}
