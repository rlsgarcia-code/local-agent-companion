// Administrative, offline toolchain preparation. Never called by the inference
// service, never accepts EULAs, activates accounts, downloads, or runs a project.
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, mkdir, readFile, readdir, readlink, realpath, rename, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const run = (file, args) => promisify(execFile)(file, args, { timeout: 600000, maxBuffer: 2 * 1024 * 1024,
  env: { HOME: process.env.HOME, PATH: "/usr/bin:/bin:/usr/sbin:/sbin", LANG: "en_US.UTF-8" } });
export async function fileSha256(file) {
  const hash = createHash("sha256"); for await (const chunk of createReadStream(file)) hash.update(chunk); return hash.digest("hex");
}
export function verifyUnityInstallerSignature(output, publisher) {
  if (!output.includes("Status: signed by a developer certificate issued by Apple for distribution") ||
      !output.includes(`Developer ID Installer: Unity Technologies SF (${publisher.teamIdentifier})`)) throw new Error("Unity installer must have a valid Apple-trusted publisher signature; no digest-only fallback is permitted.");
  const certificate = output.match(/SHA256 Fingerprint:\s*([A-Fa-f0-9\s]+?)(?:\s*-{3,}|$)/)?.[1]?.replace(/\s/g, "").toLowerCase();
  if (certificate !== publisher.installerCertificateSha256) throw new Error("Unity installer publisher certificate differs from the pinned release.");
}
export async function verifyUnityInput(file, expected) {
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size !== expected.size || await fileSha256(file) !== expected.sha256)
    throw new Error(`Unity input integrity mismatch: ${path.basename(file)}`);
}
export async function unityTreeManifest(directory) {
  const base = await realpath(directory), files = {};
  let bytes = 0, entries = 0;
  async function visit(folder) {
    for (const entry of (await readdir(folder, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      if (++entries > 150000) throw new Error("Unity toolchain exceeds its inventory entry limit.");
      const full = path.join(folder, entry.name), name = path.relative(base, full).split(path.sep).join("/");
      if (entry.isDirectory()) await visit(full);
      else if (entry.isFile()) {
        const info = await lstat(full); bytes += info.size;
        if (bytes > 24 * 1024 ** 3) throw new Error("Unity toolchain exceeds its inventory size limit.");
        files[name] = { size: info.size, sha256: await fileSha256(full) };
      } else if (entry.isSymbolicLink()) {
        const target = await readlink(full), resolved = await realpath(full), relative = path.relative(base, resolved);
        if ((relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) &&
            !["/System/", "/usr/lib/", "/usr/bin/"].some((prefix) => resolved.startsWith(prefix))) throw new Error("Unity toolchain contains a link outside its root or system libraries.");
        files[name] = { symlink: target };
      } else throw new Error("Unity toolchain contains a special filesystem entry.");
    }
  }
  await visit(base); return { files, bytes, entries };
}

export async function prepareUnityToolchain({ inputs, output }) {
  const lock = JSON.parse(await readFile(path.join(root, "packages/adapter-game-unity/toolchain.lock.json"), "utf8"));
  if (`${process.platform}-${process.arch}` !== lock.platform) throw new Error("This pinned Unity provisioner is qualified only for Mac ARM64; do not substitute another editor/platform silently.");
  for (const item of lock.inputs) {
    const file = path.join(inputs, item.file); await verifyUnityInput(file, item);
    const signature = await run("/usr/sbin/pkgutil", ["--check-signature", file]); verifyUnityInstallerSignature(signature.stdout, lock.publisher);
  }
  const editorExpanded = path.join(inputs, "editor-expanded"), webExpanded = path.join(inputs, "web-expanded");
  const exists = async (file) => { try { await lstat(file); return true; } catch (error) { if (error.code === "ENOENT") return false; throw error; } };
  if (!await exists(editorExpanded)) await run("/usr/sbin/pkgutil", ["--expand-full", path.join(inputs, "Unity.pkg"), editorExpanded]);
  const directory = path.join(editorExpanded, "Unity.pkg.tmp/Payload/Unity"), app = path.join(directory, "Unity.app"), web = path.join(directory, "PlaybackEngines/WebGLSupport");
  if (!await exists(web)) {
    if (!await exists(webExpanded)) await run("/usr/sbin/pkgutil", ["--expand-full", path.join(inputs, "WebGL.pkg"), webExpanded]);
    await mkdir(path.dirname(web), { recursive: true }); await rename(path.join(webExpanded, "TargetSupport.pkg.tmp/Payload"), web);
  }
  await run("/usr/bin/codesign", ["--verify", "--deep", "--strict", app]);
  const identity = await run("/usr/bin/codesign", ["-dv", "--verbose=2", app]);
  if (!identity.stderr.includes(`TeamIdentifier=${lock.publisher.teamIdentifier}`)) throw new Error("Unexpected Unity application publisher.");
  const version = await run(path.join(app, "Contents/MacOS/Unity"), ["-version"]);
  if (version.stdout.trim() !== lock.version) throw new Error("Unity editor version differs from its exact LTS lock.");
  const inventory = await unityTreeManifest(directory);
  const inventorySha256 = createHash("sha256").update(JSON.stringify(inventory)).digest("hex");
  const record = { schemaVersion: 1, version: lock.version, revision: lock.revision, platform: lock.platform,
    publisher: lock.publisher, directory, inventorySha256, status: "prepared-unqualified", available: false,
    pending: ["isolated editor lifecycle", "license broker", "controlled import/build", "2D/3D browser observations", "cancellation and reconciliation"], ...inventory };
  await mkdir(path.dirname(output), { recursive: true, mode: 0o700 });
  await writeFile(output, JSON.stringify(record, null, 2), { mode: 0o600 });
  return { version: lock.version, inventorySha256, files: Object.keys(inventory.files).length, bytes: inventory.bytes, status: record.status, available: false };
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const option = (name, fallback) => { const index = process.argv.indexOf(name); return index < 0 ? fallback : process.argv[index + 1]; };
  const result = await prepareUnityToolchain({ inputs: path.resolve(option("--inputs", path.join(root, ".cache/game-editor-inputs/unity-6000.3.28f1"))),
    output: path.resolve(option("--output", path.join(root, ".cache/game-toolchains/unity-prepared.json"))) });
  console.log("UNITY_TOOLCHAIN_PREPARED", JSON.stringify(result));
}
