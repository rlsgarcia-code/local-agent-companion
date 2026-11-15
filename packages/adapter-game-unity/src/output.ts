import {createHash} from 'node:crypto';
import {z} from 'zod';
import {gameFilePath,gameFileTreeConflict} from '../../contracts/src/games';
import {contentHash} from '../../contracts/src/identity';
import {readGameTar} from '../../adapter-game-container/src/archive';
import {UNITY_VERSION,unityProjectSettings,type UnityProjectSettings} from './project';

const integer=z.number().int().nonnegative().safe();
const diagnostic=z.object({schemaVersion:z.literal(1),engineVersion:z.literal(UNITY_VERSION),target:z.literal('web'),
 result:z.enum(['succeeded','failed']),failureCode:z.enum(['','invalid-project','wrong-target','export-failed','export-output']),
 sceneCount:integer.max(128),errors:integer,warnings:integer,bytes:integer,
}).strict().superRefine((value,context)=>{
 if(value.result==='succeeded'&&(value.failureCode!==''||value.errors!==0||value.sceneCount<1))context.addIssue({code:'custom',message:'Inconsistent successful editor diagnostic.'});
 if(value.result==='failed'&&value.failureCode==='')context.addIssue({code:'custom',message:'A failed editor diagnostic requires its bounded code.'});
});
export type UnityBuildDiagnostic=z.infer<typeof diagnostic>;
export type UnityOutputErrorCode='archive-invalid'|'diagnostic-invalid'|'export-failed'|'scene-count'|'output-missing'|'build-profile'|'wasm-invalid'|'data-invalid'|'text-invalid';
/** Bounded codes only: never include candidate paths, bodies, stack traces or
 * license/provider data in an outer production error. Originals stay private. */
export class UnityOutputError extends Error{
 constructor(readonly code:UnityOutputErrorCode){super(`Unity export inspection refused: ${code}. Preserve the original candidate.`);}
}
const refuse=(code:UnityOutputErrorCode):never=>{throw new UnityOutputError(code);};
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const text=(bytes:Uint8Array,limit:number)=>{
 if(bytes.byteLength<1||bytes.byteLength>limit)refuse('text-invalid');
 try{const value=new TextDecoder('utf-8',{fatal:true}).decode(bytes);if(value.includes('\0'))return refuse('text-invalid');return value;}
 catch{return refuse('text-invalid');}
};
export function readUnityBuildDiagnostic(bytes:Uint8Array):UnityBuildDiagnostic{
 if(bytes.byteLength<1||bytes.byteLength>16384)refuse('diagnostic-invalid');
 try{return diagnostic.parse(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));}
 catch{return refuse('diagnostic-invalid');}
}

/** Inspect UnityWebData1.0's table without mounting/extracting it, invoking the
 * loader or executing WASM/JS. The exact LTS loader's format is documented in
 * GAME_UNITY_PROJECTS.md. This is a strict bounded profile, not game validity. */
export function inspectUnityDataPack(input:Uint8Array){
 if(input.byteLength>256*1024*1024)refuse('data-invalid');
 const bytes=Buffer.from(input.buffer,input.byteOffset,input.byteLength),prefix=Buffer.from('UnityWebData1.0\0','ascii');
 if(bytes.length<prefix.length+4||!bytes.subarray(0,prefix.length).equals(prefix))refuse('data-invalid');
 const end=bytes.readUInt32LE(prefix.length);if(end<prefix.length+4||end>bytes.length||end>16*1024*1024)refuse('data-invalid');
 let cursor=prefix.length+4;
 const rows:{path:string;offset:number;size:number}[]=[];
 const u32=()=>{if(cursor+4>end)refuse('data-invalid');const value=bytes.readUInt32LE(cursor);cursor+=4;return value;};
 while(cursor<end){
  if(rows.length>=20000)refuse('data-invalid');
  const offset=u32(),size=u32(),length=u32();if(length<1||length>1024||cursor+length>end||offset<end||offset+size>bytes.length)refuse('data-invalid');
  let name:string;try{name=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes.subarray(cursor,cursor+length));}catch{return refuse('data-invalid');}cursor+=length;
  // Inner paths remain virtual. They can never name an absolute host file,
  // duplicate another entry, or be interpreted as an extraction destination.
  if(!gameFilePath.safeParse(name).success)refuse('data-invalid');rows.push({path:name,offset,size});
 }
 if(cursor!==end||rows.length<1||gameFileTreeConflict(rows.map(row=>row.path)))refuse('data-invalid');
 // Disjoint payload ranges bound hashing work to the actual pack size. Shared
 // payload aliases require a separately qualified profile, never guessed copies.
 const ranges=rows.filter(row=>row.size>0).sort((a,b)=>a.offset-b.offset);let previousEnd=end;
 for(const row of ranges){if(row.offset<previousEnd)refuse('data-invalid');previousEnd=row.offset+row.size;}
 return {format:'UnityWebData1.0' as const,bytes:bytes.length,sha256:hash(bytes),headerBytes:end,
  files:rows.map(row=>({...row,sha256:hash(bytes.subarray(row.offset,row.offset+row.size))}))};
}

/** Read-only future broker boundary. Archive/diagnostic are untrusted data,
 * even if their editor says success. This does NOT produce a production receipt,
 * register an adapter, expose an HTML player, grant a license or approve QA. */
export function inspectUnityExport(archive:Buffer,diagnosticBytes:Uint8Array,expected:UnityProjectSettings){
 const parsed=unityProjectSettings.safeParse(expected);if(!parsed.success)return refuse('build-profile');
 const settings=parsed.data,editor=readUnityBuildDiagnostic(diagnosticBytes);
 if(editor.result!=='succeeded')refuse('export-failed');
 if(editor.sceneCount!==settings.scenes.length)refuse('scene-count');
 let files:ReturnType<typeof readGameTar>;try{files=readGameTar(archive);}catch{return refuse('archive-invalid');}
 const entries=new Map(files.map(file=>[file.path,file]));
 const html=entries.get('index.html');if(!html)return refuse('output-missing');text(html.data,2*1024*1024);
 const buildFiles=files.filter(file=>file.path.startsWith('Build/'));
 const choose=(suffix:string)=>{const matches=buildFiles.filter(file=>file.path.slice(6).indexOf('/')<0&&file.path.endsWith(suffix));if(matches.length!==1)refuse('output-missing');return matches[0]!;};
 const loader=choose('.loader.js'),framework=choose('.framework.js'),wasm=choose('.wasm'),data=choose('.data');
 const stem=loader.path.slice(0,-'.loader.js'.length);
 if(framework.path!==stem+'.framework.js'||wasm.path!==stem+'.wasm'||data.path!==stem+'.data')refuse('build-profile');
 // Disabled compression/threads are part of this controlled editor preset.
 // Refuse compressed, worker, memory or unknown Build files; never decompress,
 // remove, rename, truncate, relax CSP or silently choose a different export.
 const required=new Set([loader.path,framework.path,wasm.path,data.path]);
 for(const file of buildFiles)if(!required.has(file.path)&&![stem+'.symbols.json',stem+'.jpg'].includes(file.path))refuse('build-profile');
 text(loader.data,16*1024*1024);text(framework.data,16*1024*1024);
 const wasmHeader=Buffer.from([0,97,115,109,1,0,0,0]);if(wasm.data.byteLength<8||!Buffer.from(wasm.data.subarray(0,8)).equals(wasmHeader))refuse('wasm-invalid');
 const pack=inspectUnityDataPack(data.data);
 const inventory=files.map(file=>({path:file.path,mime:file.mime,size:file.data.byteLength,sha256:hash(file.data)})).sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
 return {schemaVersion:1 as const,engineVersion:UNITY_VERSION,editor,
  archive:{bytes:archive.length,sha256:hash(archive)},diagnosticSha256:hash(diagnosticBytes),
  fileMapHash:contentHash(inventory),bytes:inventory.reduce((total,file)=>total+file.size,0),inventory,
  build:{loader:loader.path,framework:framework.path,wasm:wasm.path,data:data.path},dataPack:pack,
  // All original bytes are returned intact as candidate data, not a player.
  // The future broker must bind/reverify them under its own operation receipt.
  files};
}
