import { build, Platform, Arch } from "electron-builder";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
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
// Keep the dependency-free client outside the repository workspace so the
// builder cannot discover and embed the parent's agent/native dependencies.
const staging = await mkdtemp(path.join(tmpdir(), `companion-desktop-${architecture}-`));
try {
  const bundle = path.join(staging, "companion-engine");
  // Verify the source before copying and the exact copy before the builder reads it.
  await verifyBundle(path.resolve(source), publicKey, false, `darwin-${architecture}`);
  await cp(path.resolve(source), bundle, { recursive: true, dereference: false });
  await verifyBundle(bundle, publicKey, false, `darwin-${architecture}`);
  execFileSync(process.execPath, ["scripts/build-desktop.mjs"], { stdio: "inherit" });
  const client = path.join(staging, "client");
  await cp(path.resolve("desktop-dist"), client, { recursive: true });
  const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
  let verifiedApplication = false;
  await build({
    projectDir: client,
    targets: Platform.MAC.createTarget(process.argv.includes("--dir") ? ["dir"] : ["dmg", "zip"], architecture === "arm64" ? Arch.arm64 : Arch.x64),
    config: {
      extends: path.resolve("desktop/electron-builder.yml"),
      electronVersion: lock.packages["node_modules/electron"].version,
      directories: { output: path.resolve("release/desktop") },
      afterPack: async (context) => {
        const target = path.join(context.appOutDir, "Local Companion.app/Contents/Resources/companion-engine");
        // extraResources applies npm file exclusions. Copy the immutable bundle
        // verbatim after packing, before Apple sealing, including its licenses.
        await cp(bundle, target, { recursive: true, dereference: false });
        await verifyBundle(target, publicKey, false, `darwin-${architecture}`);
      },
      afterSign: async (context) => {
        const application = path.join(context.appOutDir, "Local Companion.app");
        // Apple sealing must never rewrite the separately signed engine bytes.
        await verifyBundle(path.join(application, "Contents/Resources/companion-engine"), publicKey, false, `darwin-${architecture}`);
        execFileSync("/usr/bin/codesign", ["--verify", "--strict", application], { stdio: "inherit" });
        verifiedApplication = true;
      },
    },
  });
  if (!verifiedApplication) throw new Error("The Mac application was not signed and verified. No candidate can be released.");
} finally { await rm(staging, { recursive: true, force: true }); }
