import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {gameAgentSchemas} from '../packages/contracts/src/game-agent';
import {gameSourceTextPage,MAX_GAME_SOURCE_VIEW_BYTES} from '../packages/contracts/src/game-source-views';
import {readGameSourceText,GameSourceViewError} from '../packages/game-production/src/source-views';
import {gameAgentDefinition} from '../packages/agent-service/src/game-agent-tools';
import type {GameFile} from '../packages/contracts/src/games';

const fileFor=(data:Uint8Array):GameFile=>({path:'src/main.ts',size:data.length,sha256:createHash('sha256').update(data).digest('hex'),mime:'text/javascript',transferId:'synthetic-blob'});
test('source page contract requires exact file identity and bounded byte cursors without granting writes',()=>{
  const request={projectId:'fixture',path:'src/main.ts',textPage:{revision:3,sha256:'a'.repeat(64)}};
  const parsed=gameAgentSchemas.game_read_file.parse(request);
  assert.deepEqual(parsed.textPage,{...request.textPage,cursor:0,limit:8192});
  for(const textPage of [
    {sha256:'a'.repeat(64)},{revision:3},{revision:3,sha256:'a'.repeat(64),cursor:-1},
    {...request.textPage,limit:255},{...request.textPage,limit:16385},
    {...request.textPage,cursor:MAX_GAME_SOURCE_VIEW_BYTES+1},{...request.textPage,hostPath:'/private/file'},
  ])assert.equal(gameAgentSchemas.game_read_file.safeParse({...request,textPage}).success,false);
  assert.equal(gameAgentDefinition('game_read_file')!.effect,'read');
  assert.deepEqual(gameAgentSchemas.game_read_file.parse({projectId:'fixture',path:'src/main.ts'}),{projectId:'fixture',path:'src/main.ts'},'Omission preserves legacy arguments');
});

test('source pages reconstruct exact Unicode/BOM/CRLF bytes and refuse corrupt, binary and split-cursor content',()=>{
  const text='\ufeff'+'🛶 ação\r\n'.repeat(500),data=Buffer.from(text),file=fileFor(data);
  let cursor=0,result='';
  while(cursor<data.length){const page=readGameSourceText(file,data,{revision:2,sha256:file.sha256,cursor,limit:257});assert.equal(page.offset,cursor);assert.ok(page.cursor>cursor);assert.ok(Buffer.byteLength(page.content)<=257);result+=page.content;cursor=page.cursor;}
  assert.equal(result,text);assert.equal(createHash('sha256').update(result).digest('hex'),file.sha256);
  assert.equal(readGameSourceText(file,data,{revision:2,sha256:file.sha256,cursor:data.length,limit:256}).hasMore,false);
  const page={revision:2,sha256:file.sha256,cursor:0,limit:256};
  for(const run of [
    ()=>readGameSourceText(file,data,{...page,cursor:1}),
    ()=>readGameSourceText(file,data,{...page,cursor:data.length+1}),
    ()=>readGameSourceText(file,data,{...page,sha256:'0'.repeat(64)}),
    ()=>readGameSourceText(file,Buffer.from(data).fill(65,10,11),page),
    ()=>readGameSourceText(file,data.subarray(1),page),
    ...[Buffer.from([255,254]),Buffer.from('PRIVATE_CONTENT\0')].map(bytes=>()=>{const f=fileFor(bytes);return readGameSourceText(f,bytes,{...page,sha256:f.sha256});}),
  ])assert.throws(run,error=>error instanceof GameSourceViewError&&!error.message.includes('PRIVATE_CONTENT'));
  assert.equal(data.toString(),text,'Rejected reads do not change original bytes');
});

test('source text view accepts the full edit limit and preserves oversized files for SDK transfer',()=>{
  const data=Buffer.alloc(MAX_GAME_SOURCE_VIEW_BYTES,65),file=fileFor(data),page=gameSourceTextPage.parse({revision:1,sha256:file.sha256,cursor:data.length-1024});
  const last=readGameSourceText(file,data,page);assert.equal(last.content,'A'.repeat(1024));assert.equal(last.hasMore,false);
  assert.throws(()=>readGameSourceText({...file,size:file.size+1},data,page),/complete original bytes/);
});
