import * as esbuild from "esbuild";
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

const root = path.resolve("engine-dist");
await rm(root, { recursive: true, force: true });
await mkdir(root, { recursive: true });
const built = await esbuild.build({
  entryPoints: ["packages/agent-service/src/main.ts"],
  outfile: path.join(root, "service.cjs"),
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
  (process.versions.node === "22.23.4"
    ? process.execPath
    : path.resolve(
        `.cache/node-v22.23.4-${process.platform}-${process.arch}`,
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
await visit(root);
const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
const manifest = {
  version: "1.0.0-rc.1",
  protocol: "1.0",
  node: "22.23.4",
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
