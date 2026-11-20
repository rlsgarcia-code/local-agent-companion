import { z } from "zod";
import {createHash} from "node:crypto";
import { AgentError, errors, type Registration } from "../../contracts/src/index";
import { assetFingerprint, assetSourceInputs, AssetSourceError, assetOutputPaths, gameAssetApplyRequest, gameAssetResult, type GameAssetSpec, type GameAssetResult } from "../../contracts/src/game-assets";
import { gameFilePath, gameFileTreeConflict, type GameDocument, type GameProject } from "../../contracts/src/games";
import { contentHash } from "../../contracts/src/identity";
import type { GameProductionJob } from "../../contracts/src/game-production";
import type { GameBlobAccess, ProcessedGameAsset } from "../../game-production/src/index";
import type { Store } from "./store";
import type { GameProjects } from "./game-projects";
import { namespace } from "./security";

export class GameAssetResults {
  constructor(private readonly store: Store,private readonly projects: GameProjects,private readonly blobs: GameBlobAccess) {
    store.db.exec(`CREATE TABLE IF NOT EXISTS game_asset_results(job TEXT PRIMARY KEY REFERENCES game_production_jobs(id),namespace TEXT NOT NULL,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS game_asset_result_files(job TEXT NOT NULL REFERENCES game_asset_results(job),path TEXT NOT NULL,transfer TEXT NOT NULL REFERENCES transfers(id),PRIMARY KEY(job,path));
      CREATE TABLE IF NOT EXISTS game_asset_applications(namespace TEXT NOT NULL,request TEXT NOT NULL,binding TEXT NOT NULL,value TEXT NOT NULL,PRIMARY KEY(namespace,request));`);
  }
  sources(document:GameDocument,spec:GameAssetSpec) {
    try{return assetSourceInputs(document,spec).assets;}
    catch(error){if(error instanceof AssetSourceError)throw new AgentError(errors[error.kind],error.message);throw error;}
  }
  get(reg:Registration,jobId:string):GameAssetResult {
    const row=this.store.db.prepare("SELECT value FROM game_asset_results WHERE namespace=? AND job=?").get(namespace(reg),jobId) as {value:string}|undefined;
    if(!row)throw new AgentError(errors.missing,"No acknowledged processed asset exists in this namespace.");return gameAssetResult.parse(JSON.parse(row.value));
  }
  publish(reg:Registration,job:GameProductionJob,document:GameDocument,produced:ProcessedGameAsset):GameAssetResult {
    const spec=job.assetSpec!,sourceAssets=this.sources(document,spec),operation=spec.operation,recipeHash=contentHash(spec);
    const expected=assetOutputPaths(operation);
    const names=new Set<string>();let bytes=0;
    for(const file of produced.files){gameFilePath.parse(file.path);
      if(!(file.data instanceof Uint8Array))throw new AgentError(errors.invalid,"Asset processor output must contain binary file content.");bytes+=file.data.byteLength;
      if(!expected.includes(file.path)||names.has(file.path)||bytes>128*1024*1024)throw new AgentError(errors.invalid,"Asset processor returned unexpected, duplicate or oversized output files.");names.add(file.path);}
    if(operation.type==="image.atlas"?(!names.has(expected[0]!)||!names.has(expected[1]!)||produced.files.length>operation.maxPages+1):(produced.files.length!==expected.length))throw new AgentError(errors.invalid,"Media output is incomplete.");
    if(operation.type==="image.atlas"&&expected.slice(1,produced.files.length).some((name)=>!names.has(name)))throw new AgentError(errors.invalid,"Atlas pages must be contiguous; no page may be silently dropped.");
    if(operation.type==="library.copy")for(const declared of operation.selection.entry.files){
      const file=produced.files.find(file=>file.path===`${operation.outputBase}/${declared.path}`);
      if(!file||file.mime!==declared.mime||file.data.byteLength!==declared.size||createHash("sha256").update(file.data).digest("hex")!==declared.sha256)
        throw new AgentError(errors.invalid,"Library output does not preserve its exact pinned dependency/license file.");
    }
    if(operation.type==="library.copy"){
      const sidecar=produced.files.find(file=>file.path===`${operation.outputBase}/LIBRARY.json`)!;
      let declared:unknown;try{if(sidecar.data.byteLength<=512*1024)declared=JSON.parse(Buffer.from(sidecar.data).toString("utf8"));}catch{/* Reject without retaining untrusted argument/file content in a diagnostic. */}
      if(sidecar.mime!=="application/json"||declared===undefined||contentHash(declared)!==contentHash({schemaVersion:1,...operation.selection}))
        throw new AgentError(errors.invalid,"Library metadata sidecar does not preserve the exact pinned selection.");
    }
    const sources=sourceAssets.map((source)=>({asset:document.assets.find((item)=>item.id===source.id)!,hash:source.hash}));
    const provenancePath=`assets/provenance/${job.id}.json`;
    const provenance={schemaVersion:1,jobId:job.id,projectId:job.projectId,sourceRevision:job.revision,sourceHash:job.sourceHash,toolchain:job.toolchain,recipeHash,spec,
      licenseStatus:"declared-unverified",sources:sources.map(({asset,hash})=>({asset,hash,files:asset.files.map((name)=>{const {transferId:_id,...file}=document.files.find((item)=>item.path===name)!;return file;})}))};
    const files=this.blobs.store(reg,[...produced.files,{path:provenancePath,mime:"application/json",data:Buffer.from(JSON.stringify(provenance))}]);
    const conflict=gameFileTreeConflict(files.map((file)=>file.path));if(conflict)throw new AgentError(errors.invalid,conflict.message);
    const result=gameAssetResult.parse({jobId:job.id,projectId:job.projectId,revision:job.revision,sourceHash:job.sourceHash,processorId:job.adapterId,toolchain:job.toolchain,recipeHash,spec,sourceAssets,
      previousTargetHash:assetFingerprint(document,spec.target.id),asset:{id:spec.target.id,role:spec.target.role,kind:operation.type==="library.copy"?operation.selection.entry.kind:operation.type==="model.scene"?"model":(operation.type==="audio.render"||operation.type==="audio.encode")?"audio":operation.type==="image.atlas"?"atlas":"image",
        files:files.map((file)=>file.path),placeholder:spec.target.placeholder||sources.some(({asset})=>asset.placeholder)||(operation.type==="library.copy"&&Boolean(document.assets.find(asset=>asset.id===spec.target.id)?.placeholder)),
        origin:{kind:operation.type==="library.copy"?"library":sourceAssets.length?"local":"procedural",source:operation.type==="library.copy"?operation.selection.library.source:`${job.adapterId} ${operation.type}; recipe ${recipeHash}; full declarations in ${provenancePath}`,
          author:operation.type==="library.copy"?operation.selection.library.author:sourceAssets.length?"Derived locally from the recorded project sources":"Project procedural media production",
          license:operation.type==="library.copy"?`${operation.selection.library.spdx}; complete original notices: ${operation.selection.library.licenseFiles.map(file=>`${operation.outputBase}/${file}`).join(", ")}. Declared by the pinned upstream source; independent review remains required.`:sourceAssets.length?`Derived from ${sourceAssets.length} source asset declarations; preserve the full licenses in ${provenancePath}. Not independently verified.`:"Original procedural production; independent license review remains required.",
          referenceIds:sourceAssets.map((source)=>source.id),operationId:job.id},
        processing:{jobId:job.id,sourceRevision:job.revision,processorId:job.adapterId,toolchainSha256:job.toolchain.sha256,recipeHash}},files,info:produced.info,createdAt:Date.now()});
    this.store.db.prepare("INSERT INTO game_asset_results VALUES(?,?,?)").run(job.id,namespace(reg),JSON.stringify(result));
    for(const file of files)this.store.db.prepare("INSERT INTO game_asset_result_files VALUES(?,?,?)").run(job.id,file.path,file.transferId);
    return result;
  }
  apply(reg:Registration,input:z.infer<typeof gameAssetApplyRequest>):GameProject {
    const request=gameAssetApplyRequest.parse(input),binding=contentHash(request),ns=namespace(reg);
    return this.store.db.transaction(()=>{
      const old=this.store.db.prepare("SELECT binding,value FROM game_asset_applications WHERE namespace=? AND request=?").get(ns,request.requestId) as {binding:string;value:string}|undefined;
      if(old){if(old.binding!==binding)throw new AgentError(errors.conflict,"Asset application identity was reused for different content.");return JSON.parse(old.value) as GameProject;}
      const result=this.get(reg,request.jobId),revision=this.projects.revision(reg,result.projectId);
      if(revision.revision!==request.expectedRevision)throw new AgentError(errors.conflict,"Refresh the project before applying this processed asset.");
      const document=revision.document;
      if(result.sourceAssets.some((source)=>assetFingerprint(document,source.id)!==source.hash)||assetFingerprint(document,result.asset.id)!==result.previousTargetHash)
        throw new AgentError(errors.conflict,"Source or target asset changed since processing; preserve the candidate and reconcile explicitly.");
      const previous=document.assets.find((asset)=>asset.id===result.asset.id),owned=new Set(previous?.files??[]);
      for(const file of result.files)if(document.files.some((item)=>item.path===file.path)&&(!owned.has(file.path)||document.assets.some((asset)=>asset.id!==result.asset.id&&asset.files.includes(file.path))))
        throw new AgentError(errors.conflict,"Processed output would overwrite another project file or shared asset. Candidate preserved.");
      for(const file of result.files)this.blobs.read(reg,file);
      const files=[...document.files.filter((file)=>!result.files.some((item)=>item.path===file.path)),...result.files];
      const project=this.projects.commit(reg,{projectId:result.projectId,requestId:`asset-apply-${contentHash({ns,key:request.requestId})}`,expectedRevision:request.expectedRevision,
        document:{...document,files,assets:[...document.assets.filter((asset)=>asset.id!==result.asset.id),result.asset]},message:`Apply processed asset ${result.asset.id}`.slice(0,300)});
      this.store.db.prepare("INSERT INTO game_asset_applications VALUES(?,?,?,?)").run(ns,request.requestId,binding,JSON.stringify(project));return project;
    }).immediate();
  }
}
