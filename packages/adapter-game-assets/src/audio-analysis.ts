import {createHash} from "node:crypto";
import {gameAudioAnalysis,gameAudioWaveformBins,type GameAudioAnalysis} from "../../contracts/src/game-audio-analysis";

/** Analyze only the canonical PCM16 bytes emitted by our renderer, not its float
 * mix. Measurements are digital samples, not perceptual loudness or acceptance. */
export function analyzeRenderedWave(data:Buffer,requestedBins:number):GameAudioAnalysis{
  gameAudioWaveformBins.parse(requestedBins);
  if(data.length<46||data.length>44+180*48000*2*2||data.subarray(0,4).toString()!=="RIFF"||data.readUInt32LE(4)!==data.length-8||data.subarray(8,16).toString()!=="WAVEfmt "||data.readUInt32LE(16)!==16||data.readUInt16LE(20)!==1||data.readUInt16LE(34)!==16||data.subarray(36,40).toString()!=="data"||data.readUInt32LE(40)!==data.length-44)throw Error("Audio analysis requires complete canonical PCM16 WAV bytes.");
  const channelCount=data.readUInt16LE(22),sampleRate=data.readUInt32LE(24),align=channelCount*2;
  if(![1,2].includes(channelCount)||![22050,44100,48000].includes(sampleRate)||data.readUInt16LE(32)!==align||data.readUInt32LE(28)!==sampleRate*align||(data.length-44)%align)throw Error("Incoherent rendered WAV format.");
  const frames=(data.length-44)/align,binCount=Math.min(requestedBins,frames);
  if(frames/sampleRate>180)throw Error("Audio analysis duration exceeds its sample budget.");
  const channels=Array.from({length:channelCount},(_,index)=>({index,peak:0,rms:0,dc:0,peakDbfs:null as number|null,rmsDbfs:null as number|null,fullScaleSamples:0,zeroSamples:0,bins:[] as GameAudioAnalysis["channels"][number]["bins"]}));
  const sums=channels.map(()=>({square:0,value:0}));let quietFrames=0,leadingQuietFrames=0,trailingQuietFrames=0,seenLoud=false;
  for(let bin=0;bin<binCount;bin++){
    const start=Math.floor(bin*frames/binCount),end=Math.floor((bin+1)*frames/binCount),local=channels.map(()=>({min:1,max:-1,square:0}));
    for(let frame=start;frame<end;frame++){
      let quiet=true;
      for(const channel of channels){const raw=data.readInt16LE(44+(frame*channelCount+channel.index)*2),value=raw/32768,abs=Math.abs(value),sum=sums[channel.index]!,part=local[channel.index]!;
        channel.peak=Math.max(channel.peak,abs);sum.square+=value*value;sum.value+=value;
        if(raw===32767||raw===-32768)channel.fullScaleSamples++;if(raw===0)channel.zeroSamples++;
        part.min=Math.min(part.min,value);part.max=Math.max(part.max,value);part.square+=value*value;if(abs>=.001)quiet=false;
      }
      if(quiet){quietFrames++;trailingQuietFrames++;if(!seenLoud)leadingQuietFrames++;}else{seenLoud=true;trailingQuietFrames=0;}
    }
    for(const channel of channels){const part=local[channel.index]!;channel.bins.push({start,end,min:part.min,max:part.max,rms:Math.sqrt(part.square/(end-start))});}
  }
  for(const channel of channels){const sum=sums[channel.index]!;channel.rms=Math.sqrt(sum.square/frames);channel.dc=sum.value/frames;channel.peakDbfs=channel.peak?20*Math.log10(channel.peak):null;channel.rmsDbfs=channel.rms?20*Math.log10(channel.rms):null;}
  return gameAudioAnalysis.parse({schemaVersion:1,format:"PCM16 WAV",audioSha256:createHash("sha256").update(data).digest("hex"),sampleRate,channelCount,frames,durationMs:frames*1000/sampleRate,requestedBins,binCount,quietThresholdDbfs:-60,quietFrames,leadingQuietFrames,trailingQuietFrames,channels});
}
