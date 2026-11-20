import {analyzeRenderedWave} from "./audio-analysis";
import {audioAnalysisPath} from "../../contracts/src/game-audio-analysis";
import type { GameAssetOperation } from "../../contracts/src/game-assets";
import type { ProcessedGameAsset } from "../../game-production/src/index";

/** RIFF/WAVE decoder with explicit formats and boundaries. No codec subprocess. */
export function decodeWave(data: Buffer): { rate: number; channels: number; frames: number; samples: Float32Array } {
  if(data.length<44 || data.length>64*1024*1024 || data.subarray(0,4).toString()!=="RIFF" || data.subarray(8,12).toString()!=="WAVE" || data.readUInt32LE(4)+8!==data.length) throw new Error("A bounded complete RIFF/WAVE source is required.");
  let format:Buffer|undefined,pcm:Buffer|undefined;
  let offset=12;
  for(;offset+8<=data.length;) {
    const name=data.subarray(offset,offset+4).toString(),size=data.readUInt32LE(offset+4);offset+=8;
    if(offset+size>data.length)throw new Error("Truncated WAV chunk.");
    if(name==="fmt "){if(format)throw new Error("Duplicate WAV format.");format=data.subarray(offset,offset+size);}
    if(name==="data"){if(pcm)throw new Error("Duplicate WAV sample data.");pcm=data.subarray(offset,offset+size);}
    offset+=size+(size%2);
    if(offset>data.length)throw new Error("Missing WAV chunk padding.");
  }
  if(offset!==data.length)throw new Error("Incomplete WAV trailing chunk.");
  if(!format || format.length<16 || !pcm)throw new Error("WAV format/sample data is missing.");
  let tag=format.readUInt16LE(0);const channels=format.readUInt16LE(2),rate=format.readUInt32LE(4),align=format.readUInt16LE(12),bits=format.readUInt16LE(14);
  if(tag===0xfffe) {
    if(format.length<40 || format.readUInt16LE(16)<22 || format.readUInt16LE(18)!==bits || !format.subarray(28,40).equals(Buffer.from("00001000800000aa00389b71","hex"))) throw new Error("Unsupported extensible WAV format.");
    tag=format.readUInt32LE(24);
  }
  if(![1,2].includes(channels) || rate<8000 || rate>192000 || !((tag===1 && [8,16,24,32].includes(bits)) || (tag===3 && bits===32)) ||
      align!==channels*bits/8 || format.readUInt32LE(8)!==rate*align || pcm.length%align)throw new Error("Use mono/stereo PCM 8/16/24/32-bit or float32 WAV with coherent format fields.");
  const frames=pcm.length/align;
  if(!frames || frames/rate>180 || frames*channels>180*48000*2)throw new Error("Source WAV sample budget exceeded.");
  const samples=new Float32Array(frames*channels),step=bits/8;
  for(let index=0;index<samples.length;index++) {
    const offset=index*step;
    const value=tag===3?pcm.readFloatLE(offset):bits===8?(pcm[offset]!-128)/128:bits===16?pcm.readInt16LE(offset)/32768:bits===24?pcm.readIntLE(offset,3)/8388608:pcm.readInt32LE(offset)/2147483648;
    if(!Number.isFinite(value))throw new Error("Non-finite WAV samples cannot be silently repaired.");samples[index]=value;
  }
  return {rate,channels,frames,samples};
}
export function renderAudio(operation:Extract<GameAssetOperation,{type:"audio.render"}>,files:Map<string,Buffer>):ProcessedGameAsset {
  const frames=Math.round(operation.durationMs*operation.sampleRate/1000),channels=operation.channels,mix=new Float32Array(frames*channels);
  const cache=new Map<string,ReturnType<typeof decodeWave>>();let sourceSamples=0;
  const add=(frame:number,left:number,right:number)=>{if(channels===1)mix[frame]!+=(left+right)/2;else{mix[frame*2]!+=left;mix[frame*2+1]!+=right;}};
  for(const clip of operation.clips) {
    let source=cache.get(clip.source.path);
    if(!source){const data=files.get(clip.source.path);if(!data)throw new Error("Source audio is missing.");source=decodeWave(data);sourceSamples+=source.samples.length;
      if(sourceSamples>24*1024*1024)throw new Error("Audio source working-set budget exceeded.");cache.set(clip.source.path,source);}
    const start=Math.round(clip.startMs*operation.sampleRate/1000),length=Math.round((clip.startMs+clip.durationMs)*operation.sampleRate/1000)-start,offset=clip.offsetMs*source.rate/1000;
    if(offset+clip.durationMs*source.rate/1000>source.frames+0.001)throw new Error("A requested audio clip exceeds its source; original data was preserved.");
    const gains=source.channels===1?[Math.cos((clip.pan+1)*Math.PI/4),Math.sin((clip.pan+1)*Math.PI/4)]:[clip.pan>0?Math.cos(clip.pan*Math.PI/2):1,clip.pan<0?Math.cos(-clip.pan*Math.PI/2):1];
    const sample=resampler(source,operation.sampleRate);
    for(let index=0;index<length;index++) {
      const at=offset+index*source.rate/operation.sampleRate;
      const ms=index*1000/operation.sampleRate,envelope=Math.min(1,clip.fadeInMs?ms/clip.fadeInMs:1,clip.fadeOutMs?(clip.durationMs-ms)/clip.fadeOutMs:1)*clip.gain;
      add(start+index,sample(at,0)*gains[0]!*envelope,sample(at,source.channels===1?0:1)*gains[1]!*envelope);
    }
  }
  for(const note of operation.notes) {
    if(Math.max(note.frequency,note.endFrequency??note.frequency)>=operation.sampleRate*0.45)throw new Error("Procedural note frequency must stay below the selected sample rate's anti-aliasing limit.");
    const start=Math.round(note.startMs*operation.sampleRate/1000),length=Math.round((note.startMs+note.durationMs)*operation.sampleRate/1000)-start,left=Math.cos((note.pan+1)*Math.PI/4),right=Math.sin((note.pan+1)*Math.PI/4);
    let phase=0,random=note.seed||0x9e3779b9,triangle=0;
    for(let index=0;index<length;index++) {
      const hz=note.frequency+((note.endFrequency??note.frequency)-note.frequency)*index/length,step=hz/operation.sampleRate;
      const square=(phase<0.5?1:-1)+blep(phase,step)-blep((phase+0.5)%1,step);
      triangle=(triangle+square*step*4)*(1-step);
      random^=random<<13;random^=random>>>17;random^=random<<5;
      const wave=note.waveform==="sine"?Math.sin(phase*Math.PI*2):note.waveform==="saw"?2*phase-1-blep(phase,step):note.waveform==="square"?square:note.waveform==="triangle"?triangle:(random>>>0)/0xffffffff*2-1;
      const ms=index*1000/operation.sampleRate,envelope=Math.min(1,note.attackMs?ms/note.attackMs:1,note.releaseMs?(note.durationMs-ms)/note.releaseMs:1);
      const value=wave*note.gain*envelope;add(start+index,value*left,value*right);phase=(phase+step)%1;
    }
  }
  let peak=0;for(const value of mix)peak=Math.max(peak,Math.abs(value));
  const gain=operation.normalizePeak===undefined || peak===0?1:operation.normalizePeak/peak;
  const data=Buffer.alloc(44+mix.length*2);data.write("RIFF",0);data.writeUInt32LE(data.length-8,4);data.write("WAVEfmt ",8);data.writeUInt32LE(16,16);data.writeUInt16LE(1,20);data.writeUInt16LE(channels,22);
  data.writeUInt32LE(operation.sampleRate,24);data.writeUInt32LE(operation.sampleRate*channels*2,28);data.writeUInt16LE(channels*2,32);data.writeUInt16LE(16,34);data.write("data",36);data.writeUInt32LE(mix.length*2,40);
  let clipped=0;
  for(let index=0;index<mix.length;index++){const value=mix[index]!*gain;if(Math.abs(value)>1)clipped++;const bounded=Math.max(-1,Math.min(1,value));data.writeInt16LE(Math.round(bounded*(bounded<0?32768:32767)),44+index*2);}
  const producedFiles=[{path:operation.output,mime:"audio/wav",data}];
  const analysisInfo:Record<string,string|number>={};
  if(operation.waveformBins!==undefined){
    const analysis=analyzeRenderedWave(data,operation.waveformBins);
    producedFiles.push({path:audioAnalysisPath(operation.output),mime:"application/json",data:Buffer.from(JSON.stringify(analysis))});
    Object.assign(analysisInfo,{audioSha256:analysis.audioSha256,waveformBins:analysis.binCount,quietThresholdDbfs:-60,quietMs:analysis.quietFrames*1000/analysis.sampleRate,leadingQuietMs:analysis.leadingQuietFrames*1000/analysis.sampleRate,trailingQuietMs:analysis.trailingQuietFrames*1000/analysis.sampleRate});
    for(const channel of analysis.channels){const label=`channel${channel.index+1}`;Object.assign(analysisInfo,{[`${label}PeakDbfs`]:channel.peakDbfs??"digital silence",[`${label}RmsDbfs`]:channel.rmsDbfs??"digital silence",[`${label}Dc`]:channel.dc,[`${label}FullScaleSamples`]:channel.fullScaleSamples});}
  }
  return { files:producedFiles,info:{sampleRate:operation.sampleRate,channels,frames,durationMs:frames*1000/operation.sampleRate,requestedDurationMs:operation.durationMs,peakBefore:peak,peakAfter:Math.min(1,peak*gain),gainApplied:gain,clippedSamples:clipped,format:"PCM16 WAV",proceduralNotes:operation.notes.length,sourceClips:operation.clips.length,...analysisInfo} };
}
function blep(phase:number,step:number):number {if(phase<step){const t=phase/step;return t+t-t*t-1;}if(phase>1-step){const t=(phase-1)/step;return t*t+t+t+1;}return 0;}

/** Phase-indexed Blackman-windowed sinc. Downsampling filters above the new
 * Nyquist limit instead of folding high-frequency content into audible aliases. */
function resampler(source:ReturnType<typeof decodeWave>,rate:number):(at:number,channel:number)=>number {
  if(source.rate===rate)return(at,channel)=>source.samples[Math.min(source.frames-1,Math.round(at))*source.channels+channel]!;
  const cutoff=Math.min(1,rate/source.rate)*0.94,radius=Math.ceil(16/cutoff),taps=radius*2,phases=256;
  const kernels=Array.from({length:phases},(_value,phase)=>{
    const weights=new Float64Array(taps);let sum=0;
    for(let i=0;i<taps;i++){
      const x=i-radius+1-phase/phases,t=x/radius;
      const window=Math.abs(t)>=1?0:0.42+0.5*Math.cos(Math.PI*t)+0.08*Math.cos(2*Math.PI*t);
      const weight=(x===0?cutoff:Math.sin(Math.PI*cutoff*x)/(Math.PI*x))*window;weights[i]=weight;sum+=weight;
    }
    for(let i=0;i<taps;i++)weights[i]!/=sum;return weights;
  });
  return(at,channel)=>{
    const base=Math.floor(at),weights=kernels[Math.min(phases-1,Math.floor((at-base)*phases))]!;let value=0;
    for(let i=0;i<taps;i++)value+=source.samples[Math.max(0,Math.min(source.frames-1,base+i-radius+1))*source.channels+channel]!*weights[i]!;
    return value;
  };
}
