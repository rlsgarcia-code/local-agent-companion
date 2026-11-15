// Source qualification: real SDK/TLS/service, offline Blender and Babylon.
// No inference, installed product change, character quality or game acceptance.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {PNG} from 'pngjs';
import serviceModule from '../dist-tests/packages/agent-service/src/service.js';
import storeModule from '../dist-tests/packages/agent-service/src/store.js';
import serverModule from '../dist-tests/packages/agent-service/src/server.js';
import security from '../dist-tests/packages/agent-service/src/security.js';
import sdk from '../dist-tests/packages/client-ts/src/index.js';
import blender from '../dist-tests/packages/adapter-game-blender/src/index.js';
import web from '../dist-tests/packages/adapter-game-web/src/index.js';
import container from '../dist-tests/packages/adapter-game-container/src/process.js';
import previewModule from '../dist-tests/packages/adapter-game-browser/src/preview.js';
import glb from '../dist-tests/packages/game-production/src/glb.js';
import identityModule from '../dist-tests/packages/contracts/src/identity.js';
import modelContracts from '../dist-tests/packages/contracts/src/game-models.js';
import models from '../dist-tests/test/game-blender-fixtures.js';
import fixtures from '../dist-tests/test/game-fixtures.js';
const config=process.argv.find(v=>v.startsWith('--provision='))?.slice(12);assert.ok(config,'Select the exact separate development Blender provisioning record');
const output=path.resolve('output/playwright/game-skinning/runs',new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID().slice(0,8));await mkdir(output,{recursive:true});
const state=await mkdtemp(path.join(tmpdir(),'skn-')),hash=bytes=>createHash('sha256').update(bytes).digest('hex'),{contentHash}=identityModule;
const save=async(name,data)=>{const file=path.join(output,name);await mkdir(path.dirname(file),{recursive:true});await writeFile(file,Buffer.isBuffer(data)?data:JSON.stringify(data,null,2)+'\n');};
const provision=JSON.parse(await readFile(config)),oldProvisionHash=hash(await readFile('.cache/game-toolchains/blender.json'));
assert.equal(provision.driverSha256,hash(await readFile('packages/adapter-game-blender/image/process.py')));
const inputPaths=['packages/adapter-game-blender/src/index.ts','packages/adapter-game-blender/image/process.py','packages/game-production/src/glb.ts','packages/game-production/src/glb-skin.ts','packages/contracts/src/game-models.ts','scripts/qualify-game-skinning.mjs'];
const sources=[];for(const file of inputPaths)sources.push({path:file,sha256:hash(await readFile(file))});
const implementation=contentHash(sources);
const registration={id:'weighted-source-qualification',product:'companion-mac',profile:'fixture',workspace:'',providers:['ollama'],hostTools:[]};
const processor=await blender.createBlenderAssetProcessor({stateDirectory:state,configPath:path.resolve(config),driverSha256:provision.driverSha256,implementationSha256:implementation});assert.equal((await processor.probe(registration)).available,true);
let store,service,server,client,preview,passed=false;const jobs=[],assets=[],observations=[],isolation=[];
const identity=await security.ensureIdentity(state),credential=await security.createClientCredential(state,registration);
async function boot(){store=new storeModule.Store(path.join(state,'metadata.sqlite'));store.register(credential);service=new serviceModule.AgentService(store,state,undefined,{}, {gameAssetProcessors:[processor],gameAdapters:web.createWebGameAdapters(path.resolve('packages/adapter-game-web/runtimes'))});server=new serverModule.LocalServer(service,state);await server.listen();client=new sdk.AgentClient({address:security.ipcPath(state),certificate:identity.cert,credential});await client.connect();}
async function stop(){client?.close();await server?.close();await service?.close();}
const tick=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function settled(id){for(let i=0;i<5000;i++){const current=await client.getGameProduction(id);if(!['admitting','queued','running','cancelling'].includes(current.state)){assert.equal(current.state,'completed',current.error);return current;}await tick(50);}throw Error('Observation timed out; retain and inspect the same job, never restart it.');}
const command=args=>container.dockerCommand(provision.dockerExecutable,args);
const binding=job=>({jobId:job.id,scope:contentHash({product:registration.product,profile:registration.profile,workspace:registration.workspace}),sourceHash:job.sourceHash,toolchain:job.toolchain,imageId:provision.imageId,recipeHash:contentHash(job.assetSpec)});
const name=job=>'companion-tool-'+contentHash(binding(job)).slice(0,40);
async function observeIsolation(job){
 for(let i=0;i<400;i++){
  const ids=(await command(['container','ls','--all','--filter',`name=^/${name(job)}$`,'--format','{{.ID}}'])).toString().trim();
  if(ids){const [value]=JSON.parse((await command(['container','inspect',ids])).toString());assert.equal(value.Config.Labels['org.companion.game-tool-job'],contentHash(binding(job)));assert.equal(value.Image,provision.imageId);
   assert.equal(value.HostConfig.NetworkMode,'none');assert.equal(value.HostConfig.ReadonlyRootfs,true);assert.equal(value.HostConfig.Privileged,false);assert.deepEqual(value.HostConfig.CapDrop,['ALL']);assert.ok(value.HostConfig.SecurityOpt.includes('no-new-privileges'));
   assert.equal(value.HostConfig.Memory,4294967296);assert.equal(value.HostConfig.MemorySwap,4294967296);assert.equal(value.HostConfig.PidsLimit,256);assert.notEqual(value.Config.User.split(':')[0],'0');
   assert.equal(value.Mounts.filter(m=>m.Type==='bind').length,1);assert.ok(value.Mounts.some(m=>m.Destination==='/source'&&!m.RW));
   if(value.State.Running)return {jobId:job.id,container:name(job),imageId:value.Image,network:'none',readOnly:true,privileged:false,memory:value.HostConfig.Memory,pids:256,user:value.Config.User,sourceReadOnly:true};
  }
  const current=await client.getGameProduction(job.id);assert.ok(['admitting','queued','running'].includes(current.state),'Native container was not observed before terminal state');await tick(50);
 }
 throw Error('Original native container not observed; inspect that operation before any repetition');
}
async function removed(job){assert.equal((await command(['container','ls','--all','--filter',`name=^/${name(job)}$`,'--format','{{.ID}}'])).toString().trim(),'');}
function fixtureSource(file){return `import * as B from 'babylonjs';import 'babylonjs-loaders/glTF/2.0';
const canvas=document.querySelector('#game'),engine=new B.Engine(canvas,true,{preserveDrawingBuffer:true}),scene=new B.Scene(engine);scene.clearColor=new B.Color4(.04,.07,.1,1);
const camera=new B.ArcRotateCamera('camera',-Math.PI/2,Math.PI/2.2,4.4,new B.Vector3(0,1,0),scene);new B.HemisphericLight('light',new B.Vector3(0,1,-1),scene);
const controls=document.createElement('div');controls.style.cssText='position:fixed;top:12px;left:12px;z-index:2;display:flex;gap:12px';document.body.append(controls);
const rest=document.createElement('button'),bend=document.createElement('button');rest.textContent='Repouso';bend.textContent='Curvar';rest.disabled=bend.disabled=true;controls.append(rest,bend);
B.SceneLoader.ImportMeshAsync(null,'assets/','${file}',scene).then(result=>{for(const group of result.animationGroups)group.stop();const mesh=result.meshes.find(m=>m.skeleton&&m.getTotalVertices()>0),group=result.animationGroups.find(g=>g.name==='bend')??result.animationGroups[0];if(!mesh||!group)throw Error('Missing skinned mesh/clip');
 const pose=fraction=>{group.start(false);group.pause();group.goToFrame(group.from+(group.to-group.from)*fraction);};rest.onclick=()=>pose(0);bend.onclick=()=>pose(.5);pose(0);
 // Read-only engineering fixture diagnostic of actual Babylon data, not a game
 // success flag, privileged bridge or tool shipped in a reference/player.
 (window as any).skinSample=()=>({positions:Array.from(mesh.getPositionData(true,false)),weights:Array.from(mesh.getVerticesData(B.VertexBuffer.MatricesWeightsKind)),bones:mesh.skeleton.bones.length,clip:group.name});rest.disabled=bend.disabled=false;
}).catch(error=>{console.error(error);throw error;});engine.runRenderLoop(()=>scene.render());window.addEventListener('resize',()=>engine.resize());`;}
function imageDifference(a,b){const x=PNG.sync.read(a),y=PNG.sync.read(b);assert.equal(x.width,y.width);assert.equal(x.height,y.height);let count=0;for(let i=0;i<x.data.length;i+=4)if(Math.abs(x.data[i]-y.data[i])+Math.abs(x.data[i+1]-y.data[i+1])+Math.abs(x.data[i+2]-y.data[i+2])>35)count++;return count/(x.width*x.height);}
try{
 await save('control.json',{scope:'Current source service/SDK, isolated x64 Blender on ARM64 and actual Chromium/Babylon; no model, installed or human/game acceptance',sources,provision,oldProvisionHash,implementation});
 await boot();const document=fixtures.fixtureGameDocument();document.title='Weighted skinning integration fixture';document.engine='babylon';document.brief.dimension='3d';let project=await client.createGameProject('skin-project',document);
 const spec={processorId:processor.id,target:{id:'sleeve',role:'Original weighted sleeve; engineering fixture only',placeholder:true},operation:models.fixtureSkinnedModelOperation()};
 const generated=await client.processGameAsset('skin-generate',project.id,1,spec);jobs.push(generated);isolation.push(await observeIsolation(generated));await settled(generated.id);await removed(generated);
 assert.equal((await client.processGameAsset('skin-generate',project.id,1,spec)).id,generated.id);
 const result=await client.getGameAssetResult(generated.id);assets.push(result);for(const file of result.files)await save('generated/'+file.path,await client.downloadGameAssetFile(generated.id,file.path));
 const originalBytes=await client.downloadGameAssetFile(generated.id,'assets/sleeve.glb'),original=glb.inspectGameGlb(originalBytes);assert.ok(original.mixedWeightVertices>0);assert.equal(original.maxSkinInfluences,2);assert.ok(original.animations>0);assert.equal((await client.getGameProject(project.id)).revision,1);
 project=await client.applyGameAsset('skin-apply',generated.id,1);assert.equal(project.revision,2);
 await stop();await boot();assert.equal(hash(await client.downloadGameAssetFile(generated.id,'assets/sleeve.glb')),hash(originalBytes));
 const editSpec={processorId:processor.id,target:{id:'sleeve-edited',role:'Directed registered weighted model edit',placeholder:false},operation:modelContracts.gameModelOperation.parse({type:'model.scene',outputBase:'assets/sleeve-edited',objects:[{id:'imported',geometry:{kind:'glb',source:{assetId:'sleeve',path:'assets/sleeve.glb'}},rotation:[0,0,15],scale:[.9,.9,.9]}],preview:spec.operation.preview})};
 const edited=await client.processGameAsset('skin-edit',project.id,2,editSpec);jobs.push(edited);isolation.push(await observeIsolation(edited));await settled(edited.id);await removed(edited);
 const editResult=await client.getGameAssetResult(edited.id);assets.push(editResult);assert.equal(editResult.asset.placeholder,true);assert.deepEqual(editResult.asset.origin.referenceIds,['sleeve']);for(const file of editResult.files)await save('edited/'+file.path,await client.downloadGameAssetFile(edited.id,file.path));
 const editInfo=glb.inspectGameGlb(await client.downloadGameAssetFile(edited.id,'assets/sleeve-edited.glb'));assert.ok(editInfo.mixedWeightVertices>0&&editInfo.animations>0);project=await client.applyGameAsset('skin-edit-apply',edited.id,2);assert.equal(project.revision,3);
 for(const [caseName,file] of [['original','sleeve.glb'],['edited','sleeve-edited.glb']]){
  const current=(await client.getGameRevision(project.id)).document;
  for(const [name,body]of [['game.web.json',JSON.stringify({schemaVersion:1,engineVersion:'9.35.0',entry:'src/main.ts'})],['src/main.ts',fixtureSource(file)]]){
   const transfer=await client.uploadGameFile(name,Buffer.from(body),name.endsWith('.json')?'application/json':'text/plain');current.files=current.files.filter(f=>f.path!==name);current.files.push(transfer);
  }
  project=await client.commitGameRevision(project.id,'fixture-'+caseName,project.revision,current,'Fixed deformation observer fixture, not game content');
  const build=await client.startGameBuild('skin-build-'+caseName,project.id,project.revision);jobs.push(build);await settled(build.id);const artifact=await client.getGameArtifact(build.id);
  assert.ok(!artifact.files.some(f=>f.path.endsWith('.blend')),'editable native source must not enter runtime');await save(caseName+'-artifact.json',artifact);
  preview=await previewModule.openGamePreview({artifact,readFile:name=>client.downloadGameArtifactFile(build.id,name),signal:new AbortController().signal,headless:true});await preview.page.setViewportSize({width:960,height:640});
  await preview.page.waitForFunction(()=>{const button=[...document.querySelectorAll('button')].find(b=>b.textContent==='Curvar');return button&&!button.disabled;});
  await preview.page.getByRole('button',{name:'Repouso',exact:true}).click();await tick(150);const rest=await preview.page.evaluate(()=>window.skinSample()),before=await preview.page.locator('canvas').screenshot();
  await preview.page.getByRole('button',{name:'Curvar',exact:true}).click();await tick(150);const bent=await preview.page.evaluate(()=>window.skinSample()),after=await preview.page.locator('canvas').screenshot();
  assert.equal(rest.positions.length,bent.positions.length);assert.ok(rest.bones>=2);const ys=rest.positions.filter((_,i)=>i%3===1),low=Math.min(...ys),high=Math.max(...ys),height=high-low;
  const bottom=[],top=[],mixed=[];for(let i=0;i<rest.positions.length/3;i++){
   const distance=Math.hypot(...[0,1,2].map(axis=>bent.positions[i*3+axis]-rest.positions[i*3+axis]));
   if(rest.positions[i*3+1]<low+.1*height)bottom.push(distance);if(rest.positions[i*3+1]>high-.1*height)top.push(distance);
   if(rest.weights.slice(i*4,i*4+4).filter(w=>w>1e-6).length>1)mixed.push(distance);
  }
  const metrics={bottomMax:Math.max(...bottom),topMax:Math.max(...top),mixedMax:Math.max(...mixed),mixedVertices:mixed.length,pixelDifference:imageDifference(before,after)};
  assert.ok(bottom.length&&top.length&&mixed.length);assert.ok(metrics.bottomMax<.002,'anchored base moved');assert.ok(metrics.topMax>.3,'animated top did not bend');assert.ok(metrics.mixedMax>.01&&metrics.mixedMax<metrics.topMax,'blended vertices did not deform between anchored and moving regions');assert.ok(metrics.pixelDifference>.002);
  assert.deepEqual(preview.errors,[]);assert.deepEqual(preview.blocked,[]);await save(caseName+'-rest.png',before);await save(caseName+'-bent.png',after);await save(caseName+'-measurements.json',{metrics,sourceHash:artifact.sourceHash,artifactHash:artifact.artifactHash,scope:'Actual Babylon library position/weight buffers in the fixed observer plus composed canvas pixels, not a generated game success flag or performance acceptance'});
  observations.push({case:caseName,...metrics,sourceHash:artifact.sourceHash,artifactHash:artifact.artifactHash});await preview.close();preview=undefined;
 }
 const archive=await client.exportGameProject(project.id),blobs=new Map();for(const row of archive.revisions)for(const file of row.document.files)if(!blobs.has(file.sha256))blobs.set(file.sha256,await client.downloadGameFile(project.id,file.path,row.revision));
 const imported=await client.importGameProject('weighted-domain-import',archive,blobs);assert.deepEqual(await client.importGameProject('weighted-domain-import',archive,blobs),imported);assert.equal(hash(await client.downloadGameFile(imported.id,'assets/sleeve.glb')),hash(originalBytes));assert.ok((await client.getGameRevision(imported.id)).document.files.some(f=>f.path.endsWith('.blend')));
 assert.equal(hash(await readFile('.cache/game-toolchains/blender.json')),oldProvisionHash);await save('report.json',{state:'passed',scope:'Source integration and actual isolated weighted asset/edit/browser geometry, not final character/game or installed acceptance',project,assets:assets.map(a=>({jobId:a.jobId,info:a.info})),observations,isolation,domainImportIdempotent:true,nativeSourcesRetained:true,nativeSourcesExcludedFromRuntime:true,oldGlobalProvisionUnchanged:true,modelInvocations:0,physicalAcceptance:false,humanAcceptance:false,fullProductAcceptance:false,installedOrPublished:false});passed=true;
}catch(error){await save('failure.json',{message:error instanceof Error?error.message:String(error),jobIds:jobs.map(j=>j.id)});console.error(error);process.exitCode=1;}
finally{
 await preview?.close();let terminal=false;try{terminal=(await Promise.all(jobs.map(j=>client.getGameProduction(j.id)))).every(j=>['completed','failed','cancelled'].includes(j.state));}catch{}
 if(terminal){await stop();await save('closure.json',{serviceClosed:true,previewClosed:true,originalJobsTerminal:true});if(passed)await rm(state,{recursive:true,force:true});else console.error('Retained failed fixture state: '+state);}
 else{console.error('Retained original active fixture, do not restart: '+state+' pid '+process.pid);await save('closure.json',{serviceClosed:false,originalJobsTerminal:false});}
}
console.log((passed?'WEIGHTED_SKINNING_QUALIFIED ':'WEIGHTED_SKINNING_PRESERVED_FAILURE ')+output);
