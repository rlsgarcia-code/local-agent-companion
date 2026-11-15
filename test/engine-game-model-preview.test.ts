import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {mkdtemp,mkdir,cp,rm,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {PNG} from 'pngjs';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {prepareGameModelPreview,openGameModelPreview} from '../packages/adapter-game-browser/src/model-preview';
import {qualifyBrowser} from '../packages/adapter-game-browser/src/browser';
import {modelPreviewFixture} from './game-model-preview-fixtures';
import {hasRenderedPixels} from '../packages/adapter-game-browser/src/pixels';
const runtimeDirectory=path.resolve('packages/adapter-game-web/runtimes');

async function preserveViewerEvidence(directory:string,f:Awaited<ReturnType<typeof modelPreviewFixture>>){
  const source='packages/adapter-game-browser/src/model-viewer-source.ts',bytes=await readFile(source),sha=(data:Uint8Array)=>createHash('sha256').update(data).digest('hex');
  await writeFile(path.join(directory,'viewer-source.ts'),bytes);
  await writeFile(path.join(directory,'candidate.json'),JSON.stringify(f.result,null,2));
  const files=[];
  for(const file of f.result.files){const data=await f.readFile(file.path);assert.equal(data.length,file.size);assert.equal(sha(data),file.sha256);const target=path.join(directory,'candidate',file.path);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,data);files.push({path:file.path,sha256:file.sha256,size:file.size});}
  await writeFile(path.join(directory,'binding.json'),JSON.stringify({viewerSource:{path:source,sha256:sha(bytes)},modelPath:f.modelPath,jobId:f.result.jobId,projectId:f.result.projectId,revision:f.result.revision,files,runtimeLockSha256:sha(await readFile('packages/adapter-game-web/runtime.lock.json')),scope:'Real offline catalog candidate and disposable Chromium; no installed/physical/human/artistic acceptance'},null,2));
}

test('model viewer inventory uses original acknowledged GLB, grouped texture and pinned code/licenses only',async()=>{
  const f=await modelPreviewFixture();try{
    const prepared=await prepareGameModelPreview({...f,runtimeDirectory,signal:new AbortController().signal});
    assert.equal(prepared.artifact.entrypoint,'viewer/index.html');assert.equal('jobId' in prepared.artifact,false,'a viewer is not a fabricated production artifact');
    assert.ok(prepared.artifact.files.some(file=>file.path==='model/assets/hero/Textures/colormap.png'));
    assert.ok(prepared.artifact.files.some(file=>file.path==='runtime/BABYLON-LICENSE.md'));
    assert.ok(!prepared.artifact.files.some(file=>file.path.includes('LIBRARY.json')||file.path.endsWith('.blend')));
    assert.deepEqual(await prepared.readFile('model/'+f.modelPath),await f.readFile(f.modelPath));
    const config=JSON.parse((await prepared.readFile('viewer/config.json')).toString());assert.equal(config.placeholder,true);assert.equal(config.revision,1);
    const first=await prepared.readFile('model/'+f.modelPath);first.fill(0);assert.notDeepEqual(await prepared.readFile('model/'+f.modelPath),first,'callers cannot alter the frozen resource map');
    await assert.rejects(prepared.readFile('../../outside'));
    await assert.rejects(prepareGameModelPreview({...f,modelPath:'assets/missing.glb',runtimeDirectory,signal:new AbortController().signal}),/GLB/);
    await assert.rejects(prepareGameModelPreview({...f,readFile:async name=>name===f.modelPath?Buffer.from('altered'):f.readFile(name),runtimeDirectory,signal:new AbortController().signal}),/divergem/);
    const abort=new AbortController();abort.abort();await assert.rejects(prepareGameModelPreview({...f,runtimeDirectory,signal:abort.signal}));
  }finally{await f.close();}
});

test('model viewer refuses external/missing dependencies and changed runtimes without rewriting original model bytes',async()=>{
  const f=await modelPreviewFixture(),directory=await mkdtemp(path.join(tmpdir(),'model-runtime-test-'));
  try{
    const input=Buffer.from(await f.readFile(f.modelPath)),count=input.readUInt32LE(12),original=JSON.parse(input.subarray(20,20+count).toString());
    for(const uri of ['https://example.invalid/image.png','file:///etc/passwd','../absent.png','Textures/%2e%2e/image.png']){
      const document=structuredClone(original);document.images[0].uri=uri;
      const text=Buffer.from(JSON.stringify(document)),json=Buffer.alloc(Math.ceil(text.length/4)*4,32);text.copy(json);
      const suffix=input.subarray(20+count),patched=Buffer.concat([input.subarray(0,12),Buffer.alloc(8),json,suffix]);patched.writeUInt32LE(patched.length,8);patched.writeUInt32LE(json.length,12);patched.writeUInt32LE(0x4e4f534a,16);
      const result=structuredClone(f.result),model=result.files.find(file=>file.path===f.modelPath)!;model.size=patched.length;model.sha256=createHash('sha256').update(patched).digest('hex');
      await assert.rejects(prepareGameModelPreview({...f,result,readFile:async name=>name===f.modelPath?patched:f.readFile(name),runtimeDirectory,signal:new AbortController().signal}),/locais|ausente/);
      assert.deepEqual(await f.readFile(f.modelPath),input);
    }
    await cp(runtimeDirectory,directory,{recursive:true});await writeFile(path.join(directory,'babylon-9.35.0.js'),'changed');
    await assert.rejects(prepareGameModelPreview({...f,runtimeDirectory:directory,signal:new AbortController().signal}),/runtime.*alterado/);
  }finally{await f.close();await rm(directory,{recursive:true,force:true});}
});

test('actual offline model viewer renders textured geometry, selects32 real clips without autoplay and closes on host abort',async t=>{
  if(!await qualifyBrowser()){t.skip('Qualified Chromium browser unavailable');return;}
  const f=await modelPreviewFixture(),abort=new AbortController();let preview:Awaited<ReturnType<typeof openGameModelPreview>>|undefined,hits=0;
  const canary=createServer((_request,response)=>{hits++;response.end('must not be read');});
  try{
    canary.listen(0,'127.0.0.1');await once(canary,'listening');const address=canary.address();assert.ok(address&&typeof address==='object');
    preview=await openGameModelPreview({...f,runtimeDirectory,signal:abort.signal,headless:true});const page=preview.page;
    await page.getByRole('status').filter({hasText:'Modelo carregado'}).waitFor({timeout:20000});
    assert.equal(await page.locator('#clip option').count(),33);assert.equal(await page.locator('#play').isDisabled(),true);
    assert.equal(await page.getByLabel('Posição da animação',{exact:true}).isDisabled(),true);
    const output=path.resolve('output/playwright/game-model-viewer/tests',new Date().toISOString().replace(/[:.]/g,'-'));await mkdir(output,{recursive:true});
    await preserveViewerEvidence(output,f);
    const pixels=await page.locator('canvas').screenshot();await writeFile(path.join(output,'model.png'),pixels);
    const image=PNG.sync.read(pixels);const colors=new Set<string>();for(let i=0;i<image.data.length;i+=16)colors.add(image.data.subarray(i,i+3).toString('hex'));await writeFile(path.join(output,'observation.json'),JSON.stringify({colors:colors.size,errors:preview.errors,blocked:preview.blocked,geometry:await page.locator('#geometry').textContent(),scope:'Authored offline catalog fixture; visibility only, no artistic/game/physical acceptance'},null,2));console.error('MODEL_FIXTURE_PIXEL_SUMMARY',JSON.stringify({width:image.width,height:image.height,colors:colors.size,nonuniform:hasRenderedPixels(pixels)}));assert.ok(hasRenderedPixels(pixels),'actual textured mesh must produce a nonflat rendering; inspect '+output);
    const frames=()=>page.evaluate(()=>new Promise<void>(resolve=>{let count=0;const step=()=>++count===24?resolve():requestAnimationFrame(step);requestAnimationFrame(step);}));
    const clips=await page.locator('#clip option').evaluateAll(options=>options.map(option=>({value:(option as HTMLOptionElement).value,label:option.textContent??''}))),walk=clips.find(clip=>/walk/i.test(clip.label));assert.ok(walk);
    await page.selectOption('#clip',walk.value);assert.equal(await page.locator('#play').textContent(),'Reproduzir');await frames();
    const still=await page.locator('canvas').screenshot();await frames();assert.deepEqual(await page.locator('canvas').screenshot(),still,'selecting a clip cannot start animation');
    const seek=page.getByLabel('Posição da animação',{exact:true}),range=await seek.evaluate(input=>({from:Number((input as HTMLInputElement).min),to:Number((input as HTMLInputElement).max)}));assert.ok(range.to>range.from);
    assert.equal(await page.getByRole('button',{name:'Quadro anterior',exact:true}).isDisabled(),true);
    // Real range pointer input chooses an actual pose; PNGs observe geometry,
    // not a game-authored success flag or self-reported animation completion.
    const box=await seek.boundingBox();assert.ok(box);await seek.click({position:{x:box.width*.35,y:box.height/2}});await frames();
    const selected=Number(await seek.inputValue());assert.ok(selected>range.from&&selected<range.to);assert.equal(await page.locator('#play').textContent(),'Reproduzir');
    const posed=await page.locator('canvas').screenshot();assert.notDeepEqual(posed,still,'seeking the real skeleton must visibly change its pose');await frames();assert.deepEqual(await page.locator('canvas').screenshot(),posed,'scrubbing must leave a stable paused pose');await writeFile(path.join(output,'timeline-pose.png'),posed);
    await page.getByRole('button',{name:'Quadro anterior',exact:true}).click();assert.ok(Math.abs(Number(await seek.inputValue())-Math.max(range.from,selected-1))<1e-5);
    await page.getByRole('button',{name:'Próximo quadro',exact:true}).click();assert.ok(Math.abs(Number(await seek.inputValue())-selected)<1e-5);
    await seek.press('End');assert.ok(Math.abs(Number(await seek.inputValue())-range.to)<1e-8,'range endpoint serialization must stay within numeric precision');assert.equal(await page.getByRole('button',{name:'Próximo quadro',exact:true}).isDisabled(),true);
    await page.locator('#reset').click();assert.equal(Number(await seek.inputValue()),range.from);assert.equal(await page.getByRole('button',{name:'Quadro anterior',exact:true}).isDisabled(),true);
    await frames();assert.deepEqual(await page.locator('canvas').screenshot(),still,'reset must restore the selected clip start pose');
    await seek.press('ArrowRight');assert.ok(Number(await seek.inputValue())>range.from,'the focused range accepts keyboard navigation');await page.locator('#reset').click();await frames();assert.deepEqual(await page.locator('canvas').screenshot(),still,'timeline keyboard input must not orbit the camera');
    await writeFile(path.join(output,'timeline-observation.json'),JSON.stringify({range,soughtFrame:selected,frameStep:1,actualPixelChange:true,pausedPoseStable:true,seekDoesNotPlay:true,clampedAtEnd:true,resetToStart:true,scope:'Real client viewer code and offline catalog model in disposable Chromium; no installed application, native host or physical acceptance'},null,2));
    await page.screenshot({path:path.join(output,'timeline-viewer.png'),fullPage:true});
    await page.locator('#play').click();assert.equal(await page.locator('#play').textContent(),'Pausar');await frames();const animated=await page.locator('canvas').screenshot();assert.notDeepEqual(animated,still,'the selected real skeleton clip must visibly animate');await writeFile(path.join(output,'walking.png'),animated);
    await page.locator('#play').click();assert.equal(await page.locator('#play').textContent(),'Reproduzir');await frames();const paused=await page.locator('canvas').screenshot();await frames();assert.deepEqual(await page.locator('canvas').screenshot(),paused,'pause must stop actual motion');
    const pausedFrame=await seek.inputValue();await frames();assert.equal(await seek.inputValue(),pausedFrame,'timeline must stop advancing when paused');
    await page.selectOption('#clip','');for(const id of ['play','reset','speed','seek','previous-frame','next-frame'])assert.equal(await page.locator('#'+id).isDisabled(),true);
    assert.equal(await page.locator('#position').textContent(),'Escolha uma animação');
    await page.locator('#side').click();await page.locator('#top').click();await page.locator('#frame').click();
    assert.equal(preview.errors.length,0,preview.errors.join('\n'));
    await page.evaluate(async url=>{await fetch(url).catch(()=>{});window.open(url);},`http://127.0.0.1:${address.port}/canary`);assert.equal(hits,0);
    assert.ok(preview.blocked.length>0||preview.errors.some(error=>/Content Security Policy|connect-src|blocked/i.test(error)),'blocked network must be observable');
    const browser=page.context().browser()!;abort.abort();await preview.close();assert.equal(browser.isConnected(),false);
    assert.equal((await f.call<{revision:number}>('games.projects.get',{id:f.project.id})).revision,1);
    assert.equal((await f.quality()).ready,false);
  }finally{await preview?.close();canary.closeAllConnections();await new Promise<void>(resolve=>canary.close(()=>resolve()));await f.close();}
});

test('a real static library model keeps animation navigation disabled and fits a narrow viewer without errors',async t=>{
  if(!await qualifyBrowser()){t.skip('Qualified Chromium browser unavailable');return;}
  const f=await modelPreviewFixture('tree');let preview:Awaited<ReturnType<typeof openGameModelPreview>>|undefined;
  try{
    preview=await openGameModelPreview({...f,runtimeDirectory,signal:new AbortController().signal,headless:true});const page=preview.page;await page.getByRole('status').filter({hasText:'Modelo carregado'}).waitFor();
    assert.equal(await page.locator('#clip option').count(),1);for(const id of ['clip','play','reset','speed','seek','previous-frame','next-frame'])assert.equal(await page.locator('#'+id).isDisabled(),true);
    await page.setViewportSize({width:520,height:720});await page.locator('#front').click();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1),true);
    const output=path.resolve('output/playwright/game-model-viewer/tests','static-'+new Date().toISOString().replace(/[:.]/g,'-'));await mkdir(output,{recursive:true});await preserveViewerEvidence(output,f);await page.screenshot({path:path.join(output,'static-viewer.png'),fullPage:true});
    assert.deepEqual(preview.errors,[]);assert.deepEqual(preview.blocked,[]);assert.equal((await f.quality()).ready,false);
  }finally{await preview?.close();await f.close();}
});
