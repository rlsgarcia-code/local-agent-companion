import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {structuralAudioMp4} from './game-audio-container-fixtures';
const modulePromise=import(path.resolve('packages/adapter-game-web/runtimes/game-audio-1.1.0.mjs'));
test('bounded AAC inspection admits the mono/stereo three-rate delivery profile without claiming to decode payload',async()=>{
 const {inspectPackagedAudio}=await modulePromise;
 for(const rate of [22050,44100,48000])for(const channels of [1,2])for(const movieRate of [1000,rate]){const bytes=structuralAudioMp4({rate,channels,movieRate,frames:rate*2}),shape=inspectPackagedAudio(bytes);assert.equal(shape.format,'aac-lc');assert.equal(shape.channels,channels);assert.equal(shape.rate,rate);assert.equal(shape.maxFrames,Math.ceil(rate*2/1024)*1024);assert.ok(shape.minFrames<=rate*2);assert.ok(shape.maxFrames>=rate*2);}
 const old=await readFile('packages/adapter-game-web/runtimes/game-audio-1.0.0.mjs');assert.equal(createHash('sha256').update(old).digest('hex'),'532c51f9a1f413d60a74edbd45d0940223f7ee1a99f6f314c885588085621bc6','Historical source remains exact');
});
test('AAC refuses altered dimensions, external references, encryption, fragments and inconsistent sample ranges',async()=>{
 const {inspectPackagedAudio}=await modulePromise,original=structuralAudioMp4();
 const change=(type:string,offset:number,mutate:(b:Buffer,at:number)=>void)=>{const b=Buffer.from(original),at=b.indexOf(type);assert.ok(at>0);mutate(b,at+4+offset);assert.throws(()=>inspectPackagedAudio(b));};
 change('mdhd',12,(b,p)=>b.writeUInt32BE(192000,p));
 change('mdhd',16,(b,p)=>b.writeUInt32BE(180*48000+2049,p));
 change('stts',12,(b,p)=>b.writeUInt32BE(0xffffffff,p));
 change('stsc',12,(b,p)=>b.writeUInt32BE(999,p));
 change('stco',8,(b,p)=>b.writeUInt32BE(0,p));
 change('stsz',12,(b,p)=>b.writeUInt32BE(8193,p));
 change('url ',0,(b,p)=>b.writeUInt32BE(0,p));
 change('mp4a',0,(b,p)=>b.write('enca',p-4));
 change('moov',0,(b,p)=>b.write('moof',p-4));
 change('hdlr',8,(b,p)=>b.write('vide',p));
 for(const channels of [0,3,7])assert.throws(()=>inspectPackagedAudio(structuralAudioMp4({channels})));
 for(const rate of [24000,32000,64000])assert.throws(()=>inspectPackagedAudio(structuralAudioMp4({rate})));
 assert.throws(()=>inspectPackagedAudio(original.subarray(0,original.length-1)));const trailing=Buffer.concat([original,Buffer.alloc(8)]);assert.throws(()=>inspectPackagedAudio(trailing));
 const asc=original.indexOf(Buffer.from([0x11,0x90,0x56,0xe5,0]));assert.ok(asc>0);for(const [offset,value]of [[0,0x29],[2,0],[4,1]]){const b=Buffer.from(original);b[asc+offset!]=value!;assert.throws(()=>inspectPackagedAudio(b));}
 // Movie and track declarations agree with each other, but falsely stretch
 // a one-second payload to180 seconds. Independent per-field caps are insufficient.
 const expanded=Buffer.from(original);expanded.writeUInt32BE(180000,expanded.indexOf('mvhd')+4+16);expanded.writeUInt32BE(180000,expanded.indexOf('tkhd')+4+20);assert.throws(()=>inspectPackagedAudio(expanded),/pinned AAC-LC/);
 const coarse=Buffer.from(original);coarse.writeUInt32BE(1,coarse.indexOf('mvhd')+4+12);coarse.writeUInt32BE(1,coarse.indexOf('mvhd')+4+16);coarse.writeUInt32BE(1,coarse.indexOf('tkhd')+4+20);assert.throws(()=>inspectPackagedAudio(coarse));
});
