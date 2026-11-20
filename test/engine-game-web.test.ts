import assert from "node:assert/strict";
import test from "node:test";
import {createHash} from "node:crypto";
import * as path from "node:path";
import { mkdtemp, rm, cp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createWebGameAdapters } from "../packages/adapter-game-web/src/index";
import { fixtureGameDocument } from "./game-fixtures";
import { webFixture } from "./game-web-fixtures";
import type { ProductionAccess } from "../packages/game-production/src/index";
import audioLock from '../packages/adapter-game-web/audio.lock.json';
import saveLock from '../packages/adapter-game-web/save.lock.json';
import { gameWebProjectConfig } from '../packages/contracts/src/game-web-compiler';

const directory = path.resolve("packages/adapter-game-web/runtimes");
function context(engine: "phaser" | "babylon", source = webFixture(engine)): ProductionAccess {
  const document = fixtureGameDocument(); document.engine = engine;
  if (engine === "babylon") document.brief.dimension = "3d";
  document.files = [...source].map(([name, data]) => ({ path: name, mime: "text/plain", transferId: "fixture", sha256: "0".repeat(64), size: Buffer.byteLength(data) }));
  return { document, registration: { id: "test", product: "companion-mac", profile: "default", workspace: "", providers: ["ollama"], hostTools: [] },
    job: { id: "test", kind: "build", projectId: "test", revision: 1, sourceHash: "0".repeat(64), adapterId: "test", toolchain: { id: "test", version: "test", sha256: "0".repeat(64) }, engine, state: "running", createdAt: 1, updatedAt: 1 },
    signal: new AbortController().signal, readFile: async (name) => { const data = source.get(name); if (data === undefined) throw new Error("Missing fixture file"); return Buffer.from(data); } };
}

test("explicit web delivery is portable, closed and optional, including an empty static inventory",()=>{
  const base={schemaVersion:1,entry:"src/main.ts",engineVersion:"4.2.1"};
  assert.deepEqual(gameWebProjectConfig.parse(base),base);
  assert.ok(gameWebProjectConfig.safeParse({...base,delivery:{schemaVersion:1,files:[]}}).success);
  for(const files of [["../outside"],["src/main.ts"],["engine/license"],["assets/source.blend"],
    ["assets/source.blend1"],["assets/x","assets/X"],["assets/Dir/a","assets/dir/b"],
    ["assets/a","assets/a/b"],["assets/%2e%2e/key"],["data/file?token=private"]])
    assert.equal(gameWebProjectConfig.safeParse({...base,delivery:{schemaVersion:1,files}}).success,false);
  for(const delivery of [{schemaVersion:2,files:[]},{schemaVersion:1,files:[],fallback:true}])
    assert.equal(gameWebProjectConfig.safeParse({...base,delivery}).success,false);
});

test("explicit delivery packages selected media with full ancestor metadata/notices while preserving source and legacy output",async()=>{
  for(const engine of ["phaser","babylon"] as const){
    const source=webFixture(engine),master="assets/master.wav",variant="assets/tone.compact.m4a";
    source.set(master,"original synthetic master");source.set(variant,"synthetic codec bytes, not playable AAC");
    source.set("assets/original/COPYING.txt","FULL ORIGINAL NOTICE\nDo not truncate.");
    source.set("assets/tone.encoded.json",'{"sourceSha256":"fixture"}');source.set("assets/source.blend","editable bytes");
    source.set("data/levels.json",'{"rounds":[1,2]}');
    const access=context(engine,source);
    for(const file of access.document.files){if(file.path===master)file.mime="audio/wav";if(file.path===variant)file.mime="audio/mp4";}
    const origin={kind:"local" as const,source:"Authored fixture",author:"Test",license:"Declared test terms, unverified",referenceIds:[] as string[]};
    access.document.assets=[{id:"master",kind:"audio",role:"Master",placeholder:true,files:[master,"assets/original/COPYING.txt"],origin},
      {id:"variant",kind:"audio",role:"Delivery",placeholder:true,files:[variant,"assets/tone.encoded.json"],origin:{...origin,referenceIds:["master"]}}];
    const adapter=createWebGameAdapters(directory).find(item=>item.engine===engine)!;
    const legacy=await adapter.build(access),original=structuredClone(access.document);
    assert.ok(legacy.files.some(file=>file.path===master));assert.ok(!legacy.files.some(file=>file.path==="engine/COMPANION-DELIVERY.json"));
    const settings=JSON.parse(source.get("game.web.json")!);settings.delivery={schemaVersion:1,files:[variant,"data/levels.json"]};source.set("game.web.json",JSON.stringify(settings));
    const requested=await adapter.build(access),names=requested.files.map(file=>file.path);
    assert.ok(!names.includes(master));assert.ok(!names.includes("assets/fixture.txt"));assert.ok(!names.includes("assets/source.blend"));
    for(const name of [variant,"data/levels.json","assets/original/COPYING.txt","assets/tone.encoded.json","game.css"])assert.ok(names.includes(name),name);
    const report=JSON.parse(Buffer.from(requested.files.find(file=>file.path==="engine/COMPANION-DELIVERY.json")!.data).toString());
    assert.equal(report.sourceHash,access.job.sourceHash);assert.equal(report.licenseStatus,"declared-unverified");
    assert.equal(report.assets.length,2);assert.deepEqual(report.assets.find((a:{id:string})=>a.id==="variant").origin.referenceIds,["master"]);
    assert.equal(report.omitted.find((f:{path:string})=>f.path===master).size,Buffer.byteLength(source.get(master)!));
    assert.equal(report.included.find((f:{path:string})=>f.path==="assets/original/COPYING.txt").reason,"asset-metadata");
    assert.equal(Buffer.from(requested.files.find(file=>file.path==="assets/original/COPYING.txt")!.data).toString(),source.get("assets/original/COPYING.txt"));
    assert.deepEqual(access.document,original); // Compilation never mutates immutable source metadata.
    settings.delivery.files=[];source.set("game.web.json",JSON.stringify(settings));const empty=await adapter.build(access);
    assert.ok(!empty.files.some(file=>file.path.startsWith("assets/")||file.path.startsWith("data/")));assert.ok(empty.files.some(file=>file.path==="game.css"));
    settings.delivery.files=["assets/missing.m4a"];source.set("game.web.json",JSON.stringify(settings));await assert.rejects(adapter.build(access),/absent from the exact project revision/);
    settings.delivery.files=[variant];source.set("game.web.json",JSON.stringify(settings));
    access.registration.product="kidos";await assert.rejects(adapter.build(access),/unavailable to the fixed Core/);
    access.registration.product="companion-mac";await assert.rejects(createWebGameAdapters(directory,"development-unreleased",{audioRuntime:false}).find(a=>a.engine===engine)!.build(access),/unavailable to the fixed Core/);
    delete settings.delivery;source.set("game.web.json",JSON.stringify(settings));
    const restored=await adapter.build(access);assert.deepEqual(restored,legacy);
  }
});

test("optional pinned audio module bundles with its notice only on explicit import and stays out of the fixed Core profile",async()=>{
  for(const engine of ["phaser","babylon"] as const){
    const source=webFixture(engine);source.set("src/main.ts",`import {createGameAudio,audioRuntimeVersion} from '@companion/game-audio';globalThis.audioVersion=audioRuntimeVersion;globalThis.audio=createGameAudio({assets:{tone:{path:'assets/tone.wav',bus:'effects'}},states:{quiet:[]}});`);
    const adapter=createWebGameAdapters(directory).find(item=>item.engine===engine)!,result=await adapter.build(context(engine,source));
    assert.ok(result.files.some(file=>file.path==="engine/GAME-AUDIO-LICENSE.txt"));assert.ok(Buffer.from(result.files.find(file=>file.path==="game.js")!.data).toString().includes(`Companion game audio runtime ${audioLock.version}`));
    const ordinary=await adapter.build(context(engine));assert.equal(ordinary.files.some(file=>file.path==="engine/GAME-AUDIO-LICENSE.txt"),false);
    const legacy=createWebGameAdapters(directory,"development-unreleased",{audioRuntime:false}).find(item=>item.engine===engine)!;
    await assert.rejects(legacy.build(context(engine,source)),/Only pinned engine imports/);assert.match(legacy.toolchain.version,/adapter\.1$/);assert.match(adapter.toolchain.version,/adapter\.4$/);
    const child=context(engine,source);child.registration.product="kidos";await assert.rejects(adapter.build(child),/Only pinned engine imports/);
  }
});

test('optional game save module bundles offline only on explicit import and is refused by fixed Core',async()=>{
  for(const engine of ['phaser','babylon'] as const){
    const source=webFixture(engine);source.set('src/main.ts',`import {createGameSave,saveRuntimeVersion} from '@companion/game-save';globalThis.fixtureSave=createGameSave({gameId:'fixture',slot:'campaign',version:1,validate:value=>Boolean(value&&typeof value==='object')});globalThis.saveVersion=saveRuntimeVersion;`);
    const adapter=createWebGameAdapters(directory).find(a=>a.engine===engine)!,result=await adapter.build(context(engine,source));
    assert.ok(adapter.projectGuide!.length<=4000);assert.match(adapter.toolchain.version,/adapter\.4$/);
    assert.ok(result.files.some(file=>file.path==='engine/GAME-SAVE-LICENSE.txt'));
    assert.ok(Buffer.from(result.files.find(file=>file.path==='game.js')!.data).toString().includes('Companion game save runtime 1.0.0'));
    assert.equal((await adapter.build(context(engine))).files.some(file=>file.path==='engine/GAME-SAVE-LICENSE.txt'),false);
    await assert.rejects(createWebGameAdapters(directory,'fixture',{audioRuntime:false}).find(a=>a.engine===engine)!.build(context(engine,source)),/Only pinned engine imports/);
    const child=context(engine,source);child.registration.product='kidos';await assert.rejects(adapter.build(child),/Only pinned engine imports/);
  }
});

test('save pin changes refuse workspace compilation while the frozen Core profile remains separate',async()=>{
  const temporary=await mkdtemp(path.join(tmpdir(),'save-runtime-pin-'));try{
    await cp(directory,temporary,{recursive:true});await writeFile(path.join(temporary,saveLock.entry),'export const unverified=true;');
    const source=webFixture('phaser');source.set('src/main.ts',"import {createGameSave} from '@companion/game-save';globalThis.save=createGameSave({gameId:'test',slot:'slot',version:1,validate:()=>true});");
    const adapter=createWebGameAdapters(temporary)[0]!;assert.equal((await adapter.probe(context('phaser').registration)).available,false);
    await assert.rejects(adapter.build(context('phaser',source)),/game save integrity/);
    assert.equal((await createWebGameAdapters(temporary,'pin',{audioRuntime:false})[0]!.probe(context('phaser').registration)).available,true);
  }finally{await rm(temporary,{recursive:true,force:true});}
});

test("audio runtime integrity is mandatory and cannot fall back to an unverified copy",async()=>{
  const temporary=await mkdtemp(path.join(tmpdir(),"audio-runtime-pin-"));try{
    await cp(directory,temporary,{recursive:true});await writeFile(path.join(temporary,audioLock.entry),"export const replaced=true;");
    for(const adapter of createWebGameAdapters(temporary))assert.equal((await adapter.probe(context("phaser").registration)).available,false);
    // The separately pinned legacy Core profile neither advertises nor loads audio.
    assert.equal((await createWebGameAdapters(temporary,"pin",{audioRuntime:false})[0]!.probe(context("phaser").registration)).available,true);
  }finally{await rm(temporary,{recursive:true,force:true});}
});

test("both real web compilers bundle modular TypeScript, CSS, engine code, assets and licenses offline", async () => {
  for (const adapter of createWebGameAdapters(directory)) {
    assert.equal((await adapter.probe(context("phaser").registration)).available, true);
    const result = await adapter.build(context(adapter.engine as "phaser" | "babylon"));
    const names = result.files.map((file) => file.path);
    for (const name of ["index.html", "game.js", "game.css", "base.css", "assets/fixture.txt"]) assert.ok(names.includes(name), name);
    assert.ok(names.some((name) => name.includes("LICENSE")));
    const html = Buffer.from(result.files.find((file) => file.path === "index.html")!.data).toString();
    assert.match(html, /connect-src 'self'/);
    const policy=/http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)![1]!;
    assert.ok(policy.includes(`style-src 'self' 'sha256-${createHash("sha256").update("body {}").digest("base64")}'`));
    assert.equal((policy.match(/'sha256-/g)??[]).length,1);
    assert.doesNotMatch(policy,/unsafe-inline|unsafe-eval|nonce-|unsafe-hashes/);
    assert.match(policy,/script-src 'self';/);
    assert.doesNotMatch(html, /https?:\/\//);
    assert.match(Buffer.from(result.files.find((file) => file.path === "game.js")!.data).toString(), /globalThis\./);
  }
});

test("web compiler rejects Node packages, filesystem traversal, project plugins and unpinned runtime upgrades", async () => {
  const adapter = createWebGameAdapters(directory)[0]!;
  for (const imported of ["node:fs", "../../../../etc/passwd", "https://example.com/module.js", "/etc/passwd", "other-package"]) {
    const source = webFixture("phaser"); source.set("src/main.ts", `import x from ${JSON.stringify(imported)}; console.log(x);`);
    await assert.rejects(adapter.build(context("phaser", source)), /Only pinned engine imports|not present/);
  }
  const source = webFixture("phaser"); source.set("game.web.json", JSON.stringify({ schemaVersion: 1, entry: "src/main.ts", engineVersion: "latest", plugins: ["evil"] }));
  await assert.rejects(adapter.build(context("phaser", source)), /Unrecognized key/);
  source.set("game.web.json", JSON.stringify({ schemaVersion: 1, entry: "src/main.ts", engineVersion: "latest" }));
  await assert.rejects(adapter.build(context("phaser", source)), /migrate it explicitly/);
});

test("installed web guidance matches the actual canvas host and permits only packaged glTF dependencies",async()=>{
  for(const adapter of createWebGameAdapters(directory)){
    const result=await adapter.build(context(adapter.engine as "phaser"|"babylon")),html=Buffer.from(result.files.find(file=>file.path==="index.html")!.data).toString();
    assert.equal((html.match(/<canvas\b/g)??[]).length,1);assert.match(html,/<canvas id="game"/);
    assert.match(adapter.projectGuide??"",/existing HTMLCanvasElement canvas#game, not a container/);
    if(adapter.engine==="phaser")assert.match(adapter.projectGuide??"",/config.canvas.*parent set to game.*blank canvas/);
    else assert.match(adapter.projectGuide??"",/dependencies packaged under assets\/ at their preserved relative paths.*no network textures or remote decoders/);
  }
});

test("missing or modified packaged runtimes are unavailable, and interrupted in-memory builds are never replayed", async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), "web-runtime-test-"));
  try {
    const adapter = createWebGameAdapters(temporary)[0]!;
    assert.equal((await adapter.probe(context("phaser").registration)).available, false);
    await cp(directory, temporary, { recursive: true });
    assert.equal((await adapter.probe(context("phaser").registration)).available, true);
    await writeFile(path.join(temporary, "phaser-4.2.1.min.js"), "tampered");
    assert.equal((await adapter.probe(context("phaser").registration)).available, false);
    assert.equal((await adapter.reconcile!(context("phaser"))).state, "missing");
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test("Babylon glTF2 is pinned, preloaded before game code and cannot be imported by another engine",async()=>{
  const source=webFixture("babylon");source.set("src/main.ts","import {GLTFFileLoader} from 'babylonjs-loaders/glTF/2.0'; console.log(GLTFFileLoader);");
  source.set("assets/source.blend","editable source, never a runtime file");
  const adapter=createWebGameAdapters(directory).find((item)=>item.engine==="babylon")!;
  const result=await adapter.build(context("babylon",source)),html=Buffer.from(result.files.find((f)=>f.path==="index.html")!.data).toString();
  assert.ok(html.indexOf("babylon-9.35.0.js")<html.indexOf("babylon-gltf2-9.35.0.min.js"));
  assert.ok(html.indexOf("babylon-gltf2-9.35.0.min.js")<html.indexOf('src="game.js"'));
  assert.ok(result.files.some((file)=>file.path==="engine/BABYLON-LOADERS-LICENSE.md"));
  assert.ok(!result.files.some((file)=>file.path.endsWith(".blend")));
  const other=webFixture("phaser");other.set("src/main.ts",source.get("src/main.ts")!);
  await assert.rejects(createWebGameAdapters(directory)[0]!.build(context("phaser",other)),/Only pinned engine imports/);
  const temporary=await mkdtemp(path.join(tmpdir(),"gltf-runtime-"));
  try{await cp(directory,temporary,{recursive:true});await writeFile(path.join(temporary,"babylon-gltf2-9.35.0.min.js"),"tampered");
    assert.equal((await createWebGameAdapters(temporary)[1]!.probe(context("babylon").registration)).available,false);
  }finally{await rm(temporary,{recursive:true,force:true});}
});
