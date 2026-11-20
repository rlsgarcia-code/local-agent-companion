import {z} from 'zod';
import type {GameFile} from './games';

export const MAX_GAME_SOURCE_VIEW_BYTES=8*1024*1024;
export const gameSourceTextPage=z.object({
  revision:z.number().int().positive(),
  sha256:z.string().regex(/^[a-f0-9]{64}$/),
  cursor:z.number().int().min(0).max(MAX_GAME_SOURCE_VIEW_BYTES).default(0),
  limit:z.number().int().min(256).max(16384).default(8192),
}).strict().describe('Read a UTF-8 byte page pinned to the exact project revision and file SHA-256. Get both from game_project. Follow the returned cursor, never guess a character offset.');
export type GameSourceTextPage=z.infer<typeof gameSourceTextPage>;
export type GameSourcePageResult={
  kind:'text-source-page';projectId:string;revision:number;sourceHash:string;file:GameFile;
  encoding:'utf-8';content:string;offset:number;cursor:number;hasMore:boolean;totalBytes:number;
};
