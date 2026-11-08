import { createHash, randomUUID } from "node:crypto";
import { chmod, cp, lstat, mkdir, readFile, realpath, rename, rm } from "node:fs/promises";
import * as path from "node:path";

/** Copy verified files to a content-addressed version before any process starts. */
export async function prepareInstallation(
  source: string,
  state: string,
  verify: (directory: string) => Promise<void>,
): Promise<{ directory: string; manifestSha256: string }> {
  source = await realpath(source);
  await verify(source);
  const raw = await readFile(path.join(source, "manifest.json"));
  const manifest = JSON.parse(raw.toString()) as { version: string; target: string };
  if (!/^[a-zA-Z0-9_.-]+$/.test(manifest.version) || !/^[a-z0-9-]+$/.test(manifest.target))
    throw new Error("Invalid immutable engine version path.");
  const manifestSha256 = createHash("sha256").update(raw).digest("hex");
  const versions = path.join(state, "versions");
  await mkdir(versions, { recursive: true, mode: 0o700 });
  const info = await lstat(versions);
  if (!info.isDirectory() || info.isSymbolicLink() || (process.getuid && info.uid !== process.getuid()))
    throw new Error("Unsafe versioned engine directory.");
  if (process.platform !== "win32") await chmod(versions, 0o700);
  const directory = path.join(versions, `${manifest.version}-${manifest.target}-${manifestSha256}`);
  try {
    await verify(directory);
    return { directory: await realpath(directory), manifestSha256 };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const staging = path.join(versions, `.prepared-${randomUUID()}`);
  try {
    await cp(source, staging, { recursive: true, dereference: false, errorOnExist: true, force: false });
    // Detect a source modified between verification and copy.
    await verify(staging);
    if (!raw.equals(await readFile(path.join(staging, "manifest.json"))))
      throw new Error("Engine manifest changed while preparing the update.");
    try { await rename(staging, directory); }
    catch (error) {
      if (!["EEXIST", "ENOTEMPTY"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
      await verify(directory);
    }
    return { directory: await realpath(directory), manifestSha256 };
  } finally { await rm(staging, { recursive: true, force: true }); }
}
