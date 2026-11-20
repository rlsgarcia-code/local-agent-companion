import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {inspectUnityExport,inspectUnityDataPack,readUnityBuildDiagnostic,UnityOutputError,type UnityOutputErrorCode} from '../packages/adapter-game-unity/src/output';
import {unityOutputFixture,unityTarFixture,unityDataFixture} from './unity-output-fixtures';
const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
function refused(code:UnityOutputErrorCode){return (error:unknown)=>error instanceof UnityOutputError&&error.code===code&&!error.message.includes('PRIVATE_MARKER');}

test('Unity output inspection preserves every synthetic original byte and reports real file hashes without executing HTML, JS or WASM',()=>{
 for(const dimension of ['2d','3d'] as const){const f=unityOutputFixture(dimension),archive=f.archive(),diagnostic=f.diagnostic(),before=Buffer.from(archive),prior=JSON.stringify(f.settings),result=inspectUnityExport(archive,diagnostic,f.settings);
 assert.deepEqual(archive,before);assert.equal(JSON.stringify(f.settings),prior);assert.equal(result.archive.sha256,sha(archive));assert.equal(result.diagnosticSha256,sha(diagnostic));assert.deepEqual(result.files.map(file=>[file.path,Buffer.from(file.data)]),f.files.map(([name,data])=>[name,data]));
 assert.deepEqual(result.build,{loader:'Build/output.loader.js',framework:'Build/output.framework.js',wasm:'Build/output.wasm',data:'Build/output.data'});assert.equal(result.dataPack.files.length,1);
 assert.equal(result.bytes,f.files.reduce((sum,[,data])=>sum+data.length,0));assert.notEqual(result.bytes,result.editor.bytes,'the editor-reported summary is not the independent byte inventory');assert.equal((globalThis as Record<string,unknown>).__unityFixtureExecuted,undefined);
 const reversed=inspectUnityExport(unityTarFixture([...f.files].reverse()),diagnostic,f.settings);assert.equal(reversed.fileMapHash,result.fileMapHash);assert.notEqual(reversed.archive.sha256,result.archive.sha256);assert.ok(result.inventory.every(file=>file.sha256===sha(result.files.find(entry=>entry.path===file.path)!.data)));
 }
});
test('Unity bounded diagnostic rejects private/unknown fields, partial JSON, incompatible versions and contradictory outcomes without echoing contents',()=>{
 const f=unityOutputFixture();for(const body of [Buffer.alloc(16385,32),Buffer.from([0xc3,0x28]),Buffer.from('PRIVATE_MARKER {'),Buffer.from(JSON.stringify({...f.report,PRIVATE_MARKER:'private'})),Buffer.from(JSON.stringify({...f.report,engineVersion:'other'})),Buffer.from(JSON.stringify({...f.report,failureCode:null})),Buffer.from(JSON.stringify({...f.report,errors:1})),Buffer.from(JSON.stringify({...f.report,sceneCount:0})),Buffer.from(JSON.stringify({...f.report,bytes:Number.MAX_SAFE_INTEGER+1}))])assert.throws(()=>readUnityBuildDiagnostic(body),refused('diagnostic-invalid'));
 const failed=Buffer.from(JSON.stringify({...f.report,result:'failed',failureCode:'export-failed'}));assert.equal(readUnityBuildDiagnostic(failed).result,'failed');assert.throws(()=>inspectUnityExport(f.archive(),failed,f.settings),refused('export-failed'));
 assert.throws(()=>inspectUnityExport(f.archive(),f.diagnostic(),{...f.settings,scenes:['Assets/Other.unity']}),refused('scene-count'));
});
test('Unity export reader requires a complete coherent uncompressed single-thread quartet and never silently drops unsupported Build output',()=>{
 for(const missing of ['index.html','.loader.js','.framework.js','.wasm','.data']){const f=unityOutputFixture();f.files=f.files.filter(([name])=>!name.endsWith(missing));assert.throws(()=>inspectUnityExport(unityTarFixture(f.files),f.diagnostic(),f.settings),refused('output-missing'));}
 for(const suffix of ['.mem','.worker.js','.wasm.gz','.data.br','.framework.js.unityweb','.unknown']){const f=unityOutputFixture();f.files.push(['Build/output'+suffix,Buffer.from('PRIVATE_MARKER')]);assert.throws(()=>inspectUnityExport(f.archive(),f.diagnostic(),f.settings),refused('build-profile'));}
 const mixed=unityOutputFixture();mixed.files.find(row=>row[0].endsWith('.wasm'))![0]='Build/different.wasm';assert.throws(()=>inspectUnityExport(mixed.archive(),mixed.diagnostic(),mixed.settings),refused('build-profile'));
 const multiple=unityOutputFixture();multiple.files.push(['Build/second.data',unityDataFixture()]);assert.throws(()=>inspectUnityExport(multiple.archive(),multiple.diagnostic(),multiple.settings),refused('output-missing'));
});
test('Unity container-output rejection wraps archive paths, links, corruption, case collisions and oversized declarations in bounded errors',()=>{
 for(const [name,type]of [['../../PRIVATE_MARKER','0'],['PRIVATE_MARKER','2'],['PRIVATE_MARKER','1'],['PRIVATE_MARKER','3']]){const f=unityOutputFixture(),archive=unityTarFixture([[name!,Buffer.from('private'),type!]]);assert.throws(()=>inspectUnityExport(archive,f.diagnostic(),f.settings),refused('archive-invalid'));}
 const disguised=unityOutputFixture();disguised.files[0]![0]='\ufeffindex.html';assert.throws(()=>inspectUnityExport(disguised.archive(),disguised.diagnostic(),disguised.settings),refused('output-missing'));
 const f=unityOutputFixture(),broken=f.archive();broken[7]=255;assert.throws(()=>inspectUnityExport(broken,f.diagnostic(),f.settings),refused('archive-invalid'));assert.throws(()=>inspectUnityExport(f.archive().subarray(0,100),f.diagnostic(),f.settings),refused('archive-invalid'));
 f.files.push(['INDEX.html',Buffer.from('PRIVATE_MARKER')]);assert.throws(()=>inspectUnityExport(f.archive(),f.diagnostic(),f.settings),refused('archive-invalid'));
});
test('Unity text and WASM checks refuse corrupt encodings, compressed representations and incompatible binary headers without compiling a module',()=>{
 for(const [suffix,bytes,code]of [['.loader.js',Buffer.from([0xff]),'text-invalid'],['.framework.js',Buffer.from('a\0b'),'text-invalid'],['index.html',Buffer.alloc(0),'text-invalid'],['.wasm',Buffer.from([31,139,0,0,0,0,0,0]),'wasm-invalid'],['.wasm',Buffer.from([0,97,115,109,2,0,0,0]),'wasm-invalid'],['.data',Buffer.from('PRIVATE_MARKER'),'data-invalid']]as const){const f=unityOutputFixture();f.files.find(row=>row[0].endsWith(suffix))![1]=bytes;assert.throws(()=>inspectUnityExport(f.archive(),f.diagnostic(),f.settings),refused(code));}
});
test('Unity data pack uses bounded virtual paths and disjoint payloads; never extracts files or accepts truncated or overlapping tables',()=>{
 const bom=inspectUnityDataPack(unityDataFixture([{path:'\ufeffdata',data:Buffer.from('x')}]));assert.equal(bom.files[0]!.path,'\ufeffdata');
 const input=unityDataFixture([{path:'Resources/grama',data:Buffer.from('🌿')},{path:'Managed/Metadata/game.dat',data:Buffer.from([0,1,2])}]),before=Buffer.from(input),result=inspectUnityDataPack(input);assert.deepEqual(input,before);assert.equal(result.files[0]!.sha256,sha(Buffer.from('🌿')));assert.equal(result.files[1]!.size,3);
 for(const rows of [[{path:'../PRIVATE_MARKER',data:Buffer.from('a')}],[{path:'/PRIVATE_MARKER',data:Buffer.from('a')}],[{path:'a',data:Buffer.from('a')},{path:'A',data:Buffer.from('b')}],[{path:'a',data:Buffer.from('a')},{path:'a/b',data:Buffer.from('b')}],[]])assert.throws(()=>inspectUnityDataPack(unityDataFixture(rows)),refused('data-invalid'));
 for(const mutate of [(b:Buffer)=>b.writeUInt32LE(0,16),(b:Buffer)=>b.writeUInt32LE(0xffffffff,16),(b:Buffer)=>b.writeUInt32LE(0,20),(b:Buffer)=>b.writeUInt32LE(0xffffffff,24),(b:Buffer)=>b.writeUInt32LE(1025,28),(b:Buffer)=>{b[32]=255;},(b:Buffer)=>b.writeUInt32LE(20,16)]){const b=Buffer.from(input);mutate(b);assert.throws(()=>inspectUnityDataPack(b),refused('data-invalid'));}
 assert.throws(()=>inspectUnityDataPack(input.subarray(0,input.length-1)),refused('data-invalid'));
 const overlapped=unityDataFixture([{path:'a',data:Buffer.from('abc')},{path:'b',data:Buffer.from('def')}]);overlapped.writeUInt32LE(overlapped.readUInt32LE(20),33);assert.throws(()=>inspectUnityDataPack(overlapped),refused('data-invalid'));
});
