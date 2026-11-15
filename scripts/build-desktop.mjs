import * as esbuild from "esbuild";
import { copyFile, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { generateThirdPartyNotices } from "./generate-third-party-notices.mjs";
import {copyGameModelRuntime} from "./copy-game-model-runtime.mjs";

const output = path.resolve("desktop-dist");
await rm(output, { recursive: true, force: true });
await mkdir(path.join(output, "renderer"), { recursive: true });

const [mainBuild] = await Promise.all([
  esbuild.build({
    entryPoints: ["desktop/main.ts"],
    outfile: path.join(output, "main.cjs"),
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    external: ["electron","playwright-core"],
    sourcemap: true,
    metafile: true,
    logLevel: "info"
  }),
  esbuild.build({
    entryPoints: ["desktop/preload.ts"],
    outfile: path.join(output, "preload.cjs"),
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    external: ["electron"],
    sourcemap: true,
    logLevel: "info"
  })
]);
await esbuild.build({entryPoints:["desktop/game-studio-preload.ts"],outfile:path.join(output,"game-studio-preload.cjs"),bundle:true,platform:"node",format:"cjs",target:"node22",external:["electron"]});
const inputs = Object.keys(mainBuild.metafile.inputs);
if (inputs.some((name) => /node_modules\/(?:langchain|deepagents|@langchain)\//.test(name))) {
  throw new Error("The Mac client contains an agent runtime. Keep execution inside the shared engine.");
}
await writeFile(path.join(output, "dependencies.json"), JSON.stringify({ inputs }, null, 2) + "\n");
await generateThirdPartyNotices({ metafile: mainBuild.metafile,additionalPackages:["playwright-core"], outputDirectory: path.join(output, "licenses") });
await cp("node_modules/playwright-core",path.join(output,"node_modules/playwright-core"),{recursive:true,filter:(source)=>!source.split(path.sep).includes("types")&&!source.split(path.sep).includes("bin")});
await cp("packages/game-studio-ui",path.join(output,"game-studio"),{recursive:true});
await copyGameModelRuntime(path.join(output,"game-model-runtime"));

await cp("desktop/renderer", path.join(output, "renderer"), { recursive: true });
await copyFile("desktop/assets/icon.png", path.join(output, "icon.png"));
await copyFile("LICENSE", path.join(output, "LICENSE"));
const desktopPackage = {
  name: "local-companion-desktop",
  version: JSON.parse(await readFile("package.json", "utf8")).version,
  private: true,
  description: "Local Ollama coding companion for macOS",
  author: "Local Agent Companion contributors",
  license: "MIT",
  dependencies: {"playwright-core":JSON.parse(await readFile("node_modules/playwright-core/package.json","utf8")).version},
  main: "main.cjs"
};
await writeFile(path.join(output, "package.json"), `${JSON.stringify(desktopPackage, null, 2)}\n`, "utf8");
await writeFile(path.join(output, "package-lock.json"), `${JSON.stringify({
  name: desktopPackage.name,
  version: desktopPackage.version,
  lockfileVersion: 3,
  requires: true,
  packages: { "": desktopPackage,"node_modules/playwright-core":JSON.parse(await readFile("package-lock.json","utf8")).packages["node_modules/playwright-core"] }
}, null, 2)}\n`, "utf8");

console.log(`DESKTOP_APP_READY ${output}`);
