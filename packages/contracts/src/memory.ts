import { z } from "zod";
import { identifier } from "./schema";

export const memoryRead = z.object({ key: identifier }).strict();
export const memoryWrite = z.object({ key: identifier, requestId: identifier,
  revision: z.number().int().nonnegative(), content: z.string().max(2_000_000),
}).strict();
export type MemoryEntry = { key: string; revision: number; content: string; updatedAt: number };
