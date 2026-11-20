import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';

test('bundled Standard/Deep classify the real SDK deadline after LangChain transformation, retain unknown usage and never redispatch on replay',{timeout:45_000},async()=>{
 const cache=path.resolve('.cache');await mkdir(cache,{recursive:true});const directory=await mkdtemp(path.join(cache,'model-timeout-bundle-test-'));let passed=false;
 try{
  const bundle=path.join(directory,'fixture.cjs');
  await build({entryPoints:['test/model-timeout-bundle-fixture.ts'],outfile:bundle,bundle:true,platform:'node',format:'cjs',target:'node22',external:['better-sqlite3','esbuild','playwright-core'],logLevel:'silent'});
  for(const runtime of ['standard','deep']){
   const output=await promisify(execFile)(process.execPath,[bundle,runtime],{timeout:15_000,maxBuffer:128*1024});const line=output.stdout.split('\n').find(line=>line.startsWith('{"marker":"BUNDLED_MODEL_DEADLINE"'));assert.ok(line);
   const result=JSON.parse(line);assert.equal(result.baseline,false);assert.equal(result.runtime,runtime);assert.deepEqual(result.observed,[{constructorName:'Error',name:'TimeoutError',officialTimeout:false}]);assert.deepEqual(result.diagnostics,[{category:'request_timeout'}]);assert.equal(result.requests,1);assert.equal(result.toolsExecuted,0);assert.equal(result.unknownUsageReservationPreserved,true);assert.equal(result.replayWithoutRedispatch,true);assert.equal(result.persistedAfterReopen,true);
  }
  passed=true;
 }finally{if(passed)await rm(directory,{recursive:true,force:true});else console.error(`Original bundled timeout fixture preserved: ${directory}`);}
});
