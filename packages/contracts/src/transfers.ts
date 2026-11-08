import { z } from "zod";
import { identifier } from "./schema";

export const TRANSFER_CHUNK_BYTES = 512 * 1024;
export const MAX_TRANSFER_BYTES = 256 * 1024 * 1024;
export const transferBegin = z.object({
  key: identifier,
  size: z.number().int().nonnegative().max(MAX_TRANSFER_BYTES),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  mime: z.enum(["application/json", "image/png", "image/jpeg", "image/webp", "image/gif", "text/plain", "application/octet-stream"]),
}).strict();
export const transferAppend = z.object({
  id: identifier,
  offset: z.number().int().nonnegative(),
  data: z.string().max(Math.ceil(TRANSFER_CHUNK_BYTES / 3) * 4).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
}).strict();
export type Transfer = z.infer<typeof transferBegin> & {
  id: string;
  received: number;
  committed: boolean;
};
export const sessionImport = z.union([
  z.object({ key: identifier, domain: z.unknown() }).strict(),
  z.object({ key: identifier, transferId: identifier }).strict(),
]);
