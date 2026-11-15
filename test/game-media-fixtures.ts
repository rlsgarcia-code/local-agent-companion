/** Synthetic fixture preparation/inspection, only in the explicit offline container. */
import assert from "node:assert/strict";
import { readFile,writeFile,mkdir } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { PNG } from "pngjs";
import { fixtureGameDocument } from "./game-fixtures";
import { gameContentHash } from "../packages/game-design/src/project";
import { gameAssetSpec,assetSourceInputs } from "../packages/contracts/src/game-assets";
import { gameMediaProcessRequest } from "../packages/contracts/src/game-media-worker";
import { canonical,contentHash } from "../packages/contracts/src/identity";
import { gameMediaToolchain,MEDIA_PROCESSOR_ID } from "../packages/adapter-game-assets/src/media-toolchain";

const sha=(bytes:Uint8Array)=>createHash("sha256").update(bytes).digest("hex");
const json=async(file:string)=>JSON.parse(await readFile(file,"utf8"));
function pixels(width:number,height:number,rgba:number[]){const png=new PNG({width,height});for(let i=0;i<width*height;i++)png.data.set(rgba,i*4);return PNG.sync.write(png);}
export async function prepareMediaFixtures(root:string){
  const cases=path.join(root,"child/cases");
  const pin=sha(await readFile(root+"/runtime/manifest.json")),toolchain=gameMediaToolchain(pin);
  const tiny=new PNG({width:2,height:1});tiny.data.set([255,0,0,255,0,0,255,0]);
  const sources=[{id:"tiny",name:"assets/tiny.png",data:PNG.sync.write(tiny)},{id:"red",name:"assets/red.png",data:pixels(180,180,[255,0,0,255])},{id:"green",name:"assets/green.png",data:pixels(180,180,[0,255,0,255])}];
  const operations:Record<string,unknown>={
    compose:{type:"image.compose",output:"assets/final.png",width:2,height:1,background:"#00ff00ff",layers:[{source:{assetId:"tiny",path:"assets/tiny.png"},x:0,y:0,width:2,height:1,flipX:true,filter:"nearest"}]},
    atlas:{type:"image.atlas",outputBase:"assets/actors",pageSize:256,maxPages:2,padding:2,trim:false,frames:[{id:"red",source:{assetId:"red",path:"assets/red.png"}},{id:"green",source:{assetId:"green",path:"assets/green.png"}}],animations:[{id:"blink",frames:["red","green"],fps:8,loop:true}]},
    audio:{type:"audio.render",output:"assets/tone.wav",durationMs:50,sampleRate:22050,channels:1,notes:[{waveform:"sine",frequency:440,startMs:0,durationMs:50,gain:0.2},{waveform:"sine",frequency:1200,startMs:0,durationMs:20,gain:1e-7,releaseMs:5}]},
  };
  await mkdir(cases,{mode:0o700});
  for(const name of ['compose','atlas','audio','tampered','bad-recipe']){
    const dir=path.join(cases,name);await mkdir(dir,{mode:0o700});await mkdir(dir+'/input',{mode:0o700});await mkdir(dir+'/input/blobs',{mode:0o700});await mkdir(dir+'/output',{mode:0o700});
    const document=fixtureGameDocument();
    for(const source of sources){document.files.push({path:source.name,mime:'image/png',sha256:sha(source.data),size:source.data.length,transferId:source.id});
      document.assets.push({id:source.id,kind:'image',role:'Synthetic qualification pixels',files:[source.name],placeholder:true,origin:{kind:'procedural',author:'Fixture',source:'Generated test pixels',license:'Synthetic fixture',referenceIds:[]}});}
    const spec=gameAssetSpec.parse({processorId:MEDIA_PROCESSOR_ID,target:{id:'target',role:'Synthetic candidate'},operation:operations[name]??operations.compose});
    const request=gameMediaProcessRequest.parse({schemaVersion:1,requestId:'media-'+name,sourceHash:gameContentHash(document),recipeHash:contentHash(spec),toolchain,document,spec,sources:assetSourceInputs(document,spec).files});
    if(name==='bad-recipe')request.recipeHash='0'.repeat(64);
    await writeFile(dir+'/input/request.json',canonical(request),{mode:0o600});
    for(const file of request.sources){const data=sources.find(source=>source.name===file.path)!.data;await writeFile(dir+'/input/blobs/'+file.sha256,name==='tampered'?Buffer.alloc(data.length):data,{mode:0o600});}
  }
}
export async function inspectMediaFixtures(root:string){
  const cases=path.join(root,"child/cases");
  const result=await json(cases+'/compose/output/result.json'),file=result.files[0],data=await readFile(cases+'/compose/output/candidate/'+file.sha256);
  assert.equal(sha(data),file.sha256);assert.deepEqual([...PNG.sync.read(data).data],[0,255,0,255,255,0,0,255]);
  const atlas=await json(cases+'/atlas/output/result.json');assert.equal(atlas.files.length,3);assert.equal(atlas.info.pages,2);
  const atlasMetadata=atlas.files.find((file:any)=>file.path==='assets/actors.atlas.json'),metadata=await json(cases+'/atlas/output/candidate/'+atlasMetadata.sha256);
  assert.equal(metadata.textures.length,2);assert.deepEqual(metadata.animations.blink,{frames:['red','green'],fps:8,loop:true});
  for(const [index,page] of metadata.textures.entries()){
    const bytes=await readFile(cases+'/atlas/output/candidate/'+atlas.files.find((file:any)=>file.path==='assets/'+page.image).sha256);
    assert.equal(page.frames.length,1);assert.deepEqual([...PNG.sync.read(bytes).data.subarray(0,4)],index?[0,255,0,255]:[255,0,0,255]);
  }
  const audio=await json(cases+'/audio/output/result.json'),wav=await readFile(cases+'/audio/output/candidate/'+audio.files[0].sha256);
  assert.equal(wav.toString('ascii',0,4),'RIFF');assert.equal(wav.toString('ascii',8,12),'WAVE');assert.equal(wav.readUInt32LE(24),22050);
  assert.equal(wav.length,44+audio.info.frames*2);assert.ok(wav.subarray(44).some(byte=>byte!==0));
  assert.equal(audio.info.sourceClips,0);assert.equal(audio.info.proceduralNotes,2);
  assert.equal((await json(cases+'/audio/input/request.json')).spec.operation.notes[1].gain,1e-7);
  return {pngPixelsVerified:true,atlasPages:2,atlasFrames:2,audioFrames:audio.info.frames,audioSampleRate:22050,smallRecipeFloatVerified:true};
}
