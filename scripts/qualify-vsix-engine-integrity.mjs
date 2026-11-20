// Real VSCE archive with an existing test-signed engine; never installs it or
// changes the product key. All source/engine references are read-only inputs.
import assert from 'node:assert/strict';
import {createHash,createPublicKey} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {readFile,writeFile,mkdir,cp,readdir,lstat} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createRequire} from 'node:module';
import path from 'node:path';
import bootstrap from '../dist-tests/packages/client-ts/src/bootstrap.js';
import {verifyPackagedEngine} from './package-native.mjs';
const run=promisify(execFile),require=createRequire(import.meta.url);
const option=name=>{const item=process.argv.find(arg=>arg.startsWith(name+'='));if(!item)throw Error('Missing '+name);return path.resolve(item.slice(name.length+1));};
assert.equal(process.argv.length,5);
const engine=option('--engine'),keyFile=option('--key'),output=option('--output');
const versions=JSON.parse(await readFile('packages/contracts/src/version.json','utf8'));assert.equal(process.versions.node,versions.node);
await mkdir(output); // Exclusive: retain every previous candidate/failure.
const save=(name,value)=>writeFile(path.join(output,name),JSON.stringify(value,null,2)+'\n');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
async function hashFile(file){const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest('hex');}
async function inventory(root){const files=[];async function visit(folder){for(const entry of await readdir(folder,{withFileTypes:true})){
 const file=path.join(folder,entry.name);if(entry.isSymbolicLink())throw Error('Fixture refuses linked source inputs');
 if(entry.isDirectory())await visit(file);else{assert.ok(entry.isFile());const info=await lstat(file);files.push({path:path.relative(root,file).split(path.sep).join('/'),sha256:await hashFile(file),size:info.size,mode:info.mode&0o777});}
 }}await visit(root);return files.sort((a,b)=>a.path.localeCompare(b.path));}
try{
 const publicKey=await readFile(keyFile,'utf8'),productionKey=await readFile('release-keys/companion-ed25519.pub','utf8');
 const der=key=>createPublicKey(key).export({type:'spki',format:'der'});
 assert.ok(!der(publicKey).equals(der(productionKey)),'This runner is only for a non-production qualification key; use the release CLI for official inputs.');
 await bootstrap.verifyBundle(engine,publicKey,false);
 await assert.rejects(bootstrap.verifyBundle(engine,productionKey,false),/signature/);
 const manifestBytes=await readFile(path.join(engine,'manifest.json')),signatureBytes=await readFile(path.join(engine,'manifest.sig')),manifest=JSON.parse(manifestBytes);
 const inputEngine=await inventory(engine),inputClient=await inventory('dist');
 await save('qualification-only.json',{installationAllowed:false,publicationAllowed:false,productionTrustRootChanged:false,modelCalls:0,reason:'Existing ephemeral test signature; installed product keeps its real pinned key and must reject this engine. This VSIX is archive qualification only.'});
 await save('control.json',{observerSha256:await hashFile('scripts/qualify-vsix-engine-integrity.mjs'),verifierSha256:await hashFile('scripts/package-native.mjs'),bootstrapSourceSha256:await hashFile('packages/client-ts/src/bootstrap.ts'),compiledBootstrapSha256:await hashFile('dist-tests/packages/client-ts/src/bootstrap.js'),manifestSha256:sha(manifestBytes),signatureSha256:sha(signatureBytes),publicKeySha256:sha(der(publicKey)),inputClient});
 const staging=path.join(output,'staging');await mkdir(staging);
 for(const name of ['package.json','README.md','LICENSE','.vscodeignore','media/extension-icon.png']){await mkdir(path.dirname(path.join(staging,name)),{recursive:true});await cp(name,path.join(staging,name));}
 await cp(path.resolve('dist'),path.join(staging,'dist'),{recursive:true,dereference:false,filter:file=>file!==path.resolve('dist/engine')});
 await cp(engine,path.join(staging,'dist/engine'),{recursive:true,dereference:false});
 const home=path.join(output,'private-home');await mkdir(home,{mode:0o700});
 const env={...Object.fromEntries(['PATH','SystemRoot','WINDIR','COMSPEC','TMP','TEMP','LANG','LC_ALL','TZ'].filter(k=>process.env[k]!==undefined).map(k=>[k,process.env[k]])),HOME:home,USERPROFILE:home,XDG_CONFIG_HOME:path.join(home,'config'),XDG_CACHE_HOME:path.join(home,'cache'),COPYFILE_DISABLE:'1'};
 const archive=path.join(output,'QUALIFICATION-ONLY.vsix');
 const result=await run(process.execPath,[require.resolve('@vscode/vsce/vsce'),'package','--no-dependencies','--no-rewrite-relative-links','--target',manifest.target,'--out',archive],{cwd:staging,env,maxBuffer:4*1024*1024});
 await writeFile(path.join(output,'vsce.log'),result.stdout+'\n'+result.stderr);
 const verification=await verifyPackagedEngine(archive,manifest,{manifestBytes,signatureBytes,publicKey});
 assert.equal(verification.files,Object.keys(manifest.files).length+2);
 assert.deepEqual(await inventory(engine),inputEngine);assert.deepEqual(await inventory('dist'),inputClient);
 await bootstrap.verifyBundle(path.join(staging,'dist/engine'),publicKey,false);
 await save('report.json',{scope:'Real VSCE packaging of a temporary copy of the compiled client and complete real engine with an existing ephemeral qualification signature. No activation, installed acceptance or production signing.',engine,manifestSha256:sha(manifestBytes),signatureSha256:sha(signatureBytes),target:manifest.target,engineVersion:manifest.version,clientVersion:JSON.parse(await readFile('package.json','utf8')).version,providerVariant:JSON.parse(await readFile('dist/provider-variant.json','utf8')).providerVariant,node:process.versions.node,vsce:require('@vscode/vsce/package.json').version,archive,pathSha256:await hashFile(archive),archiveBytes:(await lstat(archive)).size,verification,engineFilesAndModesUnchanged:true,clientFilesAndModesUnchanged:true,productionKeyRejectsFixture:true,productionTrustRootChanged:false,installationAllowed:false,publicationAllowed:false,modelCalls:0});
 console.log('VSIX_ENGINE_INTEGRITY_QUALIFIED '+output);
}catch(error){await save('failure.json',{message:error.message,stdout:error.stdout,stderr:error.stderr});throw error;}
