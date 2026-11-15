import { z } from "zod";

const utf8 = new TextEncoder();
const literal = z.string().max(64 * 1024).refine(value => !/[\uD800-\uDFFF]/u.test(value) && !value.includes("\0"), "Edits require well-formed text without NUL.");
/** Literal, sequential edits, never regex, script or a filesystem patch. */
export const gameTextEdits = z.array(z.object({
  before: literal.min(1, "A nonempty exact match is required."),
  after: literal,
}).strict()).min(1).max(32).refine(edits => utf8.encode(JSON.stringify(edits)).byteLength <= 256 * 1024, "The complete edits exceed 256 KiB.");
export type GameTextEdits = z.infer<typeof gameTextEdits>;
export const MAX_GAME_EDIT_TEXT_BYTES = 8 * 1024 * 1024;
