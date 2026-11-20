import {z} from "zod";
const frames=z.number().int().nonnegative().max(180*48000),sample=z.number().finite().min(-1).max(1),level=z.number().finite().min(0).max(1);
export const gameAudioWaveformBins=z.union([z.literal(128),z.literal(256),z.literal(512),z.literal(1024)]);
export const gameAudioAnalysis=z.object({
  schemaVersion:z.literal(1),format:z.literal("PCM16 WAV"),audioSha256:z.string().regex(/^[a-f0-9]{64}$/),
  sampleRate:z.union([z.literal(22050),z.literal(44100),z.literal(48000)]),channelCount:z.union([z.literal(1),z.literal(2)]),
  frames:frames.refine(n=>n>0),durationMs:z.number().positive().max(180000),requestedBins:gameAudioWaveformBins,binCount:z.number().int().min(1).max(1024),
  quietThresholdDbfs:z.literal(-60),quietFrames:frames,leadingQuietFrames:frames,trailingQuietFrames:frames,
  channels:z.array(z.object({index:z.number().int().min(0).max(1),peak:level,rms:level,dc:sample,peakDbfs:z.number().finite().max(0).nullable(),rmsDbfs:z.number().finite().max(0).nullable(),fullScaleSamples:frames,zeroSamples:frames,
    bins:z.array(z.object({start:frames,end:frames,min:sample,max:sample,rms:level}).strict()).min(1).max(1024),
  }).strict()).min(1).max(2),
}).strict().superRefine((value,context)=>{
  if(value.binCount!==Math.min(value.frames,value.requestedBins)||value.channels.length!==value.channelCount||Math.abs(value.durationMs-value.frames*1000/value.sampleRate)>1e-8||[value.quietFrames,value.leadingQuietFrames,value.trailingQuietFrames].some(n=>n>value.frames))context.addIssue({code:"custom",message:"Incoherent audio analysis dimensions."});
  for(const [index,channel]of value.channels.entries()){
    if(channel.index!==index||channel.bins.length!==value.binCount||channel.rms>channel.peak+1e-12||channel.fullScaleSamples>value.frames||channel.zeroSamples>value.frames)context.addIssue({code:"custom",message:"Incoherent channel measurements."});
    for(const [binIndex,bin]of channel.bins.entries())if(bin.start!==Math.floor(binIndex*value.frames/value.binCount)||bin.end!==Math.floor((binIndex+1)*value.frames/value.binCount)||bin.min>bin.max||bin.rms>Math.max(Math.abs(bin.min),Math.abs(bin.max))+1e-12)context.addIssue({code:"custom",message:"Waveform bins must cover the exact samples once."});
  }
});
export type GameAudioAnalysis=z.infer<typeof gameAudioAnalysis>;
export const audioAnalysisPath=(wavPath:string)=>wavPath.slice(0,-4)+".audio.json";
