import { createHash, randomUUID } from "node:crypto";
import { chmod, cp, lstat, mkdir, readFile, realpath, rename, rm } from "node:fs/promises";
import * as path from "node:path";

/** Old clients cannot silently downgrade a newer service or replace an immutable release. */
export function assertSafeActivation(installed: string, requested: string, development = false): void {
  if (development) return;
  const parse = (value: string): number[] => {
    const match = /^(\d+)\.(\d+)\.(\d+)(?:-rc\.(\d+))?$/.exec(value);
    if (!match) throw new Error("Unknown engine release ordering. Update the clients or use the explicit rollback procedure.");
    return [Number(match[1]), Number(match[2]), Number(match[3]), match[4] === undefined ? Number.POSITIVE_INFINITY : Number(match[4])];
  };
  const previous = parse(installed), next = parse(requested);
  for (let i = 0; i < previous.length; i++) {
    if (previous[i]! < next[i]!) return;
    if (previous[i]! > next[i]!) throw new Error("A newer engine is installed. Update this client; automatic downgrade is prohibited.");
  }
  throw new Error("This engine version has a different signed artifact. Repair the exact client/engine installation; an immutable release cannot be replaced silently.");
}

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
