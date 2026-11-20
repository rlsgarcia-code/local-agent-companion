import {createHash,createPublicKey,sign} from 'node:crypto';
import {createReadStream,createWriteStream} from 'node:fs';
import {readFile,writeFile,mkdir,cp,realpath,lstat,link,unlink,appendFile,readdir,chmod} from 'node:fs/promises';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pipeline} from 'node:stream/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import * as path from 'node:path';

const projectRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const run=promisify(execFile),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const childEnvironment=()=>({...Object.fromEntries(['PATH','SystemRoot','WINDIR','COMSPEC','TMP','TEMP','LANG','LC_ALL','TZ'].filter(key=>process.env[key]!==undefined).map(key=>[key,process.env[key]])),COPYFILE_DISABLE:'1'});
let verifierPromise;
async function verifier(){
 return verifierPromise??=(async()=>{
  const code="const esbuild=await import('esbuild');const result=await esbuild.build({entryPoints:[process.argv[1]],bundle:true,platform:'node',format:'cjs',write:false,logLevel:'silent'});process.stdout.write(result.outputFiles[0].text);";
  const {stdout}=await run(process.execPath,['--input-type=module','-e',code,path.join(projectRoot,'packages/client-ts/src/bootstrap.ts')],{cwd:projectRoot,env:childEnvironment(),maxBuffer:32*1024*1024});
  const module={exports:{}};new Function('module','exports','require',stdout)(module,module.exports,createRequire(import.meta.url));return module.exports;
 })();
}
const contains=(a,b)=>{const relative=path.relative(a,b);return relative===''||!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative);};
async function prospective(name){
 try{return await realpath(name);}catch(error){if(error.code!=='ENOENT')throw error;const parent=path.dirname(name);if(parent===name)throw error;return path.join(await prospective(parent),path.basename(name));}
}
async function absent(file){try{await lstat(file);}catch(error){if(error.code==='ENOENT')return;throw error;}throw Error('An engine candidate/archive already exists; choose a new reviewed version or output root.');}

/** CLI provenance guard. Never label a dirty source tree as a reviewed commit. */
export async function assertReleaseCheckout(directory=projectRoot,requestedCommit){
 const env={...childEnvironment(),GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:process.platform==='win32'?'NUL':'/dev/null'};
 const {stdout:head}=await run('git',['rev-parse','HEAD'],{cwd:directory,env});const commit=head.trim();
 if(!/^[a-f0-9]{40}$/.test(commit)||requestedCommit&&requestedCommit!==commit)throw Error('The release commit must be the exact checked-out Git commit.');
 const {stdout:status}=await run('git',['-c','core.fsmonitor=false','--no-optional-locks','status','--porcelain','--untracked-files=normal'],{cwd:directory,env,maxBuffer:8*1024*1024});
 if(status.trim())throw Error('Release source contains uncommitted changes. Preserve them and create a reviewed commit before signing.');
 return commit;
}

/** Trusted build operation, not an RPC. New immutable output only; no input
 * rewrite, development-key fallback, provider call or key inherited by tar. */
export async function packageEngine({inputDirectory,outputDirectory,signingKey,publicKey,commit}){
 if(!signingKey||!publicKey)throw Error('A release requires the configured Companion publishing key and pinned public key; unsigned builds remain development artifacts.');
 if(!/^[a-f0-9]{40}$/.test(commit??''))throw Error('A release requires its exact source commit.');
 if(!createPublicKey(signingKey).export({type:'spki',format:'der'}).equals(createPublicKey(publicKey).export({type:'spki',format:'der'})))throw Error('The publishing key does not match the pinned Companion public key.');
 const input=await realpath(path.resolve(inputDirectory)),output=await prospective(path.resolve(outputDirectory));
 if(contains(input,output)||contains(output,input))throw Error('Engine input and release output must be disjoint; the input is never modified.');
 const raw=await readFile(path.join(input,'manifest.json')),manifest=JSON.parse(raw.toString('utf8'));
 if(manifest.development!==true)throw Error('Only an explicit development build may become a new candidate. Preserve existing signed releases unchanged.');
 const {verifyBundle}=await verifier();await verifyBundle(input,undefined,true);
 const base=`companion-engine-${manifest.version}-${manifest.target}`;
 const candidate=path.join(output,base),directory=path.join(candidate,'engine-dist'),archive=path.join(output,base+'.tar.gz'),partial=archive+'.partial';
 await absent(candidate);await absent(archive);await absent(partial);await absent(archive+'.sha256');
 await mkdir(output,{recursive:true});if(await realpath(output)!==output)throw Error('Release output changed during preparation.');
 await mkdir(candidate,{mode:0o700}); // EEXIST preserves any previous candidate.
 await cp(input,directory,{recursive:true,dereference:false,force:false,errorOnExist:true});
 await verifyBundle(directory,undefined,true);
 if(sha(await readFile(path.join(directory,'manifest.json')))!==sha(raw))throw Error('The input manifest changed during preparation; preserve both copies.');
 const signed={...manifest,commit};delete signed.development;
 const bytes=Buffer.from(JSON.stringify(signed,null,2)+'\n');
 await writeFile(path.join(directory,'manifest.json'),bytes);
 // Signature is public verification metadata, including shared Root installs.
 // The private publishing key is never written into this tree.
 await writeFile(path.join(directory,'manifest.sig'),sign(null,bytes,signingKey),{flag:'wx',mode:0o644});
 await chmod(path.join(directory,'manifest.sig'),0o644); // Independent of the publisher's private umask.
 await verifyBundle(directory,publicKey,false);
 await verifyBundle(input,undefined,true);if(sha(await readFile(path.join(input,'manifest.json')))!==sha(raw))throw Error('The original development input changed during signing.');
 const expected=new Set([...Object.keys(signed.files),'manifest.json','manifest.sig'].map(name=>'engine-dist/'+name)),directories=new Set(['engine-dist/']);
 // verifyBundle permits real empty directories. Preserve the actual verified
 // layout, including filtered native dependency folders, without accepting a
 // directory that appears only while tar reads the source.
 async function inventory(folder){for(const entry of await readdir(folder,{withFileTypes:true})){
  if(entry.isSymbolicLink())throw Error('The signed candidate changed to contain a symbolic link.');
  if(entry.isDirectory()){const next=path.join(folder,entry.name);directories.add('engine-dist/'+path.relative(directory,next).split(path.sep).join('/')+'/');if(directories.size>100000)throw Error('The candidate directory inventory exceeds its budget.');await inventory(next);}
 }}
 await inventory(directory);
 const child=spawn('tar',['-czf','-','-C',candidate,'engine-dist'],{env:childEnvironment(),stdio:['ignore','pipe','pipe']});
 let diagnosticBytes=0;child.stderr.on('data',chunk=>{diagnosticBytes+=chunk.length;});
 const ended=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>code===0?resolve():reject(Error(`The engine archive did not complete (${code??signal}); preserve its partial output (${diagnosticBytes} diagnostic bytes).`)));});
 try{await Promise.all([pipeline(child.stdout,createWriteStream(partial,{flags:'wx',mode:0o600})),ended]);}
 catch(error){if(child.exitCode===null&&child.signalCode===null){const end=new Promise(resolve=>child.once('close',resolve));child.kill('SIGTERM');await end;}throw error;}
 const {stdout:listing}=await run('tar',['-tzf',partial],{env:childEnvironment(),maxBuffer:32*1024*1024}),seen=new Set(),seenDirectories=new Set();
 for(const name of listing.split(/\r?\n/).filter(Boolean)){
  if(name.endsWith('/')){if(!directories.has(name)||seenDirectories.has(name))throw Error('The archive contains an undeclared/duplicate directory. Preserve the partial candidate.');seenDirectories.add(name);}
  else{if(!expected.has(name)||seen.has(name))throw Error('The archive contains an undeclared/duplicate file. Preserve the partial candidate.');seen.add(name);}
 }
 if(seen.size!==expected.size)throw Error('The archive omitted signed engine files. Preserve the partial candidate.');
 if(seenDirectories.size!==directories.size)throw Error('The archive omitted original engine directories. Preserve the partial candidate.');
 for(const [name,expectedBytes]of [['manifest.json',bytes],['manifest.sig',await readFile(path.join(directory,'manifest.sig'))]]){
  const {stdout}=await run('tar',['-xOf',partial,'engine-dist/'+name],{env:childEnvironment(),encoding:'buffer',maxBuffer:8*1024*1024});
  if(!expectedBytes.equals(stdout))throw Error('The archived signature/manifest differs from the verified candidate.');
 }
 await verifyBundle(directory,publicKey,false);
 if(!bytes.equals(await readFile(path.join(directory,'manifest.json'))))throw Error('The signed candidate changed during archiving.');
 const hash=createHash('sha256');for await(const chunk of createReadStream(partial))hash.update(chunk);const digest=hash.digest('hex');
 await link(partial,archive); // Exclusive publication, not an overwriting rename.
 await unlink(partial);await writeFile(archive+'.sha256',`${digest}  ${path.basename(archive)}\n`,{flag:'wx',mode:0o600});
 return {directory,archive,sha256:digest,manifestSha256:sha(bytes),inputManifestSha256:sha(raw),archiveFileCount:seen.size,archiveDirectoryCount:directories.size,version:manifest.version,target:manifest.target,commit};
}

export async function runEnginePackageCli(args=process.argv.slice(2)){
 if(args.length>2||args.some(arg=>!/^--(?:input|output)=.+/.test(arg))||new Set(args.map(arg=>arg.split('=')[0])).size!==args.length)throw Error('Usage: package-engine.mjs [--input=<bundle>] [--output=<new-release-root>]');
 const versions=JSON.parse(await readFile(path.join(projectRoot,'packages/contracts/src/version.json'),'utf8'));if(process.versions.node!==versions.node)throw Error(`Use bundled Node ${versions.node} for engine packaging.`);
 const commit=await assertReleaseCheckout(projectRoot,process.env.GITHUB_SHA);
 const result=await packageEngine({inputDirectory:args.find(arg=>arg.startsWith('--input='))?.slice(8)??path.join(projectRoot,'engine-dist'),outputDirectory:args.find(arg=>arg.startsWith('--output='))?.slice(9)??path.join(projectRoot,'release/engine'),signingKey:process.env.COMPANION_RELEASE_SIGNING_KEY,publicKey:await readFile(path.join(projectRoot,'release-keys/companion-ed25519.pub'),'utf8'),commit});
 if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,`bundle=${result.directory}\narchive=${result.archive}\n`);
 process.stdout.write(`SIGNED_ENGINE_READY ${JSON.stringify(result)}\n`);return result;
}
