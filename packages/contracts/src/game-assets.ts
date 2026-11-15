import {gameAudioEncodeOperation,audioEncodePaths} from "./game-audio-codec";
import { z } from "zod";
import {gameAudioWaveformBins,audioAnalysisPath} from "./game-audio-analysis";
import { identifier } from "./schema";
import { gameAsset, gameFile, gameFilePath, gameFileTreeConflict } from "./games";
import type { GameDocument, GameFile } from "./games";
import { contentHash } from "./identity";
import { gameToolchain } from "./game-production";
import { gameModelOperation, modelSources } from "./game-models";
import { gameVectorImageOperation, vectorRecipePath } from "./game-vector";
import { gameLibraryCopyOperation } from "./game-library";
import {gameRgbaColor} from "./game-colors";

const output = gameFilePath.refine((name) => name.startsWith("assets/"), "Processed assets must remain under assets/.");
export const gameAssetSource = z.object({ assetId: identifier, path: gameFilePath }).strict();
const coordinate = z.number().int().min(-8192).max(8192);
const dimension = z.number().int().min(1).max(4096);
const rgba = gameRgbaColor;
const rect = z.object({ x: z.number().int().nonnegative().max(8192), y: z.number().int().nonnegative().max(8192), width: dimension, height: dimension }).strict();
const pngEncoding=z.enum(["rgba8","lossless-smallest"]).optional().describe("Explicit PNG encoding choice. Omit to preserve legacy RGBA8 bytes. lossless-smallest compares RGBA/RGB/grayscale/exact palette at 8 bits, selecting the smallest available representation without resizing or quantizing pixels; savings are measured, not guaranteed. Core media requires its own qualified format contract.");
export const gameImageComposeOperation = z.object({ type: z.literal("image.compose"), output: output.refine((name) => name.endsWith(".png")), width: dimension, height: dimension,
    pngEncoding,
    background: rgba.default("#00000000"), layers: z.array(z.object({ source: gameAssetSource, x: coordinate, y: coordinate,
      width: dimension, height: dimension, crop: rect.optional(), flipX: z.boolean().default(false), flipY: z.boolean().default(false),
      opacity: z.number().min(0).max(1).default(1), tint: rgba.default("#ffffffff"), filter: z.enum(["nearest", "bilinear"]).default("bilinear"),
    }).strict()).min(1).max(64),
  }).strict();
export const gameAudioRenderOperation = z.object({ type: z.literal("audio.render"), output: output.refine((name) => name.endsWith(".wav")),
    waveformBins:gameAudioWaveformBins.optional().describe("Explicit optional digital measurements/waveform sidecar for the exact encoded PCM16 output. Omit to preserve legacy recipe and WAV-only files. Choose 128/256/512/1024 bins. Not perceptual loudness, musical quality or physical hearing. Fixed Core media requires separate qualification."),
    sampleRate: z.union([z.literal(22050), z.literal(44100), z.literal(48000)]).default(48000), channels: z.union([z.literal(1), z.literal(2)]).default(2),
    durationMs: z.number().int().min(10).max(180000), normalizePeak: z.number().min(0.05).max(0.99).optional(),
    clips: z.array(z.object({ source: gameAssetSource, startMs: z.number().int().nonnegative().max(180000),
      offsetMs: z.number().int().nonnegative().max(180000).default(0), durationMs: z.number().int().positive().max(180000),
      gain: z.number().min(0).max(4).default(1), pan: z.number().min(-1).max(1).default(0), fadeInMs: z.number().int().nonnegative().max(10000).default(0), fadeOutMs: z.number().int().nonnegative().max(10000).default(0),
    }).strict()).max(32).default([]),
    notes: z.array(z.object({ waveform: z.enum(["sine", "triangle", "square", "saw", "noise"]), frequency: z.number().min(20).max(20000),
      endFrequency: z.number().min(20).max(20000).optional(), startMs: z.number().int().nonnegative().max(180000), durationMs: z.number().int().min(1).max(180000),
      gain: z.number().min(0).max(1), pan: z.number().min(-1).max(1).default(0), attackMs: z.number().int().nonnegative().max(10000).default(5),
      releaseMs: z.number().int().nonnegative().max(10000).default(30), seed: z.number().int().min(0).max(0xffffffff).default(1),
    }).strict()).max(256).default([]),
  }).strict().superRefine((operation, context) => {
    if(operation.waveformBins!==undefined&&!gameFilePath.safeParse(audioAnalysisPath(operation.output)).success)context.addIssue({code:"custom",message:"The derived audio analysis path must fit portable file limits."});
    if (!operation.clips.length && !operation.notes.length) context.addIssue({ code: "custom", message: "An audio render requires source clips or procedural notes." });
    if ([...operation.clips, ...operation.notes].some((clip) => clip.startMs + clip.durationMs > operation.durationMs) ||
        operation.notes.some((note) => note.attackMs + note.releaseMs > note.durationMs) ||
        operation.clips.some((clip) => clip.fadeInMs + clip.fadeOutMs > clip.durationMs) ||
        [...operation.clips, ...operation.notes].reduce((sum, clip) => sum + clip.durationMs, 0) > 480000)
      context.addIssue({ code: "custom", message: "Audio segments must fit the requested duration, envelopes and 480-second processing budget." });
});
export const gameAssetOperation = z.discriminatedUnion("type", [
  gameModelOperation,
  gameAudioEncodeOperation,
  gameVectorImageOperation,
  gameLibraryCopyOperation,
  gameImageComposeOperation,
  z.object({ type: z.literal("image.atlas"), outputBase: output.refine((name) => name.split("/").at(-1)!.length <= 220),
    pngEncoding,
    pageSize: z.union([z.literal(256), z.literal(512), z.literal(1024), z.literal(2048), z.literal(4096)]),
    maxPages: z.number().int().min(1).max(16).default(4), padding: z.number().int().min(1).max(8).default(2), trim: z.boolean().default(true),
    frames: z.array(z.object({ id: identifier, source: gameAssetSource }).strict()).min(1).max(256),
    animations: z.array(z.object({ id: identifier, frames: z.array(identifier).min(1).max(256), fps: z.number().min(0.1).max(120), loop: z.boolean() }).strict()).max(64).default([]),
  }).strict(),
  gameAudioRenderOperation,
]).superRefine((operation, context) => {
  if (operation.type === "image.atlas") {
    const paths = [`${operation.outputBase}.atlas.json`, `${operation.outputBase}-page-${String(operation.maxPages-1).padStart(2,"0")}.png`];
    if (paths.some((name) => !gameFilePath.safeParse(name).success))
      context.addIssue({code:"custom",message:"Generated atlas output paths must fit portable file and component limits."});
    const names = new Set(operation.frames.map((frame) => frame.id));
    if (names.size !== operation.frames.length || new Set(operation.animations.map((clip) => clip.id)).size !== operation.animations.length ||
        operation.animations.some((clip) => clip.frames.some((name) => !names.has(name))))
      context.addIssue({ code: "custom", message: "Atlas frames and animation identities must be unique and reference existing frames." });
  }

});
export type GameAssetOperation = z.infer<typeof gameAssetOperation>;
export const gameAssetSpec = z.object({ processorId: identifier, target: z.object({ id: identifier, role: z.string().min(1).max(300), placeholder: z.boolean().default(true) }).strict(), operation: gameAssetOperation }).strict();
export type GameAssetSpec = z.infer<typeof gameAssetSpec>;
export const gameAssetProcessRequest = z.object({ requestId: identifier, projectId: identifier, revision: z.number().int().positive(), spec: gameAssetSpec }).strict();
const assetInspectionBinding={requestId:identifier,projectId:identifier,revision:z.number().int().positive(),requestHash:z.string().regex(/^[a-f0-9]{64}$/)};
export const gameAssetRequestInspection=z.discriminatedUnion('state',[
  z.object({...assetInspectionBinding,state:z.literal('missing')}).strict(),
  z.object({...assetInspectionBinding,state:z.literal('acknowledged'),jobId:identifier}).strict(),
]);
export const gameAssetApplyRequest = z.object({ requestId: identifier, jobId: identifier, expectedRevision: z.number().int().positive() }).strict();
export const gameAssetResult = z.object({ jobId: identifier, projectId: identifier, revision: z.number().int().positive(), sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  processorId: identifier, toolchain: gameToolchain, recipeHash: z.string().regex(/^[a-f0-9]{64}$/), spec: gameAssetSpec,
  sourceAssets: z.array(z.object({ id: identifier, hash: z.string().regex(/^[a-f0-9]{64}$/) }).strict()).max(256),
  previousTargetHash: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  asset: gameAsset, files: z.array(gameFile).min(1).max(18), info: z.record(z.string().max(100), z.union([z.string().max(1000), z.number().finite(), z.boolean()])).refine((value) => Object.keys(value).length <= 64),
  createdAt: z.number().int().nonnegative(),
}).strict().superRefine((result, context) => {
  const conflict = gameFileTreeConflict(result.files.map((file) => file.path));
  if (conflict) context.addIssue({ code: "custom", message: conflict.message });
});
export type GameAssetResult = z.infer<typeof gameAssetResult>;
export function assetSources(operation: GameAssetOperation): z.infer<typeof gameAssetSource>[] {
  return operation.type === "audio.encode" ? [operation.source] : operation.type === "model.scene" ? modelSources(operation) : operation.type === "image.vector"||operation.type === "library.copy" ? [] : operation.type === "image.compose" ? operation.layers.map((layer) => layer.source) : operation.type === "image.atlas" ? operation.frames.map((frame) => frame.source) : operation.clips.map((clip) => clip.source);
}
export function assetOutputPaths(operation:GameAssetOperation):string[]{return operation.type==="audio.encode"?audioEncodePaths(operation):operation.type==="library.copy"?[...operation.selection.entry.files.map(file=>`${operation.outputBase}/${file.path}`),`${operation.outputBase}/LIBRARY.json`]:operation.type==="image.vector"?[operation.output,vectorRecipePath(operation.output)]:operation.type==="model.scene"?[".glb",".blend",".preview.png",".model.json"].map((suffix)=>operation.outputBase+suffix):
  operation.type==="image.atlas"?[`${operation.outputBase}.atlas.json`,...Array.from({length:operation.maxPages},(_value,index)=>`${operation.outputBase}-page-${String(index).padStart(2,"0")}.png`)]:operation.type==="audio.render"&&operation.waveformBins!==undefined?[operation.output,audioAnalysisPath(operation.output)]:[operation.output];}
export function assetFingerprint(document: GameDocument, assetId: string): string | null {
  const asset = document.assets.find((item) => item.id === assetId);
  return asset ? contentHash({ asset, files: asset.files.map((name) => { const file = document.files.find((item) => item.path === name); if (!file) throw new Error("Asset references a missing source file."); const { transferId: _id, ...metadata } = file; return metadata; }) }) : null;
}

/** Domain validation shared by the service and bounded workers; never host paths. */
export class AssetSourceError extends Error {
  constructor(readonly kind: "invalid" | "missing" | "conflict", message: string) { super(message); }
}
export function assetSourceInputs(document: GameDocument, spec: GameAssetSpec): {
  files: GameFile[]; assets: { id: string; hash: string }[];
} {
  const ids=[...new Set(assetSources(spec.operation).map(source=>source.assetId))];
  if(ids.length>100||ids.includes(spec.target.id))throw new AssetSourceError("invalid","Use up to 100 distinct source assets and a different target asset identity; do not create provenance cycles.");
  const files=new Map<string,GameFile>();let bytes=0;
  for(const source of assetSources(spec.operation)) {
    const asset=document.assets.find(item=>item.id===source.assetId),file=document.files.find(item=>item.path===source.path);
    if(!asset||!asset.files.includes(source.path)||!file)throw new AssetSourceError("missing","Source file must belong to the selected asset in this exact project revision.");
    const valid=spec.operation.type==="model.scene"?(source.path.endsWith(".glb")?asset.kind==="model":["image","sprite","atlas","material"].includes(asset.kind)):
      (spec.operation.type==="audio.render"||spec.operation.type==="audio.encode")?asset.kind==="audio":["image","sprite","atlas"].includes(asset.kind);
    if(spec.operation.type==="audio.encode"&&file.mime!=="audio/wav")throw new AssetSourceError("invalid","Audio encoding requires a registered WAV file.");
    if(!valid)throw new AssetSourceError("invalid","Source asset kind does not match this media operation.");
    if(!files.has(file.path)){files.set(file.path,file);bytes+=file.size;}
  }
  if(bytes>64*1024*1024)throw new AssetSourceError("invalid","Source media working set exceeds 64 MiB; originals were preserved.");
  const pending=[...ids],seen=new Set<string>();
  while(pending.length){const id=pending.pop()!;if(id===spec.target.id)throw new AssetSourceError("conflict","Replacing this asset would create a provenance cycle.");if(seen.has(id))continue;seen.add(id);pending.push(...(document.assets.find(item=>item.id===id)?.origin.referenceIds??[]));}
  return {files:[...files.values()],assets:ids.map(id=>({id,hash:assetFingerprint(document,id)!}))};
}
