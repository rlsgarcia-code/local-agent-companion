import { gameTextEdits, MAX_GAME_EDIT_TEXT_BYTES } from "../../contracts/src/game-text-edits";

export class GameTextEditError extends Error {}
const utf8 = new TextEncoder();
/** Pure transformation; decoding, hashes, authority and persistence belong to
 * the service. Never executes the supplied text. */
export function applyGameTextEdits(source: string, input: unknown): string {
  const edits = gameTextEdits.parse(input);
  if (/[\uD800-\uDFFF]/u.test(source) || source.includes("\0")) throw new GameTextEditError("The source is not supported text; its bytes were preserved.");
  if (utf8.encode(source).byteLength > MAX_GAME_EDIT_TEXT_BYTES) throw new GameTextEditError("The text exceeds the 8 MiB editing limit; use the SDK to preserve and edit the complete file.");
  let result = source;
  for (const [index, edit] of edits.entries()) {
    if (edit.before === edit.after) throw new GameTextEditError(`Edit ${index + 1} does not change text.`);
    const position = result.indexOf(edit.before);
    if (position < 0) throw new GameTextEditError(`Edit ${index + 1} has no exact match; read the current file.`);
    if (result.indexOf(edit.before, position + 1) >= 0) throw new GameTextEditError(`Edit ${index + 1} is ambiguous; include enough unchanged context for a unique match.`);
    result = result.slice(0, position) + edit.after + result.slice(position + edit.before.length);
    if (utf8.encode(result).byteLength > MAX_GAME_EDIT_TEXT_BYTES) throw new GameTextEditError(`Edit ${index + 1} exceeds the 8 MiB result limit; no edits were committed.`);
  }
  if (result === source) throw new GameTextEditError("The edits cancel one another; no revision was created.");
  return result;
}
