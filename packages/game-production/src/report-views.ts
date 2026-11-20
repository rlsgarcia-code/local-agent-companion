import {readUtf8TextPage,GameTextPageError} from './text-pages';
export const MAX_REPORT_TEXT_BYTES = 8 * 1024 * 1024;
export class GameReportViewError extends Error {}
const utf8 = new TextEncoder();

/** Preserve complete records while fitting the tool projection's byte budget.
 * The cursor advances by records actually returned, never by requested limit. */
export function gameReportPage<T>(items: readonly T[], cursor: number, limit: number) {
  const page: T[] = [];let bytes = 0;
  for (const item of items.slice(cursor, cursor + limit)) {
    const size = utf8.encode(JSON.stringify(item)).byteLength + 1;
    if (size > 64 * 1024) throw new GameReportViewError("A report record exceeds the tool view; download the complete report through the SDK.");
    if (bytes + size > 64 * 1024) break;
    bytes += size;page.push(item);
  }
  const next = cursor + page.length;
  return { items: page, cursor: next, hasMore: next < items.length, total: items.length };
}

/** Byte-addressed UTF-8 evidence, without parsing or executing its contents. */
export function readGameReportText(data: Uint8Array, cursor: number, limit: number) {
  try{return readUtf8TextPage(data,cursor,limit,MAX_REPORT_TEXT_BYTES);}
  catch(error){if(error instanceof GameTextPageError)throw new GameReportViewError(error.message.replaceAll('text','evidence').replace('evidence view limit','text view limit'));throw error;}
}
