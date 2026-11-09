import {createHash} from 'node:crypto';
import {readFile,readdir,realpath} from 'node:fs/promises';
import {createRequire} from 'node:module';
import * as path from 'node:path';

/** Only CI owns this disposable user account; never stop a developer's live service. */
export async function cleanupEditorTestEngine(projectRoot,installedRoot,workspace){
  // GitHub documents RUNNER_ENVIRONMENT at https://docs.github.com/en/actions/reference/workflows-and-actions/variables
  if(process.env.GITHUB_ACTIONS!=='true'||process.env.RUNNER_ENVIRONMENT!=='github-hosted')return {stopped:false,reason:'not-owned-ci'};
  let expected;
  try{expected=await readFile(path.join(installedRoot,'dist/engine/manifest.json'));}
  catch(error){if(error.code==='ENOENT')return {stopped:false,reason:'no-packaged-engine'};throw error;}
  const require=createRequire(import.meta.url);
  const {AgentClient}=require(path.join(projectRoot,'dist-tests/packages/client-ts/src/index.js'));
  const {engineStateDirectory,engineAddress}=require(path.join(projectRoot,'dist-tests/packages/client-ts/src/bootstrap.js'));
  const state=engineStateDirectory();
  let runtime;
  try{runtime=JSON.parse(await readFile(path.join(state,'runtime.json'),'utf8'));}
  catch(error){if(error.code==='ENOENT')return {stopped:false,reason:'no-fixture-service'};throw error;}
  if(!Number.isSafeInteger(runtime.pid)||runtime.pid<=1)throw Error('Invalid CI engine process identity.');
  const canonical=await realpath(workspace),samePath=(left,right)=>process.platform==='win32'?left.toLowerCase()===right.toLowerCase():left===right;
  for(const name of await readdir(path.join(state,'clients'))){
    if(!/^[a-f0-9]{64}\.json$/.test(name))continue;
    const credential=JSON.parse(await readFile(path.join(state,'clients',name),'utf8'));
    const reg=credential.registration;
    if(reg.product!=='companion-vscode'||reg.profile!=='default'||typeof reg.workspace!=='string'||!samePath(reg.workspace,canonical))continue;
    const client=new AgentClient({address:engineAddress(state),certificate:await readFile(path.join(state,'server.crt'),'utf8'),credential});
    try{
      await client.connect();const info=await client.call('engine.info');
      if(info.build?.manifestSha256!==createHash('sha256').update(expected).digest('hex'))throw Error('Refuse to stop an engine outside this exact CI fixture.');
      if(!(await client.call('engine.quiesceIfIdle')).accepted)throw Error('The CI fixture still has work; teardown will not cancel it.');
      try{if(!(await client.call('engine.shutdownIfIdle')).accepted)throw Error('The idle CI engine refused explicit shutdown.');}
      catch(error){if(client.connected)throw error;}
      for(let n=0;n<100&&client.connected;n++)await new Promise(resolve=>setTimeout(resolve,50));
      if(client.connected)throw Error('The CI fixture service did not close after its explicit shutdown.');
      let exited=false;
      for(let n=0;n<100&&!exited;n++){
        try{process.kill(runtime.pid,0);}catch(error){if(error.code!=='ESRCH')throw error;exited=true;}
        if(!exited)await new Promise(resolve=>setTimeout(resolve,100));
      }
      if(!exited)throw Error('The CI service closed its endpoint but its original process did not exit.');
      return {stopped:true,processExited:true,version:info.version};
    }finally{client.close();}
  }
  throw Error('A CI engine exists but its original fixture registration was not found.');
}
