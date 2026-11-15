import { z } from "zod";

/** Host/user declarations for one exact gateway alias; never a tool grant or probe result. */
export const modelCapabilityDeclaration = z.object({
  functionCalling: z.boolean(),
  vision: z.boolean(),
  jsonMode: z.boolean(),
  toolChoice: z.boolean(),
  parallelCalls: z.boolean(),
  promptCaching: z.boolean(),
  reasoning: z.boolean(),
  pdfInput: z.boolean(),
}).strict();

export type ModelCapabilityDeclaration = z.infer<typeof modelCapabilityDeclaration>;

export const modelCapabilityDeclarations = z.record(
  z.string().trim().min(1).max(200).refine(alias => !["__proto__", "constructor", "prototype"].includes(alias)),
  modelCapabilityDeclaration,
).refine(value => Object.keys(value).length <= 500, "Too many model capability declarations.");
