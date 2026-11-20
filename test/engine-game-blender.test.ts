import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp,rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { gameModelOperation } from "../packages/contracts/src/game-models";
import { assetOutputPaths,assetSources } from "../packages/contracts/src/game-assets";
import { inspectGameGlb } from "../packages/game-production/src/glb";
import { createBlenderAssetProcessor } from "../packages/adapter-game-blender/src/index";
import { dockerCommand } from "../packages/adapter-game-container/src/process";
import { fixtureModelOperation } from "./game-blender-fixtures";

function glb(patch:(doc:Record<string,any>)=>void=()=>{},badFloat=false){
  const binary=Buffer.alloc(36);[0,0,0,1,0,0,0,1,0].forEach((n,i)=>binary.writeFloatLE(badFloat&&i===0?NaN:n,i*4));
  const doc={asset:{version:"2.0"},buffers:[{byteLength:36}],bufferViews:[{buffer:0,byteLength:36}],accessors:[{bufferView:0,componentType:5126,count:3,type:"VEC3"}],meshes:[{primitives:[{attributes:{POSITION:0}}]}],nodes:[{mesh:0}]} as Record<string,any>;
  patch(doc);const text=Buffer.from(JSON.stringify(doc)),json=Buffer.alloc(Math.ceil(text.length/4)*4,32);text.copy(json);
  const output=Buffer.alloc(12+8+json.length+8+binary.length);output.writeUInt32LE(0x46546c67);output.writeUInt32LE(2,4);output.writeUInt32LE(output.length,8);
  output.writeUInt32LE(json.length,12);output.writeUInt32LE(0x4e4f534a,16);json.copy(output,20);const offset=20+json.length;output.writeUInt32LE(binary.length,offset);output.writeUInt32LE(0x004e4942,offset+4);binary.copy(output,offset+8);return output;
}

test("model recipes are structured, referentially complete and bounded without arbitrary Python or external paths",()=>{
  const op=fixtureModelOperation();assert.equal(assetOutputPaths(op).length,4);assert.deepEqual(assetSources(op),[]);
  assert.throws(()=>gameModelOperation.parse({...op,python:"print('must never run')"}));
  assert.throws(()=>gameModelOperation.parse({...op,objects:op.objects.map((o,i)=>i?o:{...o,parent:o.id})}),/hierarchy/);
  assert.throws(()=>gameModelOperation.parse({...op,objects:[{...op.objects[0],geometry:{kind:"mesh",vertices:[[0,0,0],[1,0,0],[0,1,0]],triangles:[[0,1,3]]}}]}),/vertex/);
  assert.throws(()=>gameModelOperation.parse({...op,clips:[{...op.clips[0],tracks:[{...op.clips[0]!.tracks[0],target:{kind:"bone",id:"absent"}}]}]}),/existing/);
  assert.throws(()=>gameModelOperation.parse({...op,outputBase:"../outside"}));
  assert.throws(()=>gameModelOperation.parse({...op,objects:Array.from({length:128},(_,i)=>({id:`o-${i}`,geometry:{kind:"sphere",radius:1,segments:64,rings:32},subdivision:2}))}),/complexity/);
});

test("independent GLB inspection rejects external resources, truncation, cycles, nonfinite data and unknown required decoders",()=>{
  assert.equal(inspectGameGlb(glb()).triangles,1);
  assert.throws(()=>inspectGameGlb(glb((doc)=>{doc.buffers[0].uri="file:///etc/passwd";})),/external/);
  assert.throws(()=>inspectGameGlb(glb().subarray(0,32)),/header/);
  assert.throws(()=>inspectGameGlb(glb((doc)=>{doc.nodes[0].children=[0];})),/cyclic/);
  assert.throws(()=>inspectGameGlb(glb(()=>{},true)),/nonfinite/);
  assert.throws(()=>inspectGameGlb(glb((doc)=>{doc.extensionsRequired=["KHR_draco_mesh_compression"];})),/required extension/);
  assert.throws(()=>inspectGameGlb(glb((doc)=>{doc.accessors[0].count=1000000;})),/accessor range/);
  assert.throws(()=>inspectGameGlb(glb((doc)=>{doc.meshes[0].primitives[0].indices=0;})),/index accessor/);
  assert.throws(()=>inspectGameGlb(glb((doc)=>{doc.accessors.push({bufferView:0,byteOffset:12,componentType:5123,count:3,type:"SCALAR"});doc.meshes[0].primitives[0].indices=1;})),/index outside vertex/);
});

test("missing Blender provisioning is unavailable, not a host editor or registration escape",async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),"blender-capability-"));try{
    const processor=await createBlenderAssetProcessor({stateDirectory:directory,driverSha256:"a".repeat(64)});
    assert.equal((await processor.probe({} as never)).available,false);assert.deepEqual(processor.operations,["model.scene"]);assert.ok(!processor.products.includes("kidos"));
    assert.match(processor.projectGuide!,/No Python/);
  }finally{await rm(directory,{recursive:true,force:true});}
});

test("shared fixed container CLI does not inherit a model/host credential canary",async()=>{
  process.env.COMPANION_MODEL_KEY_CANARY="synthetic-do-not-forward";
  try{const value=await dockerCommand(process.execPath,["-e","process.stdout.write(process.env.COMPANION_MODEL_KEY_CANARY?'leaked':'absent')"]);assert.equal(value.toString(),"absent");}
  finally{delete process.env.COMPANION_MODEL_KEY_CANARY;}
});
