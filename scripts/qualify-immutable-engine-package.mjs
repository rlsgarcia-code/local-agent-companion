// Complete real-engine packaging with an ephemeral qualification key only.
// Never pins a new product key, publishes a release or installs a service.
import assert from 'node:assert/strict';
import {generateKeyPairSync,createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {readFile,writeFile,mkdir,mkdtemp,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {packageEngine} from './engine-package.mjs';
import bootstrap from '../dist-tests/packages/client-ts/src/bootstrap.js';
import security from '../dist-tests/packages/agent-service/src/security.js';
import storage from '../dist-tests/packages/agent-service/src/store.js';
import sdk from '../dist-tests/packages/client-ts/src/index.js';
assert.equal(process.argv.length,4);assert.ok(process.argv[2].startsWith('--engine='));assert.ok(process.argv[3].startsWith('--output='));
const input=path.resolve(process.argv[2].slice(9)),output=path.resolve(process.argv[3].slice(9));await mkdir(output); // Never replace an earlier qualification.
const sha=bytes=>createHash('sha256').update(bytes).digest('hex'),raw=await readFile(path.join(input,'manifest.json')),manifest=JSON.parse(raw);assert.equal(manifest.development,true);await bootstrap.verifyBundle(input,undefined,true);
const root=await mkdtemp(path.join(tmpdir(),'engine-package-qualification-')),services=[];
const save=async(name,value)=>writeFile(path.join(output,name),JSON.stringify(value,null,2)+'\n');
async function start(directory,label){
 const state=path.join(root,label);await mkdir(state,{mode:0o700});const identity=await security.ensureIdentity(state),credential=await security.createClientCredential(state,{id:'package-'+label,product:'companion-mac',profile:'fixture',workspace:'',providers:['ollama'],hostTools:[]}),store=new storage.Store(path.join(state,'metadata.sqlite'));store.register(credential);store.close();
 const child=spawn(path.join(directory,'node'),[path.join(directory,'service.cjs'),state],{env:{HOME:state,PATH:'/usr/bin:/bin',TMPDIR:tmpdir(),LANG:'en_US.UTF-8'},stdio:'ignore'}),record={child,state};services.push(record);
 let ready=false;for(let i=0;i<600;i++){assert.equal(child.exitCode,null);try{if(JSON.parse(await readFile(path.join(state,'runtime.json'),'utf8')).pid===child.pid){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,25));}assert.ok(ready);
 record.client=new sdk.AgentClient({address:security.ipcPath(state),certificate:identity.cert,credential});await record.client.connect();return record;
}
let passed=false;
try{
 await save('control.json',{observerSha256:sha(await readFile(new URL(import.meta.url))),packageHelperSha256:sha(await readFile(new URL('./engine-package.mjs',import.meta.url))),verifierSourceSha256:sha(await readFile('packages/client-ts/src/bootstrap.ts')),inputManifestSha256:sha(raw),qualificationOnly:true});
 const original=await start(input,'original'),before=await original.client.call('engine.info',{});assert.equal(before.build.manifestSha256,sha(raw));const session=await original.client.call('sessions.create',{title:'Original engine stays live while a copy is signed'});
 const pair=generateKeyPairSync('ed25519'),publicKey=pair.publicKey.export({type:'spki',format:'pem'}),commit='0'.repeat(40);
 await writeFile(path.join(output,'QUALIFICATION-ONLY.pub'),publicKey,{mode:0o600});
 await save('qualification-only.json',{installationAllowed:false,publicationAllowed:false,productionTrustRootChanged:false,sourceIsDirtyDevelopmentSnapshot:true,commitSentinel:commit,reason:'Ephemeral test signature, not the configured release publisher. No private key is stored.'});
 const mask=process.umask(0o077);let result;
 try{result=await packageEngine({inputDirectory:input,outputDirectory:path.join(output,'fixture-package'),signingKey:pair.privateKey.export({type:'pkcs8',format:'pem'}),publicKey,commit});}finally{process.umask(mask);}
 assert.equal((await stat(path.join(result.directory,'manifest.sig'))).mode&0o444,0o444);
 await bootstrap.verifyBundle(result.directory,publicKey,false);
 await assert.rejects(bootstrap.verifyBundle(result.directory,await readFile('release-keys/companion-ed25519.pub','utf8'),false),/signature/);
 assert.equal(original.child.exitCode,null);const after=await original.client.call('engine.info',{});assert.deepEqual(after.build,before.build);assert.ok((await original.client.call('sessions.list',{})).some(value=>value.id===session.id));assert.ok(raw.equals(await readFile(path.join(input,'manifest.json'))));
 const signed=await start(result.directory,'signed-copy'),info=await signed.client.call('engine.info',{});assert.equal(info.build.manifestSha256,result.manifestSha256);assert.equal(info.build.commit,commit);assert.equal(info.node,'22.23.4');assert.notEqual(signed.child.pid,original.child.pid);assert.equal(original.child.exitCode,null);
 await assert.rejects(packageEngine({inputDirectory:input,outputDirectory:path.join(output,'fixture-package'),signingKey:pair.privateKey.export({type:'pkcs8',format:'pem'}),publicKey,commit}),/already exists/);
 await bootstrap.verifyBundle(input,undefined,true);await bootstrap.verifyBundle(result.directory,publicKey,false);
 await save('report.json',{scope:'Actual complete development engine copied, signed with an ephemeral qualification key, inventoried and archived. Original service remains alive and retains its session; a distinct service starts from the signed copy. Not a release, installer, .app/VSIX, model test or installed rollback.',input,inputManifestSha256:sha(raw),inputFiles:Object.keys(manifest.files).length,result,original:{pid:original.child.pid,before:before.build,after:after.build,sessionPreserved:true},copy:{pid:signed.child.pid,build:info.build,node:info.node},sameInputBytesPreserved:true,productionKeyRejectsFixture:true,ephemeralPrivateKeyStored:false,existingOutputRejected:true,installationAllowed:false,publicationAllowed:false,productionTrustRootChanged:false,modelCalls:0});passed=true;console.log('IMMUTABLE_ENGINE_PACKAGE_QUALIFIED '+output);
}catch(error){await save('failure.json',{message:error.message,services:services.map(s=>({pid:s.child.pid,exitCode:s.child.exitCode}))});throw error;}
finally{
 for(const service of services){service.client?.close();if(service.child.exitCode===null){const end=once(service.child,'exit');service.child.kill('SIGTERM');await end;}}
 if(passed){assert.ok(services.every(s=>s.child.exitCode===0));await rm(root,{recursive:true,force:true});}else console.error('Original qualification state preserved: '+root);
 await save('closure.json',{services:services.map(s=>({pid:s.child.pid,exitCode:s.child.exitCode,signalCode:s.child.signalCode})),privateStateRemoved:passed});
}
