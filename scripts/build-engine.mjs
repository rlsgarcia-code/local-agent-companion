import * as esbuild from "esbuild";
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

const root = path.resolve("engine-dist");
const legacyRoots = ["src", "desktop"].map((directory) => path.resolve(directory) + path.sep);
await rm(root, { recursive: true, force: true });
await mkdir(root, { recursive: true });
const built = await esbuild.build({
  entryPoints: { service: "packages/agent-service/src/main.ts", "bootstrap-lock": "packages/agent-service/src/bootstrap-lock.ts" },
  outdir: root,
  outExtension: { ".js": ".cjs" },
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  external: ["better-sqlite3"],
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
for (const name of ["better-sqlite3", "bindings", "file-uri-to-path"])
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
await generateThirdPartyNotices({
  metafile: built.metafile,
  additionalPackages: ["better-sqlite3", "bindings", "file-uri-to-path"],
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
    ].map((name) => [name, lock.packages[`node_modules/${name}`].version]),
  ),
  files,
};
await writeFile(
  path.join(root, "manifest.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);
console.log(`ENGINE_READY ${manifest.target} ${root}`);
