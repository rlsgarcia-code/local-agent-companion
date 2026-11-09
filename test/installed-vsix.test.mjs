import assert from 'node:assert/strict';
import {createWriteStream} from 'node:fs';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink} from 'node:fs/promises';
import {once} from 'node:events';
import {tmpdir} from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import yazl from 'yazl';
import {runBoundedCli} from '../scripts/editor-test-cli.mjs';
import {installedVSIXDirectory} from '../scripts/verify-installed-vsix.mjs';
async function fixture(context){
  const root=await mkdtemp(path.join(tmpdir(),'verified-vsix-'));
  context.after(()=>rm(root,{recursive:true,force:true}));
  const extensions=path.join(root,'extensions'),installed=path.join(extensions,'local.fixture-1.0.0');
  const manifest={name:'fixture',publisher:'local',version:'1.0.0',main:'./dist/extension.js'};
  const files={'package.json':JSON.stringify(manifest),'dist/extension.js':'verified-ui','dist/engine/node':'verified-node','dist/engine/service.cjs':'verified-service'};
  const archive=path.join(root,'fixture.vsix'),zip=new yazl.ZipFile();
  for(const [name,value] of Object.entries(files)){
    zip.addBuffer(Buffer.from(value),'extension/'+name);
    const target=path.join(installed,name);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,value);
  }
  const output=createWriteStream(archive);zip.outputStream.pipe(output);zip.end();await once(output,'close');
  return {archive,extensions,installed,manifest};
}

test('accepts only the exact installed VSIX payload while allowing editor metadata',async context=>{
  const f=await fixture(context);
  await writeFile(path.join(f.installed,'package.json'),JSON.stringify({...f.manifest,__metadata:{installedTimestamp:123}}));
  assert.equal(await installedVSIXDirectory(f.archive,f.extensions),f.installed);
});

test('rejects a wrong version, altered UI and incomplete native engine even when package.json exists',async context=>{
  const f=await fixture(context),manifest=path.join(f.installed,'package.json');
  await writeFile(manifest,JSON.stringify({...f.manifest,version:'0.9.0'}));
  assert.equal(await installedVSIXDirectory(f.archive,f.extensions),undefined);
  await writeFile(manifest,JSON.stringify(f.manifest));await writeFile(path.join(f.installed,'dist/extension.js'),'modified-ui');
  assert.equal(await installedVSIXDirectory(f.archive,f.extensions),undefined);
  await writeFile(path.join(f.installed,'dist/extension.js'),'verified-ui');await rm(path.join(f.installed,'dist/engine/node'));
  assert.equal(await installedVSIXDirectory(f.archive,f.extensions),undefined);
});

test('does not accept an installed symlink even when its target has identical bytes',async context=>{
  const f=await fixture(context),target=path.join(f.installed,'dist/engine/node'),external=path.join(path.dirname(f.extensions),'external-runtime');
  await writeFile(external,await readFile(target));await rm(target);
  try{await symlink(external,target);}catch(error){
    if(process.platform==='win32'&&error.code==='EPERM'){context.skip('The runner denied file symlink creation.');return;}
    throw error;
  }
  assert.equal(await installedVSIXDirectory(f.archive,f.extensions),undefined);
});


test('CLI completion does not wait for pipes inherited by a detached Electron descendant',async()=>{
  let pid;
  try{
    const program=`const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e','setTimeout(()=>{},15000)'],{detached:true,stdio:['ignore','inherit','inherit']});console.log(child.pid);child.unref();process.exit(0);`;
    const result=await runBoundedCli(process.execPath,['-e',program],{timeout:3000});
    pid=Number(result.stdout.trim());assert.ok(Number.isInteger(pid)&&pid>0);
  }finally{if(pid)try{process.kill(pid);}catch(error){if(error.code!=='ESRCH')throw error;}}
});
