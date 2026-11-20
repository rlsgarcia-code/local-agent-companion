import { lstat, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir, userInfo } from "node:os";
import path from "node:path";
import { z } from "zod";

export const browserTemporary = z.object({ path: z.string().refine(path.isAbsolute),
  device: z.string().regex(/^\d+$/), inode: z.string().regex(/^\d+$/), owner: z.string().min(1).max(256) }).strict();
export type BrowserTemporary = z.infer<typeof browserTemporary>;
const owner = () => String(process.getuid?.() ?? userInfo().username);
const base = () => realpath(process.platform === "win32" ? tmpdir() : "/tmp");

export async function createBrowserTemporary(): Promise<BrowserTemporary> {
  const directory = await mkdtemp(path.join(await base(), "cb-"));
  const info = await lstat(directory, { bigint: true });
  const value = browserTemporary.parse({ path: directory, device: String(info.dev), inode: String(info.ino), owner: owner() });
  try {
    await checkBrowserTemporary(value);
    if (process.platform !== "win32" && Buffer.byteLength(path.join(directory, "com.google.Chrome.XXXXXX/SingletonSocket")) >= 104)
      throw new Error("The system temporary directory cannot fit the browser's private socket.");
    return value;
  } catch (error) { await removeBrowserTemporary(value).catch(() => {});throw error; }
}

export async function checkBrowserTemporary(value: BrowserTemporary, boundParent?: string): Promise<void> {
  browserTemporary.parse(value);
  const parent = boundParent ?? await base();
  if (parent !== await realpath(parent) || path.dirname(value.path) !== parent || !/^cb-[a-zA-Z0-9]{6}$/.test(path.basename(value.path)) || value.owner !== owner())
    throw new Error("Browser temporary directory does not belong to this operation's owner.");
  const info = await lstat(value.path, { bigint: true });
  if (!info.isDirectory() || info.isSymbolicLink() || String(info.dev) !== value.device || String(info.ino) !== value.inode ||
      process.getuid && (info.uid !== BigInt(process.getuid()) || (info.mode & 0o077n) !== 0n))
    throw new Error("Browser temporary directory identity changed.");
}

/** Caller must first confirm its exact worker/resource shutdown receipt. */
export async function removeBrowserTemporary(value: BrowserTemporary): Promise<void> {
  try { await checkBrowserTemporary(value); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return;throw error; }
  await rm(value.path, { recursive: true });
}
