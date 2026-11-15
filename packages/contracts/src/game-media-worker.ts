import { z } from "zod";
import { identifier } from "./schema";
import { canonical,contentHash } from "./identity";
import { gameDocument, gameFile, gameFilePath, gameFileTreeConflict } from "./games";
import { assetSourceInputs, gameAssetSpec, gameAssetResult } from "./game-assets";
import { gameToolchain } from "./game-production";

export const GAME_MEDIA_SOURCE_BYTES=64*1024*1024;
export const GAME_MEDIA_RESULT_BYTES=128*1024*1024;
const sha=z.string().regex(/^[a-f0-9]{64}$/);

/** Private one-job exchange; neither paths on the host nor a Core permission. */
export const gameMediaProcessRequest=z.object({
  schemaVersion:z.literal(1),requestId:identifier,sourceHash:sha,recipeHash:sha,toolchain:gameToolchain,
  document:gameDocument,spec:gameAssetSpec,sources:z.array(gameFile).max(256),
}).strict().superRefine((value,context)=>{
  if(value.spec.operation.type==="audio.encode")context.addIssue({code:"custom",path:["spec"],message:"Audio encoding requires a separately qualified isolated processor; the fixed Core worker keeps its existing formats."});
  if(value.spec.operation.type==="audio.render"&&value.spec.operation.waveformBins!==undefined)context.addIssue({code:"custom",path:["spec"],message:"Audio analysis requires a separately qualified Core media contract; this fixed worker preserves its legacy output files."});
  if((value.spec.operation.type==="image.compose"||value.spec.operation.type==="image.atlas")&&value.spec.operation.pngEncoding!==undefined)context.addIssue({code:"custom",path:["spec"],message:"PNG encoding choices require a separately qualified Core media contract; this fixed worker preserves its legacy representation."});
  if(value.spec.operation.type==="model.scene")context.addIssue({code:"custom",path:["spec"],message:"3D requires the isolated Blender adapter."});
  if(value.spec.operation.type==="image.vector")context.addIssue({code:"custom",path:["spec"],message:"Vector media requires a separately qualified Core SVG contract; this fixed Core worker keeps its existing formats."});
  if(value.spec.operation.type==="library.copy")context.addIssue({code:"custom",path:["spec"],message:"Library import requires its separately qualified protected catalog; this fixed Core worker keeps its existing formats."});
  if(value.recipeHash!==contentHash(value.spec))context.addIssue({code:"custom",path:["recipeHash"],message:"The normalized recipe does not match its original hash."});
  try{
    const expected=assetSourceInputs(value.document,value.spec).files;
    if(canonical(expected)!==canonical(value.sources))context.addIssue({code:"custom",path:["sources"],message:"Media inputs must exactly match registered sources in recipe order."});
  }catch(error){context.addIssue({code:"custom",path:["sources"],message:error instanceof Error?error.message:"Invalid registered sources."});}
});
export type GameMediaProcessRequest=z.infer<typeof gameMediaProcessRequest>;

export const gameMediaProcessResult=z.object({
  schemaVersion:z.literal(1),requestId:identifier,requestSha256:sha,sourceHash:sha,
  recipeHash:sha,toolchain:gameToolchain,
  files:z.array(z.object({path:gameFilePath.refine(name=>name.startsWith("assets/")),
    mime:z.enum(["image/png","audio/wav","application/json"]),size:z.number().int().min(1).max(GAME_MEDIA_RESULT_BYTES),sha256:sha,
  }).strict()).min(1).max(17),
  info:gameAssetResult.shape.info,
}).strict().superRefine((value,context)=>{
  const conflict=gameFileTreeConflict(value.files.map(file=>file.path));
  if(conflict)context.addIssue({code:"custom",path:["files",conflict.index,"path"],message:conflict.message});
  if(value.files.reduce((total,file)=>total+file.size,0)>GAME_MEDIA_RESULT_BYTES)
    context.addIssue({code:"custom",path:["files"],message:"Media candidate exceeds 128 MiB."});
});
export type GameMediaProcessResult=z.infer<typeof gameMediaProcessResult>;
