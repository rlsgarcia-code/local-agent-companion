import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {gameAssetResult,type GameAssetResult} from '../../contracts/src/game-assets';
import {gameFilePath} from '../../contracts/src/games';
import runtimeLock from '../../adapter-game-web/runtime.lock.json';
import {openPinnedResourcePreview} from './preview';
import type {PinnedBrowserResources} from './resources';
import {modelViewerHtml,modelViewerCss,modelViewerScript} from './model-viewer-source';

const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const MAX_MODEL=64*1024*1024,MAX_TOTAL=128*1024*1024;

/** Bounded resource inventory only, not independent geometry/quality validation.
 * No project script, URI rewrite, remote decoder or host path enters the viewer. */
export async function prepareGameModelPreview(options:{result:GameAssetResult;modelPath:string;readFile(name:string):Promise<Uint8Array>;runtimeDirectory:string;signal:AbortSignal}){
  const result=gameAssetResult.parse(options.result),modelPath=gameFilePath.parse(options.modelPath);
  const model=result.files.find(file=>file.path===modelPath&&file.mime==='model/gltf-binary'&&file.path.endsWith('.glb'));
  if(!model||model.size>MAX_MODEL)throw Error('Escolha um modelo GLB deste candidato com até 64 MiB.');
  options.signal.throwIfAborted();
  const bytes=new Map<string,Buffer>();let total=0;
  const add=(name:string,mime:string,data:Uint8Array)=>{
    options.signal.throwIfAborted();gameFilePath.parse(name);const value=Buffer.from(data);
    total+=value.length;if(total>MAX_TOTAL)throw Error('O modelo e os recursos do visor excedem 128 MiB.');
    if(bytes.has(name))throw Error('Conflito nos recursos do visor.');bytes.set(name,value);
    return {path:name,mime,size:value.length,sha256:sha(value)};
  };
  const load=async(name:string)=>{
    const file=result.files.find(file=>file.path===name);
    if(!file||file.size>MAX_MODEL)throw Error('O modelo referencia um arquivo ausente ou grande demais neste candidato.');
    const data=Buffer.from(await options.readFile(name));
    if(data.length!==file.size||sha(data)!==file.sha256)throw Error('Os bytes do candidato divergem do arquivo preservado.');
    return {file,data};
  };
  const {data}=await load(modelPath);
  if(data.length<28||data.readUInt32LE(0)!==0x46546c67||data.readUInt32LE(4)!==2||data.readUInt32LE(8)!==data.length||data.readUInt32LE(16)!==0x4e4f534a||data.readUInt32LE(12)>8*1024*1024||20+data.readUInt32LE(12)>data.length)throw Error('O arquivo não contém um cabeçalho GLB 2 válido e limitado.');
  const document=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(data.subarray(20,20+data.readUInt32LE(12))));
  if(document?.asset?.version!=='2.0')throw Error('Este visor requer glTF 2 em um arquivo GLB.');
  if(!Array.isArray(document.extensionsRequired??[])||(document.extensionsRequired??[]).some((name:unknown)=>typeof name!=='string'||['KHR_draco_mesh_compression','EXT_meshopt_compression','KHR_texture_basisu','MSFT_audio_emitter','KHR_interactivity'].includes(name as string)))throw Error('O modelo requer um decodificador ou comportamento não disponível neste visor offline. Preserve o original e prepare uma variante compatível.');
  const files=[add(`model/${modelPath}`,model.mime,data)],dependencies=new Map<string,'buffer'|'image'>();
  for(const [collection,kind] of [['buffers','buffer'],['images','image']] as const){
    const entries=document[collection]??[];if(!Array.isArray(entries)||entries.length>256)throw Error('O inventário de dependências GLB excede os limites do visor.');
    for(const entry of entries){
      if(!entry||typeof entry!=='object')throw Error('Dependência GLB inválida.');
      if(entry.uri===undefined)continue;
      const uri=entry.uri;if(typeof uri!=='string'||!uri||uri.startsWith('/')||/[\\:%?#]/.test(uri))throw Error('O visor aceita somente dependências locais preservadas no candidato.');
      const resolved=gameFilePath.parse(path.posix.normalize(path.posix.join(path.posix.dirname(modelPath),uri)));
      if(resolved===modelPath||dependencies.has(resolved)&&dependencies.get(resolved)!==kind)throw Error('Dependência GLB conflitante.');
      dependencies.set(resolved,kind);
    }
  }
  for(const [name,kind] of dependencies){
    const {file,data:dependency}=await load(name);
    if(kind==='image'?!['image/png','image/jpeg','image/webp'].includes(file.mime):file.mime!=='application/octet-stream')throw Error('Formato de dependência GLB não disponível neste visor.');
    files.push(add(`model/${name}`,file.mime,dependency));
  }
  const runtime=runtimeLock.engines.find(item=>item.engine==='babylon');if(!runtime)throw Error('Runtime Babylon ausente.');
  for(const [name,expected] of Object.entries(runtime.files)){
    if(typeof expected!=='string'||path.basename(name)!==name)throw Error('Inventário do runtime do visor inválido.');
    const content=await readFile(path.join(options.runtimeDirectory,name));
    if(sha(content)!==expected)throw Error('O runtime do visor está ausente ou alterado. Repare a instalação exata.');
    // Include full licenses/notices, but only the two pinned entrypoints execute.
    files.push(add(`runtime/${name}`,name.endsWith('.js')?'text/javascript':'text/plain',content));
  }
  files.push(add('viewer/index.html','text/html',Buffer.from(modelViewerHtml(runtime.entry,runtime.plugins.map(plugin=>plugin.entry)))),
    add('viewer/style.css','text/css',Buffer.from(modelViewerCss)),add('viewer/viewer.js','text/javascript',Buffer.from(modelViewerScript)),
    add('viewer/config.json','application/json',Buffer.from(JSON.stringify({title:result.asset.role,revision:result.revision,model:`/model/${modelPath}`,source:result.asset.origin.source,license:result.asset.origin.license,placeholder:result.asset.placeholder}))));
  const artifact:PinnedBrowserResources={engine:'babylon',entrypoint:'viewer/index.html',files};
  return {artifact,readFile:async(name:string)=>{const value=bytes.get(name);if(!value)throw Error('Recurso ausente no visor fixado.');return Buffer.from(value);}};
}

export async function openGameModelPreview(options:Parameters<typeof prepareGameModelPreview>[0]&{headless?:boolean}){
  const prepared=await prepareGameModelPreview(options);
  const preview=await openPinnedResourcePreview({...prepared,signal:options.signal,headless:options.headless});
  try{
    await preview.page.waitForFunction(()=>document.getElementById('status')?.textContent?.startsWith('Modelo carregado')||document.getElementById('error')?.hidden===false,undefined,{timeout:20000});
    if(await preview.page.locator('#error').isVisible()){
      // Private host diagnostics, not an event/log upload or model-tool result.
      const cause=await preview.page.locator('#error').evaluate(element=>({stage:(element as HTMLElement).dataset.stage,detail:(element as HTMLElement).dataset.detail}));
      throw Error('O modelo não pôde ser renderizado com os recursos locais deste visor. Preserve o candidato e confira suas dependências.',{cause});
    }
    return preview;
  }catch(error){await preview.close();throw error;}
}
