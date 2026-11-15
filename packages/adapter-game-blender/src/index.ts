import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";
import { PNG } from "pngjs";
import { contentHash } from "../../contracts/src/identity";
import { assetSources, assetOutputPaths } from "../../contracts/src/game-assets";
import type { GameModelOperation } from "../../contracts/src/game-models";
import { GameProductionFailure, GameProductionUncertain, type GameAssetProcessor, type ProcessedGameAsset, type ProductionAccess } from "../../game-production/src/index";
import { inspectGameGlb } from "../../game-production/src/glb";
import { dockerCommand } from "../../adapter-game-container/src/process";
import { readGameTar } from "../../adapter-game-container/src/archive";
import { isolatedContainerJob } from "../../adapter-game-container/src/job";
import lock from "../toolchain.lock.json";

const digest=(data:Uint8Array)=>createHash("sha256").update(data).digest("hex");
export const blenderProvision=z.object({schemaVersion:z.literal(1),version:z.literal(lock.version),hostArchitecture:z.enum(["arm64","x64"]),toolArchitecture:z.literal("x64"),platform:z.literal("linux/amd64"),
  imageId:z.string().regex(/^sha256:[a-f0-9]{64}$/),recipeSha256:z.string().regex(/^[a-f0-9]{64}$/),driverSha256:z.string().regex(/^[a-f0-9]{64}$/),dockerExecutable:z.string().refine(path.isAbsolute)}).strict();
type Provision=z.infer<typeof blenderProvision>;
export async function createBlenderAssetProcessor(options:{stateDirectory:string;driverSha256:string;implementationSha256?:string;configPath?:string}):Promise<GameAssetProcessor>{
  let provision:Provision|undefined;
  try{
    const file=options.configPath??path.join(options.stateDirectory,"toolchains/blender.json"),metadata=await lstat(file);
    if(!metadata.isFile()||metadata.isSymbolicLink()||metadata.nlink!==1||metadata.mode&0o022||metadata.size>16384||process.getuid&&metadata.uid!==process.getuid()&&metadata.uid!==0)throw new Error("Unsafe Blender provisioning record");
    provision=blenderProvision.parse(JSON.parse(await readFile(file,"utf8")));
    if(provision.hostArchitecture!==process.arch||provision.driverSha256!==options.driverSha256||provision.recipeSha256!==contentHash({lock,driverSha256:options.driverSha256,imagePolicy:1}))provision=undefined;
  }catch{ /* Optional unavailable tool; never download, install or select another engine. */ }
  const toolchain={id:"blender-model-isolated",version:`${lock.version}.adapter.2`,sha256:contentHash({provision:provision??null,adapterABI:2,implementation:options.implementationSha256??"development-unreleased"})};
  async function probe(){
    if(!provision)return {available:false,reason:"Provision the exact Blender LTS tool image administratively; source recipes cannot install tools. This path uses Linux x64, explicitly emulated on ARM64."};
    try{
      const local=(host:string)=>/^(?:unix:\/\/\/|npipe:\/\/)/.test(host);
      if(process.env.DOCKER_HOST&&!local(process.env.DOCKER_HOST))throw new Error("Remote Docker is not permitted.");
      const command=(args:string[])=>dockerCommand(provision!.dockerExecutable,args);
      const [context]=JSON.parse((await command(["context","inspect"])).toString());if(!local(context.Endpoints?.docker?.Host??""))throw new Error("Local IPC required.");
      const [image]=JSON.parse((await command(["image","inspect",provision.imageId])).toString());
      if(image.Id!==provision.imageId||image.Architecture!=="amd64"||image.Config?.Labels?.["org.companion.game-blender.recipe"]!==provision.recipeSha256)throw new Error("Blender image identity mismatch.");
      return {available:true};
    }catch{return {available:false,reason:"The pinned Blender image or local isolation service is unavailable; no native/unverified substitute is executed."};}
  }
  function candidate(archive:Buffer,operation:GameModelOperation):ProcessedGameAsset{
    const files=readGameTar(archive),expected=assetOutputPaths(operation);
    if(files.length!==4||files.some((f)=>!expected.includes(f.path))||files.reduce((sum,f)=>sum+f.data.byteLength,0)>128*1024*1024)throw new Error("Incomplete or oversized Blender candidate.");
    const get=(suffix:string)=>files.find((f)=>f.path===operation.outputBase+suffix)!;
    const glb=inspectGameGlb(get(".glb").data);if(!glb.meshes||!glb.triangles)throw new Error("Blender did not export a mesh with triangles.");
    if(operation.rig&&!glb.skins||operation.clips.some((clip)=>!glb.document.animations?.some((animation:{name?:string})=>animation.name===clip.id)))throw new Error("Blender output lost the requested rig or named animation clips.");
    if(operation.objects.some(object=>object.skin)&&!glb.skinnedVertices)throw new Error("Blender output lost the requested weighted skin.");
    const native=Buffer.from(get(".blend").data);if(native.length<12||!(native.subarray(0,7).toString()==="BLENDER"||native.readUInt32LE(0)===0xfd2fb528))throw new Error("The editable Blender source is missing or unrecognized.");
    const png=Buffer.from(get(".preview.png").data);if(png.length>4*1024*1024||png.length<33||png.subarray(1,4).toString()!=="PNG"||png.readUInt32BE(16)!==512||png.readUInt32BE(20)!==512)throw new Error("Blender preview must be a bounded 512-pixel PNG.");
    PNG.sync.read(png,{checkCRC:true});
    const reportBytes=get(".model.json").data;if(reportBytes.byteLength>16384)throw new Error("Blender report exceeds 16 KiB.");
    const report=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(reportBytes));if(report.schemaVersion!==1||!String(report.blender).startsWith(lock.version))throw new Error("Blender output report version mismatch.");
    get(".glb").mime="model/gltf-binary";get(".blend").mime="application/x-blender";
    return {files,info:{blender:lock.version,toolArchitecture:"x64",emulated:process.arch!=="x64",triangles:glb.triangles,meshes:glb.meshes,nodes:glb.nodes,skins:glb.skins,skinnedVertices:glb.skinnedVertices,mixedWeightVertices:glb.mixedWeightVertices,maxSkinInfluences:glb.maxSkinInfluences,animations:glb.animations,animationChannels:glb.animationChannels,previewWidth:512,previewHeight:512}};
  }
  function execution(access:ProductionAccess&{spec:Parameters<GameAssetProcessor["process"]>[0]["spec"]}){
    if(!provision||access.spec.operation.type!=="model.scene")throw new GameProductionFailure("The isolated Blender processor requires a provisioned model.scene recipe.");
    const operation=access.spec.operation;
    return isolatedContainerJob({stateDirectory:options.stateDirectory,imageId:provision.imageId,dockerExecutable:provision.dockerExecutable,platform:provision.platform,
      entrypoint:["/opt/blender/blender","--background","--factory-startup","--disable-autoexec","--threads","2","--python-exit-code","1","--python","/opt/companion/process.py"],
      validate:(archive)=>candidate(archive,operation),memoryMiB:4096,workMiB:384,timeoutMs:180000,maxOutputBytes:144*1024*1024,recipeHash:contentHash(access.spec)});
  }
  return {id:"blender-model-isolated-v1",products:["companion-mac","companion-vscode"],authority:"workspace",operations:["model.scene"],toolchain,probe,
    resources:{memoryMiB:4096,cpuSlots:2,exclusiveGroups:["blender-editor"]},
    projectGuide:"model.scene builds/edits a typed scene: primitives/custom triangle meshes or self-contained registered GLB, PBR colors/PNG textures, object hierarchy, rigid bindBone bindings or explicit mesh skin.weights (one ordered row per source vertex; 1-4 distinct bone/weight influences summing to one), and named object/bone animation clips. Weighted meshes require a rig, no parent/rigid binding/topology modifiers, and aggregate 50000 vertices/200000 influences. This qualified editor preserves up to four influences per vertex; registered GLB above that is refused, never silently reduced. Inputs use meters, Blender Z-up and Euler degrees; GLB is exported Y-up. No Python, expressions, plugins, .blend imports or external URIs. The four immutable outputs are outputBase.glb, .blend, .preview.png and .model.json; inspect then explicitly apply. .blend is editable source, not a runtime resource; use GLB in games. PNGs/GLBs must be registered project assets with provenance. Sources/placeholder ancestry remain preserved. Linux x64 executes under explicit emulation on ARM64. Rendering is a 512px CPU candidate, not artistic/game/human acceptance.",
    async process(access){
      if(!(await probe()).available||!provision||access.spec.operation.type!=="model.scene")throw new GameProductionFailure("The qualified Blender processing toolchain is unavailable.");
      const files:{path:string;data:Uint8Array}[]=[],sources:Record<string,string>={};let bytes=0;
      for(const source of assetSources(access.spec.operation))if(!sources[source.path]){
        access.signal.throwIfAborted();const data=await access.readFile(source.path);bytes+=data.byteLength;if(bytes>64*1024*1024)throw new GameProductionFailure("Model inputs exceed 64 MiB; source assets are preserved.");
        try{
          if(source.path.endsWith(".glb")){if(inspectGameGlb(data).maxSkinInfluences>4)throw Error("This qualified Blender path preserves at most four influences per vertex; original input remains preserved.");}
          else{const png=Buffer.from(data);if(png.length<33||png.length>16*1024*1024||png.subarray(1,4).toString()!=="PNG"||!png.readUInt32BE(16)||!png.readUInt32BE(20)||png.readUInt32BE(16)>4096||png.readUInt32BE(20)>4096)throw new Error("Model textures require bounded PNG inputs.");}
        }catch(error){throw new GameProductionFailure(error instanceof Error?error.message:"Invalid model source; original bytes remain saved.");}
        const name=`files/${digest(data)}${source.path.endsWith(".glb")?".glb":".png"}`;sources[source.path]=name;if(!files.some((file)=>file.path===name))files.push({path:name,data});
      }
      files.push({path:"recipe.json",data:Buffer.from(JSON.stringify({operation:access.spec.operation,sources}))});
      return execution(access).run(access,files);
    },
    async reconcile(access){if(!(await probe()).available)throw new GameProductionUncertain("Restore the original Blender toolchain to inspect this model job.");return execution(access).reconcile(access);},
    async dispose(access){if(!provision)return;await execution(access).dispose(access);},
  };
}
