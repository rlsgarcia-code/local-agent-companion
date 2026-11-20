import {createHash} from 'node:crypto';
import type {GameFile} from '../../contracts/src/games';
import {MAX_GAME_SOURCE_VIEW_BYTES,type GameSourceTextPage} from '../../contracts/src/game-source-views';
import {readUtf8TextPage,GameTextPageError} from './text-pages';

export class GameSourceViewError extends Error {}
/** Verify the immutable blob before decoding. Pages never normalize source. */
export function readGameSourceText(file:GameFile,data:Uint8Array,page:GameSourceTextPage){
  if(file.size>MAX_GAME_SOURCE_VIEW_BYTES)throw new GameSourceViewError('Source exceeds the text view limit; download its complete original bytes through the SDK.');
  if(page.sha256!==file.sha256||data.length!==file.size||createHash('sha256').update(data).digest('hex')!==file.sha256)
    throw new GameSourceViewError('Source bytes do not match the exact file size and SHA-256.');
  if(data.includes(0))throw new GameSourceViewError('Source contains NUL bytes; use the authenticated SDK for its original bytes.');
  try{return readUtf8TextPage(data,page.cursor,page.limit,MAX_GAME_SOURCE_VIEW_BYTES);}
  catch(error){if(error instanceof GameTextPageError)throw new GameSourceViewError(error.message.replaceAll('text','source'));throw error;}
}
