import { z } from "zod";
import { lstat, opendir, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { gameFilePath, gameFileTreeConflict } from "../../contracts/src/games";
import { browserDigest, type QualifiedBrowser } from "./browser";
import { digest } from "./journal";

/** Root provisions this whole immutable tree; game/client input cannot select it. */
export const coreBrowserManifest = z.object({ schemaVersion: z.literal(1),
  target: z.enum(["linux-x64", "linux-arm64"]),
  version: z.string().regex(/^(?:Chromium|Google Chrome|Microsoft Edge) \d+(?:\.\d+){1,3}$/),
  executable: gameFilePath,
  files: z.array(z.object({ path: gameFilePath, sha256: z.string().regex(/^[a-f0-9]{64}$/),
    size: z.number().int().min(1).max(512 * 1024 * 1024) }).strict()).min(1).max(25000),
}).strict().superRefine((manifest, context) => {
  const conflict = gameFileTreeConflict(manifest.files.map(file => file.path));
  if (conflict) context.addIssue({ code: "custom", path: ["files", conflict.index], message: conflict.message });
  if (!manifest.files.some(file => file.path === manifest.executable) || manifest.files.some(file => file.path === "manifest.json") ||
      manifest.files.reduce((total, file) => total + file.size, 0) > 1024 * 1024 * 1024)
    context.addIssue({ code: "custom", path: ["files"], message: "The browser executable/tree is missing, recursive or oversized." });
});

export async function loadCoreBrowser(directory = "/browser"): Promise<QualifiedBrowser> {
  const root = path.resolve(directory);
  if (root !== directory || await realpath(root) !== root) throw new Error("The fixed browser path cannot traverse links.");
  // The Core verifies Root ownership before mounting. User namespaces may expose
  // that owner as an unmapped UID; inside, require one consistent immutable tree.
  const owner = (await lstat(root)).uid;
  async function protectedEntry(name: string, isDirectory: boolean) {
    const stat = await lstat(name);
    if (stat.isSymbolicLink() || stat.uid !== owner || stat.mode & 0o022 ||
        (isDirectory ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1))
      throw new Error("The browser installation has unsafe or mixed ownership/modes.");
    return stat;
  }
  await protectedEntry(root, true);
  const manifestPath = path.join(root, "manifest.json");
  if ((await protectedEntry(manifestPath, false)).size > 8 * 1024 * 1024) throw new Error("Browser manifest exceeds its bound.");
  const raw = await readFile(manifestPath);
  const manifest = coreBrowserManifest.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw)));
  if (process.platform === "linux" && manifest.target !== `linux-${process.arch}`)
    throw new Error("The provisioned browser belongs to another architecture.");
  const files = new Map(manifest.files.map(file => [file.path, file]));
  const expectedDirectories = new Set<string>([""]);
  for (const file of files.keys()) {
    let parent = path.posix.dirname(file);
    while (parent !== ".") { expectedDirectories.add(parent); parent = path.posix.dirname(parent); }
  }
  let count = 0;
  async function walk(relative: string) {
    const current = path.join(root, relative); await protectedEntry(current, true);
    for await (const item of await opendir(current)) {
      if (++count > manifest.files.length + expectedDirectories.size) throw new Error("Unexpected browser installation entries.");
      const name = relative ? `${relative}/${item.name}` : item.name;
      if (name === "manifest.json") continue;
      if (expectedDirectories.has(name)) { await walk(name); continue; }
      const expected = files.get(name); if (!expected) throw new Error("Unexpected browser installation file.");
      const stat = await protectedEntry(path.join(root, name), false);
      if (stat.size !== expected.size || await browserDigest(path.join(root, name)) !== expected.sha256)
        throw new Error("The provisioned browser differs from its manifest.");
      files.delete(name);
    }
  }
  await walk("");
  if (files.size) throw new Error("The browser installation is incomplete.");
  const executablePath = path.join(root, manifest.executable);
  if (!((await protectedEntry(executablePath, false)).mode & 0o111)) throw new Error("The browser entrypoint is not executable.");
  return { executablePath, version: manifest.version, sha256: digest(raw),
    components: manifest.files.map(file => ({ path: path.join(root, file.path), sha256: file.sha256 })) };
}
