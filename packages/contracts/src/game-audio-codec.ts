import {z} from "zod";
import {identifier} from "./schema";
import {gameFilePath} from "./games";
const variantId=z.string().regex(/^[a-z][a-z0-9_-]{0,23}$/);
const bitrate=z.union([z.literal(64),z.literal(96),z.literal(128),z.literal(192)]);
export const gameAudioEncodeOperation=z.object({
  type:z.literal("audio.encode"),codec:z.literal("aac-lc"),
  source:z.object({assetId:identifier,path:gameFilePath.refine(value=>value.endsWith(".wav"))}).strict(),
  outputBase:gameFilePath.refine(value=>value.startsWith("assets/")&&value.split("/").at(-1)!.length<=200),
  variants:z.array(z.object({id:variantId,bitrateKbps:bitrate}).strict()).min(1).max(3),
}).strict().superRefine((value,context)=>{
  if(new Set(value.variants.map(item=>item.id)).size!==value.variants.length)context.addIssue({code:"custom",message:"Audio variant identities must be unique."});
  if(audioEncodePaths(value).some(name=>!gameFilePath.safeParse(name).success))context.addIssue({code:"custom",message:"Encoded audio paths must fit portable file limits."});
});
export type GameAudioEncodeOperation=z.infer<typeof gameAudioEncodeOperation>;
export const audioEncodePaths=(operation:{outputBase:string;variants:{id:string}[]})=>[...operation.variants.map(item=>`${operation.outputBase}.${item.id}.m4a`),`${operation.outputBase}.encoded.json`];
export const gameAudioEncodeReport=z.object({schemaVersion:z.literal(1),codec:z.literal("aac-lc"),container:z.literal("mp4"),sourceSha256:z.string().regex(/^[a-f0-9]{64}$/),
  sampleRate:z.union([z.literal(22050),z.literal(44100),z.literal(48000)]),channels:z.union([z.literal(1),z.literal(2)]),sourceFrames:z.number().int().positive().max(180*48000),
  variants:z.array(z.object({id:variantId,bitrateKbps:bitrate,path:gameFilePath,size:z.number().int().positive().max(8*1024*1024),sha256:z.string().regex(/^[a-f0-9]{64}$/),decodedFrames:z.number().int().positive().max(180*48000+2048),rmse:z.number().finite().min(0).max(2),snrDb:z.number().finite().nullable()}).strict()).min(1).max(3),
}).strict().superRefine((value,context)=>{if(value.sourceFrames>value.sampleRate*180||value.variants.some(item=>Math.abs(item.decodedFrames-value.sourceFrames)>2048))context.addIssue({code:"custom",message:"Encoded audio must retain its bounded source dimensions."});});
export type GameAudioEncodeReport=z.infer<typeof gameAudioEncodeReport>;
