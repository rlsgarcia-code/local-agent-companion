import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import test from "node:test";
import * as esbuild from "esbuild";
import {
  APPROVED_LICENSE_EXPRESSIONS,
  generateThirdPartyNotices,
  packagesFromMetafile
} from "../scripts/generate-third-party-notices.mjs";

const projectRoot = path.resolve(import.meta.dirname, "..");

test("extracts scoped, nested, and Windows-style package roots from an esbuild metafile", () => {
  const packages = packagesFromMetafile({
    inputs: {
      "node_modules/plain/index.js": {},
      "node_modules/@scope/pkg/main.js": {},
      "node_modules/parent/node_modules/nested/index.js": {},
      "node_modules/@owner/sdk/dist/node_modules/.pnpm/embedded@2.3.4/node_modules/embedded/index.js": {},
      "C:\\repo\\node_modules\\@windows\\pkg\\index.js": {},
      "src/extension.ts": {}
    }
  });

  assert.deepEqual(
    packages.map(({ name, root }) => ({ name, root })),
    [
      { name: "@scope/pkg", root: "node_modules/@scope/pkg" },
      { name: "@windows/pkg", root: "C:/repo/node_modules/@windows/pkg" },
      { name: "embedded", root: "node_modules/@owner/sdk/dist/node_modules/.pnpm/embedded@2.3.4/node_modules/embedded" },
      { name: "nested", root: "node_modules/parent/node_modules/nested" },
      { name: "plain", root: "node_modules/plain" }
    ]
  );
});

test("generates a complete allowlisted inventory for the production bundle", async (context) => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "local-companion-licenses-"));
  context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  context.after(() => esbuild.stop());
  const result = await esbuild.build({
    absWorkingDir: projectRoot,
    entryPoints: ["src/extension.ts"],
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    outfile: path.join(temporaryRoot, "extension.js"),
    external: ["vscode", "playwright-core"],
    metafile: true,
    write: false,
    logLevel: "silent"
  });
  const nativePackage = nativePackageForCurrentPlatform();
  const outputDirectory = path.join(temporaryRoot, "licenses");
  const manifest = await generateThirdPartyNotices({
    metafile: result.metafile,
    additionalPackages: [nativePackage, "playwright-core"],
    projectRoot,
    outputDirectory
  });

  assert.equal(manifest.packageCount, 56, "dependency inventory changed; review licenses before updating this expectation");
  assert.equal(manifest.packages.length, manifest.packageCount);
  assert.ok(manifest.packages.some((entry) => entry.name === nativePackage && entry.nativeComponent));
  assert.ok(manifest.packages.some((entry) => entry.name === "langchain"));
  assert.ok(!manifest.packages.some((entry) => ["@langchain/openai", "openai"].includes(entry.name)), "model provider clients belong to the shared engine");
  assert.ok(!manifest.packages.some((entry) => entry.name === "chromadb"), "semantic-memory clients belong to the shared engine");
  assert.ok(manifest.packages.some((entry) => entry.name === "@langchain/mcp-adapters" && entry.license === "MIT"));
  assert.ok(manifest.packages.some((entry) => entry.name === "@modelcontextprotocol/client" && entry.license === "Apache-2.0"));
  assert.ok(manifest.packages.some((entry) => entry.name === "@modelcontextprotocol/core" && entry.license === "Apache-2.0"));
  assert.ok(manifest.packages.some((entry) => entry.name === "playwright-core" && entry.nativeComponent));
  for (const entry of manifest.packages) {
    assert.ok(APPROVED_LICENSE_EXPRESSIONS.includes(entry.license), `${entry.name} has ${entry.license}`);
    assert.ok(entry.licenseSources.length > 0, `${entry.name} has no license source`);
    assert.ok(entry.licenseSources.every((source) => /^[a-f0-9]{64}$/.test(source.sha256)));
  }

  const persistedManifest = JSON.parse(await readFile(path.join(outputDirectory, "third-party-manifest.json"), "utf8"));
  const notices = await readFile(path.join(outputDirectory, "THIRD_PARTY-LICENSES.txt"), "utf8");
  assert.deepEqual(persistedManifest, manifest);
  assert.match(notices, /THIRD-PARTY SOFTWARE NOTICES/);
  assert.match(notices, /LangChain/);
  assert.match(notices, /Chroma/);
});

test("refuses to package a dependency without usable license metadata", async (context) => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "local-companion-license-failure-"));
  context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const packageDirectory = path.join(temporaryRoot, "node_modules", "missing-license");
  await mkdir(packageDirectory, { recursive: true });
  await writeFile(
    path.join(packageDirectory, "package.json"),
    JSON.stringify({ name: "missing-license", version: "1.0.0" }),
    "utf8"
  );

  await assert.rejects(
    generateThirdPartyNotices({
      metafile: { inputs: { "node_modules/missing-license/index.js": {} } },
      projectRoot: temporaryRoot,
      outputDirectory: path.join(temporaryRoot, "output")
    }),
    /does not declare a usable SPDX license expression/
  );
});

function nativePackageForCurrentPlatform() {
  const packages = {
    "darwin-arm64": "chromadb-js-bindings-darwin-arm64",
    "darwin-x64": "chromadb-js-bindings-darwin-x64",
    "linux-arm64": "chromadb-js-bindings-linux-arm64-gnu",
    "linux-x64": "chromadb-js-bindings-linux-x64-gnu",
    "win32-x64": "chromadb-js-bindings-win32-x64-msvc"
  };
  const platformKey = `${process.platform}-${process.arch}`;
  const packageName = packages[platformKey];
  if (!packageName) throw new Error(`Unsupported test platform: ${platformKey}`);
  return packageName;
}
