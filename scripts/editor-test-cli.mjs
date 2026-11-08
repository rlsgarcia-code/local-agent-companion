import {spawn} from 'node:child_process';

/** Resolve on the CLI's exit, closing pipes that Electron descendants can keep alive on Windows. */
export function runBoundedCli(executable,args,{env=process.env,timeout=120_000}={}){
  return new Promise((resolve,reject)=>{
    const child=spawn(executable,args,{env,windowsHide:true,stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='',finished=false;
    child.stdout.on('data',data=>stdout=(stdout+data.toString()).slice(-64*1024));
    child.stderr.on('data',data=>stderr=(stderr+data.toString()).slice(-64*1024));
    const finish=(error,code)=>{
      if(finished)return;finished=true;clearTimeout(timer);
      child.stdout.destroy();child.stderr.destroy();
      if(error||code!==0)reject(Object.assign(error??new Error(`VS Code CLI failed with exit ${code}: ${stderr}`),{exitCode:code,stdout,stderr}));
      else resolve({stdout,stderr});
    };
    const timer=setTimeout(()=>{child.kill();finish(new Error('VS Code installation CLI timed out'),null);},timeout);
    child.once('error',error=>finish(error,null));
    child.once('exit',code=>finish(undefined,code));
  });
}
