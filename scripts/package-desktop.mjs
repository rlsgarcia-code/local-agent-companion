import { build, Platform, Arch } from "electron-builder";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import * as path from "node:path";

if (process.platform !== "darwin") throw new Error("Build the Mac application on macOS.");
const architecture = process.argv.find((arg) => arg.startsWith("--arch="))?.slice(7) || process.arch;
if (!["arm64", "x64"].includes(architecture)) throw new Error("Select exactly one Mac architecture per build.");
const source = process.env.COMPANION_ENGINE_BUNDLE;
if (!source) throw new Error("Set COMPANION_ENGINE_BUNDLE to the exact signed engine for this Mac architecture. Build arm64 and x64 separately; a host engine cannot be embedded into both.");
const versions = JSON.parse(await readFile("packages/contracts/src/version.json", "utf8"));
if (process.versions.node !== versions.node) throw new Error(`Use bundled Node ${versions.node} to build the application.`);
execFileSync(process.execPath, ["scripts/build-sdks.mjs"], { stdio: "inherit" });
const require = createRequire(import.meta.url);
const { verifyBundle } = require(path.resolve("release/sdk/typescript/client-ts/src/bootstrap.cjs"));
const publicKey = await readFile("release-keys/companion-ed25519.pub", "utf8");
await mkdir("build", { recursive: true });
const staging = await mkdtemp(path.resolve("build", `desktop-${architecture}-`));
try {
  const bundle = path.join(staging, "companion-engine");
  // Verify the source before copying and the exact copy before the builder reads it.
  await verifyBundle(path.resolve(source), publicKey, false, `darwin-${architecture}`);
  await cp(path.resolve(source), bundle, { recursive: true, dereference: false });
  await verifyBundle(bundle, publicKey, false, `darwin-${architecture}`);
  execFileSync(process.execPath, ["scripts/build-desktop.mjs"], { stdio: "inherit" });
  const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
  await build({
    projectDir: path.resolve("desktop-dist"),
    targets: Platform.MAC.createTarget(process.argv.includes("--dir") ? ["dir"] : ["dmg", "zip"], architecture === "arm64" ? Arch.arm64 : Arch.x64),
    config: {
      extends: path.resolve("desktop/electron-builder.yml"),
      electronVersion: lock.packages["node_modules/electron"].version,
      extraResources: [{ from: bundle, to: "companion-engine" }],
    },
  });
} finally { await rm(staging, { recursive: true, force: true }); }
