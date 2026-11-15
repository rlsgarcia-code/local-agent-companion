// Development QA of authored rules only. GDScript never executes on the host;
// the QA/controller files are excluded from the eventual player build.
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFile,writeFile,mkdir,lstat,copyFile} from 'node:fs/promises';
import path from 'node:path';
import adapter from '../dist-tests/packages/adapter-game-godot/src/index.js';
import processes from '../dist-tests/packages/adapter-game-container/src/process.js';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const suite=process.argv.find(value=>value.startsWith('--suite='))?.slice(8)??'rules';assert.ok(['rules','scene'].includes(suite),'Choose only the authored rules or scene suite.');
const stamp=new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID().slice(0,8);
const output=path.resolve('output/game-generation/mare-rules',stamp),source=path.join(output,'source');await mkdir(source,{recursive:true});
const files=[];
for(const name of (suite==='rules'?['project.godot','river.gd','data/courses.json','qa/check.gd']:['project.godot','river.gd','data/courses.json','main.gd','main.tscn','save_store.gd','sound.gd','qa/scene_check.gd'])){
 const file=path.resolve('examples/games/mare',name),stat=await lstat(file);assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=1024*1024);
 const data=await readFile(file),destination=path.join(source,name);await mkdir(path.dirname(destination),{recursive:true});await writeFile(destination,data,{mode:0o644});files.push({path:name,sha256:sha(data),size:data.length});
}
const config=path.resolve('.cache/game-toolchains/godot.json'),provision=JSON.parse(await readFile(config));
const driver=sha(await readFile('packages/adapter-game-godot/image/build.mjs'));
const state=path.resolve('.cache/mare-rules',stamp);await mkdir(state,{recursive:true,mode:0o700});
const toolchain=await adapter.createGodotGameAdapter({stateDirectory:state,driverSha256:driver,configPath:config});
const capability=await toolchain.probe({product:'companion-vscode'});assert.ok(capability.available,capability.reason);
assert.ok(!source.includes(','));
const binding=sha(Buffer.from(JSON.stringify({stamp,suite,files,image:provision.imageId,driver}))),name='companion-mare-rules-'+binding.slice(0,24),label='org.companion.mare-rules';
const command=(args,options)=>processes.dockerCommand(provision.dockerExecutable,args,options);
const save=(file,value)=>writeFile(path.join(output,file),JSON.stringify(value,null,2)+'\n');
async function inspect(){
 const listed=(await command(['container','ls','--all','--no-trunc','--filter',`name=^/${name}$`,'--format','{{.ID}}'])).toString().trim();
 if(!listed)return null;
 const [container]=JSON.parse((await command(['container','inspect',listed])).toString());
 assert.equal(container.Config?.Labels?.[label],binding,'Unrelated container; no cleanup allowed');assert.equal(container.Image,provision.imageId);return container;
}
const program=`const fs=require('node:fs');const cp=require('node:child_process');fs.mkdirSync('/work/project',{recursive:true});fs.cpSync('/source','/work/project',{recursive:true});const r=cp.spawnSync('/opt/godot/godot',['--headless','--path','/work/project','--script','res://qa/${suite==='rules'?'check':'scene_check'}.gd','--fixed-fps','60'],{encoding:'utf8',timeout:90000,maxBuffer:2097152});process.stdout.write(r.stdout||'');process.stderr.write(r.stderr||'');process.exit(r.error?125:r.status??126);`;
await save('control.json',{scope:'Native isolated Godot authored QA; not browser/physical/human acceptance',suite,files,binding,name,provision,driver,runnerSha256:sha(await readFile(new URL(import.meta.url)))});
let attempted=false,bytes,failure;
try{
 assert.equal(await inspect(),null,'Unique QA identity unexpectedly exists; inspect original only');attempted=true;
 await command(['create','--name',name,'--label',`${label}=${binding}`,'--pull=never','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--memory','3g','--memory-swap','3g','--cpus','2','--pids-limit','256','--log-driver','none','--user','65532:65532','--tmpfs','/work:rw,noexec,nosuid,size=768m,uid=65532,gid=65532,mode=0700','--tmpfs','/tmp:rw,noexec,nosuid,size=128m,mode=1777','--mount',`type=bind,src=${source},dst=/source,readonly`,'--env','HOME=/tmp/home','--env','XDG_DATA_HOME=/tmp/data','--env','XDG_CONFIG_HOME=/tmp/config','--env','XDG_CACHE_HOME=/tmp/cache','--entrypoint','/usr/local/bin/node',provision.imageId,'-e',program]);
 const owned=await inspect();assert.ok(owned);
 // Attach only to the acknowledged container; no shell or mounted output/keys.
 bytes=await command(['start','--attach',owned.Id],{timeout:120000,maxBytes:2097152});
 await writeFile(path.join(output,'godot.log'),bytes);
 const lines=bytes.toString().trim().split('\n'),result=lines.map(line=>{try{return JSON.parse(line);}catch{return null;}}).find(value=>value?.state==='passed');
 assert.ok(result,'Godot did not acknowledge a successful rules run');if(suite==='rules')assert.equal(result.courses.length,12);
 await save('candidate.json',result);
}catch(error){failure=error;await save('failure.json',{message:error instanceof Error?error.message:String(error)});}
finally{
 if(attempted){
  const owned=await inspect();if(owned)await command(['container','rm','--force',owned.Id]);assert.equal(await inspect(),null,'QA container is still present');
  await save('closure.json',{exactContainerAbsent:true,binding});
 }
}
if(failure)throw failure;
await save('report.json',{state:'passed',binding,rules:JSON.parse(await readFile(path.join(output,'candidate.json'))),sourceFiles:files,exactContainerAbsent:true,fullProductAcceptance:false});
console.log('MARE_RULES_RECORDED '+output);
