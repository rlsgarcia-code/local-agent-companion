import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("the Mac application consumes only the published Companion SDK boundary", async () => {
  const [runtime, main, contracts, tsconfig, sdkConfig, sdkBuild, desktopBuild, testSdk, packageManifest, guide] = await Promise.all([
    readFile("desktop/runtime-client.ts", "utf8"),
    readFile("desktop/main.ts", "utf8"),
    readFile("desktop/contracts.ts", "utf8"),
    readFile("tsconfig.json", "utf8"),
    readFile("tsconfig.sdk.json", "utf8"),
    readFile("scripts/build-sdks.mjs", "utf8"),
    readFile("scripts/build-desktop.mjs", "utf8"),
    readFile("scripts/prepare-test-sdk.mjs", "utf8"),
    readFile("package.json", "utf8"),
    readFile("docs/APPLICATION_ADAPTERS.md", "utf8"),
  ]);

  for (const [name, source] of [["runtime-client", runtime], ["main", main], ["contracts", contracts]]) {
    assert.doesNotMatch(source, /from\s+["']\.\.\/packages\//, `${name} bypasses the public SDK`);
  }
  assert.match(runtime, /from "@companion\/client-sdk"/);
  assert.match(runtime, /from "@companion\/client-sdk\/bootstrap"/);
  assert.match(runtime, /from "@companion\/client-sdk\/contracts"/);
  assert.match(contracts, /@companion\/client-sdk\/desktop/);
  assert.match(runtime, /client\.engineInfo\(\)/);
  assert.match(runtime, /engineCapabilities\.filter/);

  const config = JSON.parse(tsconfig);
  assert.equal(config.compilerOptions.paths["@companion/client-sdk"][0], "packages/client-ts/src/index.ts");
  assert.equal(config.compilerOptions.paths["@companion/client-sdk/desktop"][0], "packages/contracts/src/desktop.ts");
  assert.ok(JSON.parse(sdkConfig).include.includes("packages/contracts/src/desktop.ts"));
  assert.match(sdkBuild, /packages\/contracts\/src\/desktop\.ts/);
  assert.match(sdkBuild, /"\.\/desktop"/);
  assert.match(desktopBuild, /release\/sdk/);
  assert.match(desktopBuild, /installed-companion-sdk/);
  assert.match(testSdk, /@companion\/client-sdk/);
  const scripts = JSON.parse(packageManifest).scripts;
  assert.match(scripts["compile:tests"], /prepare-test-sdk\.mjs/);
  assert.match(scripts["test:repository"], /mac-sdk-boundary\.test\.mjs/);
  assert.match(guide, /aplicativo Mac como cliente de referência/i);
});
