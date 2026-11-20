/** Private Core media protocol. No client-supplied port, UID, command or outcome. */
import { z } from "zod";
import { gameToolchain } from "./game-production";
import { gameMediaProcessResult } from "./game-media-worker";
import { coreBuildReceipt,coreBuildProgress,coreBuildChunk,coreBuildReply,coreProductionPolicy } from "./kidos-game-builds";

export const coreMediaReceipt=coreBuildReceipt.extend({production_kind:z.literal("assets"),admitted:z.boolean()});
export const coreMediaCapabilities=z.discriminatedUnion("available",[
  z.object({available:z.literal(false),reason:z.string().min(1).max(4000)}).strict(),
  z.object({available:z.literal(true),media_abi:z.literal(1),queue_budget_abi:z.literal(1),processor_id:z.literal("kidos-core-media-v1"),
    operations:z.array(z.enum(["image.compose","image.atlas","audio.render"])).min(1).max(3),toolchain:gameToolchain,admission:coreProductionPolicy,
    chunk_bytes:z.literal(262144),request_bytes:z.literal(16777216),source_bytes:z.literal(67108864),result_bytes:z.literal(134217728)}).strict(),
]);
export const coreMediaPage=z.object({...gameMediaProcessResult.shape,files:gameMediaProcessResult.shape.files.max(17),
  cursor:z.number().int().min(0).max(17),has_more:z.boolean()}).strict();
export const installedCoreGameMediaSchemas={receipt:coreMediaReceipt,capabilities:coreMediaCapabilities,page:coreMediaPage,progress:coreBuildProgress,chunk:coreBuildChunk,reply:coreBuildReply};
