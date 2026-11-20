/** Private installed-adapter ABI. Never an enrollment or provider-selection RPC. */
import { z } from "zod";
import { identifier } from "./schema";
import { gameStages } from "./game-workflow";

const sha=z.string().regex(/^[a-f0-9]{64}$/);
const tokens=z.number().int().min(0).max(1_000_000_000_000);
export const coreInferenceReceipt=z.object({
  request_id:identifier,binding:sha,request_sha256:sha.nullable(),
  role:z.enum(["executor","planner","evaluator","advisor","vision","embedding"]),
  day:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),created:z.number().finite().nonnegative(),
  state:z.enum(["pending","completed","failed","unknown"]),charged_tokens:tokens.max(2_000_000_000_000),
  input_tokens:tokens.nullable(),output_tokens:tokens.nullable(),fresh:z.boolean(),
  production:z.object({ref:z.string().regex(/^[a-f0-9]{32}$/),stage:z.enum(gameStages)}).strict().optional(),
}).strict();
export const coreInferenceEvent=z.discriminatedUnion("type",[
  z.object({type:z.literal("admission"),receipt:coreInferenceReceipt}).strict(),
  z.object({type:z.literal("settlement"),receipt:coreInferenceReceipt}).strict(),
  z.object({type:z.literal("token"),text:z.string().max(1_000_000)}).strict(),
  z.object({type:z.literal("tool_call"),id:z.string().regex(/^[A-Za-z0-9_.:-]{1,160}$/),name:z.string().regex(/^[A-Za-z_][A-Za-z0-9_-]{0,63}$/),arguments:z.record(z.string(),z.unknown())}).strict(),
  z.object({type:z.literal("done")}).strict(),
  z.object({type:z.literal("error"),code:z.string().min(1).max(100),message:z.string().max(300)}).strict(),
]);
