import assert from "node:assert/strict";
import test from "node:test";
import {createHash} from "node:crypto";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {gameAudioEncodeOperation} from "../packages/contracts/src/game-audio-codec";
import {assetOutputPaths,assetSources,assetSourceInputs} from "../packages/contracts/src/game-assets";
import {processGameMedia} from "../packages/adapter-game-assets/src/process";
import {canonicalPcm16,inspectAudioMp4,validateEncodedAudio,createAudioCodecProcessor} from "../packages/adapter-game-audio-codec/src/index";
import {fixtureGameDocument} from "./game-fixtures";
const sha=(b:Uint8Array)=>createHash("sha256").update(b).digest("hex");
function wav(){const b=Buffer.alloc(44+4410*2);b.write("RIFF");b.writeUInt32LE(b.length-8,4);b.write("WAVEfmt ",8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(22050,24);b.writeUInt32LE(44100,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write("data",36);b.writeUInt32LE(b.length-44,40);return b;}
const operation=()=>gameAudioEncodeOperation.parse({type:"audio.encode",codec:"aac-lc",source:{assetId:"source",path:"assets/source.wav"},outputBase:"assets/music",variants:[{id:"compact",bitrateKbps:64},{id:"standard",bitrateKbps:128}]});
function box(type:string,size:number){const b=Buffer.alloc(size);b.writeUInt32BE(size);b.write(type,4);return b;}
// Structural data only, not AAC. Native roundtrip/browser qualification is separate.
const mp4=()=>Buffer.concat([box("ftyp",20),box("moov",16),box("free",8),box("mdat",40)]);
function tar(entries:[string,Buffer][]){const chunks=[];for(const [name,data]of entries){const h=Buffer.alloc(512);h.write(name);h.write("0000644\0",100);h.write("0000000\0",108);h.write("0000000\0",116);h.write(data.length.toString(8).padStart(11,"0")+"\0",124);h.fill(32,148,156);h[156]=48;h.write("ustar\0",257);h.write("00",263);let sum=0;for(const b of h)sum+=b;h.write(sum.toString(8).padStart(6,"0")+"\0 ",148);chunks.push(h,data,Buffer.alloc((512-data.length%512)%512));}return Buffer.concat([...chunks,Buffer.alloc(1024)]);}
test("audio encoding has explicit bounded variants, registered sources and no local-worker/Core escape",()=>{
 const op=operation();assert.deepEqual(assetSources(op),[op.source]);assert.deepEqual(assetOutputPaths(op),["assets/music.compact.m4a","assets/music.standard.m4a","assets/music.encoded.json"]);
 for(const value of [{...op,command:"ffmpeg"},{...op,codec:"auto"},{...op,variants:[op.variants[0],op.variants[0]]},{...op,variants:[{id:"../outside",bitrateKbps:64}]},{...op,variants:[{id:"low",bitrateKbps:12}]},{...op,source:{assetId:"x",path:"https://outside.invalid/raw.wav"}}])assert.throws(()=>gameAudioEncodeOperation.parse(value));
 assert.throws(()=>processGameMedia(op,new Map()),/isolated codec/);
 const document=fixtureGameDocument(),data=wav();document.files=[{path:op.source.path,size:data.length,mime:"audio/wav",sha256:sha(data),transferId:"fixture"}];document.assets=[{id:"source",kind:"audio",role:"Fixture",placeholder:true,files:[op.source.path],origin:{kind:"procedural",author:"Test",source:"Synthetic",license:"Test",referenceIds:[]}}];
 const spec={processorId:"audio-codec-isolated-v1",target:{id:"encoded",role:"Fixture",placeholder:true},operation:op};assert.equal(assetSourceInputs(document,spec).files.length,1);
 document.files[0]!.mime="image/png";assert.throws(()=>assetSourceInputs(document,spec),/registered WAV/);document.files[0]!.mime="audio/wav";document.assets[0]!.kind="image";assert.throws(()=>assetSourceInputs(document,spec),/kind/);
});
test("canonical PCM guards and MP4 structure checks preserve bounds without claiming to decode AAC",()=>{
 const data=wav();assert.deepEqual(canonicalPcm16(data),{channels:1,sampleRate:22050,frames:4410});assert.throws(()=>canonicalPcm16(data.subarray(1)));const bad=Buffer.from(data);bad.writeUInt16LE(24,34);assert.throws(()=>canonicalPcm16(bad));
 assert.deepEqual(inspectAudioMp4(mp4()).map(b=>b.type),["ftyp","moov","free","mdat"]);
 assert.throws(()=>inspectAudioMp4(Buffer.concat([box("ftyp",20),box("mdat",40),box("moov",16)])),/fast-start/);
 const oversized=mp4();oversized.writeUInt32BE(100000,0);assert.throws(()=>inspectAudioMp4(oversized));assert.throws(()=>inspectAudioMp4(mp4().subarray(0,60)));
});
test("encoded candidates bind every requested variant, source, dimensions and byte hash",()=>{
 const op=operation(),data=mp4(),source={sha256:sha(wav()),...canonicalPcm16(wav())},variants=op.variants.map(v=>({...v,path:`${op.outputBase}.${v.id}.m4a`,size:data.length,sha256:sha(data),decodedFrames:source.frames,rmse:.02,snrDb:30}));
 const report={schemaVersion:1,codec:"aac-lc",container:"mp4",sourceSha256:source.sha256,sampleRate:source.sampleRate,channels:source.channels,sourceFrames:source.frames,variants};
 const archive=(r=report)=>tar([...variants.map(v=>[v.path,data] as [string,Buffer]),["assets/music.encoded.json",Buffer.from(JSON.stringify(r))]]);
 const result=validateEncodedAudio(archive(),op,source);assert.equal(result.info.variants,2);assert.equal(result.files[0]!.mime,"audio/mp4");
 assert.throws(()=>validateEncodedAudio(archive({...report,sourceSha256:"a".repeat(64)}),op,source),/source dimensions/);
 assert.throws(()=>validateEncodedAudio(archive({...report,variants:[{...variants[0]!,sha256:"a".repeat(64)},variants[1]!]}),op,source),/exact request/);
 assert.throws(()=>validateEncodedAudio(tar([["assets/unrequested.m4a",data],["assets/music.encoded.json",Buffer.from(JSON.stringify(report))]]),op,source),/Incomplete/);
});
test("unprovisioned codec is explicitly unavailable and cannot select native FFmpeg or a KidOS processor",async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),"audio-codec-capability-"));try{
  const processor=await createAudioCodecProcessor({stateDirectory:directory,driverSha256:"a".repeat(64)});assert.equal((await processor.probe({} as never)).available,false);assert.deepEqual(processor.operations,["audio.encode"]);assert.equal(processor.products.includes("kidos"),false);assert.match(processor.projectGuide!,/No shell/);
 }finally{await rm(directory,{recursive:true,force:true});}
});
