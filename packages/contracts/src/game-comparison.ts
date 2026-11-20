import {z} from "zod";
import {identifier} from "./schema";
import {gameFilePath} from "./games";

const hash=z.string().regex(/^[a-f0-9]{64}$/),count=z.number().int().nonnegative();
export const gameComparisonSection=z.enum(["overview","design","files","assets","legacy"]);
export const gameRevisionCompare=z.object({projectId:identifier,baseRevision:z.number().int().positive(),targetRevision:z.number().int().positive(),
  section:z.enum(["all",...gameComparisonSection.options]).default("all"),cursor:count.default(0),limit:z.number().int().min(1).max(100).default(30),
}).strict();
export type GameRevisionCompare=z.infer<typeof gameRevisionCompare>;
export const gameComparisonValue=z.discriminatedUnion("kind",[
  z.object({kind:z.literal("absent")}).strict(),z.object({kind:z.literal("null")}).strict(),
  z.object({kind:z.literal("string"),value:z.string().max(4000)}).strict(),
  z.object({kind:z.literal("number"),value:z.number().finite()}).strict(),
  z.object({kind:z.literal("boolean"),value:z.boolean()}).strict(),
  z.object({kind:z.enum(["object","array"]),count}).strict(),
  z.object({kind:z.literal("file"),path:gameFilePath,sha256:hash,size:count,mime:z.string().max(128)}).strict(),
  // Legacy metadata may be arbitrarily large. Summarize it explicitly without
  // returning a truncated value or altering the original domain export.
  z.object({kind:z.literal("opaque"),sha256:hash,bytes:count}).strict(),
]);
export type GameComparisonValue=z.infer<typeof gameComparisonValue>;
export const gameComparisonChange=z.object({section:gameComparisonSection,path:z.array(z.string().max(400)).max(32),
  change:z.enum(["added","removed","modified","moved"]),before:gameComparisonValue,after:gameComparisonValue,
}).strict();
export type GameComparisonChange=z.infer<typeof gameComparisonChange>;
const revision=z.object({revision:z.number().int().positive(),contentHash:hash,createdAt:count}).strict();
export const gameRevisionComparison=z.object({projectId:identifier,base:revision,target:revision,sourceEqual:z.boolean(),
  counts:z.object({overview:count,design:count,files:count,assets:count,legacy:count,total:count}).strict(),
  section:gameRevisionCompare.shape.section,changes:z.array(gameComparisonChange).max(100),cursor:count,hasMore:z.boolean(),
}).strict();
export type GameRevisionComparison=z.infer<typeof gameRevisionComparison>;
