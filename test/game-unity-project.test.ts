import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {fixtureGameDocument} from './game-fixtures';
import {readUnityProject,unityProjectSettings,UNITY_VERSION,UNITY_REVISION,UNITY_DRIVER_ROOT} from '../packages/adapter-game-unity/src/project';

function fixture(dimension:'2d'|'3d'='2d'){
 const document=fixtureGameDocument();document.engine='unity';document.brief.dimension=dimension;
 const settings={schemaVersion:1,engineVersion:UNITY_VERSION,dimension,scenes:['Assets/Scenes/Opening.unity','Assets/Scenes/Game.unity']};
 const data=new Map<string,Buffer>();const reads:string[]=[];
 const add=(name:string,value:string|Uint8Array)=>{
  const bytes=Buffer.from(value);data.set(name,bytes);const file={path:name,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),mime:'application/octet-stream',transferId:'source-'+data.size};
  const prior=document.files.findIndex(entry=>entry.path===name);if(prior<0)document.files.push(file);else document.files[prior]=file;
 };
 add('game.unity.json',JSON.stringify(settings));add('ProjectSettings/ProjectVersion.txt',`m_EditorVersion: ${UNITY_VERSION}\nm_EditorVersionWithRevision: ${UNITY_VERSION} (${UNITY_REVISION})\n`);
 add('Packages/manifest.json',JSON.stringify({dependencies:{'com.unity.modules.audio':'1.0.0'}}));add('Packages/packages-lock.json',JSON.stringify({dependencies:{'com.unity.modules.audio':{version:'1.0.0',depth:0,source:'builtin',dependencies:{}}}}));
 for(const scene of settings.scenes)add(scene,'%YAML 1.1\n%TAG !u! tag:unity3d.com,2011:\n');
 return {document,settings,data,reads,add,read:async(name:string)=>{reads.push(name);assert.ok(data.has(name));return data.get(name)!;}};
}
test('Unity 2D/3D preflight preserves explicit scene order, exact LTS and built-in module lock without executing or changing source',async()=>{
 for(const dimension of ['2d','3d'] as const){const f=fixture(dimension),before=JSON.stringify(f.document),bytes=[...f.data].map(([name,body])=>[name,body.toString('hex')]);
  const result=await readUnityProject(f.document,f.read);assert.deepEqual(result.settings,f.settings);assert.deepEqual(result.dependencies,{'com.unity.modules.audio':'1.0.0'});assert.equal(JSON.stringify(f.document),before);assert.deepEqual([...f.data].map(([name,body])=>[name,body.toString('hex')]),bytes);assert.deepEqual(f.reads,['game.unity.json','ProjectSettings/ProjectVersion.txt','Packages/manifest.json','Packages/packages-lock.json']);
 }
});
test('Unity project settings refuse scene fallbacks, traversal, duplicates and client-granted editor/license/provider options',()=>{
 const {settings}=fixture();
 for(const value of [{...settings,scenes:[]},{...settings,scenes:['Assets/../Elsewhere.unity']},{...settings,scenes:['/host/scene.unity']},{...settings,scenes:['Assets/game.cs']},{...settings,scenes:['Assets/A.unity','Assets/a.unity']},{...settings,engineVersion:'6000.6.0f1'},{...settings,executeMethod:'Project.Arbitrary.Run'},{...settings,license:true},{...settings,provider:'openai'}])assert.equal(unityProjectSettings.safeParse(value).success,false);
});
test('Unity preflight rejects missing scenes, a different engine/dimension and mutated native editor version without migration',async()=>{
 const cases=[(f:ReturnType<typeof fixture>)=>{f.document.engine='godot';},(f:ReturnType<typeof fixture>)=>{f.document.brief.dimension='3d';},(f:ReturnType<typeof fixture>)=>{f.document.files=f.document.files.filter(row=>row.path!=='Assets/Scenes/Game.unity');},(f:ReturnType<typeof fixture>)=>f.add('ProjectSettings/ProjectVersion.txt',`m_EditorVersion: 6000.6.0f1\nm_EditorVersionWithRevision: 6000.6.0f1 (different)\n`),(f:ReturnType<typeof fixture>)=>f.add('ProjectSettings/ProjectVersion.txt',`m_EditorVersion: ${UNITY_VERSION}\nm_EditorVersionWithRevision: ${UNITY_VERSION} (${UNITY_REVISION})\nm_EditorVersion: other\n`)];
 for(const mutate of cases){const f=fixture();mutate(f);const before=JSON.stringify(f.document);await assert.rejects(readUnityProject(f.document,f.read));assert.equal(JSON.stringify(f.document),before);}
});
test('Unity packages cannot select a registry, Git/file dependency or forged/missing module resolution',async()=>{
 for(const [name,value]of [
  ['Packages/manifest.json',{dependencies:{'com.unity.modules.audio':'https://elsewhere.invalid/package'}}],
  ['Packages/manifest.json',{dependencies:{'com.unity.addressables':'1.0.0'}}],
  ['Packages/manifest.json',{dependencies:{'com.unity.modules.unityanalytics':'1.0.0'}}],
  ['Packages/manifest.json',{dependencies:{},scopedRegistries:[{url:'https://elsewhere.invalid'}]}],
  ['Packages/packages-lock.json',{dependencies:{}}],
  ['Packages/packages-lock.json',{dependencies:{'com.unity.modules.audio':{version:'1.0.0',depth:0,source:'registry',dependencies:{},url:'https://elsewhere.invalid'}}}],
  ['Packages/packages-lock.json',{dependencies:{'com.unity.modules.audio':{version:'1.0.0',depth:0,source:'builtin',dependencies:{'com.unity.modules.physics':'1.0.0'}}}}],
 ]as const){const f=fixture();f.add(name,JSON.stringify(value));await assert.rejects(readUnityProject(f.document,f.read));}
});
test('Unity built-in transitive dependencies are exact, reachable and cannot be replaced by invented locks',async()=>{
 const f=fixture();f.add('Packages/manifest.json',JSON.stringify({dependencies:{'com.unity.modules.terrainphysics':'1.0.0'}}));
 const dependencies={'com.unity.modules.terrainphysics':{version:'1.0.0',depth:0,source:'builtin',dependencies:{'com.unity.modules.physics':'1.0.0','com.unity.modules.terrain':'1.0.0'}},'com.unity.modules.physics':{version:'1.0.0',depth:1,source:'builtin',dependencies:{}},'com.unity.modules.terrain':{version:'1.0.0',depth:1,source:'builtin',dependencies:{}}};
 f.add('Packages/packages-lock.json',JSON.stringify({dependencies}));assert.equal(Object.keys((await readUnityProject(f.document,f.read)).lockedDependencies).length,3);
 dependencies['com.unity.modules.physics'].depth=2;f.add('Packages/packages-lock.json',JSON.stringify({dependencies}));await assert.rejects(readUnityProject(f.document,f.read),/resolved depths/);
});
test('Unity reserved driver, editor caches, embedded packages, binary plugins and compiler response files are refused before metadata reads',async()=>{
 for(const name of [UNITY_DRIVER_ROOT+'/WebBuild.cs',UNITY_DRIVER_ROOT+'.meta','Library/asset-cache','UserSettings/EditorUserSettings.asset','Assets/Plugins/third-party.dll','Assets/Plugins/External.bundle/Contents/MacOS/plugin','Assets/csc.rsp','Packages/embedded/package.json']){
  const f=fixture();f.add(name,'Original incompatible data stays untouched');const before=JSON.stringify(f.document);await assert.rejects(readUnityProject(f.document,f.read));assert.deepEqual(f.reads,[]);assert.equal(JSON.stringify(f.document),before);
 }
});
test('Unity metadata is bounded by declared and actual bytes and rejects malformed UTF-8',async()=>{
 for(const declared of [true,false]){const f=fixture();if(declared)f.document.files.find(row=>row.path==='game.unity.json')!.size=16385;else f.data.set('game.unity.json',Buffer.alloc(16385,32));await assert.rejects(readUnityProject(f.document,f.read),/bounded/);if(declared)assert.deepEqual(f.reads,[]);}
 const altered=fixture();altered.data.set('game.unity.json',Buffer.from('{}'));await assert.rejects(readUnityProject(altered.document,altered.read),/exact project revision/);
 const f=fixture();f.add('game.unity.json',Buffer.from([0xc3,0x28]));await assert.rejects(readUnityProject(f.document,f.read));
 for(const value of ['PRIVATE_UNITY_MARKER invalid JSON',JSON.stringify({...f.settings,PRIVATE_UNITY_MARKER:'untrusted content'})]){const f=fixture();f.add('game.unity.json',value);await assert.rejects(readUnityProject(f.document,f.read),error=>error instanceof Error&&/Invalid Unity metadata format/.test(error.message)&&!error.message.includes('PRIVATE_UNITY_MARKER'));}
});
