import * as esbuild from "esbuild";
import { copyFile, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { generateThirdPartyNotices } from "./generate-third-party-notices.mjs";

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
    external: ["electron"],
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
await generateThirdPartyNotices({ metafile: mainBuild.metafile, outputDirectory: path.join(output, "licenses") });

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
  main: "main.cjs"
};
await writeFile(path.join(output, "package.json"), `${JSON.stringify(desktopPackage, null, 2)}\n`, "utf8");
await writeFile(path.join(output, "package-lock.json"), `${JSON.stringify({
  name: desktopPackage.name,
  version: desktopPackage.version,
  lockfileVersion: 3,
  requires: true,
  packages: { "": desktopPackage }
}, null, 2)}\n`, "utf8");

console.log(`DESKTOP_APP_READY ${output}`);
