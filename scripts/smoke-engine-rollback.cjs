// Explicit, isolated rollback acceptance. It never changes the installed service.
const {createHash,randomBytes,verify}=require('node:crypto');
const {spawn}=require('node:child_process');
const {createReadStream}=require('node:fs');
const {mkdtemp,mkdir,readFile,writeFile,lstat,readdir,rm}=require('node:fs/promises');
const {tmpdir}=require('node:os');
const path=require('node:path');
const option=name=>process.argv.find(value=>value.startsWith(name+'='))?.slice(name.length+1);
const required=name=>{const value=option(name);if(!value)throw Error('Missing '+name);return path.resolve(value);};
async function verifiedSdk(directory,key){
  const raw=await readFile(path.join(directory,'manifest.json'));
  if(raw.length>1024*1024||!verify(null,raw,key,await readFile(path.join(directory,'manifest.sig'))))throw Error('SDK signature failed');
  const manifest=JSON.parse(raw);
  if(manifest.kind!=='companion-sdks'||!manifest.files||!manifest.files['typescript/client-ts/src/index.cjs']||!manifest.files['typescript/client-ts/src/bootstrap.cjs'])throw Error('Invalid SDK manifest');
  for(const [name,digest] of Object.entries(manifest.files)){
    if(!name||name.split(/[\\/]/).some(part=>!part||part==='.'||part==='..')||path.isAbsolute(name)||!/^[a-f0-9]{64}$/.test(digest))throw Error('Unsafe SDK file');
    let file=directory;for(const part of name.split('/')){file=path.join(file,part);if((await lstat(file)).isSymbolicLink())throw Error('SDK contains links');}
    if(!(await lstat(file)).isFile())throw Error('Invalid SDK entry');
    const h=createHash('sha256');for await(const block of createReadStream(file))h.update(block);
    if(h.digest('hex')!==digest)throw Error('SDK file integrity failed');
  }
  async function rejectExtra(folder){
    for(const entry of await readdir(folder,{withFileTypes:true})){
      const file=path.join(folder,entry.name),name=path.relative(directory,file).split(path.sep).join('/');
      if(entry.isSymbolicLink())throw Error('SDK contains links');
      if(entry.isDirectory())await rejectExtra(file);
      else if(!entry.isFile()||!Object.hasOwn(manifest.files,name)&&!['manifest.json','manifest.sig'].includes(name))throw Error('Undeclared SDK file');
    }
  }
  await rejectExtra(directory);
  return {Client:require(path.join(directory,'typescript/client-ts/src/index.cjs')).AgentClient,
    verifyBundle:require(path.join(directory,'typescript/client-ts/src/bootstrap.cjs')).verifyBundle};
}
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const digest=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
(async()=>{
  const current=required('--engine'),previous=required('--previous-engine');
  const model=option('--ollama-model');
  if(!model||!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(model))throw Error('Pass the exact configured Ollama model.');
  const key=await readFile(path.resolve('release-keys/companion-ed25519.pub'),'utf8');
  const currentSdk=await verifiedSdk(required('--sdk-dir'),key),previousSdk=await verifiedSdk(required('--previous-sdk-dir'),key);
  await currentSdk.verifyBundle(current,key,false);await previousSdk.verifyBundle(previous,key,false);
  const directory=await mkdtemp(path.join(tmpdir(),'companion-version-rollback-'));
  const id=createHash('sha256').update(directory).digest('hex');
  const credential={registration:{id,product:'companion-mac',profile:'explicit-rollback-smoke',workspace:'',providers:['ollama'],hostTools:[]},token:randomBytes(32).toString('base64url')};
  await mkdir(path.join(directory,'clients'),{mode:0o700});
  await writeFile(path.join(directory,'clients',id+'.json'),JSON.stringify(credential),{mode:0o600});
  const addressHash=createHash('sha256').update(path.resolve(directory)).digest('hex').slice(0,24);
  const address=process.platform==='win32'?`\\\\.\\pipe\\companion-${addressHash}`:path.join(directory.length<65?directory:path.join(tmpdir(),`companion-${process.getuid()}-${addressHash}`),'agent.sock');
  let child,stopped,client;
  const stop=async()=>{
    if(child&&child.exitCode===null&&child.signalCode===null){child.kill('SIGTERM');const timer=setTimeout(()=>child.kill('SIGKILL'),10000);try{await stopped;}finally{clearTimeout(timer);}}
  };
  const start=async(bundle,sdk)=>{
    child=spawn(path.join(bundle,process.platform==='win32'?'node.exe':'node'),[path.join(bundle,'service.cjs'),directory],{stdio:'ignore',windowsHide:true});
    stopped=new Promise(resolve=>child.once('exit',resolve));
    for(let n=0;n<100;n++){
      try{client=new sdk.Client({address,certificate:await readFile(path.join(directory,'server.crt'),'utf8'),credential});await client.connect();return await client.call('engine.info');}
      catch(error){client?.close();if(n===99||child.exitCode!==null)throw error;await new Promise(resolve=>setTimeout(resolve,100));}
    }
  };
  try{
    const first=await start(current,currentSdk);
    const session=await client.call('sessions.create',{title:'Post-update read-only history preserved by rollback'});
    const run=await client.startRun(session.id,'post-update-read-only',{runtime:'standard',mode:'plan',provider:{kind:'ollama',endpoint:'http://127.0.0.1:11434/v1',roles:{executor:model}},messages:[{role:'user',content:'Responda somente ROLLBACK_OK. Não use ferramentas e não acesse arquivos.'}],systemPrompt:'This is a read-only rollback installation check. Do not use tools.',tools:[],recursionLimit:30});
    const result=await client.waitForRun(run.id,session.id,()=>{},undefined,AbortSignal.timeout(180000));
    if(result.state!=='completed'||result.result?.text?.trim()!=='ROLLBACK_OK')throw Error('The post-update read-only run did not finish.');
    const before=await client.exportSession(session.id),beforeHash=digest(before);
    if(!(await client.call('engine.quiesceIfIdle')).accepted)throw Error('Refuse rollback while work is active');
    client.close();await stop();
    const prior=await start(previous,previousSdk);
    const after=await client.exportSession(session.id);
    if(digest(after)!==beforeHash)throw Error('Rollback changed the history produced after the update.');
    if((await client.call('runs.get',{id:run.id})).state!=='completed')throw Error('Rollback lost the completed run.');
    if(!(await client.call('engine.quiesceIfIdle')).accepted)throw Error('Refuse reactivation while work is active');
    client.close();await stop();
    const reactivated=await start(current,currentSdk);
    if(digest(await client.exportSession(session.id))!==beforeHash)throw Error('Reactivation changed the retained history.');
    const report={state:'passed',current:{version:first.version,build:first.build},previous:{version:prior.version,build:prior.build},reactivated:reactivated.version,historySha256:beforeHash,postUpdateRunPreserved:true,historyUnchanged:true,toolsConfigured:0,scope:'isolated-signed-binary-rollback'};
    if(option('--report'))await writeFile(path.resolve(option('--report')),JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify(report));
  }finally{client?.close();await stop();await rm(directory,{recursive:true,force:true});if(process.platform!=='win32'&&path.dirname(address)!==directory)await rm(path.dirname(address),{recursive:true,force:true});}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
