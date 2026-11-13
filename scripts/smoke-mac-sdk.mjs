import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import * as esbuild from "esbuild";

const root = path.resolve("release/sdk");
const require = createRequire(import.meta.url);
const sdk = require(root);
const bootstrap = require(path.join(root, "typescript/client-ts/src/bootstrap.cjs"));
const contracts = require(path.join(root, "typescript/contracts/src/index.cjs"));
const desktop = require(path.join(root, "typescript/contracts/src/desktop.cjs"));

assert.equal(typeof sdk.AgentClient, "function");
assert.equal(typeof bootstrap.ensureEngine, "function");
assert.match(bootstrap.COMPANION_RELEASE_PUBLIC_KEY, /BEGIN PUBLIC KEY/);
assert.ok(Array.isArray(contracts.engineCapabilities));
assert.equal(typeof desktop.desktopRunSpec?.parse, "function");

const aliases = new Map([
  ["@companion/client-sdk", path.join(root, "typescript/client-ts/src/index.cjs")],
  ["@companion/client-sdk/bootstrap", path.join(root, "typescript/client-ts/src/bootstrap.cjs")],
  ["@companion/client-sdk/contracts", path.join(root, "typescript/contracts/src/index.cjs")],
  ["@companion/client-sdk/desktop", path.join(root, "typescript/contracts/src/desktop.cjs")],
]);
const result = await esbuild.build({
  entryPoints: ["desktop/runtime-client.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  write: false,
  metafile: true,
  plugins: [{
    name: "installed-companion-sdk",
    setup(build) {
      build.onResolve({ filter: /^@companion\/client-sdk(?:\/.*)?$/ }, (args) => {
        const resolved = aliases.get(args.path);
        return resolved ? { path: resolved } : { errors: [{ text: `Unknown SDK entry: ${args.path}` }] };
      });
    },
  }],
});
const inputs = Object.keys(result.metafile.inputs);
assert.ok(inputs.some((file) => file.endsWith("typescript/client-ts/src/bootstrap.cjs")), inputs.join("\n"));
assert.ok(inputs.some((file) => file.endsWith("typescript/contracts/src/index.cjs")), inputs.join("\n"));
assert.ok(!inputs.some((file) => /packages\/(?:client-ts|contracts|agent-core)\/src/.test(file)));
process.stdout.write("MAC_APP_PUBLIC_SDK_BOUNDARY_OK\n");
