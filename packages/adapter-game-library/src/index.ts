import {constants} from "node:fs";
import {lstat,open,realpath} from "node:fs/promises";
import path from "node:path";
import {createHash} from "node:crypto";
import {z} from "zod";
import {canonical,contentHash} from "../../contracts/src/identity";
import {gameLibraryManifest,gameLibraryQuery,gameLibraryPage,type GameLibraryManifest,type GameLibrarySelection} from "../../contracts/src/game-library";
import {GameProductionFailure,type GameAssetProcessor} from "../../game-production/src/index";

const digest=(data:Uint8Array)=>createHash("sha256").update(data).digest("hex");
const catalogIndex=z.object({schemaVersion:z.literal(1),libraries:z.array(z.object({id:z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/),manifestSha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict()).min(1).max(30)}).strict();
type Pack={hash:string;manifest:GameLibraryManifest};

/** Only a process-owner supplied, immutable installation directory is read.
 * All filenames below it are fixed or hashes, never a host path from RPC/model data. */
async function installedFile(root:string,relative:string,maximum:number):Promise<Buffer>{
  let current=root;
  for(const part of relative.split("/")){
    if(!part||part==="."||part===".."||part.includes("\\"))throw Error("Invalid installed library path.");
    current=path.join(current,part);const info=await lstat(current);
    if(info.isSymbolicLink())throw Error("Linked installed library content is not permitted.");
    if(current!==path.join(root,...relative.split("/"))&&!info.isDirectory())throw Error("Library parent must be a directory.");
  }
  const handle=await open(current,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
  try{
    const before=await handle.stat();
    if(!before.isFile()||before.nlink!==1||before.size<1||before.size>maximum)throw Error("Library input is not a bounded regular file.");
    const bytes=Buffer.alloc(before.size);let offset=0;
    while(offset<bytes.length){const result=await handle.read(bytes,offset,bytes.length-offset,offset);if(!result.bytesRead)throw Error("Truncated library input.");offset+=result.bytesRead;}
    const after=await handle.stat();
    if(after.size!==before.size||after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs||after.nlink!==1)throw Error("Library input changed while reading.");
    return bytes;
  }finally{await handle.close();}
}

export async function createGameLibraryProcessor(options:{directory:string;implementationSha256?:string}):Promise<GameAssetProcessor>{
  let root="",indexSha="unavailable",packs:Pack[]=[],available=false;
  async function blob(pack:Pack,file:GameLibrarySelection["entry"]["files"][number]){
    const bytes=await installedFile(root,`${pack.manifest.library.id}/blobs/${file.sha256}`,file.size);
    if(bytes.length!==file.size||digest(bytes)!==file.sha256)throw Error("Pinned library blob integrity mismatch.");
    return bytes;
  }
  try{
    const info=await lstat(options.directory);if(info.isSymbolicLink()||!info.isDirectory())throw Error("Library root must be an installed directory.");
    root=await realpath(options.directory);
    const raw=await installedFile(root,"index.json",64*1024),index=catalogIndex.parse(JSON.parse(raw.toString("utf8")));indexSha=digest(raw);
    if(new Set(index.libraries.map(item=>item.id)).size!==index.libraries.length)throw Error("Duplicate installed library identity.");
    let total=0;const verified=new Map<string,number>();
    for(const item of index.libraries){
      const bytes=await installedFile(root,`${item.id}/manifest.json`,2*1024*1024);
      if(digest(bytes)!==item.manifestSha256)throw Error("Installed library manifest differs from its exact registry.");
      const manifest=gameLibraryManifest.parse(JSON.parse(bytes.toString("utf8")));
      if(manifest.library.id!==item.id)throw Error("Library identity mismatch.");
      const pack={hash:item.manifestSha256,manifest};
      for(const entry of manifest.entries)for(const file of entry.files){
        const key=`${item.id}/${file.sha256}`;if(verified.has(key)){if(verified.get(key)!==file.size)throw Error("Inconsistent shared library blob declaration.");continue;}total+=file.size;
        if(total>256*1024*1024)throw Error("Installed library byte budget exceeded.");
        await blob(pack,file);verified.set(key,file.size);
      }
      packs.push(pack);
    }
    available=true;
  }catch{packs=[];}
  const unavailable=()=>new GameProductionFailure("The installed licensed asset catalog is missing, changed or unverified. Restore its exact package; no runtime download or substitute is allowed.");
  return {id:"licensed-libraries-v1",products:["companion-mac","companion-vscode"],authority:"workspace",operations:["library.copy"],
    resources:{memoryMiB:192,cpuSlots:1,exclusiveGroups:[]},
    toolchain:{id:"licensed-libraries",version:"1",sha256:contentHash({ABI:1,indexSha,implementation:options.implementationSha256??"development-unreleased"})},
    projectGuide:"Use game_libraries to search/page the installed offline catalog. Pass an EXACT returned selection unchanged to library.copy, processorId licensed-libraries-v1 and a new assets/* outputBase. The grouped model, dependent texture and complete license/notice files keep their relative paths. Query animations before selecting clips. Processing returns a candidate; apply explicitly. Do not rename GLB/PNG formats, strip notices, fetch URLs or infer artistic/license/human acceptance from a successful copy. The cited upstream license remains declared-unverified independently.",
    async probe(){return available?{available:true}:{available:false,reason:unavailable().message};},
    async libraries(input){
      if(!available)throw unavailable();const query=gameLibraryQuery.parse(input),needle=query.query.toLocaleLowerCase("en-US");
      const matches=packs.filter(pack=>!query.libraryId||pack.manifest.library.id===query.libraryId).flatMap(pack=>pack.manifest.entries
        .filter(entry=>!query.entryId||entry.id===query.entryId)
        .filter(entry=>[entry.id,entry.title,...entry.tags,...entry.animations,pack.manifest.library.title].join(" ").toLocaleLowerCase("en-US").includes(needle))
        .map(entry=>({manifestSha256:pack.hash,library:pack.manifest.library,entry})));
      const entries=matches.slice(query.cursor,query.cursor+query.limit);
      return gameLibraryPage.parse({entries,cursor:query.cursor+entries.length,hasMore:query.cursor+entries.length<matches.length});
    },
    async process(access){
      if(!available)throw unavailable();const operation=access.spec.operation;
      if(operation.type!=="library.copy")throw new GameProductionFailure("The library processor accepts only pinned library.copy operations.");
      const selected=operation.selection,pack=packs.find(pack=>pack.hash===selected.manifestSha256&&pack.manifest.library.id===selected.library.id);
      const entry=pack?.manifest.entries.find(entry=>entry.id===selected.entry.id);
      if(!pack||!entry||canonical(selected)!==canonical({manifestSha256:pack.hash,library:pack.manifest.library,entry}))throw new GameProductionFailure("The exact library selection must match the installed manifest, including every dependency and full notice. Requery the catalog; declarations cannot grant library authority.");
      try{
        const files=[];
        for(const file of entry.files){access.signal.throwIfAborted();files.push({path:`${operation.outputBase}/${file.path}`,mime:file.mime,data:await blob(pack,file)});}
        access.signal.throwIfAborted();
        files.push({path:`${operation.outputBase}/LIBRARY.json`,mime:"application/json",data:Buffer.from(JSON.stringify({schemaVersion:1,...selected},null,2)+"\n")});
        return {files,info:{library:pack.manifest.library.id,entry:entry.id,manifestSha256:pack.hash,animations:entry.animations.length,licenseStatus:"declared-unverified"}};
      }catch(error){if(access.signal.aborted)throw access.signal.reason;throw new GameProductionFailure("The pinned library file verification/copy failed. No project was changed; preserve the candidate and restore the exact package.");}
    },
    async reconcile(){return {state:"missing",detail:"This in-process immutable copy has no surviving external operation or acknowledged candidate. Inspection did not copy again. Request a new job explicitly."};},
  };
}
