import { createHash, verify } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { lstat, readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import * as path from "node:path";
import { z } from "zod";
import { executeGraph } from "../../agent-core/src/index";
import { adapterModelAPI, type InstalledAdapter } from "../../agent-core/src/installed-adapter";
import { AgentError, errors, PROTOCOL_VERSION } from "../../contracts/src/index";

const descriptorSchema = z.object({ schema: z.literal(1), directory: z.string(), manifestSha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const manifestSchema = z.object({ schema: z.literal(1), product: z.literal("kidos"), protocol: z.string(),
  entry: z.literal("adapter.cjs"), files: z.record(z.string(), z.string().regex(/^[a-f0-9]{64}$/)) }).strict();

async function owned(file: string, owner: number, boundary: string): Promise<void> {
  let current = path.resolve(file);
  if (current !== boundary && !current.startsWith(boundary === path.parse(boundary).root ? boundary : boundary + path.sep))
    throw new Error("Adapter path leaves the trusted installation root.");
  while (true) {
    const stat = await lstat(current);
    if (stat.isSymbolicLink() || stat.uid !== owner || (stat.mode & 0o022)) throw new Error("Unsafe adapter ownership or permissions.");
    if (current === boundary) break;
    const parent = path.dirname(current);
    if (parent === current) throw new Error("Adapter trust boundary was not reached.");
    current = parent;
  }
}

/** Optional arguments exist for isolated signed fixtures; production uses fixed system paths. */
export async function loadSignedAdapter(descriptorFile: string, publicKeyFile: string,
  trust: { owner?: number; boundary?: string } = {}): Promise<InstalledAdapter> {
  const owner = trust.owner ?? 0, boundary = path.resolve(trust.boundary ?? path.parse(descriptorFile).root);
  await owned(descriptorFile, owner, boundary); await owned(publicKeyFile, owner, boundary);
  if ((await lstat(descriptorFile)).size > 8192 || (await lstat(publicKeyFile)).size > 4096) throw new Error("Invalid adapter trust metadata.");
  const descriptor = descriptorSchema.parse(JSON.parse(await readFile(descriptorFile, "utf8")));
  if (!path.isAbsolute(descriptor.directory)) throw new Error("Adapter installation path must be absolute.");
  await owned(descriptor.directory, owner, boundary);
  const manifestFile = path.join(descriptor.directory, "manifest.json"), signatureFile = path.join(descriptor.directory, "manifest.sig");
  await owned(manifestFile, owner, boundary); await owned(signatureFile, owner, boundary);
  if ((await lstat(manifestFile)).size > 1024 * 1024 || (await lstat(signatureFile)).size !== 64) throw new Error("Invalid signed adapter manifest.");
  const bytes = await readFile(manifestFile);
  if (createHash("sha256").update(bytes).digest("hex") !== descriptor.manifestSha256 ||
      !verify(null, bytes, await readFile(publicKeyFile), await readFile(signatureFile))) throw new Error("Adapter signature or pinned manifest is invalid.");
  const manifest = manifestSchema.parse(JSON.parse(bytes.toString("utf8")));
  if (manifest.protocol !== PROTOCOL_VERSION || !Object.hasOwn(manifest.files, manifest.entry)) throw new Error("Adapter protocol or entry is incompatible.");
  const declared = new Set(Object.keys(manifest.files));
  for (const [relative, digest] of Object.entries(manifest.files)) {
    if (path.isAbsolute(relative) || relative.includes("\\") || relative.split("/").some((part) => !part || part === "." || part === "..")) throw new Error("Unsafe adapter file path.");
    const file = path.join(descriptor.directory, relative); await owned(file, owner, boundary);
    const stat = await lstat(file); if (!stat.isFile() || stat.size > 256 * 1024 * 1024) throw new Error("Invalid adapter file.");
    const hash = createHash("sha256"); for await (const block of createReadStream(file)) hash.update(block);
    if (hash.digest("hex") !== digest) throw new Error("Adapter file integrity failed.");
  }
  async function check(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name), relative = path.relative(descriptor.directory, file).split(path.sep).join("/");
      await owned(file, owner, boundary);
      if (entry.isDirectory()) await check(file);
      else if (!entry.isFile() || !declared.has(relative) && !["manifest.json", "manifest.sig"].includes(relative)) throw new Error("Undeclared adapter file.");
    }
  }
  await check(descriptor.directory);
  const entry = path.join(descriptor.directory, manifest.entry);
  const factory = createRequire(entry)(entry).createAdapter;
  if (typeof factory !== "function") throw new Error("Installed adapter has no factory.");
  const adapter = factory({ ...adapterModelAPI, executeGraph, directory: descriptor.directory });
  if (adapter?.product !== "kidos" || ["validate", "execute", "prepareTool", "invokeTool"].some((name) => typeof adapter[name] !== "function"))
    throw new Error("Installed adapter contract is invalid.");
  return adapter as InstalledAdapter;
}
export async function systemAdapter(): Promise<InstalledAdapter | undefined> {
  const descriptor = "/etc/kidos/agent-adapter.json";
  if (process.platform !== "linux" || !existsSync(descriptor)) return undefined;
  try { return await loadSignedAdapter(descriptor, "/usr/share/kidos/release-keys/kidos-ed25519.pub"); }
  catch { throw new AgentError(errors.forbidden, "The protected KidOS adapter failed verification. Repair the system installation."); }
}
