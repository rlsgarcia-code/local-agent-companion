import {createHash} from 'node:crypto';
import {z} from 'zod';
import {identifier} from '../../contracts/src/schema';
import {gameFilePath,gameFileTreeConflict} from '../../contracts/src/games';
import type {ProducedGameFile} from '../../game-production/src/index';
import {inspectUnityExport} from './output';
import type {UnityProjectSettings} from './project';

export const UNITY_PLAYER_POLICY="default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self'; connect-src 'self'; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
const metadata=z.object({projectId:identifier,title:z.string().trim().min(1).max(300)}).strict();
const noticeMetadata=z.object({path:gameFilePath,title:z.string().trim().min(1).max(100),sha256:z.string().regex(/^[a-f0-9]{64}$/),size:z.number().int().min(1).max(4*1024*1024)}).strict();
export type UnityPlayerNotice=z.infer<typeof noticeMetadata>&{data:Uint8Array};
export type UnityPlayerErrorCode='metadata-invalid'|'reserved-path'|'extra-html'|'notices-invalid'|'player-size';
export class UnityPlayerError extends Error{
 constructor(readonly code:UnityPlayerErrorCode){super(`Unity player preparation refused: ${code}. Preserve the original export.`);}
}
const refuse=(code:UnityPlayerErrorCode):never=>{throw new UnityPlayerError(code);};
const sha=(data:Uint8Array)=>createHash('sha256').update(data).digest('hex');
const escaped=(text:string)=>text.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
const base='companion-player/';
/** This bootstrap is presentation/runtime lifecycle, not an agent, bridge to the
 * host, tool runner, permission grant, save implementation or Unity editor. */
export const UNITY_PLAYER_JS=String.raw`(() => {
 'use strict';
 const el=id=>document.getElementById(id),canvas=el('game'),overlay=el('loading'),status=el('status');
 let state='preparing',config,instance,noticeEpoch=0;
 const say=text=>{status.textContent=text;};
 const fail=()=>{state='failed';overlay.hidden=false;el('start').hidden=true;el('progress').hidden=true;el('fullscreen').disabled=true;el('quit').disabled=true;say('Não foi possível carregar este jogo. Recarregue a página para tentar novamente.');};
 const local=value=>{const url=new URL(value,document.baseURI);if(url.origin!==location.origin||url.protocol!==location.protocol)throw Error('Packaged resources only');return url.href;};
 async function read(name){const response=await fetch(local(name),{cache:'no-store',redirect:'error'});if(!response.ok||response.redirected)throw Error('Packaged resource unavailable');return response;}
 async function showNotice(){const epoch=++noticeEpoch,selected=config.notices[el('notice-file').selectedIndex];if(!selected)return;
  el('notice-text').textContent='Carregando…';try{const text=await(await read(selected.path)).text();if(epoch===noticeEpoch)el('notice-text').textContent=text;}catch{if(epoch===noticeEpoch)el('notice-text').textContent='Não foi possível abrir este aviso. Os arquivos originais permanecem na exportação.';}}
 el('notices').addEventListener('click',()=>{if(!config)return;el('notice-dialog').showModal();void showNotice();});
 el('close-notices').addEventListener('click',()=>el('notice-dialog').close());el('notice-dialog').addEventListener('close',()=>noticeEpoch++);el('notice-file').addEventListener('change',()=>void showNotice());
 el('start').addEventListener('click',()=>{
  if(state!=='ready')return;state='starting';el('start').disabled=true;el('start').hidden=true;el('progress').hidden=false;say('Carregando o jogo…');
  const options={arguments:[],dataUrl:local(config.build.data),frameworkUrl:local(config.build.framework),codeUrl:local(config.build.wasm),streamingAssetsUrl:local('StreamingAssets'),
   companyName:'Companion',productName:config.projectId,productVersion:'1',showBanner:(_message,type)=>{if(type==='error')el('runtime-status').textContent='O jogo informou um erro. Confira a execução antes de continuar.';}};
  if(config.build.symbols)options.symbolsUrl=local(config.build.symbols);
  try{Promise.resolve(createUnityInstance(canvas,options,value=>{if(state==='starting'&&typeof value==='number'&&Number.isFinite(value))el('progress').value=Math.max(0,Math.min(1,value));})).then(value=>{
    if(!value||typeof value.Quit!=='function')throw Error('Runtime unavailable');instance=value;state='playing';overlay.hidden=true;el('quit').disabled=false;
    el('fullscreen').disabled=typeof value.SetFullscreen!=='function'||!document.fullscreenEnabled;canvas.focus();
   }).catch(fail);}catch{fail();}
 });
 document.addEventListener('fullscreenerror',()=>{el('runtime-status').textContent='Tela cheia indisponível neste navegador.';});
 el('fullscreen').addEventListener('click',()=>{if(state!=='playing'||typeof instance?.SetFullscreen!=='function')return;try{instance.SetFullscreen(1);}catch{el('runtime-status').textContent='Tela cheia indisponível neste navegador.';}});
 el('quit').addEventListener('click',()=>{
  if(state!=='playing')return;state='quitting';overlay.hidden=false;el('progress').hidden=true;el('quit').disabled=true;el('fullscreen').disabled=true;say('Encerrando o jogo…');
  try{const result=instance.Quit();if(!result||typeof result.then!=='function')throw Error('Runtime stop unconfirmed');result.then(()=>{instance=null;state='ended';say('Jogo encerrado. Recarregue a página para jogar novamente.');}).catch(()=>{state='stop-unknown';say('Não foi possível confirmar o encerramento. Feche esta página antes de abrir outra partida.');});}
  catch{state='stop-unknown';say('Não foi possível confirmar o encerramento. Feche esta página antes de abrir outra partida.');}
 });
 window.addEventListener('pagehide',()=>{if(instance&&state==='playing')try{Promise.resolve(instance.Quit()).catch(()=>{});}catch{}});
 if(!/^https?:$/.test(location.protocol)){fail();say('Abra este jogo pelo player ou por um servidor local.');return;}
 void(async()=>{
  const value=await(await read('companion-player/config.json')).json();if(value.schemaVersion!==1||!Array.isArray(value.notices)||!value.notices.length)throw Error('Player metadata unavailable');config=value;
  el('notice-file').replaceChildren(...config.notices.map(notice=>{const option=document.createElement('option');option.textContent=notice.title;return option;}));el('notices').disabled=false;
  await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=local(config.build.loader);script.onload=resolve;script.onerror=reject;document.head.append(script);});
  if(typeof createUnityInstance!=='function')throw Error('Runtime unavailable');state='ready';el('progress').hidden=true;el('start').disabled=false;say('Tudo pronto para jogar.');
 })().catch(fail);
})();`;
export const UNITY_PLAYER_CSS=`:root{color-scheme:dark;font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#edf2f5;background:#111820}*{box-sizing:border-box}[hidden]{display:none!important}html,body{margin:0;width:100%;height:100%;overflow:hidden}body{display:grid;grid-template-rows:minmax(0,1fr) auto}#viewport{position:relative;min-width:0;min-height:0}#game{display:block;width:100%;height:100%;touch-action:none;background:#0b1118;outline-offset:-3px}#loading{position:absolute;inset:0;display:grid;place-content:center;text-align:center;gap:16px;padding:28px;background:#111820e8;animation:appear .15s ease-out}h1{font-size:clamp(22px,4vw,38px);line-height:1.15;letter-spacing:-.6px;margin:0;overflow-wrap:anywhere}#status{margin:0;max-width:500px;color:#b4c2cc}#start{justify-self:center;padding:10px 28px;background:#5ac8bd;color:#092421;border-color:transparent;font-weight:600}progress{width:min(340px,70vw);height:6px;justify-self:center;accent-color:#5ac8bd}footer{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px;padding:10px 16px;background:#171f29;border-top:1px solid #2d3948}footer strong{font-size:12px;min-width:0;max-width:45vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.controls{display:flex;flex-wrap:wrap;gap:8px}button,select{font:inherit;color:inherit;border:1px solid #405061;border-radius:5px;padding:6px 10px;background:transparent;cursor:pointer}button:disabled{opacity:.45;cursor:default}button:hover:not(:disabled){background:#283444}button:focus-visible,select:focus-visible,pre:focus-visible{outline:2px solid #5ac8bd;outline-offset:3px}#runtime-status:empty{display:none}#runtime-status{font-size:11px;color:#b4c2cc;margin:0}dialog{color:inherit;background:#171f29;border:1px solid #405061;border-radius:8px;max-width:min(850px,94vw);width:850px;padding:24px}dialog::backdrop{background:#000b}dialog header{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:20px}dialog h2{font-size:18px;margin:0}dialog label{display:block;font-size:12px;margin-bottom:6px}dialog select{width:100%;background:#171f29}dialog pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:55dvh;overflow:auto;line-height:1.6;font-size:12px}@keyframes appear{from{opacity:0}to{opacity:1}}@media(max-width:480px){footer strong{max-width:100%}footer{gap:8px}.controls{width:100%}button{min-height:38px}dialog{padding:18px}}@media(prefers-reduced-motion:reduce){*{animation:none!important}}`;

/** Pure future-broker assembly. Returns an UNQUALIFIED candidate, never a job,
 * build receipt or available adapter. No disk, compiler, project execution or
 * inferred license; the caller must verify actual distribution notices/authority. */
export function createUnityPlayer(input:{archive:Buffer;diagnostic:Uint8Array;settings:UnityProjectSettings;metadata:z.infer<typeof metadata>;notices:readonly UnityPlayerNotice[]}){
 const meta=metadata.safeParse(input.metadata);if(!meta.success)return refuse('metadata-invalid');
 const inspection=inspectUnityExport(input.archive,input.diagnostic,input.settings);
 for(const file of inspection.files){
  const lower=file.path.toLocaleLowerCase('en-US');if(lower==='companion-player'||lower.startsWith(base))return refuse('reserved-path');
  if(file.path!=='index.html'&&/\.(?:html?|xhtml)$/i.test(file.path))return refuse('extra-html');
 }
 if(!Array.isArray(input.notices)||input.notices.length<1||input.notices.length>128)return refuse('notices-invalid');
 const notices:ProducedGameFile[]=[],noticeIndex:{path:string;title:string}[]=[];let noticeBytes=0;
 for(const notice of input.notices){
  if(!notice||typeof notice!=='object'||Array.isArray(notice))return refuse('notices-invalid');
  const {data,...fields}=notice,parsed=noticeMetadata.safeParse(fields);if(!parsed.success||!(data instanceof Uint8Array))return refuse('notices-invalid');
  const name=base+'notices/'+parsed.data.path;
  if(!gameFilePath.safeParse(name).success||data.byteLength!==parsed.data.size||sha(data)!==parsed.data.sha256||(noticeBytes+=data.byteLength)>8*1024*1024)return refuse('notices-invalid');
  try{new TextDecoder('utf-8',{fatal:true}).decode(data);}catch{return refuse('notices-invalid');}
  notices.push({path:name,mime:'text/plain',data:Buffer.from(data)});noticeIndex.push({path:name,title:parsed.data.title});
 }
 const config={schemaVersion:1,projectId:meta.data.projectId,build:{...inspection.build,...(inspection.inventory.some(file=>file.path===inspection.build.loader.replace(/\.loader\.js$/,'.symbols.json'))?{symbols:inspection.build.loader.replace(/\.loader\.js$/,'.symbols.json')}:{})},notices:noticeIndex};
 const title=escaped(meta.data.title),html=`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta http-equiv="Content-Security-Policy" content="${UNITY_PLAYER_POLICY}"><title>${title}</title><link rel="icon" href="data:,"><link rel="stylesheet" href="companion-player/player.css"><script defer src="companion-player/player.js"></script></head><body><main id="viewport"><canvas id="game" tabindex="0" aria-label="${title}"></canvas><section id="loading" aria-label="Carregamento"><h1>${title}</h1><p id="status" role="status">Preparando o jogo…</p><progress id="progress" max="1" value="0" aria-label="Progresso de carregamento"></progress><button id="start" type="button" disabled>Jogar</button></section></main><footer><strong>${title}</strong><p id="runtime-status" role="status"></p><div class="controls"><button id="fullscreen" type="button" disabled>Tela cheia</button><button id="quit" type="button" disabled>Encerrar</button><button id="notices" type="button" disabled>Licenças</button></div></footer><dialog id="notice-dialog" aria-labelledby="notice-title"><header><h2 id="notice-title">Licenças e avisos</h2><button id="close-notices" type="button">Fechar</button></header><label for="notice-file">Documento</label><select id="notice-file"></select><pre id="notice-text" tabindex="0"></pre></dialog></body></html>`;
 const generated:ProducedGameFile[]=[{path:'index.html',mime:'text/html',data:Buffer.from(html)},{path:base+'player.js',mime:'text/javascript',data:Buffer.from(UNITY_PLAYER_JS)},{path:base+'player.css',mime:'text/css',data:Buffer.from(UNITY_PLAYER_CSS)},{path:base+'config.json',mime:'application/json',data:Buffer.from(JSON.stringify(config))}];
 const files=[...inspection.files.filter(file=>file.path!=='index.html'),...generated,...notices];
 if(files.length>20000||files.reduce((total,file)=>total+file.data.byteLength,0)>256*1024*1024)return refuse('player-size');
 if(gameFileTreeConflict(files.map(file=>file.path)))return refuse('notices-invalid');
 return {stage:'unqualified-player-candidate' as const,entrypoint:'index.html',files,
  source:{archiveSha256:inspection.archive.sha256,fileMapHash:inspection.fileMapHash,originalIndexSha256:inspection.inventory.find(file=>file.path==='index.html')!.sha256},
  transformation:{replaced:['index.html'],generated:generated.map(file=>file.path),notices:notices.map(file=>({path:file.path,sha256:sha(file.data),bytes:file.data.byteLength}))}};
}
