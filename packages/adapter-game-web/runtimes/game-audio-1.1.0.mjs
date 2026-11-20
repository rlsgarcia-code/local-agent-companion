/*! Companion game audio runtime 1.1.0 | MIT | engine/GAME-AUDIO-LICENSE.txt */
export const audioRuntimeVersion = "1.1.0";
const MiB=1024*1024;
const number=(value,min,max,label)=>{if(!Number.isFinite(value)||value<min||value>max)throw Error(`Invalid ${label}`);return value;};
const id=value=>{if(typeof value!=="string"||!/^[a-z][a-z0-9_-]{0,63}$/.test(value))throw Error("Invalid audio identity");return value;};
const plain=value=>value&&typeof value==="object"&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
const keys=(value,names)=>{if(!plain(value)||Object.keys(value).some(key=>!names.includes(key)))throw Error("Unknown audio configuration field");};

/** Bounded container inspection, not a second codec. Only canonical WAV and
 * the nonfragmented AAC-LC profile emitted by the pinned game codec enter native
 * decoding. Do not generalize this into an arbitrary MP4/media-file loader. */
export function inspectPackagedAudio(input){
  if(!(input instanceof Uint8Array)||input.byteLength<46||input.byteLength>16*MiB)throw Error("Packaged audio exceeds its byte bounds");
  const bytes=input,view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),size=bytes.length;
  const text=(at,n)=>String.fromCharCode(...bytes.subarray(at,at+n));
  if(text(0,4)==="RIFF"){
    if(view.getUint32(4,true)!==size-8||text(8,8)!=="WAVEfmt "||view.getUint32(16,true)!==16||view.getUint16(20,true)!==1||view.getUint16(34,true)!==16||text(36,4)!=="data"||view.getUint32(40,true)!==size-44)throw Error("Convert audio to canonical PCM16 WAV before packaging");
    const channels=view.getUint16(22,true),rate=view.getUint32(24,true),align=channels*2,frames=(size-44)/align;
    if(![1,2].includes(channels)||![22050,44100,48000].includes(rate)||view.getUint16(32,true)!==align||view.getUint32(28,true)!==rate*align||!Number.isInteger(frames)||frames<1||frames/rate>180)throw Error("Invalid packaged WAV dimensions");
    return {format:"pcm16",channels,rate,minFrames:frames,maxFrames:frames};
  }
  if(size>8*MiB)throw Error("AAC container exceeds 8 MiB");let boxCount=0;
  const fail=()=>{throw Error("Use the pinned AAC-LC MP4 delivery profile before packaging");};
  const list=(start,end,allowed)=>{
    const boxes=[];let at=start;
    while(at<end){if(at+8>end||++boxCount>64)fail();const length=view.getUint32(at),type=text(at+4,4);if(length<8||at+length>end||!allowed.includes(type))fail();boxes.push({type,start:at,p:at+8,end:at+length,size:length});at+=length;}
    if(at!==end)fail();return boxes;
  };
  const one=(boxes,type,optional=false)=>{const found=boxes.filter(box=>box.type===type);if(found.length!==1){if(optional&&found.length===0)return undefined;fail();}return found[0];};
  const full=(box,length)=>{if(box.size!==length||view.getUint32(box.p)!==0)fail();};
  const top=list(0,size,["ftyp","moov","free","mdat"]),ftyp=one(top,"ftyp"),moov=one(top,"moov"),mdat=one(top,"mdat");
  if(top[0]!==ftyp||ftyp.size<20||ftyp.size>64||(ftyp.size-16)%4||!["isom","mp41","mp42","M4A "].includes(text(ftyp.p,4))||moov.start>mdat.start||moov.size>MiB)fail();
  const movie=list(moov.p,moov.end,["mvhd","trak","udta"]),mvhd=one(movie,"mvhd");full(mvhd,108);
  const movieRate=view.getUint32(mvhd.p+12),movieDuration=view.getUint32(mvhd.p+16);if(![1000,22050,44100,48000].includes(movieRate)||movieDuration<1||movieDuration>180*movieRate)fail();
  const track=one(movie,"trak"),trackBoxes=list(track.p,track.end,["tkhd","edts","mdia"]),tkhd=one(trackBoxes,"tkhd");
  if(tkhd.size!==92||bytes[tkhd.p]!==0||view.getUint32(tkhd.p+20)!==movieDuration||view.getUint32(tkhd.end-8)!==0||view.getUint32(tkhd.end-4)!==0)fail();
  const media=one(trackBoxes,"mdia"),mediaBoxes=list(media.p,media.end,["mdhd","hdlr","minf"]),mdhd=one(mediaBoxes,"mdhd"),handler=one(mediaBoxes,"hdlr");full(mdhd,32);
  const rate=view.getUint32(mdhd.p+12),duration=view.getUint32(mdhd.p+16);if(![22050,44100,48000].includes(rate)||![1000,rate].includes(movieRate)||duration<1||duration>180*rate+2048||handler.size<32||view.getUint32(handler.p)!==0||text(handler.p+8,4)!=="soun")fail();
  const edit=one(trackBoxes,"edts",true);let priming=0;if(edit){const elst=one(list(edit.p,edit.end,["elst"]),"elst");full(elst,28);priming=view.getInt32(elst.p+12);if(view.getUint32(elst.p+4)!==1||view.getUint32(elst.p+8)!==movieDuration||priming<0||priming>2048||view.getUint32(elst.p+16)!==65536)fail();}
  const minf=one(mediaBoxes,"minf"),info=list(minf.p,minf.end,["smhd","dinf","stbl"]);full(one(info,"smhd"),16);
  const dinf=one(info,"dinf"),dref=one(list(dinf.p,dinf.end,["dref"]),"dref");full(dref,28);if(view.getUint32(dref.p+4)!==1)fail();const reference=one(list(dref.p+8,dref.end,["url "]),"url ");if(reference.size!==12||view.getUint32(reference.p)!==1)fail();
  const stbl=one(info,"stbl"),table=list(stbl.p,stbl.end,["stsd","stts","stsc","stsz","stco","sgpd","sbgp"]),stsd=one(table,"stsd");
  if(stsd.size<52||view.getUint32(stsd.p)!==0||view.getUint32(stsd.p+4)!==1)fail();const entry=one(list(stsd.p+8,stsd.end,["mp4a"]),"mp4a");
  if(entry.size<44||view.getUint16(entry.p+6)!==1||view.getUint32(entry.p+8)!==0||view.getUint32(entry.p+12)!==0||![1,2].includes(view.getUint16(entry.p+16))||view.getUint16(entry.p+18)!==16||view.getUint32(entry.p+20)!==0||view.getUint32(entry.p+24)!==rate*65536)fail();
  const descriptions=list(entry.p+28,entry.end,["esds","btrt"]),esds=one(descriptions,"esds");one(descriptions,"btrt",true);if(esds.size<20||esds.size>128||view.getUint32(esds.p)!==0)fail();
  const descriptor=(at,end,tag)=>{
    if(at>=end||bytes[at++]!==tag)fail();let length=0,complete=false;
    for(let i=0;i<4;i++){if(at>=end)fail();const byte=bytes[at++];length=length*128+(byte&127);if(!(byte&128)){complete=true;break;}}
    if(!complete||at+length>end)fail();return {p:at,end:at+length,length};
  };
  const es=descriptor(esds.p+4,esds.end,3);if(es.end!==esds.end||es.length<3||view.getUint16(es.p)!==1||bytes[es.p+2]!==0)fail();
  const decoder=descriptor(es.p+3,es.end,4);if(decoder.length<13||bytes[decoder.p]!==64||bytes[decoder.p+1]!==21)fail();
  const config=descriptor(decoder.p+13,decoder.end,5);if(config.end!==decoder.end||config.length!==5)fail();
  const code=view.getUint16(config.p),channels=(code>>3)&15,rateIndex=(code>>7)&15,expectedRate=[96000,88200,64000,48000,44100,32000,24000,22050][rateIndex];
  if((code>>11)!==2||expectedRate!==rate||![1,2].includes(channels)||(code&7)!==0||bytes[config.p+2]!==0x56||bytes[config.p+3]!==0xe5||bytes[config.p+4]!==0)fail();
  const sync=descriptor(decoder.end,es.end,6);if(sync.end!==es.end||sync.length!==1||bytes[sync.p]!==2)fail();
  const stts=one(table,"stts");if(stts.size<24||view.getUint32(stts.p)!==0)fail();const entries=view.getUint32(stts.p+4);if(entries<1||entries>2||stts.size!==16+entries*8)fail();let samples=0,frames=0;
  for(let i=0;i<entries;i++){const at=stts.p+8+i*8,count=view.getUint32(at),delta=view.getUint32(at+4);if(count<1||delta<1||delta>1024||i<entries-1&&delta!==1024)fail();samples+=count;frames+=count*delta;}
  const maxFrames=samples*1024;if(frames!==duration||maxFrames>180*rate+2048||frames<maxFrames-1023)fail();
  // A forged long movie/edit timeline must not expand a short track after our
  // pre-decode reservation. Accept only the1 kHz movie clock or the audio rate
  // selected by the pinned FFmpeg9 muxer, with that clock's bounded rounding.
  const presentedFrames=movieDuration*rate/movieRate;if(Math.abs(presentedFrames+priming-frames)>Math.ceil(rate/movieRate)+1)fail();
  const stsc=one(table,"stsc");full(stsc,28);if(view.getUint32(stsc.p+4)!==1||view.getUint32(stsc.p+8)!==1||view.getUint32(stsc.p+12)!==samples||view.getUint32(stsc.p+16)!==1)fail();
  const stco=one(table,"stco");full(stco,20);if(view.getUint32(stco.p+4)!==1||view.getUint32(stco.p+8)!==mdat.p)fail();
  const stsz=one(table,"stsz");if(stsz.size!==20+samples*4||view.getUint32(stsz.p)!==0||view.getUint32(stsz.p+4)!==0||view.getUint32(stsz.p+8)!==samples)fail();let payload=0;
  for(let i=0;i<samples;i++){const n=view.getUint32(stsz.p+12+i*4);if(n<1||n>8192)fail();payload+=n;}if(payload!==mdat.end-mdat.p)fail();
  const group=one(table,"sgpd",true),mapping=one(table,"sbgp",true);if(Boolean(group)!==Boolean(mapping))fail();if(group){if(group.size!==26||view.getUint32(group.p)!==0x1000000||text(group.p+4,4)!=="roll"||view.getUint32(group.p+8)!==2||view.getUint32(group.p+12)!==1||view.getInt16(group.p+16)!==-1)fail();full(mapping,28);if(text(mapping.p+4,4)!=="roll"||view.getUint32(mapping.p+8)!==1||view.getUint32(mapping.p+12)!==samples||view.getUint32(mapping.p+16)!==1)fail();}
  return {format:"aac-lc",channels,rate,minFrames:Math.max(1,frames-4096),maxFrames:Math.max(maxFrames,Math.ceil(presentedFrames))};
}

/** Local game playback only. No microphone, provider, worker, host bridge or
 * intelligence. An injected OfflineAudioContext is useful for inaudible QA;
 * live playback always requires a fresh trusted user gesture. */
export function createGameAudio(options){
  keys(options,["assets","states","context","maxVoices"]);if(!plain(options.assets)||!plain(options.states))throw Error("Audio assets and states are required");
  const definitions=new Map(),states=new Map();
  if(Object.keys(options.assets).length>64||Object.keys(options.states).length>64)throw Error("Audio catalog exceeds its limits");
  for(const [name,value]of Object.entries(options.assets)){
    id(name);keys(value,["path","bus","gain","pan","loopStart","loopEnd","maxInstances"]);
    if(typeof value.path!=="string"||value.path.length>512||!value.path.startsWith("assets/")||!/^.*\.(?:wav|m4a)$/.test(value.path)||value.path.split("/").some(part=>!part||part==="."||part===".."||/[\\\x00-\x1f\x7f]/.test(part)))throw Error("Audio must use packaged relative assets/*.wav or *.m4a paths");
    if(!["music","ambience","effects"].includes(value.bus))throw Error("Invalid audio bus");
    if(value.bus==="effects"&&(value.loopStart!==undefined||value.loopEnd!==undefined))throw Error("Effects cannot declare loop ranges");
    const loopStart=number(value.loopStart??0,0,180,"loop start"),loopEnd=value.loopEnd===undefined?undefined:number(value.loopEnd,0,180,"loop end");
    if(loopEnd!==undefined&&loopEnd<=loopStart)throw Error("Loop end must follow its start");
    const maxInstances=number(value.maxInstances??4,1,16,"effect instances");if(!Number.isInteger(maxInstances))throw Error("Effect instance limit must be integral");
    definitions.set(name,{path:value.path,bus:value.bus,gain:number(value.gain??.7,0,1,"asset gain"),pan:number(value.pan??0,-1,1,"pan"),loopStart,loopEnd,maxInstances});
  }
  for(const [name,tracks]of Object.entries(options.states)){
    id(name);if(!Array.isArray(tracks)||tracks.length>6||new Set(tracks).size!==tracks.length||tracks.some(track=>!definitions.has(track)||definitions.get(track).bus==="effects")||tracks.filter(track=>definitions.get(track).bus==="music").length>1||tracks.filter(track=>definitions.get(track).bus==="ambience").length>5)throw Error("A state may contain one music track and up to five ambience tracks");
    states.set(name,[...tracks]);
  }
  const maxVoices=number(options.maxVoices??24,12,32,"voice limit");if(!Number.isInteger(maxVoices))throw Error("Voice limit must be integral");
  const ownedContext=!options.context,Context=globalThis.AudioContext;
  if(ownedContext&&!Context)throw Error("Web Audio is unavailable");
  const context=options.context??new Context(),offline=typeof globalThis.OfflineAudioContext==="function"&&context instanceof globalThis.OfflineAudioContext;
  if(!context||!offline&&!(Context&&context instanceof Context))throw Error("A native audio context is required");
  number(context.sampleRate,8000,192000,"context sample rate");
  const controller=new AbortController(),buffers=new Map(),loading=new Map(),voices=new Map(),loops=new Map(),offsets=new Map();
  const busVolumes={master:1,music:1,ambience:1,effects:1},busNodes=new Map();
  let phase="locked",muted=false,state=null,pendingState=null,stateVersion=0,lifecycle=0,voiceId=0,encodedReserved=0,decodedReserved=0,decodedCached=0,pauseReason=null;
  const open=()=>{if(phase==="closed")throw Error("Audio runtime is closed");};
  const master=context.createGain();master.gain.value=0;master.connect(context.destination);
  const masterControl={node:master,from:0,to:0,start:0,end:0};
  for(const name of ["music","ambience","effects"]){const node=context.createGain();node.gain.value=1;node.connect(master);busNodes.set(name,{node,from:1,to:1,start:0,end:0});}
  function valueAt(control,time){return time>=control.end?control.to:time<=control.start?control.from:control.from+(control.to-control.from)*(time-control.start)/(control.end-control.start);}
  function fade(control,target,seconds){
    const now=context.currentTime,from=valueAt(control,now),param=control.node.gain;
    param.cancelScheduledValues(now);param.setValueAtTime(from,now);
    if(seconds>0)param.linearRampToValueAtTime(target,now+seconds);else param.setValueAtTime(target,now);
    Object.assign(control,{from:seconds?from:target,to:target,start:now,end:now+seconds});
  }
  function remove(voice){if(!voices.has(voice.id))return;voice.source.disconnect();voice.gain.node.disconnect();voice.pan.disconnect();voices.delete(voice.id);if(loops.get(voice.assetId)===voice)loops.delete(voice.assetId);}
  function stop(voice,seconds=0){
    if(!voices.has(voice.id))return;fade(voice.gain,0,seconds);voice.retiring=true;
    try{voice.source.stop(context.currentTime+seconds);}catch(error){if(error?.name!=="InvalidStateError")throw error;}
    if(!seconds)remove(voice);
  }
  function sourceOffset(voice){
    const at=voice.offset+Math.max(0,context.currentTime-voice.started)*voice.rate,span=voice.loopEnd-voice.loopStart;
    return at<voice.loopEnd?at:voice.loopStart+(at-voice.loopStart)%span;
  }
  function start(assetId,{loop=false,gain=1,pan,rate=1,fadeSeconds=0,offset=0}={}){
    const definition=definitions.get(assetId),buffer=buffers.get(assetId);if(!buffer)throw Error("Preload audio before playback");
    if(voices.size>=maxVoices)return null;
    const source=context.createBufferSource(),node=context.createGain(),panner=context.createStereoPanner();
    source.buffer=buffer;source.loop=loop;source.playbackRate.value=rate;
    const loopStart=definition.loopStart,loopEnd=definition.loopEnd??buffer.duration;source.loopStart=loopStart;source.loopEnd=loopEnd;
    panner.pan.value=pan??definition.pan;source.connect(node);node.connect(panner);panner.connect(busNodes.get(definition.bus).node);
    node.gain.value=0;const control={node,from:0,to:0,start:0,end:0},voice={id:++voiceId,assetId,source,pan:panner,gain:control,started:context.currentTime,offset,rate,loopStart,loopEnd,loop,retiring:false};
    source.onended=()=>remove(voice);voices.set(voice.id,voice);if(loop)loops.set(assetId,voice);
    fade(control,definition.gain*gain,fadeSeconds);source.start(context.currentTime,offset);return voice;
  }
  function reconcileLoops(seconds){
    const desired=new Set(state===null?[]:states.get(state));
    // Superseded tails may not accumulate across rapid state changes.
    for(const voice of [...voices.values()])if(voice.retiring)stop(voice);
    for(const [assetId,voice]of [...loops])if(!desired.has(assetId)){loops.delete(assetId);offsets.delete(assetId);stop(voice,seconds);}
    for(const assetId of desired)if(!loops.has(assetId)){
      const definition=definitions.get(assetId),offset=offsets.get(assetId)??definition.loopStart;
      if(!start(assetId,{loop:true,offset,fadeSeconds:seconds}))throw Error("Audio voice budget cannot admit this state transition");
    }
  }
  async function load(assetId){
    open();id(assetId);if(!definitions.has(assetId))throw Error("Unknown audio asset");if(buffers.has(assetId))return buffers.get(assetId);if(loading.has(assetId))return loading.get(assetId);
    const work=Promise.resolve().then(async()=>{
      let encoded=0,reservation=0;
      try{
        open();const definition=definitions.get(assetId),url=new URL(definition.path.split("/").map(encodeURIComponent).join("/"),document.baseURI),base=new URL(document.baseURI);
        if(url.origin!==base.origin||url.protocol!==base.protocol)throw Error("Audio left the game origin");
        const response=await fetch(url,{signal:controller.signal,credentials:"same-origin",redirect:"error",cache:"no-store"});
        if(!response.ok||!response.body)throw Error("Packaged audio resource is unavailable");
        const reader=response.body.getReader(),chunks=[];
        try{for(;;){const next=await reader.read();if(next.done)break;encoded+=next.value.byteLength;encodedReserved+=next.value.byteLength;
          if(encoded>16*MiB||encodedReserved>32*MiB){await reader.cancel();throw Error("Encoded audio budget exceeded");}chunks.push(next.value);}}
        finally{reader.releaseLock();}
        open();const bytes=new Uint8Array(encoded);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.byteLength;}
        const shape=inspectPackagedAudio(bytes),{channels,rate,minFrames,maxFrames}=shape;
        if((definition.path.endsWith(".wav"))!==(shape.format==="pcm16"))throw Error("Audio extension differs from its bounded container");
        const needed=(Math.ceil(maxFrames*context.sampleRate/rate)+3)*channels*4;
        if(decodedCached+decodedReserved+needed>64*MiB)throw Error("Decoded audio budget exceeded");reservation=needed;decodedReserved+=reservation;
        const buffer=await context.decodeAudioData(bytes.buffer);open();
        if(buffer.numberOfChannels!==channels||buffer.sampleRate!==context.sampleRate||buffer.length<1||buffer.duration<minFrames/rate-3/context.sampleRate||buffer.duration>maxFrames/rate+3/context.sampleRate||buffer.length*channels*4>reservation)throw Error("Decoded audio differs from its bounded container");
        if(definition.loopStart>=buffer.duration||(definition.loopEnd??buffer.duration)>buffer.duration+1/context.sampleRate)throw Error("Loop range exceeds its sound");
        buffers.set(assetId,buffer);decodedCached+=buffer.length*channels*4;return buffer;
      }finally{encodedReserved-=encoded;if(reservation)decodedReserved-=reservation;loading.delete(assetId);}
    });loading.set(assetId,work);return work;
  }
  async function preload(assetIds){
    open();if(!Array.isArray(assetIds)||assetIds.length>64)throw Error("Preload requires a bounded asset list");await Promise.all([...new Set(assetIds)].map(load));open();
  }
  async function setState(name,{fadeMs=350}={}){
    open();id(name);if(!states.has(name))throw Error("Unknown audio state");number(fadeMs,0,5000,"transition duration");const version=++stateVersion;pendingState=name;
    try{await preload(states.get(name));if(version!==stateVersion)return {applied:false,reason:"superseded"};open();state=name;pendingState=null;
      for(const key of offsets.keys())if(!states.get(name).includes(key))offsets.delete(key);
      if(phase==="playing")reconcileLoops(fadeMs/1000);return {applied:true,state};
    }catch(error){if(version===stateVersion)pendingState=null;throw error;}
  }
  async function unlock(event){
    open();if(!offline&&(!(event instanceof Event)||!event.isTrusted||!["click","pointerup","touchend","keydown"].includes(event.type)||globalThis.navigator?.userActivation&& !navigator.userActivation.isActive))throw Error("Start or resume audio from a fresh user gesture");
    if(phase==="playing")return {playing:true};const version=++lifecycle;phase="starting";
    try{if(!offline)await context.resume();open();if(version!==lifecycle){if(ownedContext&&context.state==="running")await context.suspend();return {playing:false};}if(!offline&&context.state!=="running")throw Error("The browser has not enabled audio");
      phase="playing";pauseReason=null;fade(masterControl,muted?0:busVolumes.master,.015);reconcileLoops(.015);return {playing:true};
    }catch(error){if(phase!=="closed"){phase="paused";pauseReason="unavailable";fade(masterControl,0,0);}throw error;}
  }
  async function pause(reason="game"){
    open();if(!["game","hidden","interrupted"].includes(reason))throw Error("Invalid pause reason");++lifecycle;phase="paused";pauseReason=reason;fade(masterControl,0,0);
    for(const [assetId,voice]of loops)offsets.set(assetId,sourceOffset(voice));for(const voice of [...voices.values()])stop(voice);
    if(ownedContext&&!offline&&context.state==="running")await context.suspend();return {paused:true};
  }
  async function playEffect(assetId,{gain=1,pan,rate=1}={}){
    open();number(gain,0,1,"effect gain");if(pan!==undefined)number(pan,-1,1,"effect pan");number(rate,.5,2,"effect rate");id(assetId);
    if(definitions.get(assetId)?.bus!=="effects")throw Error("Choose a registered effect");if(phase!=="playing")return {played:false,reason:"paused-or-locked"};const version=lifecycle;
    await load(assetId);if(phase!=="playing"||version!==lifecycle)return {played:false,reason:"interrupted"};
    if([...voices.values()].filter(voice=>voice.assetId===assetId).length>=definitions.get(assetId).maxInstances)return {played:false,reason:"instance-limit"};
    // Reserve twelve voices for state loops and their transition tails; effects never displace music silently.
    if([...voices.values()].filter(voice=>!voice.loop).length>=maxVoices-12)return {played:false,reason:"voice-limit"};
    const voice=start(assetId,{gain,pan,rate});return voice?{played:true,voiceId:voice.id}:{played:false,reason:"voice-limit"};
  }
  function setVolume(bus,value,{fadeMs=30}={}){open();if(!Object.prototype.hasOwnProperty.call(busVolumes,bus))throw Error("Unknown audio bus");number(value,0,1,"bus volume");number(fadeMs,0,5000,"volume fade");busVolumes[bus]=value;
    fade(bus==="master"?masterControl:busNodes.get(bus),bus==="master"&&(muted||phase!=="playing")?0:value,fadeMs/1000);
  }
  function setMuted(value){open();if(typeof value!=="boolean")throw Error("Mute must be boolean");muted=value;fade(masterControl,muted||phase!=="playing"?0:busVolumes.master,.01);}
  function snapshot(){return {version:audioRuntimeVersion,phase,state,pendingState,muted,pauseReason,volumes:{...busVolumes},contextState:context.state,loaded:[...buffers.keys()],encodedReserved,decodedReserved,decodedCached,voices:[...voices.values()].map(voice=>({id:voice.id,assetId:voice.assetId,loop:voice.loop,retiring:voice.retiring,gain:valueAt(voice.gain,context.currentTime)}))};}
  async function close(){
    if(phase==="closed")return;phase="closed";++stateVersion;++lifecycle;controller.abort();fade(masterControl,0,0);
    for(const voice of [...voices.values()])stop(voice);buffers.clear();decodedCached=0;offsets.clear();
    document.removeEventListener("visibilitychange",hidden);globalThis.removeEventListener("pagehide",pagehide);context.removeEventListener("statechange",interrupted);
    for(const control of busNodes.values())control.node.disconnect();master.disconnect();if(ownedContext)await context.close();
  }
  const hidden=()=>{if(document.hidden&&phase!=="closed")void pause("hidden").catch(()=>{});};
  const pagehide=event=>{if(phase!=="closed")void(event.persisted?pause("hidden"):close()).catch(()=>{});};
  const interrupted=()=>{if(!offline&&phase==="playing"&&context.state!=="running")void pause("interrupted").catch(()=>{});};
  document.addEventListener("visibilitychange",hidden);globalThis.addEventListener("pagehide",pagehide);context.addEventListener("statechange",interrupted);
  return Object.freeze({preload,setState,unlock,resume:unlock,pause,playEffect,setVolume,setMuted,snapshot,close,
    stopEffect(voiceId){open();const voice=voices.get(voiceId);if(!voice||voice.loop)return false;stop(voice,.005);return true;}});
}
