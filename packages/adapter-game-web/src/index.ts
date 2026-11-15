import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import * as path from "node:path";
import * as esbuild from "esbuild";
import { gameFilePath } from "../../contracts/src/games";
import { gameWebProjectConfig } from "../../contracts/src/game-web-compiler";
import { contentHash } from "../../contracts/src/identity";
import { GameProductionFailure, type GameProductionAdapter, type ProductionAccess, type ProducedGameArtifact } from "../../game-production/src/index";
import lock from "../runtime.lock.json";
import audioLock from "../audio.lock.json";
import saveLock from '../save.lock.json';
import { isWebResource, selectWebDelivery } from "./delivery";
const loaders: Record<string, esbuild.Loader> = { ".js": "js", ".mjs": "js", ".ts": "ts", ".json": "json", ".css": "css" };
const escaped = (text: string) => text.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
const baseCss = "html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#111}#game{width:100%;height:100%;display:block;touch-action:none}canvas{display:block;max-width:100%}";
// Rendering tools may synchronize layout with this exact empty rule. Allow its
// bytes only: no declarations, inline-style blanket permission, nonce supplied
// by a project, script exception or mutation of an existing artifact's policy.
const emptyStyleHash=createHash("sha256").update("body {}","utf8").digest("base64");
const policy = `default-src 'none'; script-src 'self'; style-src 'self' 'sha256-${emptyStyleHash}'; img-src 'self' data: blob:; font-src 'self'; media-src 'self' blob:; connect-src 'self'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`;

/** Only immutable, verified blobs enter the compiler. Never load project config/plugins or resolve disk packages. */
export function createWebGameAdapters(runtimeDirectory: string, implementationSha256 = "development-unreleased", options:{audioRuntime?:boolean;saveRuntime?:boolean}={}): GameProductionAdapter[] {
  const saveEnabled=options.audioRuntime!==false&&options.saveRuntime!==false;
  return lock.engines.map((runtime): GameProductionAdapter => {
    async function verifiedRuntime() {
      if (esbuild.version !== lock.compiler.version) throw new Error("The pinned game compiler version is unavailable.");
      const files = await Promise.all(Object.entries(runtime.files).map(async ([name, sha256]) => {
        const data = await readFile(path.join(runtimeDirectory, name));
        if (createHash("sha256").update(data).digest("hex") !== sha256) throw new Error("Packaged game runtime integrity check failed.");
        return { path: `engine/${name}`, mime: name.endsWith(".js") ? "text/javascript" : "text/plain", data };
      }));
      return files;
    }
    async function verifiedAudio(){
      const files=new Map<string,Buffer>();
      for(const [name,hash]of Object.entries(audioLock.files)){const bytes=await readFile(path.join(runtimeDirectory,name));if(createHash("sha256").update(bytes).digest("hex")!==hash)throw new Error("Packaged game audio integrity check failed.");files.set(name,bytes);}
      return {source:files.get(audioLock.entry)!,license:{path:"engine/GAME-AUDIO-LICENSE.txt",mime:"text/plain",data:files.get("GAME-AUDIO-LICENSE.txt")!}};
    }
    async function verifiedSave(){
      const files=new Map<string,Buffer>();for(const [name,hash]of Object.entries(saveLock.files)){const bytes=await readFile(path.join(runtimeDirectory,name));if(createHash('sha256').update(bytes).digest('hex')!==hash)throw new Error('Packaged game save integrity check failed.');files.set(name,bytes);}
      return {source:files.get(saveLock.entry)!,license:{path:'engine/GAME-SAVE-LICENSE.txt',mime:'text/plain',data:files.get('GAME-SAVE-LICENSE.txt')!}};
    }
    const adapter: GameProductionAdapter = {
      id: `web-${runtime.engine}-v1`, engine: runtime.engine as "phaser" | "babylon",
      products: ["companion-mac", "companion-vscode"], authority: "workspace",
      resources: { memoryMiB: 1024, cpuSlots: 1, exclusiveGroups: [] },
      projectGuide: (options.audioRuntime!==false?`Optional game.web.json delivery:{schemaVersion:1,files:["assets/theme.compact.m4a","data/levels.json"]} explicitly selects static resources for the web build. Omit delivery to preserve all legacy assets/data; [] creates a resource-free build. Include every dynamic URL, texture/model dependency and playtest recipe deliberately; no automatic dependency inference or format fallback. Missing files fail the build. Metadata/text notices of selected registered assets and their provenance ancestors are retained automatically, as engine/COMPANION-DELIVERY.json records; license declarations remain unverified. Originals and all revisions remain in the editable project/export. This is not a quality or loading-time claim. The fixed Core compiler refuses delivery. `:" ")+(options.audioRuntime!==false?`Optional pinned module ${audioLock.module}: import {createGameAudio} from "${audioLock.module}". Version ${audioLock.version}. Configure assets {id:{path:"assets/name.wav",bus:"music"|"ambience"|"effects",gain:0..1}} and states {menu:["musicId"],play:["musicId","ambienceId"]}. Use canonical PCM16 WAV or an explicit M4A AAC-LC variant from audio-codec-isolated-v1; other MP4 profiles are refused. The same bounded loader checks internal-only references, one LC audio track, sample tables and decoded memory before native decode; it never chooses another source silently. Preserve WAV masters and test actual loops/listening. Preload before latency-sensitive effects, await setState for transitions; call unlock(event)/resume(event) only in a fresh trusted click/key handler. No autoplay or automatic return from hidden pause. setMuted/setVolume control buses; pause/close own resources. States allow one music and up to five ambience loops. Effects have bounded instances and may return played:false instead of displacing music. Check errors/phase; snapshot is command state, not sound-quality evidence. No microphone or external resource access. This optional module is unavailable to the fixed Core compiler. `:"")+`Save game.web.json with {schemaVersion:1,entry:"src/main.ts",engineVersion:"${runtime.version}"}. Use project-relative JS/TS/CSS/JSON imports and the pinned ${[runtime.module,...runtime.plugins.map((plugin)=>plugin.module)].join(", ")} modules. Load packaged assets/ and data/ by relative URL. ${runtime.engine==="babylon"?"The pinned glTF2 loader is preloaded offline. GLB may be self-contained or use dependencies packaged under assets/ at their preserved relative paths; no network textures or remote decoders. ":""}.blend is editable source and is excluded from runtime builds. The HTML provides an existing HTMLCanvasElement canvas#game, not a container. ${runtime.engine==="phaser"?"Set Phaser config.canvas to that existing element; parent set to game would put another canvas inside it and may show only a blank canvas.":"Pass that existing canvas to Babylon Engine."} No Node modules, remote resources or project build plugins. Runtime recipes: data/playtests.json or named data/playtests/*.json. A compiled fixture is not a complete game.`,
      toolchain: { id: `web-${runtime.engine}`, version: `${runtime.version}+esbuild.${lock.compiler.version}.adapter.${options.audioRuntime===false?1:saveEnabled?4:3}`, sha256: contentHash({ runtime, compiler: lock.compiler, adapterABI: 1, implementation: implementationSha256,...(options.audioRuntime!==false?{audio:audioLock,deliveryPolicy:"explicit-with-provenance-metadata-v1"}:{}),...(saveEnabled?{save:saveLock}:{}) }) },
      async probe(registration) {
        try { await verifiedRuntime();if(options.audioRuntime!==false&&registration.product!=="kidos")await verifiedAudio();if(saveEnabled&&registration.product!=='kidos')await verifiedSave(); return { available: true }; }
        catch { return { available: false, reason: "The verified game runtime or pinned compiler is missing or changed. Repair the exact engine installation." }; }
      },
      async build(access) {
        access.signal.throwIfAborted();
        try {
          const runtimeFiles = await verifiedRuntime();
          const settings = gameWebProjectConfig.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await access.readFile("game.web.json"))));
          if(settings.delivery && (options.audioRuntime===false || access.registration.product==="kidos"))
            throw new Error("Explicit web delivery selection is unavailable to the fixed Core compiler. Preserve the original project and use its qualified contract.");
          if (settings.engineVersion !== runtime.version) throw new Error("Project engine version differs from the installed pinned runtime; migrate it explicitly.");
          if (!/\.(?:js|mjs|ts)$/.test(settings.entry)) throw new Error("Web games require a JavaScript or TypeScript entrypoint.");
          const audio=options.audioRuntime!==false&&access.registration.product!=="kidos"?await verifiedAudio():undefined;
          const save=saveEnabled&&access.registration.product!=='kidos'?await verifiedSave():undefined;
          const bundle = await compile(access, settings.entry, [runtime,...runtime.plugins],audio?.source,save?.source);
          const files = [...runtimeFiles, ...bundle.files];
          if(bundle.audioUsed&&audio)files.push(audio.license);
          if(bundle.saveUsed&&save)files.push(save.license);
          const delivery=settings.delivery?selectWebDelivery(access.document,settings.delivery.files,access.job.sourceHash):undefined;
          for (const file of delivery?.files ?? access.document.files.filter(file=>isWebResource(file.path))) {
            access.signal.throwIfAborted();
            files.push({ path: file.path, mime: file.mime, data: Buffer.from(await access.readFile(file.path)) });
          }
          if(delivery)files.push(delivery.report);
          const scripts=[runtime.entry,...runtime.plugins.map((plugin)=>plugin.entry)].map((entry)=>`<script src="engine/${entry}"></script>`).join("");
          const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta http-equiv="Content-Security-Policy" content="${policy}"><title>${escaped(access.document.title)}</title><link rel="icon" href="data:,"><link rel="stylesheet" href="base.css">${bundle.css ? '<link rel="stylesheet" href="game.css">' : ''}</head><body><canvas id="game" aria-label="${escaped(access.document.title)}"></canvas>${scripts}<script src="game.js"></script></body></html>`;
          files.push({ path: "index.html", mime: "text/html", data: Buffer.from(html) }, { path: "base.css", mime: "text/css", data: Buffer.from(baseCss) });
          return { entrypoint: "index.html", files };
        } catch (error) {
          access.signal.throwIfAborted();
          // Compilation has no project-side effects; all candidates remain in memory until service commit.
          throw new GameProductionFailure(error instanceof Error ? error.message : "Web game compilation failed.");
        }
      },
      async reconcile() {
        // A service commit is atomic. No adapter-side process/file survives; never silently rebuild.
        return { state: "missing", detail: "The in-memory build candidate was not acknowledged. The original project is unchanged; request a new build explicitly." };
      },
    };
    if(saveEnabled)adapter.projectGuide=`Optional pinned ${saveLock.module} ${saveLock.version}: import {createGameSave} from '${saveLock.module}'. Use stable {gameId,slot,version,validate} (validator is pure synchronous and receives frozen JSON). await load() returns empty/loaded/migration-required/invalid/incompatible/unavailable and stamp. save(data,{expected:stampOrNull}) compares original bytes inside one native IndexedDB transaction; await saved/unchanged before announcing persistence. Conflict requires load/reconciliation; never retry blindly. Explicit migrate({expected}) uses configured synchronous migrations; discard({expected,confirm:true}) deletes only that slot. No automatic reset or migration. Max record64 KiB by default, up to256 KiB. Storage is origin/browser/profile-local; temporary previews remain temporary. No cloud, agent service or credentials. Check all failures, save gameplay state promised by design rather than just score, and test normal reload/close/resume. Core compiler refuses this module. `+adapter.projectGuide;
    return adapter;
  });
}

async function compile(access: ProductionAccess, entry: string, modules:readonly {module:string;global:string}[],audioSource?:Buffer,saveSource?:Buffer): Promise<{ files: ProducedGameArtifact["files"]; css: boolean;audioUsed:boolean;saveUsed:boolean }> {
  const sourceFiles = new Map(access.document.files.map((file) => [file.path, file]));
  let loadedBytes = 0,audioUsed=false,saveUsed=false;
  const context = await esbuild.context({ entryPoints: [entry], outfile: "game.js", bundle: true, platform: "browser", format: "iife",
    target: ["es2020"], write: false, minify: true, legalComments: "inline", logLevel: "silent", treeShaking: true,
    tsconfigRaw: { compilerOptions: { useDefineForClassFields: true } },
    plugins: [{ name: "verified-game-blobs", setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        if(audioSource&&args.path===audioLock.module)return {path:audioLock.module,namespace:"shared-audio"};
        if(saveSource&&args.path===saveLock.module)return {path:saveLock.module,namespace:'shared-save'};
        if (modules.some((module)=>module.module===args.path)) return { path: args.path, namespace: "engine-global" };
        const name = args.kind === "entry-point" ? args.path : args.path.startsWith(".") ? path.posix.normalize(path.posix.join(path.posix.dirname(args.importer), args.path)) : "";
        if (!name || !gameFilePath.safeParse(name).success) return { errors: [{ text: "Only pinned engine imports and project-relative files are permitted." }] };
        const resolved = [name, `${name}.ts`, `${name}.js`, `${name}/index.ts`, `${name}/index.js`].find((candidate) => sourceFiles.has(candidate));
        if (!resolved) return { errors: [{ text: `File is not present in the pinned game revision: ${name}` }] };
        return { path: resolved, namespace: "game-source" };
      });
      build.onLoad({filter:/.*/,namespace:"shared-audio"},()=>{audioUsed=true;return {contents:audioSource!,loader:"js"};});
      build.onLoad({filter:/.*/,namespace:'shared-save'},()=>{saveUsed=true;return {contents:saveSource!,loader:'js'};});
      build.onLoad({ filter: /.*/, namespace: "engine-global" }, (args) => ({ contents: `module.exports = globalThis.${modules.find((module)=>module.module===args.path)!.global};`, loader: "js" }));
      build.onLoad({ filter: /.*/, namespace: "game-source" }, async (args) => {
        access.signal.throwIfAborted();
        const loader = loaders[path.posix.extname(args.path)];
        if (!loader) return { errors: [{ text: "Import code/CSS/JSON; load other assets through their packaged relative URLs." }] };
        const data = await access.readFile(args.path);
        loadedBytes += data.byteLength;
        if (data.byteLength > 8 * 1024 * 1024 || loadedBytes > 32 * 1024 * 1024) throw new Error("Source code exceeds the web compiler budget.");
        return { contents: data, loader };
      });
    } }],
  });
  const abort = () => { void context.cancel(); };
  access.signal.addEventListener("abort", abort, { once: true });
  try {
    access.signal.throwIfAborted();
    const result = await context.rebuild();
    access.signal.throwIfAborted();
    const files = result.outputFiles!.map((file) => ({ path: path.basename(file.path), mime: file.path.endsWith(".css") ? "text/css" : "text/javascript", data: file.contents }));
    return { files, css: files.some((file) => file.path === "game.css"),audioUsed,saveUsed };
  } finally { access.signal.removeEventListener("abort", abort); await context.dispose(); }
}
