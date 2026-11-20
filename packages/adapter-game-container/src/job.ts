import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, rename, rm, lstat } from "node:fs/promises";
import * as path from "node:path";
import { contentHash } from "../../contracts/src/identity";
import { gameFilePath } from "../../contracts/src/games";
import { GameProductionFailure, GameProductionUncertain, type ProductionAccess } from "../../game-production/src/index";
import { dockerCommand } from "./process";

const sha=(data:Uint8Array)=>createHash("sha256").update(data).digest("hex");
const label="org.companion.game-tool-job";
/** Per-operation confinement/receipts, not a queue or agent executor. */
export function isolatedContainerJob<T>(options:{stateDirectory:string;imageId:string;dockerExecutable:string;platform:string;
  entrypoint:readonly string[];validate:(archive:Buffer)=>T;memoryMiB:number;workMiB:number;timeoutMs:number;maxOutputBytes:number;recipeHash:string}){
  const command=(args:string[],opts?:Parameters<typeof dockerCommand>[2])=>dockerCommand(options.dockerExecutable,args,opts);
  const binding=(a:ProductionAccess)=>({jobId:a.job.id,scope:contentHash({product:a.registration.product,profile:a.registration.profile,workspace:a.registration.workspace}),
    sourceHash:a.job.sourceHash,toolchain:a.job.toolchain,imageId:options.imageId,recipeHash:options.recipeHash});
  const id=(a:ProductionAccess)=>contentHash(binding(a));
  const directory=(a:ProductionAccess)=>path.join(options.stateDirectory,"game-tool-jobs",id(a));
  const name=(a:ProductionAccess)=>`companion-tool-${id(a).slice(0,40)}`;
  async function inspect(a:ProductionAccess){
    const found=(await command(["container","ls","--all","--no-trunc","--filter",`name=^/${name(a)}$`,"--format","{{.ID}}"])).toString().trim();
    if(!found)return undefined;
    const [container]=JSON.parse((await command(["container","inspect",found])).toString());
    if(container.Config?.Labels?.[label]!==id(a)||container.Image!==options.imageId)throw new GameProductionUncertain("Container identity differs from the saved operation; no unrelated process was changed.");
    return container as {Id:string};
  }
  async function cleanup(a:ProductionAccess){const container=await inspect(a);if(container)await command(["container","rm","--force",container.Id]);if(await inspect(a))throw new Error("Container termination is unconfirmed.");}
  async function verifyOperation(a:ProductionAccess){
    const file=path.join(directory(a),"operation.json"),metadata=await lstat(file);
    if(!metadata.isFile()||metadata.isSymbolicLink()||metadata.nlink!==1||metadata.mode&0o022||process.getuid&&metadata.uid!==process.getuid()||metadata.size>16384||contentHash(JSON.parse(await readFile(file,"utf8")))!==id(a))throw new GameProductionUncertain("The durable container operation binding is invalid.");
  }
  return {
    async run(a:ProductionAccess,files:readonly {path:string;data:Uint8Array}[]):Promise<T>{
      a.signal.throwIfAborted();let attempted=false,archive:Buffer|undefined,error:unknown;
      const dir=directory(a),source=path.join(dir,"source");
      if(source.includes(","))throw new GameProductionFailure("Container state path cannot contain a comma.");
      try{
        await mkdir(dir,{recursive:true,mode:0o700});await writeFile(path.join(dir,"operation.json"),JSON.stringify(binding(a)),{flag:"wx",mode:0o600});
        await mkdir(source,{mode:0o755});let bytes=0;
        for(const file of files){a.signal.throwIfAborted();gameFilePath.parse(file.path);bytes+=file.data.byteLength;if(bytes>72*1024*1024)throw new Error("Container input exceeds its 72 MiB processing budget.");
          const target=path.join(source,file.path);await mkdir(path.dirname(target),{recursive:true,mode:0o755});await writeFile(target,file.data,{flag:"wx",mode:0o444});}
        const uid=process.getuid?.()||1000,gid=process.getgid?.()||1000;
        attempted=true;
        await command(["create","--platform",options.platform,"--name",name(a),"--label",`${label}=${id(a)}`,"--pull=never","--network","none","--read-only","--cap-drop","ALL","--security-opt","no-new-privileges",
          "--memory",`${options.memoryMiB}m`,"--memory-swap",`${options.memoryMiB}m`,"--cpus","2","--pids-limit","256","--log-driver","none","--user",`${uid}:${gid}`,
          "--tmpfs",`/work:rw,noexec,nosuid,size=${options.workMiB}m,uid=${uid},gid=${gid},mode=0700`,"--tmpfs","/tmp:rw,noexec,nosuid,size=128m,mode=1777",
          "--mount",`type=bind,src=${source},dst=/source,readonly`,"--env","HOME=/tmp/home","--env","XDG_DATA_HOME=/tmp/data","--env","XDG_CONFIG_HOME=/tmp/config","--env","XDG_CACHE_HOME=/tmp/cache",
          "--entrypoint","/bin/sleep",options.imageId,"infinity"],{signal:a.signal});
        await command(["start",name(a)],{signal:a.signal});
        await command(["exec",name(a),...options.entrypoint],{signal:a.signal,timeout:options.timeoutMs,maxBytes:4*1024*1024});
        archive=await command(["exec",name(a),"/bin/tar","--format=pax","-C","/work/output","-cf","-","."],{signal:a.signal,timeout:60000,maxBytes:options.maxOutputBytes});
        options.validate(archive);
        await writeFile(path.join(dir,"candidate.tar"),archive,{flag:"wx",mode:0o600});
        await writeFile(path.join(dir,"receipt.tmp"),JSON.stringify({binding:binding(a),sha256:sha(archive)}),{flag:"wx",mode:0o600});await rename(path.join(dir,"receipt.tmp"),path.join(dir,"receipt.json"));
      }catch(caught){error=caught;}
      finally{if(attempted)try{await cleanup(a);}catch{throw new GameProductionUncertain("The original isolated tool may still be running. Restore it and reconcile before repeating processing.");}}
      a.signal.throwIfAborted();if(error)throw new GameProductionFailure(error instanceof Error?error.message:"Isolated processing failed.");return options.validate(archive!);
    },
    async reconcile(a:ProductionAccess){
      try{await verifyOperation(a);}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}
      try{await cleanup(a);}catch{throw new GameProductionUncertain("Cannot confirm the original tool's termination.");}
      try{
        const dir=directory(a),receipt=path.join(dir,"receipt.json"),receiptMetadata=await lstat(receipt);
        if(!receiptMetadata.isFile()||receiptMetadata.isSymbolicLink()||receiptMetadata.nlink!==1||receiptMetadata.mode&0o022||receiptMetadata.size>16384||process.getuid&&receiptMetadata.uid!==process.getuid())throw new GameProductionUncertain("Invalid isolated candidate receipt ownership or size.");
        const record=JSON.parse(await readFile(receipt,"utf8")),metadata=await lstat(path.join(dir,"candidate.tar"));
        if(contentHash(record.binding)!==id(a)||!metadata.isFile()||metadata.isSymbolicLink()||metadata.nlink!==1||metadata.mode&0o022||process.getuid&&metadata.uid!==process.getuid()||metadata.size>options.maxOutputBytes)throw new GameProductionUncertain("Invalid isolated candidate receipt or size.");
        const archive=await readFile(path.join(dir,"candidate.tar"));if(sha(archive)!==record.sha256)throw new GameProductionUncertain("Isolated candidate hash mismatch.");
        return {state:"completed" as const,result:options.validate(archive)};
      }catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;return {state:"missing" as const,detail:"The original isolated tool is stopped and no acknowledged candidate survived. Source assets remain unchanged; request new processing explicitly."};}
    },
    async dispose(a:ProductionAccess){
      try{await verifyOperation(a);}catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return;throw error;}
      if(await inspect(a))throw new Error("Cannot remove recovery files while the original tool exists.");await rm(directory(a),{recursive:true,force:true});
    },
  };
}
