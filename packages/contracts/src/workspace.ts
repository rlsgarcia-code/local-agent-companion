import { z } from "zod";
export const workspaceOptions = z.object({
  threadId: z.string().min(1).max(128),
  responseLanguage: z.enum(["pt-BR", "en"]).default("pt-BR"),
  maxConversationCharacters: z.number().int().min(8000).max(500000).default(48000),
  finalReview: z.enum(["off", "changes", "always"]).default("changes"),
  assistantMessageId: z.string().min(1).max(128),
  memoryText: z.string().max(200000).default(""),
  semanticMemory: z.object({model:z.string().max(200),endpoint:z.string().url().optional(),results:z.number().int().min(1).max(12).default(5)}).strict().optional(),
}).strict();
