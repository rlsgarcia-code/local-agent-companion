/** Fixed Core broker ABI, consumed only by the installed KidOS adapter. */
import { z } from "zod";
import { identifier } from "./schema";
import { gameToolchain } from "./game-production";
import { gameWebCompileResult } from "./game-web-compiler";
import { gameStages } from "./game-workflow";

const sha=z.string().regex(/^[a-f0-9]{64}$/),buildId=z.string().regex(/^[a-f0-9]{32}$/);
export const coreBuildReceipt=z.object({
  build_id:buildId,request_id:identifier,input_binding:sha,
  state:z.enum(["uploading","prepared","reserving","admission_unknown","admitting","launching","running","cancelling","awaiting_reconciliation","completed","failed","cancelled"]),
  created:z.number().int().nonnegative(),updated:z.number().int().nonnegative(),cancel_requested:z.boolean(),
  error:z.string().max(300).nullable(),historical:z.literal(true),
  production:z.object({ref:buildId,project_id:identifier,stage:z.enum(gameStages)}).strict().optional(),
  admitted:z.boolean().optional(),
}).strict();
export const coreProductionPolicy=z.object({day:z.string(),starts:z.number().int().nonnegative(),reserved_bytes:z.number().int().nonnegative(),daily_starts:z.number().int().positive(),daily_reserved_bytes:z.number().int().positive(),allowed:z.boolean(),require_project:z.boolean().optional(),require_queue:z.boolean().optional(),production_kinds:z.array(z.enum(["build","assets","validate"])).max(3).optional()}).strict();
export const coreBuildCapabilities=z.discriminatedUnion("available",[
  z.object({available:z.literal(false),reason:z.string().min(1).max(4000)}).strict(),
  z.object({available:z.literal(true),broker_abi:z.literal(1),project_budget_abi:z.literal(1).optional(),queue_budget_abi:z.literal(1).optional(),engines:z.array(z.object({engine:z.enum(["phaser","babylon"]),toolchain:gameToolchain}).strict()).max(2),
    admission:coreProductionPolicy,
    chunk_bytes:z.literal(262144),request_bytes:z.literal(16777216),source_bytes:z.literal(268435456)}).strict(),
]);
export const coreBuildProgress=z.object({
  blobs:z.array(z.object({key:z.union([z.literal("request"),sha]),size:z.number().int().min(0).max(268435456),sha256:sha,
    received:z.number().int().min(0).max(268435456),sealed:z.union([z.literal(0),z.literal(1)])}).strict()).max(100),
  cursor:z.number().int().min(0).max(20001),has_more:z.boolean(),
}).strict();
export const coreBuildPage=z.object({...gameWebCompileResult.shape,
  files:z.array(gameWebCompileResult.shape.files.element).max(100),cursor:z.number().int().min(0).max(20000),has_more:z.boolean()}).strict();
export const coreBuildChunk=z.object({offset:z.number().int().nonnegative().max(268435456),data:z.string().max(349528),sha256:sha,
  size:z.number().int().min(0).max(268435456),eof:z.boolean()}).strict();
export const coreBuildReply=z.discriminatedUnion("ok",[
  z.object({kind:z.literal("kidos-production-result"),operation:z.string().max(50),ok:z.literal(true),result:z.unknown()}).strict(),
  z.object({kind:z.literal("kidos-production-result"),operation:z.string().max(50),ok:z.literal(false),error:z.object({code:z.string().min(1).max(100),message:z.string().max(4000),status:z.number().int().min(400).max(599)}).strict()}).strict(),
]);
export const installedCoreGameBuildSchemas={receipt:coreBuildReceipt,capabilities:coreBuildCapabilities,progress:coreBuildProgress,page:coreBuildPage,chunk:coreBuildChunk,reply:coreBuildReply};
