// Player protocol/CSP qualification only. Synthetic loader/framework/data/WASM,
// no Unity editor, real Unity runtime/game, license, inference or installation.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import bootstrap from '../dist-tests/packages/client-ts/src/bootstrap.js';
import previewModule from '../dist-tests/packages/adapter-game-browser/src/preview.js';
import fixtures from '../dist-tests/test/unity-output-fixtures.js';

const args=process.argv.slice(2);assert.equal(args.length,1);assert.ok(args[0].startsWith('--engine=')&&args[0].slice(9));const engine=path.resolve(args[0].slice(9));await bootstrap.verifyBundle(engine,undefined,true);
const output=path.resolve('output/playwright/unity-player/runs',new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID().slice(0,8));await mkdir(output,{recursive:true});
const temporary=await mkdtemp(path.join(tmpdir(),'unity-player-')),sha=bytes=>createHash('sha256').update(bytes).digest('hex');let preview,child,passed=false,phase="setup";const results=[];let fullscreenObservation=null;
const wasm=Buffer.from([0,97,115,109,1,0,0,0,1,5,1,96,0,1,127,3,2,1,0,7,10,1,6,97,110,115,119,101,114,0,0,10,6,1,4,0,65,42,11]);
const notice=Buffer.from('AVISO SINTÉTICO DO TESTE — NÃO É LICENÇA DA UNITY.\r\n<img src="https://invalid.example/not-requested">\nTexto integral preservado.');
const workScript=String.raw`const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const kit=require(process.argv[2]),root=process.argv[3],value=JSON.parse(fs.readFileSync(path.join(root,'input.json'),'utf8')),raw=fs.readFileSync(path.join(root,'candidate.tar')),diagnostic=fs.readFileSync(path.join(root,'diagnostic.json'));
const notices=value.notices.map(n=>({...n,data:fs.readFileSync(path.join(root,n.source))})).map(({source,...notice})=>notice);
const result=kit.createUnityPlayer({archive:raw,diagnostic,settings:value.settings,metadata:value.metadata,notices});if(result.stage!=='unqualified-player-candidate')throw Error('Unexpected production qualification');
const destination=path.join(root,'player');fs.mkdirSync(destination,{mode:0o700});
for(const file of result.files){const target=path.resolve(destination,file.path);if(!target.startsWith(destination+path.sep))throw Error('Nonportable output');fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,file.data,{flag:'wx',mode:0o600});}
fs.writeFileSync(path.join(root,'result.json'),JSON.stringify({stage:result.stage,entrypoint:result.entrypoint,source:result.source,transformation:result.transformation,files:result.files.map(f=>({path:f.path,mime:f.mime,size:f.data.length,sha256:crypto.createHash('sha256').update(f.data).digest('hex')}))}),{flag:'wx',mode:0o600});`;
try{
 for(const mode of ['normal','init-rejected','quit-rejected']){
  const directory=path.join(temporary,mode);await mkdir(directory,{mode:0o700});const fixture=fixtures.unityOutputFixture('3d');
  const loader=String.raw`let fixtureStarts=0;function createUnityInstance(canvas,config,progress){fixtureStarts++;
   return (async()=>{progress(.2);if(MODE==='init-rejected')throw Error('PRIVATE_MARKER');
    await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=config.frameworkUrl;script.onload=resolve;script.onerror=reject;document.head.append(script);});
    const module=await WebAssembly.instantiate(await(await fetch(config.codeUrl)).arrayBuffer());if(module.instance.exports.answer()!==42)throw Error('WASM protocol fixture failed');
    await(await fetch(config.dataUrl)).arrayBuffer();canvas.width=960;canvas.height=540;const ctx=canvas.getContext('2d');ctx.fillStyle='#163348';ctx.fillRect(0,0,960,540);ctx.fillStyle='#5ac8bd';ctx.fillRect(180,160,600,12);ctx.fillStyle='#edf2f5';ctx.font='30px sans-serif';ctx.textAlign='center';ctx.fillText('Teste de protocolo do player',480,240);ctx.font='20px sans-serif';ctx.fillText('Runtime Unity simulado · WASM mínimo',480,290);progress(1);
    return {SetFullscreen(value){if(value===1)return canvas.requestFullscreen().then(()=>{canvas.dataset.fullscreenResult='resolved';}).catch(error=>{canvas.dataset.fullscreenResult=error.name+': '+error.message;});},Quit(){return new Promise((resolve,reject)=>setTimeout(()=>MODE==='quit-rejected'?reject(Error('PRIVATE_MARKER')):resolve(),250));}};
   })();}`.replaceAll('MODE',JSON.stringify(mode));
  fixture.files.find(row=>row[0].endsWith('.loader.js'))[1]=Buffer.from(loader);fixture.files.find(row=>row[0].endsWith('.framework.js'))[1]=Buffer.from('/* Synthetic framework protocol fixture; no Unity runtime. */');fixture.files.find(row=>row[0].endsWith('.wasm'))[1]=wasm;
  const archive=fixture.archive(),diagnostic=fixture.diagnostic();await writeFile(path.join(directory,'candidate.tar'),archive,{mode:0o600});await writeFile(path.join(directory,'diagnostic.json'),diagnostic,{mode:0o600});await writeFile(path.join(directory,'notice.txt'),notice,{mode:0o600});
  await writeFile(path.join(directory,'input.json'),JSON.stringify({settings:fixture.settings,metadata:{projectId:'stable-fixture',title:'Player Unity — teste com runtime simulado'},notices:[{path:'fixture.txt',title:'Aviso sintético <img>',size:notice.length,sha256:sha(notice),source:'notice.txt'}]}),{mode:0o600});await writeFile(path.join(directory,'assemble.cjs'),workScript,{mode:0o600});
  child=spawn(path.join(engine,'node'),[path.join(directory,'assemble.cjs'),path.join(engine,'unity-output-inspector.cjs'),directory],{cwd:directory,env:{HOME:directory,PATH:'/usr/bin:/bin',TMPDIR:directory+'/',LANG:'en_US.UTF-8'},stdio:['ignore','pipe','pipe']});let log='';for(const stream of [child.stdout,child.stderr])stream.on('data',b=>log=(log+b).slice(-20000));const [code,signal]=await once(child,'exit');await writeFile(path.join(output,mode+'-assembly.log'),log);assert.equal(signal,null);assert.equal(code,0,log);child=undefined;
  const result=JSON.parse(await readFile(path.join(directory,'result.json'),'utf8'));assert.equal(result.source.archiveSha256,sha(archive));assert.equal(result.stage,'unqualified-player-candidate');
  const artifact={engine:'unity',entrypoint:result.entrypoint,files:result.files},controller=new AbortController();
  const read=async name=>{const expected=result.files.find(f=>f.path===name);assert.ok(expected);const bytes=await readFile(path.join(directory,'player',name));assert.equal(bytes.length,expected.size);assert.equal(sha(bytes),expected.sha256);return bytes;};
  preview=await previewModule.openPinnedResourcePreview({artifact,readFile:read,signal:controller.signal,headless:true});const page=preview.page;
  await page.setViewportSize(mode==='normal'?{width:1050,height:760}:{width:390,height:844});await page.locator('#status').filter({hasText:'Tudo pronto para jogar'}).waitFor();
  assert.equal(await page.locator('#fullscreen').isDisabled(),true);assert.equal(await page.locator('#quit').isDisabled(),true);
  const requests=[];page.on('request',request=>requests.push(new URL(request.url()).pathname));
  await page.locator('#notices').click();await page.locator('#notice-text').filter({hasText:'Texto integral preservado.'}).waitFor();assert.equal(await page.locator('#notice-text').textContent(),notice.toString());assert.equal(await page.locator('#notice-dialog img').count(),0);await page.locator('#close-notices').click();
  await page.locator('#start').click();
  if(mode==='init-rejected'){await page.locator('#status').filter({hasText:'Não foi possível carregar este jogo'}).waitFor();assert.equal(await page.locator('#start').isVisible(),false);assert.equal(await page.locator('#quit').isDisabled(),true);assert.equal((await page.locator('body').textContent()).includes('PRIVATE_MARKER'),false);}
  else{
   await page.locator('#loading').waitFor({state:'hidden'});assert.equal(await page.locator('#quit').isEnabled(),true);assert.equal(requests.filter(url=>url.endsWith('.framework.js')).length,1);assert.equal(requests.filter(url=>url.endsWith('.wasm')).length,1);assert.equal(requests.filter(url=>url.endsWith('.data')).length,1);
   await page.screenshot({path:path.join(output,mode+'-playing.png'),fullPage:true});
   if(mode==='normal'){
    await page.setViewportSize({width:390,height:844});const layout=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,height:innerHeight,scrollHeight:document.documentElement.scrollHeight}));assert.ok(layout.scrollWidth<=layout.width&&layout.scrollHeight<=layout.height);await page.screenshot({path:path.join(output,'mobile-playing.png'),fullPage:true});
    phase='fullscreen-enter';await page.locator('#fullscreen').click();await page.waitForFunction(()=>Boolean(document.fullscreenElement)||document.querySelector('canvas').dataset.fullscreenResult?.startsWith('TypeError: not granted'));
    if(await page.evaluate(()=>Boolean(document.fullscreenElement))){phase='fullscreen-exit';await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.fullscreenElement);fullscreenObservation={state:'entered-and-exited',physicalAcceptance:false};}
    else{await page.locator('#runtime-status').filter({hasText:'Tela cheia indisponível neste navegador.'}).waitFor();fullscreenObservation={state:'browser-refused',response:'TypeError: not granted',refusalPresented:true,entryUnproven:true,physicalAcceptance:false};} 
   }
   await page.locator('#quit').click();await page.locator('#status').filter({hasText:'Encerrando o jogo'}).waitFor();assert.equal(await page.locator('#quit').isDisabled(),true);
   await page.locator('#status').filter({hasText:mode==='normal'?'Jogo encerrado.':'Não foi possível confirmar o encerramento.'}).waitFor();assert.equal((await page.locator('body').textContent()).includes('PRIVATE_MARKER'),false);
   if(mode==='quit-rejected')assert.equal((await page.locator('#status').textContent()).includes('Jogo encerrado.'),false);
  }
  await page.screenshot({path:path.join(output,mode+'-terminal.png'),fullPage:true});assert.deepEqual(preview.errors,[]);assert.deepEqual(preview.blocked,[]);
  const beforeClose={mode,source:result.source,files:result.files,stage:result.stage,localRequestPaths:requests,errors:[...preview.errors],blocked:[...preview.blocked],noticesAsLiteralText:true,installed:false,realUnityRuntime:false};
  await preview.close();assert.ok(page.isClosed());preview=undefined;beforeClose.ownedPreviewClosed=true;results.push(beforeClose);
 }
 await bootstrap.verifyBundle(engine,undefined,true);await writeFile(path.join(output,'report.json'),JSON.stringify({scope:'Exact bundled Node player assembly and real Chromium/common private browser transport, using an explicit synthetic Unity API protocol stub and minimum WASM. Not a real Unity build/runtime/game, license, native editor barrier, physical device, QA, installed client or registered adapter.',engineManifestSha256:sha(await readFile(path.join(engine,'manifest.json'))),results,qualificationStatus:fullscreenObservation?.state==='browser-refused'?'partial':'protocol-only',fullscreen:fullscreenObservation,originalHtmlNotExecuted:true,sharedAgentServiceRunning:false,realInferenceCalls:0,unityEditorInvocations:0,productionAdapterRegistered:false},null,2)+'\n');passed=true;console.log('UNITY_PLAYER_PROTOCOL_OBSERVED '+output);
}catch(error){if(preview&&!preview.page.isClosed())try{await preview.page.screenshot({path:path.join(output,'failure.png'),fullPage:true});}catch{}await writeFile(path.join(output,'failure.json'),JSON.stringify({message:error.message,phase,errors:preview?.errors,blocked:preview?.blocked,state:preview&&!preview.page.isClosed()?await preview.page.evaluate(()=>({fullscreenEnabled:document.fullscreenEnabled,fullscreenElement:document.fullscreenElement?.id??null,fullscreenResult:document.querySelector('canvas')?.dataset.fullscreenResult,status:document.querySelector('#runtime-status')?.textContent})):null},null,2)+'\n');throw error;}
finally{await preview?.close();if(child?.exitCode===null&&child.signalCode===null){const exited=once(child,'exit');child.kill('SIGTERM');await exited;}if(passed)await rm(temporary,{recursive:true,force:true});else console.error('Owned fixture retained: '+temporary);}
