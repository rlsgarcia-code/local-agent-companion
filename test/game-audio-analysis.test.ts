import assert from "node:assert/strict";
import test from "node:test";
import {createHash} from "node:crypto";
import {analyzeRenderedWave} from "../packages/adapter-game-assets/src/audio-analysis";
import {renderAudio} from "../packages/adapter-game-assets/src/audio";
import {gameAudioAnalysis,audioAnalysisPath} from "../packages/contracts/src/game-audio-analysis";
import {gameAudioRenderOperation,assetOutputPaths} from "../packages/contracts/src/game-assets";

function pcm(channels:number,samples:number[]){
  const rate=22050,data=Buffer.alloc(44+samples.length*2);data.write("RIFF");data.writeUInt32LE(data.length-8,4);data.write("WAVEfmt ",8);data.writeUInt32LE(16,16);data.writeUInt16LE(1,20);data.writeUInt16LE(channels,22);data.writeUInt32LE(rate,24);data.writeUInt32LE(rate*channels*2,28);data.writeUInt16LE(channels*2,32);data.writeUInt16LE(16,34);data.write("data",36);data.writeUInt32LE(samples.length*2,40);samples.forEach((v,i)=>data.writeInt16LE(v,44+i*2));return data;
}
test("rendered PCM measurements match exact encoded samples and cover every stereo frame once",()=>{
  const values=Array.from({length:600},(_,i)=>i<40||i>=560?[0,0]:i%2?[-32768,8192]:[32767,-8192]).flat(),wav=pcm(2,values),before=Buffer.from(wav),a=analyzeRenderedWave(wav,256);
  assert.equal(a.audioSha256,createHash("sha256").update(wav).digest("hex"));assert.equal(a.frames,600);assert.equal(a.binCount,256);
  assert.equal(a.leadingQuietFrames,40);assert.equal(a.trailingQuietFrames,40);assert.equal(a.quietFrames,80);
  assert.equal(a.channels[0]!.fullScaleSamples,520);assert.equal(a.channels[1]!.fullScaleSamples,0);
  for(const [index,channel]of a.channels.entries()){
    const samples=values.filter((_,i)=>i%2===index).map(v=>v/32768),mean=samples.reduce((s,v)=>s+v,0)/600,rms=Math.sqrt(samples.reduce((s,v)=>s+v*v,0)/600);
    assert.ok(Math.abs(channel.rms-rms)<1e-12);assert.ok(Math.abs(channel.dc-mean)<1e-12);assert.ok(Math.abs(channel.rmsDbfs!-20*Math.log10(rms))<1e-10);
    for(const bin of channel.bins){const part=samples.slice(bin.start,bin.end);assert.equal(bin.min,Math.min(...part));assert.equal(bin.max,Math.max(...part));}
    assert.equal(channel.bins[0]!.start,0);assert.equal(channel.bins.at(-1)!.end,600);
  }
  assert.deepEqual(analyzeRenderedWave(wav,256),a);assert.deepEqual(wav,before);
});
test("silence has null dBFS rather than infinity and short sounds use only nonempty bins",()=>{
  const a=analyzeRenderedWave(pcm(1,Array(10).fill(0)),1024);assert.equal(a.binCount,10);assert.equal(a.quietFrames,10);assert.equal(a.leadingQuietFrames,10);assert.equal(a.trailingQuietFrames,10);
  assert.equal(a.channels[0]!.peakDbfs,null);assert.equal(a.channels[0]!.rmsDbfs,null);assert.equal(a.channels[0]!.zeroSamples,10);assert.doesNotMatch(JSON.stringify(a),/Infinity|NaN/);
  const dc=analyzeRenderedWave(pcm(1,Array(256).fill(4096)),128);assert.equal(dc.channels[0]!.dc,.125);assert.equal(dc.channels[0]!.peak,.125);assert.equal(dc.channels[0]!.rms,.125);
});
test("analysis is explicit, preserves legacy recipe and WAV bytes and adds only its fixed sibling",()=>{
  const operation=gameAudioRenderOperation.parse({type:"audio.render",output:"assets/tone.wav",durationMs:1000,sampleRate:22050,channels:1,notes:[{waveform:"sine",frequency:440,startMs:100,durationMs:800,gain:.2}]}),old=renderAudio(operation,new Map()),next=renderAudio({...operation,waveformBins:512},new Map());
  assert.equal("waveformBins"in operation,false);assert.deepEqual(old.files.map(f=>f.path),["assets/tone.wav"]);assert.deepEqual(next.files[0]!.data,old.files[0]!.data);for(const [key,value]of Object.entries(old.info))assert.equal(next.info[key],value);
  assert.deepEqual(assetOutputPaths({...operation,waveformBins:512}),["assets/tone.wav","assets/tone.audio.json"]);
  const analysis=gameAudioAnalysis.parse(JSON.parse(Buffer.from(next.files[1]!.data).toString()));assert.equal(analysis.requestedBins,512);assert.ok(analysis.leadingQuietFrames>=2205);assert.equal(analysis.channels[0]!.fullScaleSamples,0);assert.equal(analysis.audioSha256,createHash("sha256").update(next.files[0]!.data).digest("hex"));
  assert.equal(next.info.audioSha256,analysis.audioSha256);assert.equal(next.info.channel1RmsDbfs,analysis.channels[0]!.rmsDbfs);assert.equal(next.info.waveformBins,512);
  assert.equal(audioAnalysisPath(operation.output),next.files[1]!.path);assert.throws(()=>gameAudioRenderOperation.parse({...operation,waveformBins:123}));
  assert.throws(()=>gameAudioRenderOperation.parse({...operation,output:"assets/"+"a".repeat(251)+".wav",waveformBins:128}));
});
test("bounded analysis refuses malformed WAV, unsupported dimensions and forged bin coverage",()=>{
  const wav=pcm(1,Array(256).fill(0));assert.throws(()=>analyzeRenderedWave(wav.subarray(1),128));assert.throws(()=>analyzeRenderedWave(wav,0));assert.throws(()=>analyzeRenderedWave(wav,2048));
  for(const at of [4,16,20,22,24,28,32,34,40]){const forged=Buffer.from(wav);forged[at]=0xff;assert.throws(()=>analyzeRenderedWave(forged,128));}
  const a=analyzeRenderedWave(wav,128),bad=structuredClone(a);bad.channels[0]!.bins[0]!.end=3;assert.equal(gameAudioAnalysis.safeParse(bad).success,false);
  bad.channels[0]!.bins[0]!.end=2;bad.channels[0]!.bins[0]!.min=.5;assert.equal(gameAudioAnalysis.safeParse(bad).success,false);
});
