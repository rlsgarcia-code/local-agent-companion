import assert from "node:assert/strict";
import test from "node:test";
import {gameModelOperation} from "../packages/contracts/src/game-models";
import {inspectGameGlb} from "../packages/game-production/src/glb";
import {fixtureSkinnedModelOperation} from "./game-blender-fixtures";

function fixtureSkinGlb(options:{quantized?:boolean;sparse?:boolean;interleaved?:boolean;influences?:number;patch?:(doc:any,parts:Buffer[])=>void}={}){
  const parts:Buffer[]=[],views:any[]=[],accessors:any[]=[];let offset=0;
  const add=(data:Buffer,type:string,componentType:number,count:number,normalized?:boolean,stride?:number)=>{
    const bytes=Buffer.alloc(Math.ceil(data.length/4)*4);data.copy(bytes);const view=views.push({buffer:0,byteOffset:offset,byteLength:bytes.length,...(stride?{byteStride:stride}:{})})-1;parts.push(bytes);offset+=bytes.length;
    return accessors.push({bufferView:view,componentType,count,type,...(normalized===undefined?{}:{normalized})})-1;
  };
  const floats=(numbers:number[])=>{const b=Buffer.alloc(numbers.length*4);numbers.forEach((n,i)=>b.writeFloatLE(n,i*4));return b;};
  const position=add(floats([0,0,0,1,0,0,0,1,0]),"VEC3",5126,3),attributes:any={POSITION:position};
  const influences=options.influences??2;
  for(let set=0;set<Math.ceil(influences/4);set++){
    const joints:number[]=[],weights:number[]=[];
    for(let vertex=0;vertex<3;vertex++)for(let i=0;i<4;i++){const joint=set*4+i;joints.push(joint<influences?joint:0);weights.push(joint<influences?(options.quantized?(joint===0?64:191):1/influences):0);}
    attributes[`JOINTS_${set}`]=add(Buffer.from(joints),"VEC4",5121,3);
    let data=options.quantized?Buffer.from(weights):floats(weights);
    if(options.interleaved){const interleaved=Buffer.alloc(60);for(let i=0;i<3;i++)data.copy(interleaved,i*20,i*16,(i+1)*16);data=interleaved;}
    const index=add(data,"VEC4",options.quantized?5121:5126,3,options.quantized?true:undefined,options.interleaved?20:undefined);
    attributes[`WEIGHTS_${set}`]=index;
    if(options.sparse){const original=accessors[index].bufferView,sparseIndices=add(Buffer.from([0,1,2]),"SCALAR",5121,3);delete accessors[index].bufferView;
      accessors[index].sparse={count:3,indices:{bufferView:accessors[sparseIndices].bufferView,componentType:5121},values:{bufferView:original}};}
  }
  const matrices=Array.from({length:influences},()=>[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]).flat(),inverse=add(floats(matrices),"MAT4",5126,influences);
  const doc:any={asset:{version:"2.0"},buffers:[{byteLength:offset}],bufferViews:views,accessors,meshes:[{primitives:[{attributes}]}],nodes:[{mesh:0,skin:0},{name:"root",children:Array.from({length:influences-1},(_,i)=>i+2)},...Array.from({length:influences-1},(_,i)=>({name:`bone${i+1}`}))],skins:[{joints:Array.from({length:influences},(_,i)=>i+1),inverseBindMatrices:inverse,skeleton:1}]};
  options.patch?.(doc,parts);
  const text=Buffer.from(JSON.stringify(doc)),json=Buffer.alloc(Math.ceil(text.length/4)*4,32);text.copy(json);const bin=Buffer.concat(parts),output=Buffer.alloc(28+json.length+bin.length);
  output.writeUInt32LE(0x46546c67);output.writeUInt32LE(2,4);output.writeUInt32LE(output.length,8);output.writeUInt32LE(json.length,12);output.writeUInt32LE(0x4e4f534a,16);json.copy(output,20);
  const start=20+json.length;output.writeUInt32LE(bin.length,start);output.writeUInt32LE(0x004e4942,start+4);bin.copy(output,start+8);return output;
}

test("explicit mesh skinning validates every normalized bounded vertex and preserves rigid recipes",()=>{
 const original=fixtureSkinnedModelOperation(),object=original.objects[0]!;assert.equal(object.skin!.weights.length,36);assert.equal(original.rig!.bones.length,2);
 const rejects=(patch:Record<string,unknown>)=>assert.throws(()=>gameModelOperation.parse({...original,objects:[{...object,...patch}]}));
 rejects({skin:{weights:object.skin!.weights.slice(1)}});rejects({bindBone:"base"});rejects({parent:"sleeve"});rejects({bevel:.1});rejects({subdivision:1});rejects({geometry:{kind:"box",size:[1,1,1]}});
 for(const row of [[{bone:"absent",weight:1}],[{bone:"base",weight:.3}],[{bone:"base",weight:1},{bone:"base",weight:.1}],[{bone:"base",weight:NaN}],[{bone:"base",weight:0}],Array.from({length:5},()=>({bone:"base",weight:.2}))])rejects({skin:{weights:Array(36).fill(row)}});
 assert.throws(()=>gameModelOperation.parse({...original,rig:undefined}));
 const big={...object,geometry:{kind:"mesh",vertices:Array(30000).fill([0,0,0]),triangles:[[0,1,2]]},skin:{weights:Array(30000).fill([{bone:"base",weight:1}])}};
 assert.throws(()=>gameModelOperation.parse({...original,objects:[{...big,id:"one"},{...big,id:"two"}]}),/aggregate/);
});

test("independent skin inspection decodes float, quantized, sparse and interleaved weights without counting instances twice",()=>{
 for(const options of [{},{quantized:true},{sparse:true},{interleaved:true},{influences:4},{influences:8}]){
  const info=inspectGameGlb(fixtureSkinGlb(options));assert.equal(info.skinnedVertices,3);assert.equal(info.mixedWeightVertices,3);assert.equal(info.maxSkinInfluences,options.influences??2);
 }
 assert.equal(inspectGameGlb(fixtureSkinGlb({patch:doc=>doc.nodes.push({mesh:0,skin:0})})).skinnedVertices,3);
});

test("invalid skin identities, matrices, attribute pairs and numeric influences are rejected before engine import",()=>{
 const reject=(patch:(doc:any,parts:Buffer[])=>void,pattern:RegExp=/skin/)=>assert.throws(()=>inspectGameGlb(fixtureSkinGlb({patch})),pattern);
 reject(doc=>{doc.skins[0].joints=[];});reject(doc=>{doc.skins[0].joints=[1,1];});reject(doc=>{delete doc.nodes[1].children;});reject(doc=>{doc.skins[0].skeleton=0;});reject(doc=>{delete doc.nodes[0].mesh;});
 reject(doc=>{doc.accessors[doc.skins[0].inverseBindMatrices].count=1;});
 reject((doc,parts)=>{const a=doc.accessors[doc.skins[0].inverseBindMatrices];parts[a.bufferView]!.writeFloatLE(.2,12);});
 reject(doc=>{delete doc.meshes[0].primitives[0].attributes.WEIGHTS_0;});
 reject(doc=>{doc.meshes[0].primitives[0].attributes.JOINTS_1=doc.meshes[0].primitives[0].attributes.JOINTS_0;});
 reject(doc=>{doc.accessors[doc.meshes[0].primitives[0].attributes.JOINTS_0].normalized=true;});
 reject((doc,parts)=>{const a=doc.accessors[doc.meshes[0].primitives[0].attributes.JOINTS_0];parts[a.bufferView]![1]=0;});
 reject((doc,parts)=>{const a=doc.accessors[doc.meshes[0].primitives[0].attributes.JOINTS_0];parts[a.bufferView]![2]=99;});
 reject((doc,parts)=>{const a=doc.accessors[doc.meshes[0].primitives[0].attributes.WEIGHTS_0];parts[a.bufferView]!.writeFloatLE(-.5,0);});
 reject((doc,parts)=>{const a=doc.accessors[doc.meshes[0].primitives[0].attributes.WEIGHTS_0];parts[a.bufferView]!.fill(0);});
 assert.throws(()=>inspectGameGlb(fixtureSkinGlb({quantized:true,patch:doc=>{doc.accessors[doc.meshes[0].primitives[0].attributes.WEIGHTS_0].normalized=false;}})),/normalization/);
 assert.throws(()=>inspectGameGlb(fixtureSkinGlb({sparse:true,patch:(doc,parts)=>{const a=doc.accessors[doc.meshes[0].primitives[0].attributes.WEIGHTS_0];parts[a.sparse.indices.bufferView]![1]=0;}})),/sparse/);
});
