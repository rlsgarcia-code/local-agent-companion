import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fixtureGameDocument } from "./game-fixtures";
import { webFixture } from "./game-web-fixtures";
import { gameContentHash } from "../packages/game-design/src/project";
import { createWebGameAdapters } from "../packages/adapter-game-web/src/index";
import { compileWebCandidate } from "../packages/adapter-game-web/src/worker";
import { gameWebCompileResult, type GameWebCompileRequest } from "../packages/contracts/src/game-web-compiler";

const implementationSha256="a".repeat(64),runtimeDirectory=path.resolve("packages/adapter-game-web/runtimes");
const hash=(data:Uint8Array)=>createHash("sha256").update(data).digest("hex");
async function fixture(root:string,engine:"phaser"|"babylon"){
 const input=path.join(root,"input"),output=path.join(root,"output");
 await mkdir(path.join(input,"blobs"),{recursive:true});await mkdir(output);
 const document=fixtureGameDocument();document.engine=engine;if(engine==="babylon")document.brief.dimension="3d";
 for(const [name,source] of webFixture(engine)){
  const data=Buffer.from(source),sha256=hash(data);
  document.files.push({path:name,sha256,size:data.length,mime:name.endsWith(".json")?"application/json":"text/plain",transferId:"unused-transfer"});
  await writeFile(path.join(input,"blobs",sha256),data);
 }
 const adapter=createWebGameAdapters(runtimeDirectory,implementationSha256,{audioRuntime:false}).find(item=>item.engine===engine)!;
 const request:GameWebCompileRequest={schemaVersion:1,requestId:"fixture",sourceHash:gameContentHash(document),toolchain:adapter.toolchain,document};
 await writeFile(path.join(input,"request.json"),JSON.stringify(request));
 return {inputDirectory:input,outputDirectory:output,runtimeDirectory,implementationSha256,request};
}

test("fixed Core compiler refuses the optional workspace game audio module with an otherwise valid legacy binding",async()=>{
 const root=await mkdtemp(path.join(tmpdir(),"core-audio-refusal-"));try{
  const options=await fixture(root,"phaser"),file=options.request.document.files.find(file=>file.path==="src/main.ts")!;
  const data=Buffer.from("import {createGameAudio} from '@companion/game-audio'; console.log(createGameAudio);");
  file.sha256=hash(data);file.size=data.length;await writeFile(path.join(options.inputDirectory,"blobs",file.sha256),data);
  options.request.sourceHash=gameContentHash(options.request.document);await writeFile(path.join(options.inputDirectory,"request.json"),JSON.stringify(options.request));
  await assert.rejects(compileWebCandidate(options),/Only pinned engine imports/);
 }finally{await rm(root,{recursive:true,force:true});}
});

test("fixed Core worker refuses explicit delivery even with an empty list and exact sealed legacy binding",async()=>{
 const root=await mkdtemp(path.join(tmpdir(),"core-delivery-refusal-"));try{
  const options=await fixture(root,"phaser"),file=options.request.document.files.find(file=>file.path==="game.web.json")!;
  const config=JSON.parse((await readFile(path.join(options.inputDirectory,"blobs",file.sha256))).toString());
  const data=Buffer.from(JSON.stringify({...config,delivery:{schemaVersion:1,files:[]}}));
  file.sha256=hash(data);file.size=data.length;await writeFile(path.join(options.inputDirectory,"blobs",file.sha256),data);
  options.request.sourceHash=gameContentHash(options.request.document);await writeFile(path.join(options.inputDirectory,"request.json"),JSON.stringify(options.request));
  await assert.rejects(compileWebCandidate(options),/unavailable to the fixed Core compiler/);
  await assert.rejects(readFile(path.join(options.outputDirectory,"result.json")),/ENOENT/);
 }finally{await rm(root,{recursive:true,force:true});}
});
for(const engine of ["phaser","babylon"] as const)test(`one-job ${engine} worker produces hash-addressed local output without evaluating project code`,async()=>{
 const root=await mkdtemp(path.join(tmpdir(),"web-worker-"));
 try{
  const options=await fixture(root,engine);
  const entry=options.request.document.files.find(file=>file.path==="src/main.ts")!;
  const source=Buffer.concat([await readFile(path.join(options.inputDirectory,"blobs",entry.sha256)),Buffer.from("\nglobalThis.__projectMustNotRunDuringBuild=42;")]);
  entry.sha256=hash(source);entry.size=source.length;options.request.sourceHash=gameContentHash(options.request.document);
  await writeFile(path.join(options.inputDirectory,"blobs",entry.sha256),source);
  await writeFile(path.join(options.inputDirectory,"request.json"),JSON.stringify(options.request));
  const result=await compileWebCandidate(options);
  assert.equal((globalThis as Record<string,unknown>).__projectMustNotRunDuringBuild,undefined);
  assert.deepEqual(gameWebCompileResult.parse(JSON.parse(await readFile(path.join(options.outputDirectory,"result.json"),"utf8"))),result);
  for(const file of result.files){const bytes=await readFile(path.join(options.outputDirectory,"candidate",file.sha256));assert.equal(hash(bytes),file.sha256);assert.equal(bytes.length,file.size);}
  assert.ok(result.files.some(file=>file.path.startsWith("engine/")));
  assert.ok((await readFile(path.join(options.outputDirectory,"candidate",result.files.find(file=>file.path==="game.js")!.sha256),"utf8")).includes("__projectMustNotRunDuringBuild"));
  const before=await readFile(path.join(options.outputDirectory,"result.json"));
  await assert.rejects(compileWebCandidate(options));
  assert.deepEqual(await readFile(path.join(options.outputDirectory,"result.json")),before);
 }finally{await rm(root,{recursive:true,force:true});}
});
for(const attack of ["corrupt-blob","symlink-blob","wrong-source","wrong-toolchain","host-import","extra-command","cancelled"] as const)test(`isolated compiler exchange rejects ${attack} and never publishes a success marker`,async()=>{
 const root=await mkdtemp(path.join(tmpdir(),"web-worker-invalid-"));
 try{
  const options=await fixture(root,"phaser"),file=options.request.document.files[0]!;
  if(attack==="corrupt-blob")await writeFile(path.join(options.inputDirectory,"blobs",file.sha256),"corrupt");
  if(attack==="symlink-blob"){
   const blob=path.join(options.inputDirectory,"blobs",file.sha256),external=path.join(root,"external");
   await writeFile(external,await readFile(blob));await rm(blob);await symlink(external,blob);
  }
  if(attack==="wrong-source")options.request.sourceHash="b".repeat(64);
  if(attack==="wrong-toolchain")options.request.toolchain.sha256="b".repeat(64);
  if(attack==="host-import"){
   const entry=options.request.document.files.find(file=>file.path==="src/main.ts")!,data=Buffer.from("import '/etc/passwd';");
   entry.sha256=hash(data);entry.size=data.length;await writeFile(path.join(options.inputDirectory,"blobs",entry.sha256),data);
   options.request.sourceHash=gameContentHash(options.request.document);
  }
  const input={...options.request,...(attack==="extra-command"?{command:["sh","-c","anything"]}:{})};
  await writeFile(path.join(options.inputDirectory,"request.json"),JSON.stringify(input));
  const controller=new AbortController();if(attack==="cancelled")controller.abort();
  await assert.rejects(compileWebCandidate({...options,signal:controller.signal}));
  await assert.rejects(readFile(path.join(options.outputDirectory,"result.json")),/ENOENT/);
 }finally{await rm(root,{recursive:true,force:true});}
});
