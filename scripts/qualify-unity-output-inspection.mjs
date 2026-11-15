// Exact bundled Node and independent, pure candidate inspection. Synthetic raw
// output only: no Unity/Hub, player, project code, provider, license or adapter.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import bootstrap from '../dist-tests/packages/client-ts/src/bootstrap.js';
import fixtures from '../dist-tests/test/unity-output-fixtures.js';

const args=process.argv.slice(2);assert.equal(args.length,1);assert.ok(args[0].startsWith('--engine=')&&args[0].slice(9));const engine=path.resolve(args[0].slice(9));
await bootstrap.verifyBundle(engine,undefined,true);
const manifest=JSON.parse(await readFile(path.join(engine,'manifest.json'),'utf8'));assert.ok(manifest.files['unity-output-inspector.cjs']);
const output=path.resolve('output/game-generation/unity-output-inspection',new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID().slice(0,8));await mkdir(output,{recursive:true});
const temporary=await mkdtemp(path.join(tmpdir(),'unity-output-inspection-'));let child,passed=false;
const f=fixtures.unityOutputFixture('3d'),archive=f.archive(),diagnostic=f.diagnostic(),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const files={'candidate.tar':archive,'unity-build.json':diagnostic,'expected.json':Buffer.from(JSON.stringify(f.settings))};
for(const [name,bytes]of Object.entries(files))await writeFile(path.join(temporary,name),bytes,{flag:'wx',mode:0o600});
const body=`const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const inspector=require(process.argv[2]),directory=process.argv[3];
const archive=fs.readFileSync(path.join(directory,'candidate.tar')),diagnostic=fs.readFileSync(path.join(directory,'unity-build.json')),settings=JSON.parse(fs.readFileSync(path.join(directory,'expected.json'),'utf8'));
const result=inspector.inspectUnityExport(archive,diagnostic,settings);
assert.equal(result.files.length,7);assert.equal(result.dataPack.files.length,1);assert.equal(globalThis.__unityFixtureExecuted,undefined);
let refused=0;for(const [input,expected]of [[Buffer.from('private marker, invalid archive'),'archive-invalid'],[archive.subarray(0,600),'archive-invalid']]){assert.throws(()=>inspector.inspectUnityExport(input,diagnostic,settings),error=>error.code===expected&&!error.message.includes('private marker'));refused++;}
const before=JSON.parse(diagnostic);before.sceneCount=1;assert.throws(()=>inspector.inspectUnityExport(archive,Buffer.from(JSON.stringify(before)),settings),error=>error.code==='scene-count');refused++;
assert.equal(result.editor.bytes,1);assert.ok(result.bytes>1);
fs.writeFileSync(path.join(directory,'result.json'),JSON.stringify({fileMapHash:result.fileMapHash,archive:result.archive,inventory:result.inventory,dataPack:result.dataPack,independentBytes:result.bytes,editorReportedBytes:result.editor.bytes,refusedCases:refused,projectCodeExecuted:false}),{flag:'wx',mode:0o600});`;
await writeFile(path.join(temporary,'inspect.cjs'),body,{flag:'wx',mode:0o600});
try{
 child=spawn(path.join(engine,'node'),[path.join(temporary,'inspect.cjs'),path.join(engine,'unity-output-inspector.cjs'),temporary],{cwd:temporary,env:{HOME:temporary,PATH:'/usr/bin:/bin',TMPDIR:temporary+'/',LANG:'en_US.UTF-8'},stdio:['ignore','pipe','pipe']});
 let log='';for(const stream of [child.stdout,child.stderr])stream.on('data',data=>log=(log+data).slice(-20000));
 const [code,signal]=await once(child,'exit');await writeFile(path.join(output,'process.log'),log);assert.equal(signal,null);assert.equal(code,0,log);
 const result=JSON.parse(await readFile(path.join(temporary,'result.json'),'utf8'));assert.equal(result.archive.sha256,sha(archive));
 for(const [name,bytes]of Object.entries(files))assert.deepEqual(await readFile(path.join(temporary,name)),bytes,'Original candidate stays unchanged');
 await bootstrap.verifyBundle(engine,undefined,true);
 await writeFile(path.join(output,'report.json'),JSON.stringify({scope:'Pure independent Unity candidate inspection in the exact packaged Node process, with synthetic binary/table fixtures. No Unity editor/import/build, game, player, license, registered adapter, inference or installed acceptance.',engineManifestSha256:sha(await readFile(path.join(engine,'manifest.json'))),inspectorSha256:manifest.files['unity-output-inspector.cjs'],ownedProcessExited:{code,signal},originalInputs:Object.entries(files).map(([name,data])=>({name,bytes:data.length,sha256:sha(data)})),result,unityEditorInvocations:0,realInferenceCalls:0,adapterRegistered:false,installed:false},null,2)+'\n');
 passed=true;console.log('UNITY_OUTPUT_INSPECTION_OK '+output);
}catch(error){await writeFile(path.join(output,'failure.json'),JSON.stringify({message:error instanceof Error?error.message:String(error)},null,2)+'\n');throw error;}
finally{
 if(child?.exitCode===null&&child.signalCode===null){const exited=once(child,'exit');child.kill('SIGTERM');await exited;}
 if(passed)await rm(temporary,{recursive:true,force:true});else console.error('Owned fixture retained: '+temporary);
}
