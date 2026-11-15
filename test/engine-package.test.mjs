import assert from 'node:assert/strict';
import test from 'node:test';
import {generateKeyPairSync,createHash,verify} from 'node:crypto';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm,symlink,chmod,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {packageEngine,assertReleaseCheckout} from '../scripts/package-engine.mjs';
const run=promisify(execFile),sha=data=>createHash('sha256').update(data).digest('hex');
const versions=JSON.parse(await readFile('packages/contracts/src/version.json','utf8'));
const keys=()=>{const pair=generateKeyPairSync('ed25519');return {signingKey:pair.privateKey.export({type:'pkcs8',format:'pem'}),publicKey:pair.publicKey.export({type:'spki',format:'pem'})};};
async function snapshot(root){const result={};async function visit(dir){for(const entry of await readdir(dir,{withFileTypes:true})){const name=path.join(dir,entry.name);if(entry.isDirectory())await visit(name);else result[path.relative(root,name)]=sha(await readFile(name));}}await visit(root);return result;}
async function fixture(){
 const root=await mkdtemp(path.join(tmpdir(),'engine-package-')),inputDirectory=path.join(root,'input'),outputDirectory=path.join(root,'release');await mkdir(path.join(inputDirectory,'native/empty'),{recursive:true});
 const files={};for(const [name,data]of [['service.cjs','// synthetic entrypoint, never executed'],['bootstrap-lock.cjs','// synthetic lock, never executed'],[process.platform==='win32'?'node.exe':'node','synthetic Node bytes, not a runtime'],['LICENSE','Synthetic fixture notice']]){const bytes=Buffer.from(data);await writeFile(path.join(inputDirectory,name),bytes);files[name]=sha(bytes);}
 const manifest={version:versions.engine,protocol:versions.protocol,node:versions.node,target:`${process.platform}-${process.arch}`,development:true,files};await writeFile(path.join(inputDirectory,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
 return {root,inputDirectory,outputDirectory,...keys(),commit:'a'.repeat(40),manifest,async close(){await rm(root,{recursive:true,force:true});}};
}
test('engine signing copies exact verified bytes, preserves the development input and exclusively publishes a verified archive',async()=>{
 const f=await fixture(),mask=process.umask(0o077);try{
  const before=await snapshot(f.inputDirectory),result=await packageEngine(f);assert.deepEqual(await snapshot(f.inputDirectory),before);
  assert.equal(JSON.parse(await readFile(path.join(f.inputDirectory,'manifest.json'),'utf8')).development,true);
  const raw=await readFile(path.join(result.directory,'manifest.json')),signed=JSON.parse(raw);assert.equal(signed.development,undefined);assert.equal(signed.commit,f.commit);assert.equal(result.inputManifestSha256,before['manifest.json']);
  assert.ok(verify(null,raw,f.publicKey,await readFile(path.join(result.directory,'manifest.sig'))));
  if(process.platform!=='win32')assert.equal((await stat(path.join(result.directory,'manifest.sig'))).mode&0o444,0o444,'Public signature metadata must remain readable in a shared per-computer installation');
  const files=await snapshot(result.directory);for(const [name,hash]of Object.entries(f.manifest.files))assert.equal(files[name],hash);
  assert.equal(sha(await readFile(result.archive)),result.sha256);assert.equal(await readFile(result.archive+'.sha256','utf8'),`${result.sha256}  ${path.basename(result.archive)}\n`);
  const listing=(await run('tar',['-tzf',result.archive])).stdout.split(/\r?\n/).filter(Boolean);assert.ok(listing.includes('engine-dist/manifest.sig'));assert.ok(listing.includes('engine-dist/native/empty/'));assert.ok(listing.every(name=>name==='engine-dist/'||name.startsWith('engine-dist/')));
  assert.deepEqual(Buffer.from((await run('tar',['-xOf',result.archive,'engine-dist/manifest.json'],{encoding:'buffer'})).stdout),raw);
  await assert.rejects(packageEngine(f),/already exists/);assert.deepEqual(await snapshot(f.inputDirectory),before);assert.deepEqual(await snapshot(result.directory),files);assert.equal(sha(await readFile(result.archive)),result.sha256);
 }finally{process.umask(mask);await f.close();}
});
test('missing/wrong keys, forged commit, corrupt input and nested/symlinked output fail without changing source',async()=>{
 const f=await fixture();try{
  const before=await snapshot(f.inputDirectory);
  for(const changed of [{signingKey:undefined},{...keys(),publicKey:f.publicKey},{commit:'not-a-commit'},{outputDirectory:path.join(f.inputDirectory,'release')},{outputDirectory:f.root}])await assert.rejects(packageEngine({...f,...changed}));
  if(process.platform!=='win32'){const alias=path.join(f.root,'input-alias');await symlink(f.inputDirectory,alias);await assert.rejects(packageEngine({...f,outputDirectory:path.join(alias,'release')}),/disjoint/);}
  assert.deepEqual(await snapshot(f.inputDirectory),before);
  await writeFile(path.join(f.inputDirectory,'service.cjs'),'changed after build');await assert.rejects(packageEngine(f),/integrity/);assert.equal(await readFile(path.join(f.inputDirectory,'service.cjs'),'utf8'),'changed after build');
  await assert.rejects(readFile(path.join(f.outputDirectory,'companion-engine-'+f.manifest.version+'-'+f.manifest.target+'.tar.gz')),{code:'ENOENT'});
 }finally{await f.close();}
});
test('an old signed candidate cannot become another release input and an archive collision is preserved',async()=>{
 const f=await fixture();try{
  const result=await packageEngine(f),before=await snapshot(result.directory);await assert.rejects(packageEngine({...f,inputDirectory:result.directory,outputDirectory:path.join(f.root,'other')}),/development build/);assert.deepEqual(await snapshot(result.directory),before);
  const other=path.join(f.root,'collision');await mkdir(other);const archive=path.join(other,path.basename(result.archive));await writeFile(archive,'existing accepted archive');await assert.rejects(packageEngine({...f,outputDirectory:other}),/already exists/);assert.equal(await readFile(archive,'utf8'),'existing accepted archive');
 }finally{await f.close();}
});
test('release provenance requires the exact clean checkout and does not erase uncommitted work',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'engine-release-git-'));try{
  const env={...Object.fromEntries(['PATH','SystemRoot','WINDIR','COMSPEC','TMP','TEMP'].filter(k=>process.env[k]!==undefined).map(k=>[k,process.env[k]])),GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:process.platform==='win32'?'NUL':'/dev/null'};
  const git=async args=>run('git',['-c','user.name=Fixture','-c','user.email=fixture@invalid.test',...args],{cwd:root,env});await git(['init']);await writeFile(path.join(root,'source.txt'),'reviewed source');await git(['add','source.txt']);await git(['-c','commit.gpgSign=false','commit','-m','fixture']);
  const commit=(await git(['rev-parse','HEAD'])).stdout.trim();assert.equal(await assertReleaseCheckout(root,commit),commit);await assert.rejects(assertReleaseCheckout(root,'f'.repeat(40)),/exact checked-out/);
  await writeFile(path.join(root,'source.txt'),'new work');await assert.rejects(assertReleaseCheckout(root,commit),/uncommitted/);assert.equal(await readFile(path.join(root,'source.txt'),'utf8'),'new work');
  await writeFile(path.join(root,'source.txt'),'reviewed source');await writeFile(path.join(root,'new-file.txt'),'new source');await assert.rejects(assertReleaseCheckout(root,commit),/uncommitted/);assert.equal(await readFile(path.join(root,'new-file.txt'),'utf8'),'new source');
 }finally{await rm(root,{recursive:true,force:true});}
});
test('publishing secrets and tar options are absent from the archive child environment',{skip:process.platform==='win32'?'POSIX executable probe; Windows real tar packaging above remains covered':false},async()=>{
 const f=await fixture(),names=['PATH','COMPANION_RELEASE_SIGNING_KEY','GH_TOKEN','TAR_OPTIONS'],old=Object.fromEntries(names.map(name=>[name,process.env[name]]));try{
  const realTar=(await run('which',['tar'])).stdout.trim(),bin=path.join(f.root,'bin'),observed=path.join(f.root,'archive-env.json');await mkdir(bin);
  const code=`#!${process.execPath}\nconst fs=require('node:fs'),cp=require('node:child_process');fs.writeFileSync(${JSON.stringify(observed)},JSON.stringify({signingKeyPresent:Boolean(process.env.COMPANION_RELEASE_SIGNING_KEY),githubTokenPresent:Boolean(process.env.GH_TOKEN),tarOptionsPresent:Boolean(process.env.TAR_OPTIONS)}));const r=cp.spawnSync(${JSON.stringify(realTar)},process.argv.slice(2),{stdio:'inherit',env:process.env});process.exit(r.status??1);\n`;
  await writeFile(path.join(bin,'tar'),code);await chmod(path.join(bin,'tar'),0o700);process.env.PATH=bin+path.delimiter+old.PATH;process.env.COMPANION_RELEASE_SIGNING_KEY='fixture-sentinel';process.env.GH_TOKEN='fixture-sentinel';process.env.TAR_OPTIONS='--not-an-allowed-option';
  await packageEngine(f);assert.deepEqual(JSON.parse(await readFile(observed,'utf8')),{signingKeyPresent:false,githubTokenPresent:false,tarOptionsPresent:false});
 }finally{for(const name of names){if(old[name]===undefined)delete process.env[name];else process.env[name]=old[name];}await f.close();}
});
test('a changed archive operation that drops an empty source directory is refused before final publication',{skip:process.platform==='win32'?'POSIX executable fault injection':false},async()=>{
 const f=await fixture(),originalPath=process.env.PATH;try{
  const before=await snapshot(f.inputDirectory),realTar=(await run('which',['tar'])).stdout.trim(),bin=path.join(f.root,'bin');await mkdir(bin);
  const code=`#!${process.execPath}\nconst fs=require('node:fs'),cp=require('node:child_process'),path=require('node:path'),args=process.argv.slice(2);if(args[0]==='-czf')fs.rmdirSync(path.join(args[3],'engine-dist/native/empty'));const r=cp.spawnSync(${JSON.stringify(realTar)},args,{stdio:'inherit',env:process.env});process.exit(r.status??1);\n`;
  await writeFile(path.join(bin,'tar'),code);await chmod(path.join(bin,'tar'),0o700);process.env.PATH=bin+path.delimiter+originalPath;
  await assert.rejects(packageEngine(f),/omitted original engine directories/);assert.deepEqual(await snapshot(f.inputDirectory),before);assert.deepEqual(await readdir(path.join(f.inputDirectory,'native')),['empty']);
  const archive=path.join(f.outputDirectory,`companion-engine-${f.manifest.version}-${f.manifest.target}.tar.gz`);await assert.rejects(readFile(archive),{code:'ENOENT'});assert.ok((await readFile(archive+'.partial')).length>0);
 }finally{process.env.PATH=originalPath;await f.close();}
});
