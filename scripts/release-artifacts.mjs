import { createHash, sign, verify } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

const MANIFEST = "companion-release.manifest.json";
const SIGNATURE = "companion-release.manifest.sig";
export async function collectReleaseAssets(source, destination) {
  await mkdir(destination, { mode: 0o700 });
  const names = new Set();
  async function visit(folder) {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const file = path.join(folder, entry.name);
      if (entry.isSymbolicLink()) throw new Error("Release artifacts cannot contain links.");
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile() && !names.has(entry.name)) {
        names.add(entry.name); await copyFile(file, path.join(destination, entry.name));
      } else throw new Error("Duplicate or invalid release artifact name.");
    }
  }
  await visit(source);
}
async function hash(file) {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(file)) digest.update(chunk);
  return digest.digest("hex");
}
export async function signReleaseArtifacts(directory, key, metadata) {
  if (!key || !/^[a-f0-9]{40}$/.test(metadata.commit || "")) throw new Error("A publication key and exact commit are required.");
  const files = {};
  async function visit(folder) {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const file = path.join(folder, entry.name), name = path.relative(directory, file).split(path.sep).join("/");
      if ([MANIFEST, SIGNATURE].includes(name)) continue;
      if (entry.isSymbolicLink()) throw new Error("Release assets cannot contain symbolic links.");
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile()) files[name] = await hash(file);
      else throw new Error("Invalid release artifact.");
    }
  }
  await visit(directory);
  if (!Object.keys(files).length) throw new Error("The candidate has no artifacts.");
  const bytes = Buffer.from(JSON.stringify({ schema: 1, kind: "companion-suite-candidate", ...metadata,
    scope: ["companion-engine", "companion-mac", "companion-vscode"], deferredConsumers: ["kidos"],
    acceptance: "pending-desktop-installed-validation", files }, null, 2) + "\n");
  await writeFile(path.join(directory, MANIFEST), bytes);
  await writeFile(path.join(directory, SIGNATURE), sign(null, bytes, key));
}
export async function verifyReleaseArtifacts(directory, publicKey) {
  const bytes = await readFile(path.join(directory, MANIFEST));
  if (bytes.length > 1024 * 1024 || !verify(null, bytes, publicKey, await readFile(path.join(directory, SIGNATURE))))
    throw new Error("Release signature is invalid.");
  const manifest = JSON.parse(bytes);
  if (manifest.schema !== 1 || manifest.kind !== "companion-suite-candidate" || !/^[a-f0-9]{40}$/.test(manifest.commit) ||
      !manifest.files || typeof manifest.files !== "object" || !Object.keys(manifest.files).length)
    throw new Error("Invalid signed release manifest.");
  for (const [name, digest] of Object.entries(manifest.files)) {
    if (!name || path.isAbsolute(name) || name.split(/[\\/]/).some((part) => !part || part === "." || part === "..") || !/^[a-f0-9]{64}$/.test(digest))
      throw new Error("Unsafe release artifact path or digest.");
    let parent = directory;
    for (const part of name.split("/")) {
      parent = path.join(parent, part);
      if ((await lstat(parent)).isSymbolicLink()) throw new Error("Release artifact path contains a symbolic link.");
    }
    if (!(await lstat(parent)).isFile() || await hash(parent) !== digest) throw new Error(`Release artifact failed integrity verification: ${name}`);
  }
  async function rejectUndeclared(folder) {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const file = path.join(folder, entry.name), name = path.relative(directory, file).split(path.sep).join("/");
      if (entry.isSymbolicLink()) throw new Error("Release assets contain a symbolic link.");
      if (entry.isDirectory()) await rejectUndeclared(file);
      else if (!entry.isFile() || !Object.hasOwn(manifest.files, name) && ![MANIFEST, SIGNATURE].includes(name))
        throw new Error("Release contains an undeclared artifact.");
    }
  }
  await rejectUndeclared(directory);
  return manifest;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const [action, directory = "release-assets", destination] = process.argv.slice(2);
  if (action === "collect") {
    if (!destination) throw new Error("Select a new destination directory.");
    await collectReleaseAssets(path.resolve(directory), path.resolve(destination));
  } else if (action === "sign") {
    const versions = JSON.parse(await readFile("packages/contracts/src/version.json", "utf8"));
    const version = JSON.parse(await readFile("package.json", "utf8")).version;
    await signReleaseArtifacts(path.resolve(directory), process.env.COMPANION_RELEASE_SIGNING_KEY,
      { commit: process.env.GITHUB_SHA, application: version, engine: versions.engine, node: versions.node, protocol: versions.protocol });
  } else if (action === "verify") {
    const manifest = await verifyReleaseArtifacts(path.resolve(directory), await readFile("release-keys/companion-ed25519.pub", "utf8"));
    process.stdout.write(`VERIFIED_CANDIDATE ${manifest.engine} ${manifest.commit}\n`);
  } else throw new Error("Use sign or verify with a candidate artifact directory.");
}
