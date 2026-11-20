import { Worker } from "node:worker_threads";
import * as path from "node:path";
import { lstat, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { contentHash } from "../../contracts/src/identity";
import { assetSources } from "../../contracts/src/game-assets";
import { GameProductionFailure,GameProductionUncertain,type GameAssetProcessor,type ProcessedGameAsset } from "../../game-production/src/index";
import pngPackage from "pngjs/package.json";
import { gameVectorGuide } from "../../contracts/src/game-vector";
import rasterizerLock from "../rasterizer.lock.json";

/** Pure local processing, with bounded input/worker lifetime; never arbitrary JS,
 * provider discovery, a shell, filesystem access selected by a project or KidOS authority. */
export function createLocalGameAssetProcessor(options:{workerPath?:string;rasterizerPath?:string;implementationSha256?:string}={}):GameAssetProcessor {
  const workerPath=options.workerPath??path.join(__dirname,"worker.js");
  const rasterizerPath=options.rasterizerPath??require.resolve("@resvg/resvg-wasm/index_bg.wasm");
  const rasterizerBytes=async()=>{
    const stat=await lstat(rasterizerPath);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==rasterizerLock.wasm.size)throw new Error("The local vector rasterizer is not a verified file.");
    const bytes=await readFile(rasterizerPath);
    if(createHash("sha256").update(bytes).digest("hex")!==rasterizerLock.wasm.sha256)throw new Error("Vector rasterizer integrity mismatch.");
    return bytes;
  };
  const active=new Map<string,Worker>();let preparing=false;
  return {id:"local-media-v1",products:["companion-mac","companion-vscode"],authority:"workspace",operations:["image.compose","image.atlas","audio.render","image.vector"],projectGuide:gameVectorGuide+"\nAudio rendering may explicitly request waveformBins (128/256/512/1024) to include a .audio.json sidecar bound to the exact PCM16 WAV hash, with digital RMS/peak/DC, sample rails and quiet frames. These are measurements, not LUFS, musical quality or hearing. Omit for legacy WAV-only output. Core refuses this new option pending separate qualification. PNG composition/atlas may explicitly use pngEncoding: lossless-smallest to compare lossless 8-bit RGBA, opaque RGB, grayscale or an exact palette of at most 256 colors. No quantization, resizing or quality loss; savings are actual candidate byte counts, not guaranteed. Omit pngEncoding for legacy RGBA8 bytes. This option is not enabled in the fixed Core media worker. Preserve source, provenance, candidate review and explicit application.",
    resources:{memoryMiB:768,cpuSlots:1,exclusiveGroups:["game-media"]},
    toolchain:{id:"local-media",version:`2+pngjs.${pngPackage.version}+resvg-wasm.${rasterizerLock.version}`,sha256:contentHash({ABI:2,pngjs:pngPackage.version,rasterizer:rasterizerLock.wasm.sha256,node:process.versions.node,implementation:options.implementationSha256??"development-unreleased"})},
    async probe(){try{const file=await lstat(workerPath);if(!file.isFile()||file.isSymbolicLink())return {available:false,reason:"The local media worker is not a verified file."};await rasterizerBytes();return {available:true};}catch{return {available:false,reason:"The packaged local media worker or vector rasterizer is unavailable or unverified."};}},
    async process(access) {
      if(preparing||active.size)throw new GameProductionFailure("The local media processor is busy. The saved request/source is unchanged; retry explicitly after its active job finishes.");
      preparing=true;let worker:Worker|undefined;let timer:NodeJS.Timeout|undefined;
      try {
        const paths=[...new Set(assetSources(access.spec.operation).map((source)=>source.path))],files:{path:string;data:Uint8Array}[]=[];let bytes=0;
        for(const name of paths){access.signal.throwIfAborted();const metadata=access.document.files.find((file)=>file.path===name);
          if(!metadata || metadata.size>64*1024*1024-bytes)throw new GameProductionFailure("Asset source byte budget exceeded; preserve the originals and split the operation.");
          const data=await access.readFile(name);bytes+=data.byteLength;if(bytes>64*1024*1024)throw new GameProductionFailure("Asset source byte budget exceeded; preserve the originals and split the operation.");files.push({path:name,data});}
        access.signal.throwIfAborted();
        const rasterizer=access.spec.operation.type==="image.vector"&&access.spec.operation.output.endsWith(".png")?await rasterizerBytes():undefined;
        access.signal.throwIfAborted();
        worker=new Worker(workerPath,{workerData:{operation:access.spec.operation,files,rasterizer},env:{},resourceLimits:{maxOldGenerationSizeMb:256,maxYoungGenerationSizeMb:32,stackSizeMb:4}});
        active.set(access.job.id,worker);preparing=false;
        const running=worker;
        const result=await new Promise<ProcessedGameAsset>((resolve,reject)=>{
          const abort=()=>reject(access.signal.reason);
          access.signal.addEventListener("abort",abort,{once:true});
          timer=setTimeout(()=>reject(new GameProductionFailure("Media processing time budget exceeded; no candidate was applied.")),60000);
          running.once("message",(message:{ok:boolean;result?:ProcessedGameAsset;error?:string})=>{access.signal.removeEventListener("abort",abort);message.ok?resolve(message.result!):reject(new GameProductionFailure(message.error??"Media processing failed."));});
          running.once("error",(error)=>{access.signal.removeEventListener("abort",abort);reject(new GameProductionFailure(error.message));});
          running.once("exit",(code)=>{access.signal.removeEventListener("abort",abort);reject(new GameProductionFailure(`Media worker exited ${code} without an acknowledged result.`));});
          if(access.signal.aborted)abort();
        });
        access.signal.throwIfAborted();return result;
      } catch(error) { if(access.signal.aborted && error===access.signal.reason)throw error;throw error instanceof GameProductionFailure?error:new GameProductionFailure(error instanceof Error?error.message:"Media processing failed."); }
      finally {
        if(timer)clearTimeout(timer);preparing=false;
        if(worker)try{await worker.terminate();active.delete(access.job.id);}catch{throw new GameProductionUncertain("The media worker termination is not confirmed. Reconcile this exact job before repeating it.");}
      }
    },
    async reconcile(access){const worker=active.get(access.job.id);if(worker){await worker.terminate();active.delete(access.job.id);}return {state:"missing",detail:"The same-process media worker is stopped. No acknowledged candidate survived; request new processing explicitly. Source assets are unchanged."};},
  };
}
