/** Fixed one-job compiler for an OS-isolated broker. It never executes project code. */
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, rename } from "node:fs/promises";
import path from "node:path";
import { gameWebCompileRequest, gameWebCompileResult, type GameWebCompileResult } from "../../contracts/src/game-web-compiler";
import { gameContentHash } from "../../game-design/src/project";
import { canonical } from "../../contracts/src/identity";
import { NODE_VERSION, type Registration } from "../../contracts/src/index";
import { createWebGameAdapters } from "./index";
import { flushPublishedDirectory } from "../../platform-files/src/directory-flush";

const sha = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
function fail(): never { throw new Error("The bounded compiler exchange is invalid; source and candidate were preserved."); }

async function directory(file: string): Promise<void> {
  const stat = await lstat(file);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail();
}
async function read(file: string, limit: number): Promise<Buffer> {
  const before = await lstat(file);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > limit) fail();
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > limit || stat.dev !== before.dev || stat.ino !== before.ino) fail();
    // Limit allocation even if another process grows the input. The broker
    // mounts a sealed input read-only; hashing still verifies exact bytes.
    const buffer = Buffer.alloc(stat.size + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    if (offset !== stat.size) fail();
    return buffer.subarray(0, offset);
  } finally { await handle.close(); }
}
async function write(file: string, bytes: Uint8Array): Promise<void> {
  const handle = await open(file, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); }
  finally { await handle.close(); }
}

/** Host tests call this with private directories; production must use an OS sandbox. */
export async function compileWebCandidate(options: {
  inputDirectory: string; outputDirectory: string; runtimeDirectory: string;
  implementationSha256: string; signal?: AbortSignal;
}): Promise<GameWebCompileResult> {
  const input = path.resolve(options.inputDirectory), output = path.resolve(options.outputDirectory);
  if (input === output || input.startsWith(output + path.sep) || output.startsWith(input + path.sep) ||
      !/^[a-f0-9]{64}$/.test(options.implementationSha256)) fail();
  await directory(input); await directory(path.join(input,"blobs")); await directory(output);
  if((await readdir(output)).length) fail();
  const marker=await open(path.join(output,"result.lock"),constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);
  await marker.close();
  const request = gameWebCompileRequest.parse(JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(await read(path.join(input,"request.json"),16*1024*1024))));
  if (gameContentHash(request.document) !== request.sourceHash) fail();
  const adapter = createWebGameAdapters(options.runtimeDirectory, options.implementationSha256,{audioRuntime:false}).find(item=>item.engine===request.document.engine);
  if(!adapter || canonical(adapter.toolchain)!==canonical(request.toolchain)) fail();
  // Only content-addressed declared blobs are visible to the compiler. Transfer
  // references and document paths never become host filesystem paths.
  const sources = new Map(request.document.files.map(file=>[file.path,file]));
  const readFile = async (name: string) => {
    const file=sources.get(name); if(!file) return fail();
    const bytes=await read(path.join(input,"blobs",file.sha256),Math.min(256*1024*1024,file.size));
    if(bytes.length!==file.size||sha(bytes)!==file.sha256) fail();
    return bytes;
  };
  const signal = options.signal ?? new AbortController().signal;
  for(const file of request.document.files){signal.throwIfAborted();await readFile(file.path);}
  // This private pure compilation call has no workspace or host tool port.
  // Core authorizes the caller outside this disposable process, never by this value.
  const registration: Registration = {id:"isolated-compiler",product:"kidos",profile:"broker",workspace:"",providers:[],hostTools:[],toolCatalog:[]};
  const artifact=await adapter.build({registration,document:request.document,signal,readFile,
    job:{id:request.requestId,kind:"build",projectId:"isolated",revision:1,sourceHash:request.sourceHash,
      engine:adapter.engine,adapterId:adapter.id,toolchain:adapter.toolchain,state:"running",createdAt:0,updatedAt:0}});
  signal.throwIfAborted();
  const result=gameWebCompileResult.parse({schemaVersion:1,requestId:request.requestId,sourceHash:request.sourceHash,
    toolchain:adapter.toolchain,entrypoint:artifact.entrypoint,
    files:artifact.files.map(file=>({path:file.path,mime:file.mime,size:file.data.byteLength,sha256:sha(file.data)}))});
  // Unique candidate directory: no overwrite, traversal or partial publication.
  const candidate=path.join(output,"candidate");
  await mkdir(candidate,{mode:0o700});
  const written=new Set<string>();
  for(let index=0;index<artifact.files.length;index++){
    signal.throwIfAborted();
    const file=artifact.files[index]!,metadata=result.files[index]!;
    // Flat hash names avoid deriving output paths from a generated project.
    const target=path.join(candidate,metadata.sha256);
    if(!written.has(metadata.sha256)){await write(target,file.data);written.add(metadata.sha256);}
  }
  const pending=path.join(output,`result-${randomUUID()}.pending`);
  await write(pending,Buffer.from(JSON.stringify(result)));
  // A second invocation must never replace a former acknowledged result.
  await rename(pending,path.join(output,"result.json"));
  await flushPublishedDirectory(output);
  return result;
}

if(require.main===module){
  const controller=new AbortController();
  process.once("SIGTERM",()=>controller.abort());process.once("SIGINT",()=>controller.abort());
  const args=process.argv.slice(2);
  if(process.versions.node!==NODE_VERSION||args.length!==4){process.stderr.write("The fixed compiler requires its bundled runtime and four broker arguments.\n");process.exitCode=1;}
  else void compileWebCandidate({inputDirectory:args[0]!,outputDirectory:args[1]!,runtimeDirectory:args[2]!,implementationSha256:args[3]!,signal:controller.signal})
    .then(result=>{process.stdout.write(JSON.stringify({schemaVersion:1,requestId:result.requestId,files:result.files.length})+"\n");})
    .catch(()=>{process.stderr.write("The isolated web build did not complete; inspect the original candidate.\n");process.exitCode=1;});
}
