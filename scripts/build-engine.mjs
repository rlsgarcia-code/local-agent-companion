import * as esbuild from "esbuild";
import { copyChroma } from "./copy-chroma.mjs";
import {copyGameLibraries} from "./copy-game-libraries.mjs";
import {copyGameRasterizer} from "./copy-game-rasterizer.mjs";
import { generateThirdPartyNotices } from "./generate-third-party-notices.mjs";
import { createHash } from "node:crypto";
import {
  copyFile,
  cp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import * as path from "node:path";

const versions = JSON.parse(await readFile("packages/contracts/src/version.json", "utf8"));

// Explicit development/qualification outputs must be new immutable directories.
// Never clean an existing candidate that a running service may still be using.
const args = process.argv.slice(2);
if (args.length > 1 || args.some(value => !value.startsWith("--output=") || !value.slice(9)))
  throw new Error("Usage: build-engine.mjs [--output=<new-directory>]");
const explicitOutput = args[0]?.slice(9);
const root = path.resolve(explicitOutput ?? "engine-dist");
const legacyRoots = ["src", "desktop"].map((directory) => path.resolve(directory) + path.sep);
if (explicitOutput) {
  await mkdir(path.dirname(root), { recursive: true });
  await mkdir(root); // EEXIST intentionally preserves complete or partial output.
} else {
  // Legacy command kept for existing packaging callers; do not use it while
  // a service runs from engine-dist. New qualification uses --output instead.
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });
}
const built = await esbuild.build({
  entryPoints: { service: "packages/agent-service/src/main.ts", "bootstrap-lock": "packages/agent-service/src/bootstrap-lock.ts", "adapter-kit": "packages/agent-core/src/adapter-kit.ts", "game-assets-worker":"packages/adapter-game-assets/src/worker.ts", "game-media-worker":"packages/adapter-game-assets/src/candidate.ts", "game-browser-worker":"packages/adapter-game-browser/src/worker.ts", "game-browser-candidate":"packages/adapter-game-browser/src/candidate-main.ts", "game-web-worker":"packages/adapter-game-web/src/worker.ts", "unity-output-inspector":"packages/adapter-game-unity/src/kit.ts" },
  outdir: root,
  outExtension: { ".js": ".cjs" },
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  external: ["better-sqlite3", "esbuild", "playwright-core"],
  metafile: true,
  logLevel: "info",
  plugins: [
    {
      name: "headless-boundary",
      setup(build) {
        build.onResolve({ filter: /^(?:\.|\/|[A-Za-z]:[\\/])/ }, (args) => {
          const resolved = path.resolve(args.resolveDir, args.path);
          if (legacyRoots.some((directory) => resolved.startsWith(directory)))
            return { errors: [{ text: `Legacy interface module imported into the engine: ${args.path}` }] };
          return undefined;
        });
        build.onResolve(
          { filter: /^(?:vscode|electron|gtk|SwiftUI)$/ },
          (args) => ({
            errors: [
              { text: `UI framework imported into the engine: ${args.path}` },
            ],
          }),
        );
      },
    },
  ],
});
await writeFile(
  path.join(root, "dependencies.json"),
  JSON.stringify({ inputs: Object.keys(built.metafile.inputs) }, null, 2),
);
const compilerPackage = `@esbuild/${process.platform}-${process.arch}`;
for (const name of ["better-sqlite3", "bindings", "file-uri-to-path", "esbuild", compilerPackage, "playwright-core"])
  await cp(
    path.join("node_modules", name),
    path.join(root, "node_modules", name),
    {
      recursive: true,
      filter: (source) =>
        !source.includes(`${path.sep}deps${path.sep}`) &&
        !source.includes(`${path.sep}src${path.sep}`) &&
        !source.includes(`${path.sep}obj.target${path.sep}`),
    },
  );
const gameRuntimeRoot = "packages/adapter-game-web";
const gameRuntimeLock = JSON.parse(await readFile(path.join(gameRuntimeRoot, "runtime.lock.json"), "utf8"));
if (esbuild.version !== gameRuntimeLock.compiler.version) throw new Error("The game compiler must match its exact runtime lock.");
await mkdir(path.join(root, "game-runtimes"), { recursive: true });
for (const engine of gameRuntimeLock.engines) for (const [name, expected] of Object.entries(engine.files)) {
  const source = path.join(gameRuntimeRoot, "runtimes", name);
  if (createHash("sha256").update(await readFile(source)).digest("hex") !== expected)
    throw new Error(`Game runtime integrity mismatch: ${name}`);
  await copyFile(source, path.join(root, "game-runtimes", name));
}
await copyFile(path.join(gameRuntimeRoot, "runtime.lock.json"), path.join(root, "game-runtimes", "runtime.lock.json"));
const gameAudioLock=JSON.parse(await readFile(path.join(gameRuntimeRoot,"audio.lock.json"),"utf8"));
for(const [name,hash]of Object.entries(gameAudioLock.files)){
  const source=path.join(gameRuntimeRoot,"runtimes",name);if(createHash("sha256").update(await readFile(source)).digest("hex")!==hash)throw new Error(`Game audio integrity mismatch: ${name}`);
  await copyFile(source,path.join(root,"game-runtimes",name));
}
await copyFile(path.join(gameRuntimeRoot,"audio.lock.json"),path.join(root,"game-runtimes","audio.lock.json"));
const gameSaveLock=JSON.parse(await readFile(path.join(gameRuntimeRoot,'save.lock.json'),'utf8'));
for(const [name,hash]of Object.entries(gameSaveLock.files)){
  const source=path.join(gameRuntimeRoot,'runtimes',name);if(createHash('sha256').update(await readFile(source)).digest('hex')!==hash)throw new Error(`Game save integrity mismatch: ${name}`);
  await copyFile(source,path.join(root,'game-runtimes',name));
}
await copyFile(path.join(gameRuntimeRoot,'save.lock.json'),path.join(root,'game-runtimes','save.lock.json'));

await copyGameLibraries(path.join(root,"game-libraries"));
await copyGameRasterizer(path.join(root,"game-codecs"));
// Optional editor binaries/images remain outside the base engine. Only the fixed
// build driver and toolchain lock are shipped and covered by this engine manifest.
await mkdir(path.join(root, "game-editors/godot"), { recursive: true });
await copyFile("packages/adapter-game-godot/image/build.mjs", path.join(root, "game-editors/godot/build.mjs"));
await copyFile("packages/adapter-game-godot/toolchain.lock.json", path.join(root, "game-editors/godot/toolchain.lock.json"));
// Inactive Unity integration source only. Shipping a checked driver/lock must
// never register a production adapter or turn prepared-unqualified into ready.
await mkdir(path.join(root,"game-editors/unity"),{recursive:true});
await copyFile("packages/adapter-game-unity/editor/CompanionWebBuild.cs",path.join(root,"game-editors/unity/CompanionWebBuild.cs"));
await copyFile("packages/adapter-game-unity/toolchain.lock.json",path.join(root,"game-editors/unity/toolchain.lock.json"));
await copyFile("packages/adapter-game-unity/project-modules.lock.json",path.join(root,"game-editors/unity/project-modules.lock.json"));
await mkdir(path.join(root,"game-editors/blender"),{recursive:true});
await copyFile("packages/adapter-game-blender/image/process.py",path.join(root,"game-editors/blender/process.py"));
await copyFile("packages/adapter-game-blender/toolchain.lock.json",path.join(root,"game-editors/blender/toolchain.lock.json"));
await mkdir(path.join(root,"game-editors/audio-codec"),{recursive:true});
await copyFile("packages/adapter-game-audio-codec/image/process.py",path.join(root,"game-editors/audio-codec/process.py"));
await copyFile("packages/adapter-game-audio-codec/toolchain.lock.json",path.join(root,"game-editors/audio-codec/toolchain.lock.json"));
for(const name of ["COPYING.FFmpeg.LGPLv2.1","FFmpeg-LICENSE.md"])await copyFile(path.join("packages/adapter-game-audio-codec/licenses",name),path.join(root,"game-editors/audio-codec",name));

const node =
  process.env.COMPANION_BUNDLED_NODE ||
  (process.versions.node === versions.node
    ? process.execPath
    : path.resolve(
        `.cache/node-v${versions.node}-${process.platform}-${process.arch}`,
        process.platform === "win32" ? "node.exe" : "bin/node",
      ));
await copyFile(
  node,
  path.join(root, process.platform === "win32" ? "node.exe" : "node"),
);
const files = {};
async function visit(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isSymbolicLink())
      throw new Error("Engine artifacts cannot contain symlinks.");
    if (entry.isDirectory()) await visit(file);
    else
      files[path.relative(root, file).split(path.sep).join("/")] = createHash(
        "sha256",
      )
        .update(await readFile(file))
        .digest("hex");
  }
}
const chromaPackage = await copyChroma(path.join(root, "chroma"));
await generateThirdPartyNotices({
  metafile: built.metafile,
  additionalPackages: ["better-sqlite3", "bindings", "file-uri-to-path", "esbuild", compilerPackage, "playwright-core", chromaPackage],
  outputDirectory: path.join(root, "licenses"),
});
await copyFile("LICENSE", path.join(root, "LICENSE"));
let copiedNodeLicense = false;
for (const candidate of [
  path.resolve(path.dirname(node), "..", "LICENSE"),
  path.resolve(path.dirname(node), "LICENSE"),
]) {
  try {
    await copyFile(candidate, path.join(root, "NODE-LICENSE.txt"));
    copiedNodeLicense = true;
    break;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
if (!copiedNodeLicense)
  throw new Error("The official bundled Node license is required.");
await visit(root);
const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
const manifest = {
  version: versions.engine,
  protocol: versions.protocol,
  node: versions.node,
  installedCoreInferenceABI: 1,
  installedCoreInferenceProjectABI: 1,
  installedCoreGameProjectABI: 1,
  installedCoreGameQueueABI: 1,
  installedCoreGameMediaABI: 1,
  installedCoreGameValidationABI: 1,
  installedCoreGameValidationPortABI: 1,
  installedCoreGameBrowserComponentABI: 1,
  target: `${process.platform}-${process.arch}`,
  development: true,
  dependencies: Object.fromEntries(
    [
      "@langchain/core",
      "@langchain/langgraph",
      "@langchain/langgraph-checkpoint-sqlite",
      "langchain",
      "deepagents",
      "better-sqlite3",
      "esbuild",
      "pngjs",
      "@resvg/resvg-wasm",
      "playwright-core",
    ].map((name) => [name, lock.packages[`node_modules/${name}`].version]),
  ),
  files,
  gameRuntimes: gameRuntimeLock,
};
await writeFile(
  path.join(root, "manifest.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);
console.log(`ENGINE_READY ${manifest.target} ${root}`);
