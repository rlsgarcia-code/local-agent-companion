import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import {structuralAudioMp4} from './game-audio-container-fixtures';
// Control-flow doubles only. Native graph/PCM qualification is separate.
class Param{value=0;calls:unknown[]=[];cancelScheduledValues(t:number){this.calls.push(["cancel",t]);}setValueAtTime(v:number,t:number){this.value=v;this.calls.push(["set",v,t]);}linearRampToValueAtTime(v:number,t:number){this.value=v;this.calls.push(["ramp",v,t]);}}
class Node{gain=new Param();pan=new Param();connect(_node:unknown){}disconnect(){}}
class Source extends Node{
  buffer:any;loop=false;playbackRate={value:1};loopStart=0;loopEnd=0;onended?:()=>void;started=0;offset=0;stops=Infinity;done=false;
  start(t:number,offset:number){this.started=t;this.offset=offset;}stop(t:number){this.stops=t;}
}
class Context extends EventTarget{
  currentTime=0;sampleRate:number;state="suspended";destination=new Node();sources:Source[]=[];decoded=0;closed=0;suspended=0;decodeGate?:Promise<void>;
  constructor(rate=48000){super();this.sampleRate=rate;}
  createGain(){return new Node();}createStereoPanner(){return new Node();}createBufferSource(){const source=new Source();this.sources.push(source);return source;}
  async decodeAudioData(data:ArrayBuffer){this.decoded++;await this.decodeGate;const b=Buffer.from(data),rate=b.readUInt32LE(24),channels=b.readUInt16LE(22),frames=(b.length-44)/(channels*2),length=Math.round(frames*this.sampleRate/rate);return {length,sampleRate:this.sampleRate,numberOfChannels:channels,duration:length/this.sampleRate};}
  async resume(){this.state="running";}async suspend(){this.suspended++;this.state="suspended";}async close(){this.closed++;this.state="closed";}
  advance(seconds:number){this.currentTime+=seconds;for(const s of this.sources)if(!s.done&&(s.stops<=this.currentTime||!s.loop&&s.buffer&&this.currentTime>=s.started+(s.buffer.duration-s.offset)/s.playbackRate.value)){s.done=true;s.onended?.();}}
}
class Offline extends Context{}
class Live extends Context{}
function wav(frames=22050,channels=1){const b=Buffer.alloc(44+frames*channels*2);b.write("RIFF");b.writeUInt32LE(b.length-8,4);b.write("WAVEfmt ",8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(channels,22);b.writeUInt32LE(22050,24);b.writeUInt32LE(22050*channels*2,28);b.writeUInt16LE(channels*2,32);b.writeUInt16LE(16,34);b.write("data",36);b.writeUInt32LE(b.length-44,40);return b;}
async function fixture(){
  const globals=globalThis as any,previous=new Map<string,PropertyDescriptor|undefined>(),windowEvents=new EventTarget(),document=Object.assign(new EventTarget(),{baseURI:"https://game.invalid/private/index.html",hidden:false}),requests:any[]=[];
  const replace=(key:string,value:unknown)=>{previous.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});};
  let handler=(url:URL,options:any)=>Promise.resolve(new Response(wav()));
  replace("AudioContext",Live);replace("OfflineAudioContext",Offline);replace("document",document);replace("addEventListener",windowEvents.addEventListener.bind(windowEvents));replace("removeEventListener",windowEvents.removeEventListener.bind(windowEvents));
  replace("fetch",(url:URL,options:any)=>{requests.push({url:String(url),options});return handler(url,options);});
  const module=await import(path.resolve("packages/adapter-game-web/runtimes/game-audio-1.1.0.mjs"));
  const options={assets:{menu:{path:"assets/menu.wav",bus:"music"},play:{path:"assets/play.wav",bus:"music"},wind:{path:"assets/wind.wav",bus:"ambience"},hit:{path:"assets/hit.wav",bus:"effects",maxInstances:3}},states:{menu:["menu","wind"],play:["play","wind"],quiet:[]}};
  return {module,options,document,requests,setFetch(fn:typeof handler){handler=fn;},close(){for(const [key,value]of previous)if(value)Object.defineProperty(globalThis,key,value);else delete globals[key];}};
}
test("audio states preload once, preserve common ambience, crossfade and enforce effect limits",async()=>{
  const f=await fixture();const context=new Offline();let audio:any;try{
    audio=f.module.createGameAudio({...f.options,context});await audio.setState("menu");assert.equal(audio.snapshot().phase,"locked");assert.equal(audio.snapshot().voices.length,0);await audio.unlock();
    const common=audio.snapshot().voices.find((v:any)=>v.assetId==="wind").id;context.advance(.1);
    await audio.setState("play",{fadeMs:200});assert.equal(audio.snapshot().voices.find((v:any)=>v.assetId==="wind").id,common);assert.ok(audio.snapshot().voices.some((v:any)=>v.assetId==="menu"&&v.retiring));
    context.advance(.25);assert.equal(audio.snapshot().voices.some((v:any)=>v.assetId==="menu"),false);
    const effects=await Promise.all(Array.from({length:8},()=>audio.playEffect("hit")));assert.equal(effects.filter(e=>e.played).length,3);assert.equal(f.requests.filter(r=>r.url.endsWith("hit.wav")).length,1);
    assert.equal(audio.stopEffect(common),false);assert.equal(audio.stopEffect(effects[0].voiceId),true);
    audio.setMuted(true);audio.setVolume("master",.2);assert.equal(audio.snapshot().muted,true);audio.setMuted(false);assert.equal(audio.snapshot().volumes.master,.2);
    await audio.pause();assert.equal(audio.snapshot().voices.length,0);assert.equal((await audio.playEffect("hit")).played,false);await audio.resume();assert.equal(audio.snapshot().state,"play");
    for(const request of f.requests){assert.ok(request.url.startsWith("https://game.invalid/private/assets/"));assert.equal(request.options.credentials,"same-origin");assert.equal(request.options.redirect,"error");}
  }finally{await audio?.close();f.close();}
});
test("slow older state cannot replace a newer state or start sound after close",async()=>{
  const f=await fixture();const context=new Offline();let audio:any,release:()=>void=()=>{};try{
    f.setFetch(async(url)=>{if(url.pathname.endsWith("menu.wav"))await new Promise<void>(r=>{release=r;});return new Response(wav());});audio=f.module.createGameAudio({...f.options,context});
    const older=audio.setState("menu");await audio.setState("play");release();assert.deepEqual(await older,{applied:false,reason:"superseded"});assert.equal(audio.snapshot().state,"play");
    let decoded:()=>void=()=>{};context.decodeGate=new Promise<void>(r=>{decoded=r;});const pending=audio.preload(["hit"]);while(context.decoded<4)await new Promise(r=>setTimeout(r,1));await audio.close();decoded();await assert.rejects(pending,/closed/);
    assert.equal(audio.snapshot().voices.length,0);assert.equal(audio.snapshot().decodedCached,0);assert.equal(audio.snapshot().decodedReserved,0);assert.equal(audio.snapshot().encodedReserved,0);assert.equal(context.closed,0,"a supplied context remains owned by its caller");
  }finally{await audio?.close();f.close();}
});
test("decoded budget is reserved before native decode and failures never create negative accounting",async()=>{
  const f=await fixture();const context=new Offline(192000);let audio:any;try{
    f.setFetch(async()=>new Response(wav(2000000,2)));audio=f.module.createGameAudio({...f.options,context});await assert.rejects(audio.preload(["menu"]),/Decoded audio budget/);
    assert.equal(context.decoded,0);assert.equal(audio.snapshot().decodedReserved,0);assert.equal(audio.snapshot().encodedReserved,0);
    f.setFetch(async()=>new Response(wav()));await audio.preload(["menu"]);assert.equal(context.decoded,1);assert.equal(audio.snapshot().loaded.length,1);
  }finally{await audio?.close();f.close();}
});
test("live playback refuses synthetic gestures; hiding pauses and never resumes automatically",async()=>{
  const f=await fixture();let audio:any,owned:any;try{
    const context=new Live();audio=f.module.createGameAudio({...f.options,context});await assert.rejects(audio.unlock(new Event("click")),/fresh user gesture/);await assert.rejects(audio.unlock({isTrusted:true,type:"click"}),/fresh user gesture/);
    await audio.pause();assert.equal(context.suspended,0);owned=f.module.createGameAudio(f.options);await owned.close();assert.equal(owned.snapshot().phase,"closed");
    await audio.close();const offline=new Offline();audio=f.module.createGameAudio({...f.options,context:offline});await audio.setState("menu");await audio.unlock();f.document.hidden=true;f.document.dispatchEvent(new Event("visibilitychange"));assert.equal(audio.snapshot().phase,"paused");
    f.document.hidden=false;f.document.dispatchEvent(new Event("visibilitychange"));assert.equal(audio.snapshot().phase,"paused");assert.equal(audio.snapshot().voices.length,0);
  }finally{await owned?.close();await audio?.close();f.close();}
});
test("configuration refuses traversal, external resources, invalid states and inherited bus names",async()=>{
  const f=await fixture();let audio:any;try{
    for(const value of ["https://outside.invalid/audio.wav","../secret.wav","assets/../secret.wav","assets/x.mp3","/assets/x.wav","assets/x\\y.wav"])assert.throws(()=>f.module.createGameAudio({...f.options,assets:{hit:{path:value,bus:"effects"}}}));
    const ambience=Object.fromEntries(Array.from({length:6},(_,i)=>['wind'+i,{path:'assets/wind.wav',bus:'ambience'}]));assert.throws(()=>f.module.createGameAudio({assets:ambience,states:{bad:Object.keys(ambience)}}));
    assert.throws(()=>f.module.createGameAudio({...f.options,states:{bad:["menu","play"]}}));assert.throws(()=>f.module.createGameAudio({...f.options,maxVoices:2}));
    audio=f.module.createGameAudio({...f.options,context:new Offline()});assert.throws(()=>audio.setVolume("constructor",.2),/Unknown audio bus/);assert.throws(()=>audio.setVolume("master",2));await assert.rejects(audio.setState("missing"));
  }finally{await audio?.close();f.close();}
});
test('AAC dimensions reserve the resampled PCM budget before native decode; failure preserves other state and accounting',async()=>{
 const f=await fixture();let audio:any;try{
  const context=new Offline(192000),options={...f.options,assets:{menu:{path:'assets/delivery.m4a',bus:'music'}}};f.setFetch(async()=>new Response(structuralAudioMp4({channels:2,frames:48000*60})));
  audio=f.module.createGameAudio({...options,states:{menu:['menu']},context});await assert.rejects(audio.preload(['menu']),/Decoded audio budget/);assert.equal(context.decoded,0);assert.equal(audio.snapshot().decodedReserved,0);assert.equal(audio.snapshot().encodedReserved,0);assert.equal(audio.snapshot().state,null);
  f.setFetch(async()=>new Response(wav()));await assert.rejects(audio.preload(['menu']),/extension differs/);assert.equal(context.decoded,0);assert.equal(audio.snapshot().loaded.length,0);
  const forged=structuralAudioMp4();forged.writeUInt32BE(0,forged.indexOf('url ')+4);f.setFetch(async()=>new Response(forged));await assert.rejects(audio.preload(['menu']),/pinned AAC-LC/);assert.equal(context.decoded,0);assert.equal(audio.snapshot().decodedReserved,0);
 }finally{await audio?.close();f.close();}
});
