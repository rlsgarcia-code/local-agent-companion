import {createHash} from "node:crypto";
import {lstat,readFile} from "node:fs/promises";
import path from "node:path";
import {z} from "zod";
import {contentHash} from "../../contracts/src/identity";
import {gameAudioEncodeReport,audioEncodePaths,type GameAudioEncodeOperation} from "../../contracts/src/game-audio-codec";
import {GameProductionFailure,type GameAssetProcessor,type ProcessedGameAsset} from "../../game-production/src/index";
import {dockerCommand} from "../../adapter-game-container/src/process";
import {readGameTar} from "../../adapter-game-container/src/archive";
import {isolatedContainerJob} from "../../adapter-game-container/src/job";
import lock from "../toolchain.lock.json";
const sha=(bytes:Uint8Array)=>createHash("sha256").update(bytes).digest("hex");
export const audioCodecProvision=z.object({schemaVersion:z.literal(1),version:z.literal(lock.version),hostArchitecture:z.enum(["arm64","x64"]),toolArchitecture:z.literal("x64"),platform:z.literal("linux/amd64"),imageId:z.string().regex(/^sha256:[a-f0-9]{64}$/),driverSha256:z.string().regex(/^[a-f0-9]{64}$/),recipeSha256:z.string().regex(/^[a-f0-9]{64}$/),dockerExecutable:z.string().refine(path.isAbsolute)}).strict();
export function canonicalPcm16(bytes:Buffer){
  if(bytes.length<46||bytes.length>64*1024*1024||bytes.subarray(0,4).toString()!=="RIFF"||bytes.readUInt32LE(4)!==bytes.length-8||bytes.subarray(8,16).toString()!=="WAVEfmt "||bytes.readUInt32LE(16)!==16||bytes.readUInt16LE(20)!==1||bytes.readUInt16LE(34)!==16||bytes.subarray(36,40).toString()!=="data"||bytes.readUInt32LE(40)!==bytes.length-44)throw Error("Encode a canonical PCM16 WAV from the local media processor; originals were preserved.");
  const channels=bytes.readUInt16LE(22),sampleRate=bytes.readUInt32LE(24),frames=(bytes.length-44)/(channels*2);
  if(![1,2].includes(channels)||![22050,44100,48000].includes(sampleRate)||bytes.readUInt16LE(32)!==channels*2||bytes.readUInt32LE(28)!==sampleRate*channels*2||!Number.isInteger(frames)||frames<1||frames>180*sampleRate)throw Error("Codec source exceeds mono/stereo, rate or duration bounds.");return {channels,sampleRate,frames};
}
export function inspectAudioMp4(data:Uint8Array){
  const bytes=Buffer.from(data);if(bytes.length<64||bytes.length>8*1024*1024)throw Error("Encoded MP4 exceeds its byte bounds.");let at=0;const boxes:{type:string;start:number;size:number}[]=[];
  while(at<bytes.length){if(at+8>bytes.length||boxes.length>=16)throw Error("Incomplete encoded MP4 box table.");let size=bytes.readUInt32BE(at),header=8;const type=bytes.subarray(at+4,at+8).toString("ascii");
    if(size===1){if(at+16>bytes.length)throw Error("Truncated large MP4 box.");const large=bytes.readBigUInt64BE(at+8);if(large>BigInt(bytes.length))throw Error("Oversized MP4 box.");size=Number(large);header=16;}
    if(size<header||at+size>bytes.length||!["ftyp","moov","free","mdat"].includes(type))throw Error("Unexpected encoded MP4 top-level box.");boxes.push({type,start:at,size});at+=size;
  }
  if(boxes[0]?.type!=="ftyp"||["ftyp","moov","mdat"].some(type=>boxes.filter(box=>box.type===type).length!==1)||boxes.find(box=>box.type==="moov")!.start>boxes.find(box=>box.type==="mdat")!.start)throw Error("Encoded audio requires a complete fast-start MP4.");return boxes;
}
export function validateEncodedAudio(archive:Buffer,operation:GameAudioEncodeOperation,source:{sha256:string;sampleRate:number;channels:number;frames:number}):ProcessedGameAsset{
  const files=readGameTar(archive),expected=audioEncodePaths(operation);
  if(files.length!==expected.length||files.some(file=>!expected.includes(file.path))||files.reduce((sum,file)=>sum+file.data.byteLength,0)>32*1024*1024)throw Error("Incomplete or oversized encoded audio candidate.");
  const sidecar=files.find(file=>file.path===`${operation.outputBase}.encoded.json`)!;if(sidecar.data.byteLength>16384)throw Error("Encoded audio report exceeds 16 KiB.");
  const report=gameAudioEncodeReport.parse(JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(sidecar.data)));
  if(report.sourceSha256!==source.sha256||report.sampleRate!==source.sampleRate||report.channels!==source.channels||report.sourceFrames!==source.frames||report.variants.length!==operation.variants.length)throw Error("Codec output does not bind its source dimensions.");
  for(const [index,variant]of operation.variants.entries()){
    const declared=report.variants[index]!,file=files.find(file=>file.path===`${operation.outputBase}.${variant.id}.m4a`)!;
    if(declared.id!==variant.id||declared.bitrateKbps!==variant.bitrateKbps||declared.path!==file.path||declared.size!==file.data.byteLength||declared.sha256!==sha(file.data))throw Error("Encoded variant differs from its exact request and bytes.");inspectAudioMp4(file.data);file.mime="audio/mp4";
  }
  sidecar.mime="application/json";return {files,info:{codec:"AAC-LC",container:"MP4",variants:operation.variants.length,sampleRate:source.sampleRate,channels:source.channels,sourceFrames:source.frames,encodedBytes:report.variants.reduce((n,v)=>n+v.size,0),sourceBytes:44+source.frames*source.channels*2,format:"AAC-LC MP4 variants",toolArchitecture:"x64",emulated:process.arch!=="x64"}};
}
export async function createAudioCodecProcessor(options:{stateDirectory:string;driverSha256:string;implementationSha256?:string;configPath?:string}):Promise<GameAssetProcessor>{
  let provision:z.infer<typeof audioCodecProvision>|undefined;
  try{const file=options.configPath??path.join(options.stateDirectory,"toolchains/audio-codec.json"),stat=await lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.mode&0o022||stat.size>16384||process.getuid&&stat.uid!==process.getuid()&&stat.uid!==0)throw Error("Unsafe codec provisioning record");provision=audioCodecProvision.parse(JSON.parse(await readFile(file,"utf8")));if(provision.hostArchitecture!==process.arch||provision.driverSha256!==options.driverSha256||provision.recipeSha256!==contentHash({lock,driverSha256:options.driverSha256,imagePolicy:1}))provision=undefined;}catch{/* Explicit optional unavailable tool, no auto-install or native fallback. */}
  const toolchain={id:"audio-codec-isolated",version:`${lock.version}.adapter.1`,sha256:contentHash({provision:provision??null,adapterABI:1,implementation:options.implementationSha256??"development-unreleased"})};
  const probe=async()=>{if(!provision)return {available:false,reason:"Provision the exact signed-source audio codec image administratively; this path is Linux x64, explicitly emulated on ARM64."};
    try{const local=(host:string)=>/^(?:unix:\/\/\/|npipe:\/\/)/.test(host);if(process.env.DOCKER_HOST&&!local(process.env.DOCKER_HOST))throw Error();const [context]=JSON.parse((await dockerCommand(provision.dockerExecutable,["context","inspect"])).toString());if(!local(context.Endpoints?.docker?.Host??""))throw Error();const [image]=JSON.parse((await dockerCommand(provision.dockerExecutable,["image","inspect",provision.imageId])).toString());if(image.Id!==provision.imageId||image.Architecture!=="amd64"||image.Config?.Labels?.["org.companion.game-audio.recipe"]!==provision.recipeSha256)throw Error();return {available:true};}catch{return {available:false,reason:"The pinned local codec image is unavailable or changed; no host FFmpeg is used."};}};
  const accessSource=async(access:Parameters<GameAssetProcessor["process"]>[0])=>{const operation=access.spec.operation;if(operation.type!=="audio.encode")throw new GameProductionFailure("This processor only encodes registered WAV sources.");const file=access.document.files.find(file=>file.path===operation.source.path);if(!file||file.mime!=="audio/wav")throw new GameProductionFailure("Choose an exact registered WAV source.");const bytes=Buffer.from(await access.readFile(file.path));if(bytes.length!==file.size||sha(bytes)!==file.sha256)throw new GameProductionFailure("The codec source differs from its registered bytes.");return {file,bytes,shape:canonicalPcm16(bytes),operation};};
  const job=(source:Awaited<ReturnType<typeof accessSource>>)=>isolatedContainerJob({stateDirectory:options.stateDirectory,imageId:provision!.imageId,dockerExecutable:provision!.dockerExecutable,platform:provision!.platform,entrypoint:["/usr/bin/python3","-I","/opt/companion/audio-process.py"],memoryMiB:768,workMiB:256,timeoutMs:240000,maxOutputBytes:32*1024*1024,recipeHash:provision!.recipeSha256,validate:archive=>validateEncodedAudio(archive,source.operation,{sha256:source.file.sha256,...source.shape})});
  return {id:"audio-codec-isolated-v1",products:["companion-mac","companion-vscode"],authority:"workspace",operations:["audio.encode"],toolchain,resources:{memoryMiB:768,cpuSlots:1,exclusiveGroups:["game-audio-codec"]},
    projectGuide:"Explicitly encode a registered canonical PCM16 WAV with audio.encode, codec aac-lc, outputBase and one to three named variants at 64/96/128/192 kbps. A minimal pinned FFmpeg container produces fast-start MP4/M4A and a source/hash/roundtrip metrics report; original WAV/provenance remain. Lossy variants need listening and target-browser tests; not musical quality or permission to use assets. No shell, URLs, arbitrary filters, new providers, auto-provision or KidOS fallback. Applying a candidate remains explicit.",probe,
    async process(access){if(!(await probe()).available)throw new GameProductionFailure("The exact isolated codec is not available.");const source=await accessSource(access);return job(source).run(access,[{path:"input.wav",data:source.bytes},{path:"request.json",data:Buffer.from(JSON.stringify({schemaVersion:1,sourceSha256:source.file.sha256,operation:source.operation}))}]);},
    async reconcile(access){if(!provision)throw new GameProductionFailure("Restore the exact codec provisioning record before reconciliation.");return job(await accessSource(access)).reconcile(access);},
    async dispose(access){if(!provision)throw new GameProductionFailure("Restore the exact codec provisioning record before cleanup.");await job(await accessSource(access)).dispose(access);},
  };
}
