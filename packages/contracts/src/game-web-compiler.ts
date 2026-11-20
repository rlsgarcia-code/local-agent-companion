import { z } from "zod";
import { identifier } from "./schema";
import { gameDocument, gameFilePath, gameFileTreeConflict } from "./games";
import { gameToolchain } from "./game-production";

/** Explicit static-resource selection. Omission preserves the legacy inventory.
 * Code imports and pinned runtime/notices remain compiler-owned. */
export const gameWebDelivery = z.object({
  schemaVersion: z.literal(1),
  files: z.array(gameFilePath.refine(name =>
    (name.startsWith("assets/") || name.startsWith("data/")) && !/\.blend[0-9]*$/i.test(name),
  "Delivery resources must be assets/ or data/ files, excluding editable Blender sources.")).max(20000),
}).strict().superRefine((value, context) => {
  const conflict = gameFileTreeConflict(value.files);
  if (conflict) context.addIssue({code:"custom",path:["files",conflict.index],message:conflict.message});
});
export const gameWebProjectConfig = z.object({
  schemaVersion:z.literal(1), entry:gameFilePath, engineVersion:z.string().min(1).max(100),
  delivery:gameWebDelivery.optional(),
}).strict();

/** Private compiler exchange. Not an Agent RPC, host path or authority grant. */
export const gameWebCompileRequest = z.object({
  schemaVersion: z.literal(1), requestId: identifier,
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/), toolchain: gameToolchain,
  document: gameDocument,
}).strict().superRefine((value, context) => {
  if (!["phaser", "babylon"].includes(value.document.engine))
    context.addIssue({code:"custom",path:["document","engine"],message:"The offline web compiler handles Phaser and Babylon only."});
  if (value.document.files.reduce((total, file) => total + file.size, 0) > 256 * 1024 * 1024)
    context.addIssue({code:"custom",path:["document","files"],message:"Source payload exceeds the compiler budget."});
});
export type GameWebCompileRequest = z.infer<typeof gameWebCompileRequest>;

export const gameWebCompileResult = z.object({
  schemaVersion: z.literal(1), requestId: identifier, sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  toolchain: gameToolchain, entrypoint: gameFilePath,
  files: z.array(z.object({path:gameFilePath,mime:z.string().min(1).max(128),
    size:z.number().int().nonnegative().max(256 * 1024 * 1024),sha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict()).min(1).max(20000),
}).strict().superRefine((value, context) => {
  const conflict = gameFileTreeConflict(value.files.map(file=>file.path));
  if(conflict) context.addIssue({code:"custom",path:["files",conflict.index,"path"],message:conflict.message});
  if(!value.files.some(file=>file.path===value.entrypoint&&file.mime==="text/html"))
    context.addIssue({code:"custom",path:["entrypoint"],message:"The compiler result requires its packaged HTML entrypoint."});
  if(value.files.reduce((total,file)=>total+file.size,0)>256*1024*1024)
    context.addIssue({code:"custom",path:["files"],message:"Output payload exceeds the compiler budget."});
});
export type GameWebCompileResult = z.infer<typeof gameWebCompileResult>;
