import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp,mkdir,realpath,readFile,writeFile,rm,readdir,symlink,link } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { PNG } from "pngjs";
import { fixtureGameDocument } from "./game-fixtures";
import { gameContentHash } from "../packages/game-design/src/project";
import { canonical,contentHash } from "../packages/contracts/src/identity";
import { assetSourceInputs,gameAssetSpec } from "../packages/contracts/src/game-assets";
import { gameMediaProcessRequest,gameMediaProcessResult } from "../packages/contracts/src/game-media-worker";
import { processMediaCandidate } from "../packages/adapter-game-assets/src/candidate";
import { gameMediaToolchain,MEDIA_PROCESSOR_ID } from "../packages/adapter-game-assets/src/media-toolchain";

const pin="a".repeat(64),sha=(data:Uint8Array)=>createHash("sha256").update(data).digest("hex");
const image=()=>{const png=new PNG({width:2,height:1});png.data.set([255,0,0,255,0,255,0,255]);return PNG.sync.write(png);};
async function fixture(operation:Record<string,unknown>={type:"image.compose",output:"assets/final.png",width:2,height:1,
  layers:[{source:{assetId:"source",path:"assets/source.png"},x:0,y:0,width:2,height:1,filter:"nearest"}]}) {
  const root=await realpath(await mkdtemp(path.join(tmpdir(),"media-candidate-"))),input=path.join(root,"input"),output=path.join(root,"output");
  await mkdir(input);await mkdir(path.join(input,"blobs"));await mkdir(output);
  const source=image(),document=fixtureGameDocument();
  document.files.push({path:"assets/source.png",mime:"image/png",size:source.length,sha256:sha(source),transferId:"source"});
  document.assets.push({id:"source",kind:"image",role:"Synthetic codec fixture",files:["assets/source.png"],origin:{kind:"procedural",source:"Test pixels",author:"Test",license:"Synthetic test fixture",referenceIds:[]},placeholder:true});
  const spec=gameAssetSpec.parse({processorId:MEDIA_PROCESSOR_ID,target:{id:"target",role:"Fixture output"},operation});
  const request=gameMediaProcessRequest.parse({schemaVersion:1,requestId:"media-fixture",sourceHash:gameContentHash(document),recipeHash:contentHash(spec),toolchain:gameMediaToolchain(pin),document,spec,sources:assetSourceInputs(document,spec).files});
  const raw=Buffer.from(canonical(request));await writeFile(path.join(input,"request.json"),raw);
  if(request.sources.length)await writeFile(path.join(input,"blobs",sha(source)),source);
  return {root,input,output,request,raw,source,blob:path.join(input,"blobs",sha(source)),
    run:()=>processMediaCandidate({inputDirectory:input,outputDirectory:output,implementationSha256:pin}),
    async rewrite(){await writeFile(path.join(input,"request.json"),canonical(request));},
    async close(){await rm(root,{recursive:true,force:true});}};
}

test("the fixed media candidate binds source, recipe, request and toolchain to real PNG bytes without modifying originals",async()=>{
  const f=await fixture();
  try{
    const result=await f.run();gameMediaProcessResult.parse(result);
    assert.equal(result.sourceHash,f.request.sourceHash);assert.equal(result.recipeHash,contentHash(f.request.spec));assert.equal(result.requestSha256,sha(f.raw));
    assert.deepEqual(result.toolchain,gameMediaToolchain(pin));assert.deepEqual(result.files.map(file=>file.path),["assets/final.png"]);
    const data=await readFile(path.join(f.output,"candidate",result.files[0]!.sha256));assert.equal(sha(data),result.files[0]!.sha256);
    assert.deepEqual([...PNG.sync.read(data).data],[255,0,0,255,0,255,0,255]);
    assert.deepEqual(await readFile(f.blob),f.source);assert.deepEqual(await readFile(path.join(f.input,"request.json")),f.raw);
    assert.deepEqual(JSON.parse(await readFile(path.join(f.output,"result.json"),"utf8")),result);
    await assert.rejects(f.run());assert.deepEqual(JSON.parse(await readFile(path.join(f.output,"result.json"),"utf8")),result);
  }finally{await f.close();}
});

test("atlas candidates retain all frames, packaged pages and animation metadata",async()=>{
  const f=await fixture({type:"image.atlas",outputBase:"assets/actors",pageSize:256,maxPages:2,frames:[{id:"first",source:{assetId:"source",path:"assets/source.png"}},{id:"second",source:{assetId:"source",path:"assets/source.png"}}],animations:[{id:"blink",frames:["first","second"],fps:8,loop:true}]});
  try{
    const result=await f.run();assert.equal(result.files.length,2);assert.equal(result.info.frames,2);
    const file=result.files.find(file=>file.mime==="application/json")!,metadata=JSON.parse(await readFile(path.join(f.output,"candidate",file.sha256),"utf8"));
    assert.equal(metadata.textures[0].frames.length,2);assert.deepEqual(metadata.animations.blink,{frames:["first","second"],fps:8,loop:true});
  }finally{await f.close();}
});

test("procedural WAV processing needs no game-code blobs or model and produces a deterministic candidate",async()=>{
  const f=await fixture({type:"audio.render",output:"assets/tone.wav",durationMs:100,sampleRate:22050,channels:1,notes:[{waveform:"sine",frequency:440,startMs:0,durationMs:100,gain:0.2}]});
  try{
    assert.equal(f.request.sources.length,0);assert.deepEqual(await readdir(path.join(f.input,"blobs")),[]);
    for(const waveformBins of [128,256,512,1024]){const forged=structuredClone(f.request);Object.assign(forged.spec.operation,{waveformBins});forged.recipeHash=contentHash(forged.spec);assert.equal(gameMediaProcessRequest.safeParse(forged).success,false);}
    const result=await f.run(),data=await readFile(path.join(f.output,"candidate",result.files[0]!.sha256));
    assert.equal(data.toString("ascii",0,4),"RIFF");assert.equal(data.toString("ascii",8,12),"WAVE");assert.equal(data.readUInt32LE(24),22050);
    assert.equal(result.info.sourceClips,0);assert.equal(result.info.proceduralNotes,1);
    const again=path.join(f.root,"again");await mkdir(again);
    const repeated=await processMediaCandidate({inputDirectory:f.input,outputDirectory:again,implementationSha256:pin});
    assert.deepEqual(repeated.files,result.files);assert.deepEqual(await readFile(path.join(f.input,"request.json")),f.raw);
  }finally{await f.close();}
});

test("tampered source bytes are rejected before publishing a result",async()=>{
  const f=await fixture();
  try{await writeFile(f.blob,Buffer.alloc(f.source.length,0));await assert.rejects(f.run());assert.ok(!(await readdir(f.output)).includes("result.json"));assert.deepEqual(await readFile(path.join(f.input,"request.json")),f.raw);}
  finally{await f.close();}
});

test("unregistered sources, provenance cycles, media budgets and forged request fields cannot select host capabilities",async()=>{
  const f=await fixture();
  try{
    const request=()=>structuredClone(f.request);
    for(const change of [
      (p:typeof f.request)=>{p.sources=[];},
      (p:typeof f.request)=>{p.sources[0]!.sha256="b".repeat(64);},
      (p:typeof f.request)=>{p.document.assets[0]!.files=["assets/other.png"];},
      (p:typeof f.request)=>{p.document.assets[0]!.kind="audio";},
      (p:typeof f.request)=>{p.document.assets[0]!.origin.referenceIds=[p.spec.target.id];},
      (p:typeof f.request)=>{p.document.files[0]!.size=64*1024*1024+1;p.sources[0]!.size=p.document.files[0]!.size;},
      (p:typeof f.request)=>{Object.assign(p.spec.operation,{command:"sh",provider:"unapproved",url:"https://example.invalid"});},
      (p:typeof f.request)=>{Object.assign(p.spec.operation,{pngEncoding:"lossless-smallest"});p.recipeHash=contentHash(p.spec);},
      (p:typeof f.request)=>{Object.assign(p.spec.operation,{pngEncoding:"rgba8"});p.recipeHash=contentHash(p.spec);},
    ]){const modified=request();change(modified);assert.equal(gameMediaProcessRequest.safeParse(modified).success,false);}
    const encoded=structuredClone(f.request);encoded.spec={processorId:MEDIA_PROCESSOR_ID,target:encoded.spec.target,operation:{type:"audio.encode",codec:"aac-lc",source:{assetId:"source",path:"assets/source.wav"},outputBase:"assets/music",variants:[{id:"compact",bitrateKbps:64}]}};encoded.recipeHash=contentHash(encoded.spec);assert.equal(gameMediaProcessRequest.safeParse(encoded).success,false);
    assert.equal(gameMediaProcessRequest.safeParse({...f.request,uid:0}).success,false);
    assert.equal(gameMediaProcessRequest.safeParse({...f.request,sources:[{...f.request.sources[0],path:"/etc/passwd"}]}).success,false);
  }finally{await f.close();}
});

test("changed source identity, implementation and processor pins never produce an acknowledged candidate",async()=>{
  for(const change of ['source','toolchain','processor'] as const){
    const f=await fixture();
    try{
      if(change==='source')f.request.sourceHash="b".repeat(64);
      else if(change==='toolchain')f.request.toolchain.sha256="b".repeat(64);
      else f.request.spec.processorId="local-media-v1";
      await f.rewrite();await assert.rejects(f.run());assert.ok(!(await readdir(f.output)).includes("result.json"));
    }finally{await f.close();}
  }
});

test("blob aliases and linked request files cannot escape sealed inputs",{skip:process.platform==='win32'},async()=>{
  for(const kind of ['symlink','hardlink','request-link'] as const){
    const f=await fixture();
    try{
      const external=path.join(f.root,"original.png");await writeFile(external,f.source);
      if(kind==='request-link'){
        const raw=path.join(f.root,"request-copy.json");await writeFile(raw,f.raw);await rm(path.join(f.input,"request.json"));await symlink(raw,path.join(f.input,"request.json"));
      }else{await rm(f.blob);await (kind==='symlink'?symlink:link)(external,f.blob);}
      await assert.rejects(f.run());assert.deepEqual(await readFile(external),f.source);assert.ok(!(await readdir(f.output)).includes("result.json"));
    }finally{await f.close();}
  }
});

test("unexpected files, overlapping directories and preexisting results remain intact on rejection",async()=>{
  for(const kind of ['extra-blob','extra-input','overlap','old-result'] as const){
    const f=await fixture();
    try{
      if(kind==='extra-blob')await writeFile(path.join(f.input,"blobs","undeclared"),"not an input");
      if(kind==='extra-input')await writeFile(path.join(f.input,"command.js"),"must not execute");
      if(kind==='old-result')await writeFile(path.join(f.output,"result.json"),"prior acknowledged result");
      await assert.rejects(kind==='overlap'?processMediaCandidate({inputDirectory:f.input,outputDirectory:f.input,implementationSha256:pin}):f.run());
      if(kind==='old-result')assert.equal(await readFile(path.join(f.output,"result.json"),"utf8"),"prior acknowledged result");
      if(kind==='extra-input')assert.equal(await readFile(path.join(f.input,"command.js"),"utf8"),"must not execute");
    }finally{await f.close();}
  }
});

test("pre-cancelled or simultaneous processing never overwrites a former candidate",async()=>{
  const f=await fixture();
  try{
    await assert.rejects(processMediaCandidate({inputDirectory:f.input,outputDirectory:f.output,implementationSha256:pin,signal:AbortSignal.abort()}));
    assert.deepEqual(await readdir(f.output),[]);
    const results=await Promise.allSettled([f.run(),f.run()]);assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
    const acknowledged=JSON.parse(await readFile(path.join(f.output,"result.json"),"utf8"));assert.equal(acknowledged.requestId,f.request.requestId);
    assert.equal((await readdir(path.join(f.output,"candidate"))).length,1);
  }finally{await f.close();}
});
