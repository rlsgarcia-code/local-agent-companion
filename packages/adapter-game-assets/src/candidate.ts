/** Fixed one-job media processor for a future protected Core broker. */
import { createHash,randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import versions from "../../contracts/src/version.json";
import { canonical } from "../../contracts/src/identity";
import { assetOutputPaths } from "../../contracts/src/game-assets";
import { gameMediaProcessRequest,gameMediaProcessResult,type GameMediaProcessResult } from "../../contracts/src/game-media-worker";
import { gameContentHash } from "../../game-design/src/project";
import { processGameMedia } from "./process";
import { gameMediaToolchain,MEDIA_PROCESSOR_ID } from "./media-toolchain";
import { invalidMedia,mediaDirectory,mediaEntries,readMediaFile,writeMediaFile,syncMediaDirectory,commitMediaResult } from "./candidate-io";

const sha=(bytes:Uint8Array)=>createHash("sha256").update(bytes).digest("hex");

/** Host tests use private fixtures. This function itself is not an OS sandbox. */
export async function processMediaCandidate(options:{inputDirectory:string;outputDirectory:string;implementationSha256:string;signal?:AbortSignal}):Promise<GameMediaProcessResult> {
  const input=path.resolve(options.inputDirectory),output=path.resolve(options.outputDirectory),signal=options.signal??new AbortController().signal;
  if(input===output||input.startsWith(output+path.sep)||output.startsWith(input+path.sep))invalidMedia();
  const toolchain=gameMediaToolchain(options.implementationSha256);
  await mediaDirectory(input);await mediaDirectory(path.join(input,"blobs"));await mediaDirectory(output);
  if((await mediaEntries(output,1)).length)invalidMedia();
  if(canonical((await mediaEntries(input,2)).sort())!==canonical(["blobs","request.json"]))invalidMedia();
  signal.throwIfAborted();
  await writeMediaFile(path.join(output,"result.lock"),Buffer.alloc(0));await syncMediaDirectory(output);
  const raw=await readMediaFile(path.join(input,"request.json"),16*1024*1024);
  const request=gameMediaProcessRequest.parse(JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(raw)));
  if(request.spec.processorId!==MEDIA_PROCESSOR_ID||gameContentHash(request.document)!==request.sourceHash||canonical(request.toolchain)!==canonical(toolchain))invalidMedia();
  const expected=new Set(request.sources.map(file=>file.sha256)),entries=await mediaEntries(path.join(input,"blobs"),256);
  if(entries.length!==expected.size||entries.some(name=>!expected.has(name)))invalidMedia();
  const blobs=new Map<string,Buffer>(),files=new Map<string,Buffer>();
  for(const file of request.sources){
    signal.throwIfAborted();let data=blobs.get(file.sha256);
    if(!data){data=await readMediaFile(path.join(input,"blobs",file.sha256),file.size);if(data.length!==file.size||sha(data)!==file.sha256)invalidMedia();blobs.set(file.sha256,data);}
    if(data.length!==file.size)invalidMedia();files.set(file.path,data);
  }
  signal.throwIfAborted();
  const produced=processGameMedia(request.spec.operation,files),allowed=assetOutputPaths(request.spec.operation);
  const result=gameMediaProcessResult.parse({schemaVersion:1,requestId:request.requestId,requestSha256:sha(raw),sourceHash:request.sourceHash,recipeHash:request.recipeHash,toolchain,
    files:produced.files.map(file=>({path:file.path,mime:file.mime,size:file.data.byteLength,sha256:sha(file.data)})),info:produced.info});
  const names=new Set(result.files.map(file=>file.path));
  if(result.files.some(file=>!allowed.includes(file.path))||!names.has(allowed[0]!)||
    request.spec.operation.type==="image.atlas"&&allowed.slice(1,result.files.length).some(name=>!names.has(name)))invalidMedia();
  signal.throwIfAborted();await mkdir(path.join(output,"candidate"),{mode:0o700});
  const written=new Set<string>();
  for(let index=0;index<result.files.length;index++){
    signal.throwIfAborted();const metadata=result.files[index]!;
    if(!written.has(metadata.sha256)){await writeMediaFile(path.join(output,"candidate",metadata.sha256),produced.files[index]!.data);written.add(metadata.sha256);}
  }
  await syncMediaDirectory(path.join(output,"candidate"));signal.throwIfAborted();
  const pending=path.join(output,`result-${randomUUID()}.pending`);
  await writeMediaFile(pending,Buffer.from(canonical(result)));signal.throwIfAborted();
  await commitMediaResult(pending,path.join(output,"result.json"));
  return result;
}

if(require.main===module){
  const args=process.argv.slice(2),controller=new AbortController();
  process.once("SIGTERM",()=>controller.abort());process.once("SIGINT",()=>controller.abort());
  if(process.platform!=="linux"||process.versions.node!==versions.node||args.length!==3){process.stderr.write("The fixed media worker requires bundled Linux Node and three broker arguments.\n");process.exitCode=1;}
  else void processMediaCandidate({inputDirectory:args[0]!,outputDirectory:args[1]!,implementationSha256:args[2]!,signal:controller.signal})
    .then(result=>{process.stdout.write(JSON.stringify({schemaVersion:1,requestId:result.requestId,files:result.files.length})+"\n");})
    .catch(()=>{process.stderr.write("The isolated media operation did not complete; inspect the original candidate.\n");process.exitCode=1;});
}
