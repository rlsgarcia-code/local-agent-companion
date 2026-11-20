import { z } from "zod";

/** Terminal model transport diagnostic. Never contains provider text, URLs,
 * prompts, headers or raw errors. Session/run correlation belongs to the event. */
export const modelFailure = z.object({
  category: z.enum([
    "response_inactivity", "response_headers_timeout", "request_timeout",
    "connection_interrupted", "connection_failed", "response_interrupted",
  ]),
  code: z.enum([
    "UND_ERR_BODY_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_SOCKET",
    "ECONNRESET", "EPIPE", "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN",
  ]).optional(),
}).strict();
export type ModelFailure = z.infer<typeof modelFailure>;
