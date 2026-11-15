import {z} from 'zod';
import {createHash} from 'node:crypto';
import {gameDocument,gameFilePath,type GameDocument} from '../../contracts/src/games';
import lock from '../toolchain.lock.json';
import moduleLock from '../project-modules.lock.json';

export const UNITY_VERSION=lock.version;
export const UNITY_REVISION=lock.revision;
export const UNITY_DRIVER_ROOT='Assets/Editor/CompanionProduction';
const scene=gameFilePath.refine(value=>value.startsWith('Assets/')&&value.endsWith('.unity'),'Declare an exact native Assets/...scene.unity path.');
/** Project data, never a license, executable command, host path or authority. */
export const unityProjectSettings=z.object({
 schemaVersion:z.literal(1),engineVersion:z.literal(UNITY_VERSION),dimension:z.enum(['2d','3d']),
 scenes:z.array(scene).min(1).max(128).refine(values=>new Set(values.map(value=>value.toLocaleLowerCase('en-US'))).size===values.length,'Scenes must be distinct; order selects the first scene.'),
}).strict();
export type UnityProjectSettings=z.infer<typeof unityProjectSettings>;

// Only built-in modules, never registry/Git/file/package-runner dependencies.
// The catalog comes from hash-bound metadata of the exact prepared editor. It
// is not a claim of web compatibility, package or host authority. No telemetry.
const catalog:Record<string,{version:string;dependencies:Record<string,string>}>=moduleLock.modules;
const excluded=new Set(Object.keys(moduleLock.excludedModules));
const modules=new Set(Object.keys(catalog).filter(name=>!excluded.has(name)));
const moduleId=z.string().refine(value=>modules.has(value),'Only supported built-in Unity modules may be referenced.');
const dependencies=z.record(moduleId,z.literal('1.0.0'));
const manifest=z.object({dependencies}).strict();
const packageLock=z.object({dependencies:z.record(moduleId,z.object({version:z.literal('1.0.0'),depth:z.number().int().min(0).max(32),source:z.literal('builtin'),dependencies}).strict())}).strict();
const required=['game.unity.json','ProjectSettings/ProjectVersion.txt','Packages/manifest.json','Packages/packages-lock.json'];
const maxBytes=new Map<string,number>([[required[0]!,16384],[required[1]!,1024],[required[2]!,16384],[required[3]!,65536]]);
function parseMetadata<T>(schema:z.ZodType<T>,text:string,name:string):T{
 try{return schema.parse(JSON.parse(text));}
 catch{throw Error(`Invalid Unity metadata format: ${name}. Preserve the original and correct it explicitly.`);}
}

/** Read-only preflight before editor dispatch. Does not create a project, launch
 * Unity, copy source, edit versions, probe/activate a license or register a port. */
export async function readUnityProject(input:GameDocument,readFile:(name:string)=>Promise<Uint8Array>){
 if(moduleLock.editorVersion!==UNITY_VERSION||moduleLock.editorRevision!==UNITY_REVISION)throw Error('Unity module catalog and editor lock must name the same exact release.');
 const document=gameDocument.parse(input);
 if(document.engine!=='unity')throw Error('Unity preflight requires an explicit Unity project; engine migration is not implicit.');
 const files=new Map(document.files.map(file=>[file.path,file]));
 for(const name of required)if(!files.has(name))throw Error('Unity requires its native version file, manifest, lock and explicit game.unity.json.');
 for(const file of document.files){
  const lower=file.path.toLocaleLowerCase('en-US');
  if(/^(?:library|temp|logs|usersettings|obj|build|builds|\.git)(?:\/|$)/.test(lower))throw Error('Preserve native editor caches separately; they cannot enter the controlled working copy.');
  if(lower===UNITY_DRIVER_ROOT.toLowerCase()+'.meta'||lower===UNITY_DRIVER_ROOT.toLowerCase()||lower.startsWith(UNITY_DRIVER_ROOT.toLowerCase()+'/'))throw Error('The controlled export driver namespace is reserved. Preserve conflicting source instead of overwriting it.');
  if(/\.(?:dll|exe|so|dylib|bundle|framework|xcframework|a|lib|aar|jar|rsp)(?:\.meta)?(?:\/|$)/i.test(file.path))throw Error('Native/binary plugins and compiler response files need a separately pinned toolchain; they are not accepted by this profile.');
  if(lower.startsWith('packages/')&&!['packages/manifest.json','packages/packages-lock.json'].includes(lower))throw Error('Embedded/local packages are not part of the controlled built-in module profile.');
 }
 const read=async(name:string)=>{
  const maximum=maxBytes.get(name)!;
  if(files.get(name)!.size>maximum)throw Error('Unity project metadata exceeds its bounded format.');
  const bytes=await readFile(name);if(bytes.byteLength>maximum)throw Error('Unity project metadata exceeds its bounded format.');
  if(bytes.byteLength!==files.get(name)!.size||createHash('sha256').update(bytes).digest('hex')!==files.get(name)!.sha256)throw Error('Unity metadata bytes differ from the exact project revision.');
  return new TextDecoder('utf-8',{fatal:true}).decode(bytes);
 };
 const settings=parseMetadata(unityProjectSettings,await read(required[0]!),required[0]!);
 if(settings.dimension!==document.brief.dimension)throw Error('The explicit Unity project dimension differs from the approved brief.');
 for(const name of settings.scenes)if(!files.has(name))throw Error('A declared native Unity scene is missing; no active-editor scene fallback is permitted.');
 const version=await read(required[1]!);
 const fields=version.split(/\r?\n/).filter(value=>value.length);
 if(fields.length!==2||fields[0]!==`m_EditorVersion: ${UNITY_VERSION}`||fields[1]!==`m_EditorVersionWithRevision: ${UNITY_VERSION} (${UNITY_REVISION})`)throw Error('The editable Unity project must retain the exact pinned LTS version and revision.');
 const packages=parseMetadata(manifest,await read(required[2]!),required[2]!),resolved=parseMetadata(packageLock,await read(required[3]!),required[3]!);
 for(const [id,value]of Object.entries(packages.dependencies)){
  if(resolved.dependencies[id]?.version!==value||resolved.dependencies[id]?.depth!==0)throw Error('Every direct built-in module requires its exact depth-zero lock entry.');
 }
 for(const [id,value]of Object.entries(resolved.dependencies)){
  if(value.depth===0&&!(id in packages.dependencies))throw Error('The module lock contains an undeclared direct dependency.');
  for(const dependency of Object.keys(value.dependencies))if(!resolved.dependencies[dependency])throw Error('The module lock must include every referenced built-in dependency.');
  const sorted=(record:Record<string,string>)=>JSON.stringify(Object.entries(record).sort(([a],[b])=>a.localeCompare(b,'en-US')));
  if(value.version!==catalog[id]!.version||sorted(value.dependencies)!==sorted(catalog[id]!.dependencies))throw Error('Built-in dependency metadata differs from the exact editor catalog.');
 }
 const depths=new Map<string,number>(Object.keys(packages.dependencies).map(name=>[name,0])),queue=[...depths.keys()];
 for(let i=0;i<queue.length;i++)for(const name of Object.keys(catalog[queue[i]!]!.dependencies))if(!depths.has(name)){depths.set(name,depths.get(queue[i]!)!+1);queue.push(name);}
 if(depths.size!==Object.keys(resolved.dependencies).length||[...depths].some(([name,depth])=>resolved.dependencies[name]?.depth!==depth))throw Error('The built-in lock must contain exactly the reachable dependencies with their resolved depths.');
 return {settings,dependencies:packages.dependencies,lockedDependencies:resolved.dependencies};
}
