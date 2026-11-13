import * as esbuild from "esbuild";
import { mkdir, cp, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { createHash, sign } from "node:crypto";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { z } from "zod";
import { generateThirdPartyNotices } from "./generate-third-party-notices.mjs";
import * as path from "node:path";
const versions = JSON.parse(await readFile("packages/contracts/src/version.json", "utf8"));

const output = "release/sdk";
const lockedDependencies=JSON.parse(await readFile("package-lock.json","utf8"));
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await esbuild
  .build({
    entryPoints: [
      "packages/client-ts/src/index.ts",
      "packages/client-ts/src/bootstrap.ts",
      "packages/contracts/src/index.ts",
    ],
    outdir: path.join(output, "typescript"),
    outbase: "packages",
    bundle: true,
    platform: "node",
    target: "node22",
    format: "cjs",
    outExtension: { ".js": ".cjs" },
    metafile: true,
  })
  .then(async (result) => {
    const inputs = Object.keys(result.metafile.inputs);
    if (
      inputs.some((file) =>
        /node_modules\/(?:langchain|deepagents|@langchain)\//.test(file),
      )
    )
      throw new Error("Client SDK includes an agent runtime.");
    await writeFile(
      path.join(output, "typescript", "dependencies.json"),
      JSON.stringify({ inputs }, null, 2),
    );
    await generateThirdPartyNotices({metafile:result.metafile,outputDirectory:path.join(output,"licenses")});
  });
await cp("LICENSE",path.join(output,"LICENSE"));
await mkdir(path.join(output, "integration"), { recursive: true });
await cp("docs/APPLICATION_ADAPTERS.md", path.join(output, "integration", "APPLICATION_ADAPTERS.md"));
await cp("docs/application-adapter-contract.json", path.join(output, "integration", "application-adapter-contract.json"));
await cp("examples/application-adapter", path.join(output, "integration", "example"), { recursive: true });
await cp("packages/client-python", path.join(output, "python"), {
  recursive: true,
  filter: (name) => !name.includes("__pycache__"),
});
execFileSync(
  process.execPath,
  ["node_modules/typescript/bin/tsc", "-p", "tsconfig.sdk.json"],
  { stdio: "inherit" },
);
execFileSync(
  process.platform === "win32" ? "python" : "python3",
  ["scripts/build-python-sdk.py"],
  { stdio: "inherit" },
);
const require = createRequire(import.meta.url);
const contracts = require(
  path.resolve(output, "typescript/contracts/src/index.cjs"),
);
await mkdir(path.join(output, "contracts"), { recursive: true });
for (const name of ["runSpec", "providerSpec", "toolSpec", "modelAssistance"])
  await writeFile(
    path.join(output, "contracts", `${name}.schema.json`),
    JSON.stringify(z.toJSONSchema(contracts[name]), null, 2) + "\n",
  );
await writeFile(
  path.join(output, "package.json"),
  JSON.stringify(
    {
      name: "@companion/client-sdk",
      version: versions.engine,
      node: versions.node,
      protocol: versions.protocol,
      dependencies:{zod:lockedDependencies.packages["node_modules/zod"].version},
      main: "./typescript/client-ts/src/index.cjs",
      types: "./typescript/client-ts/src/index.d.ts",
      exports: {
        ".": {
          types: "./typescript/client-ts/src/index.d.ts",
          require: "./typescript/client-ts/src/index.cjs",
        },
        "./bootstrap": {
          types: "./typescript/client-ts/src/bootstrap.d.ts",
          require: "./typescript/client-ts/src/bootstrap.cjs",
        },
        "./contracts": {
          types: "./typescript/contracts/src/index.d.ts",
          require: "./typescript/contracts/src/index.cjs",
        },
      },
    },
    null,
    2,
  ) + "\n",
);
if (process.env.COMPANION_RELEASE_SIGNING_KEY) {
  const files = {};
  async function visit(folder) {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const file = path.join(folder, entry.name);
      if (entry.isDirectory()) await visit(file);
      else
        files[path.relative(output, file).split(path.sep).join("/")] =
          createHash("sha256")
            .update(await readFile(file))
            .digest("hex");
    }
  }
  await visit(output);
  const manifest = Buffer.from(
    JSON.stringify(
      {
        kind: "companion-sdks",
        version: versions.engine,
        protocol: versions.protocol,
        commit: process.env.GITHUB_SHA,
        files,
      },
      null,
      2,
    ) + "\n",
  );
  await writeFile(path.join(output, "manifest.json"), manifest);
  await writeFile(
    path.join(output, "manifest.sig"),
    sign(null, manifest, process.env.COMPANION_RELEASE_SIGNING_KEY),
  );
  const archive = path.resolve(`release/companion-sdks-${versions.engine}.tar.gz`);
  execFileSync("tar", ["-czf", archive, "-C", "release", "sdk"]);
  await writeFile(
    `${archive}.sha256`,
    `${createHash("sha256")
      .update(await readFile(archive))
      .digest("hex")}  ${path.basename(archive)}\n`,
  );
}
