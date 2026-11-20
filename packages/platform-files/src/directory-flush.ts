import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";

export type DirectoryFlush = "flushed" | "unsupported-on-windows";

/** Files must already have been flushed by the caller before atomic publication.
 * Node's read-only Windows directory handle cannot satisfy FlushFileBuffers'
 * GENERIC_WRITE requirement. Report that specific limitation; never suppress
 * file flush, directory-open, identity, disk-full or POSIX failures. This is not
 * a promise of parent-namespace durability after power loss on Windows. */
export async function flushPublishedDirectory(directory: string): Promise<DirectoryFlush> {
  const before = await lstat(directory);
  if (!before.isDirectory() || before.isSymbolicLink()) throw new Error("Publication parent must be a real directory.");
  const handle = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    const current = await handle.stat();
    if (!current.isDirectory() || current.dev !== before.dev || current.ino !== before.ino)
      throw new Error("Publication parent changed while opening.");
    try { await handle.sync(); }
    catch (error) {
      const failure = error as NodeJS.ErrnoException;
      if (process.platform === "win32" && failure.code === "EPERM" && failure.syscall === "fsync")
        return "unsupported-on-windows";
      throw error;
    }
    return "flushed";
  } finally { await handle.close(); }
}
