import assert from "node:assert/strict";
import test from "node:test";
import { PNG } from "pngjs";
import { deflateSync } from "node:zlib";
import { gameAssetOperation } from "../packages/contracts/src/game-assets";
import { imageProcessor } from "../packages/adapter-game-assets/src/images";
import { decodeWave, renderAudio } from "../packages/adapter-game-assets/src/audio";

function png(width:number,height:number,paint:(x:number,y:number)=>number[]):Buffer {
  const image=new PNG({width,height});for(let y=0;y<height;y++)for(let x=0;x<width;x++)paint(x,y).forEach((value,index)=>image.data[(y*width+x)*4+index]=value);
  return PNG.sync.write(image);
}
function chunk(type:string,data:Buffer):Buffer {
  const bytes=Buffer.alloc(data.length+12);bytes.writeUInt32BE(data.length);bytes.write(type,4);data.copy(bytes,8);let crc=0xffffffff;
  for(const byte of bytes.subarray(4,-4)){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
  bytes.writeUInt32BE((crc^0xffffffff)>>>0,bytes.length-4);return bytes;
}
const source={assetId:"raw",path:"assets/raw.png"};
const compose=(patch:Record<string,unknown>={})=>gameAssetOperation.parse({type:"image.compose",output:"assets/edited.png",width:4,height:1,layers:[{source,x:0,y:0,width:4,height:1}],...patch});

test("local image composition resamples premultiplied alpha, crops, flips, tints and blends into exact RGBA pixels",()=>{
  const bytes=png(2,1,(x)=>x?[0,0,255,0]:[255,0,0,255]),processor=imageProcessor(new Map([[source.path,bytes]]));
  const operation=compose();assert.equal(operation.type,"image.compose");if(operation.type!=="image.compose")return;
  const result=processor.compose(operation),decoded=PNG.sync.read(Buffer.from(result.files[0]!.data));
  assert.deepEqual([...decoded.data.subarray(8,12)],[255,0,0,64],"transparent blue must not bleed into the interpolated red edge");
  const edited=compose({width:1,layers:[{source,x:0,y:0,width:1,height:1,crop:{x:0,y:0,width:1,height:1},flipX:true,tint:"#80ff80ff",opacity:0.5}],background:"#0000ffff"});
  if(edited.type!=="image.compose")return;
  const pixel=PNG.sync.read(Buffer.from(processor.compose(edited).files[0]!.data)).data;
  assert.deepEqual([...pixel],[64,0,128,255]);
  const cropped=compose({layers:[{source,x:0,y:0,width:4,height:1,crop:{x:1,y:0,width:2,height:1}}]});
  if(cropped.type==="image.compose")assert.throws(()=>processor.compose(cropped),/crop/);
});

test("PNG decoder rejects compressed size abuse, invalid CRC and unsupported animations without losing the originals",()=>{
  const valid=png(2,1,()=>[1,2,3,255]),bad=Buffer.from(valid);bad[29]=bad[29]!^1;
  const op=compose();if(op.type!=="image.compose")return;
  assert.throws(()=>imageProcessor(new Map([[source.path,bad]])).compose(op));
  const huge=Buffer.from(valid);huge.writeUInt32BE(0x7fffffff,16);
  assert.throws(()=>imageProcessor(new Map([[source.path,huge]])).compose(op),/pixel budget/);
  const animated=Buffer.concat([valid.subarray(0,33),chunk("acTL",Buffer.alloc(8)),valid.subarray(33)]);
  assert.throws(()=>imageProcessor(new Map([[source.path,animated]])).compose(op),/Animated PNG/);
  const oversized=Buffer.concat([valid.subarray(0,33),chunk("IDAT",deflateSync(Buffer.alloc(4096))),chunk("IEND",Buffer.alloc(0))]);
  assert.throws(()=>imageProcessor(new Map([[source.path,oversized]])).compose(op),/larger than|size|length/);
  assert.deepEqual(valid,png(2,1,()=>[1,2,3,255]));
});

test("atlas production packs multiple pages with padding, trim origins and animation identities; no frames are silently dropped",()=>{
  const files=new Map([["assets/a.png",png(180,180,()=>[255,0,0,255])],["assets/b.png",png(180,180,()=>[0,255,0,255])]]);
  const operation=gameAssetOperation.parse({type:"image.atlas",outputBase:"assets/actors",pageSize:256,maxPages:2,padding:2,frames:[{id:"red",source:{assetId:"red",path:"assets/a.png"}},{id:"green",source:{assetId:"green",path:"assets/b.png"}}],animations:[{id:"blink",frames:["red","green"],fps:6,loop:true}]});
  if(operation.type!=="image.atlas")return;
  const result=imageProcessor(files).atlas(operation),metadata=JSON.parse(Buffer.from(result.files.at(-1)!.data).toString());
  assert.equal(result.info.pages,2);assert.deepEqual(metadata.animations.blink,{frames:["red","green"],fps:6,loop:true});
  for(const [index,page] of metadata.textures.entries()) {
    assert.equal(page.frames.length,1);assert.deepEqual(page.frames[0].frame,{x:2,y:2,w:180,h:180});
    const image=PNG.sync.read(Buffer.from(result.files[index]!.data));assert.deepEqual([...image.data.subarray(0,4)],index?[0,255,0,255]:[255,0,0,255]);
  }
  assert.throws(()=>imageProcessor(files).atlas({...operation,maxPages:1}),/page\/pixel budget/);
  const trim=gameAssetOperation.parse({...operation,frames:[{id:"small",source:{assetId:"raw",path:source.path}}],animations:[]});
  if(trim.type!=="image.atlas")return;
  const trimmed=imageProcessor(new Map([[source.path,png(8,8,(x,y)=>x>=2&&x<6&&y>=1&&y<7?[12,34,56,255]:[0,0,0,0])]])).atlas(trim);
  const frame=JSON.parse(Buffer.from(trimmed.files.at(-1)!.data).toString()).textures[0].frames[0];assert.deepEqual(frame.spriteSourceSize,{x:2,y:1,w:4,h:6});assert.deepEqual(frame.sourceSize,{w:8,h:8});
  assert.throws(()=>gameAssetOperation.parse({...operation,outputBase:`assets/${"á".repeat(125)}`}),/portable/);
});

function audioFixture() {return gameAssetOperation.parse({type:"audio.render",output:"assets/note.wav",sampleRate:48000,channels:1,durationMs:400,normalizePeak:0.5,
  notes:[{waveform:"sine",frequency:1000,startMs:0,durationMs:400,gain:0.8,attackMs:5,releaseMs:30}]});}
test("procedural audio has coherent independent WAV header/sample values, deterministic synthesis and normalization",()=>{
  const operation=audioFixture();if(operation.type!=="audio.render")return;
  const result=renderAudio(operation,new Map()),data=Buffer.from(result.files[0]!.data);
  assert.equal(data.subarray(0,4).toString(),"RIFF");assert.equal(data.readUInt32LE(4),data.length-8);assert.equal(data.readUInt16LE(20),1);assert.equal(data.readUInt32LE(24),48000);assert.equal(data.readUInt16LE(34),16);
  assert.equal(data.readUInt32LE(40),19200*2);assert.equal(result.info.clippedSamples,0);
  assert.ok(Math.abs(data.readInt16LE(44+4812*2)-16384)<=1,"a 1 kHz sine at its positive quarter-cycle has the declared 0.5 amplitude");
  assert.deepEqual(data,Buffer.from(renderAudio(operation,new Map()).files[0]!.data));
  const noise={...operation,notes:[{...operation.notes[0]!,waveform:"noise" as const,seed:42}]};
  assert.deepEqual(renderAudio(noise,new Map()).files[0]!.data,renderAudio(noise,new Map()).files[0]!.data);
});

test("audio decoder reads independently authored PCM/extensible/float data and rejects non-finite samples",()=>{
  function wave(tag:number,bits:number,values:number[],extensible=false):Buffer{
    const format=extensible?40:16,bytes=Buffer.alloc(12+8+format+8+values.length*bits/8+(values.length*bits/8)%2),dataOffset=12+8+format+8;
    bytes.write("RIFF");bytes.writeUInt32LE(bytes.length-8,4);bytes.write("WAVEfmt ",8);bytes.writeUInt32LE(format,16);
    bytes.writeUInt16LE(extensible?0xfffe:tag,20);bytes.writeUInt16LE(1,22);bytes.writeUInt32LE(8000,24);bytes.writeUInt32LE(8000*bits/8,28);bytes.writeUInt16LE(bits/8,32);bytes.writeUInt16LE(bits,34);
    if(extensible){bytes.writeUInt16LE(22,36);bytes.writeUInt16LE(bits,38);bytes.writeUInt32LE(4,40);bytes.writeUInt32LE(tag,44);Buffer.from("00001000800000aa00389b71","hex").copy(bytes,48);}
    bytes.write("data",dataOffset-8);bytes.writeUInt32LE(values.length*bits/8,dataOffset-4);
    values.forEach((value,i)=>{const at=dataOffset+i*bits/8;if(tag===3)bytes.writeFloatLE(value,at);else if(bits===8)bytes[at]=Math.round(value*128+128);else bytes.writeIntLE(Math.round(value*2**(bits-1)),at,bits/8);});return bytes;
  }
  for(const [tag,bits,extensible] of [[1,8,false],[1,24,false],[1,32,true],[3,32,false],[3,32,true]] as const)
    assert.deepEqual([...decodeWave(wave(tag,bits,[-0.5,0,0.5],extensible)).samples],[-0.5,0,0.5]);
  assert.throws(()=>decodeWave(wave(3,32,[NaN])),/Non-finite/);
  assert.throws(()=>decodeWave(wave(3,32,[Infinity],true)),/Non-finite/);
});

test("downsampling attenuates out-of-band tones instead of producing an audible alias",()=>{
  const op=audioFixture();if(op.type!=="audio.render")return;
  const input=(hz:number)=>Buffer.from(renderAudio({...op,normalizePeak:undefined,notes:[{...op.notes[0]!,frequency:hz}]},new Map()).files[0]!.data);
  const mix=gameAssetOperation.parse({type:"audio.render",output:"assets/resampled.wav",sampleRate:22050,channels:1,durationMs:400,
    clips:[{source:{assetId:"raw",path:"assets/raw.wav"},startMs:0,durationMs:400}]});if(mix.type!=="audio.render")return;
  const rms=(hz:number)=>{const values=decodeWave(Buffer.from(renderAudio(mix,new Map([["assets/raw.wav",input(hz)]])).files[0]!.data)).samples.subarray(2205,6615);return Math.sqrt(values.reduce((sum,value)=>sum+value*value,0)/values.length);};
  const inBand=rms(1000),outOfBand=rms(16000);assert.ok(inBand>0.2);assert.ok(outOfBand/inBand<0.005,`${outOfBand/inBand} alias ratio exceeds -46 dB`);
});

test("PCM mixer resamples, pans and fades; malformed/non-finite/truncated sources and requests are rejected",()=>{
  const raw=audioFixture();if(raw.type!=="audio.render")return;
  const sourceWave=Buffer.from(renderAudio(raw,new Map()).files[0]!.data);
  const op=gameAssetOperation.parse({type:"audio.render",output:"assets/mixed.wav",sampleRate:22050,channels:2,durationMs:400,normalizePeak:0.8,
    clips:[{source:{assetId:"tone",path:"assets/tone.wav"},startMs:0,durationMs:400,pan:-1,fadeInMs:10,fadeOutMs:10}]});
  if(op.type!=="audio.render")return;
  const result=renderAudio(op,new Map([["assets/tone.wav",sourceWave]])),decoded=decodeWave(Buffer.from(result.files[0]!.data));
  assert.equal(decoded.rate,22050);assert.equal(decoded.channels,2);assert.equal(decoded.frames,8820);
  assert.ok(Math.max(...decoded.samples.filter((_value,index)=>index%2===0))>0.79);
  assert.ok(decoded.samples.filter((_value,index)=>index%2===1).every((value)=>Math.abs(value)<0.0001));
  const bad=Buffer.from(sourceWave);bad.writeUInt32LE(12,40);assert.throws(()=>decodeWave(bad));
  assert.throws(()=>renderAudio({...op,clips:[{...op.clips[0]!,offsetMs:100}]},new Map([["assets/tone.wav",sourceWave]])),/exceeds its source/);
  assert.throws(()=>gameAssetOperation.parse({...op,clips:[{...op.clips[0]!,startMs:399}]}));
});
