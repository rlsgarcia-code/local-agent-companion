// Maintenance-code compilation only. Never launches Unity/Hub, executes the
// emitted assembly/project code, activates a license or registers an adapter.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile,mkdir,lstat,realpath,readlink} from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {fileSha256} from './prepare-game-unity.mjs';

const args=process.argv.slice(2);assert.equal(args.length,1,'Supply --prepared=<private Unity inventory>');assert.ok(args[0].startsWith('--prepared=')&&args[0].slice(11));
const file=path.resolve(args[0].slice(11)),recordStat=await lstat(file);assert.ok(recordStat.isFile()&&!recordStat.isSymbolicLink()&&recordStat.nlink===1&&recordStat.size<32*1024*1024);
if(process.getuid)assert.ok(recordStat.uid===process.getuid()&&(recordStat.mode&0o077)===0);
const record=JSON.parse(await readFile(file,'utf8')),lock=JSON.parse(await readFile('packages/adapter-game-unity/toolchain.lock.json','utf8'));
assert.equal(`${process.platform}-${process.arch}`,lock.platform);assert.equal(record.version,lock.version);assert.equal(record.revision,lock.revision);assert.equal(record.status,'prepared-unqualified');assert.equal(record.available,false);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');assert.equal(sha(JSON.stringify({files:record.files,bytes:record.bytes,entries:record.entries})),record.inventorySha256);
const base=await realpath(record.directory),scripting='Unity.app/Contents/Resources/Scripting/';
const compiler=scripting+'DotNetSdkRoslyn/csc.dll',runtime=scripting+'NetCoreRuntime/dotnet';
const references=[scripting+'NetStandard/ref/2.1.0/netstandard.dll',scripting+'Managed/UnityEngine/UnityEngine.CoreModule.dll',scripting+'Managed/UnityEngine/UnityEngine.JSONSerializeModule.dll',scripting+'Managed/UnityEngine/UnityEditor.CoreModule.dll'];
const selected=Object.entries(record.files).filter(([name])=>name.startsWith(scripting+'DotNetSdkRoslyn/')||name.startsWith(scripting+'NetCoreRuntime/')||references.includes(name));
assert.ok(selected.length>20);const verified=[];
for(const [name,value]of selected){
 const local=path.join(base,name),stat=await lstat(local);
 if(value.symlink!==undefined){assert.ok(stat.isSymbolicLink());assert.equal(await readlink(local),value.symlink);assert.ok((await realpath(local)).startsWith(base+path.sep));}
 else{assert.ok(stat.isFile()&&!stat.isSymbolicLink());assert.equal(stat.size,value.size);assert.equal(await fileSha256(local),value.sha256);}
 verified.push({path:name,...value});
}
for(const name of [runtime,compiler,...references])assert.ok(verified.some(row=>row.path===name),'Missing exact compiler/reference: '+name);
const source=path.resolve('packages/adapter-game-unity/editor/CompanionWebBuild.cs');
const output=path.resolve('output/game-generation/unity-driver-compile',new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID().slice(0,8));
const work=path.join(output,'work');await mkdir(path.join(work,'tmp'),{recursive:true,mode:0o700});await mkdir(path.join(work,'home'),{mode:0o700});
const quote=value=>{assert.ok(!/[\x00-\x1f]/.test(value));return '"'+value.replace(/\\/g,'\\\\').replace(/"/g,'\\"')+'"';};
const profile=`(version 1)
(deny default)
(import "/System/Library/Sandbox/Profiles/dyld-support.sb")
(allow process-exec (literal ${quote(path.join(base,runtime))}))
(allow process-fork)
(allow file-map-executable)
(allow process-info* (target self))
(allow sysctl-read)
(allow signal (target self))
(allow file-read-metadata)
(allow file-read* (subpath "/System") (subpath "/private/preboot") (subpath "/usr/lib") (subpath "/usr/share") (subpath ${quote(base)}) (literal ${quote(source)}) (subpath ${quote(work)}) (literal "/dev/null") (literal "/dev/urandom") (literal "/dev/random"))
(allow file-write* (subpath ${quote(work)}) (literal "/dev/null"))
(allow mach-lookup (global-name "com.apple.dyld"))
`;
await writeFile(path.join(output,'compiler.sb'),profile);const assembly=path.join(work,'CompanionWebBuild.dll');
const invocation=['-f',path.join(output,'compiler.sb'),path.join(base,runtime),path.join(base,compiler),'/nologo','/noconfig','/nostdlib+','/target:library','/langversion:9','/deterministic+','/warnaserror+','/nowarn:0649','/out:'+assembly,...references.map(name=>'/reference:'+path.join(base,name)),source];
const environment={PATH:'/usr/bin:/bin',HOME:path.join(work,'home'),TMPDIR:path.join(work,'tmp')+'/',LANG:'en_US.UTF-8',DOTNET_ROOT:path.join(base,scripting,'NetCoreRuntime'),DOTNET_MULTILEVEL_LOOKUP:'0',DOTNET_CLI_HOME:path.join(work,'home'),DOTNET_CLI_TELEMETRY_OPTOUT:'1',DOTNET_SKIP_FIRST_TIME_EXPERIENCE:'1',DOTNET_EnableDiagnostics:'0',COMPlus_EnableDiagnostics:'0'};
try{
 const result=await promisify(execFile)('/usr/bin/sandbox-exec',invocation,{cwd:work,env:environment,timeout:60000,maxBuffer:2*1024*1024});await writeFile(path.join(output,'compile.log'),result.stdout+result.stderr);
 const bytes=await readFile(assembly);assert.equal(bytes.subarray(0,2).toString(),'MZ');assert.ok(bytes.length>1024);
 await writeFile(path.join(output,'report.json'),JSON.stringify({scope:'Trusted maintenance C# driver compiled, not executed, with exact prepared Unity LTS Roslyn/.NET/reference assemblies under a compiler-only deny-default macOS profile. Not Unity editor/build/license/isolation or game acceptance.',editorVersion:lock.version,editorRevision:lock.revision,inventorySha256:record.inventorySha256,preparedRecordStillUnavailable:record.available===false,sourceSha256:sha(await readFile(source)),assemblySha256:sha(bytes),assemblyBytes:bytes.length,compilerProfileSha256:sha(profile),verifiedToolchainFiles:verified,compilerExited:0,unityEditorInvocations:0,hubInvocations:0,assemblyExecuted:false,licenseActivated:false,productionAdapterRegistered:false},null,2)+'\n');
 console.log('UNITY_BUILD_DRIVER_API_COMPILES '+output);
}catch(error){await writeFile(path.join(output,'compile.log'),String(error.stdout??'')+String(error.stderr??''));await writeFile(path.join(output,'failure.json'),JSON.stringify({message:error instanceof Error?error.message:String(error),code:error.code,signal:error.signal},null,2)+'\n');throw error;}
