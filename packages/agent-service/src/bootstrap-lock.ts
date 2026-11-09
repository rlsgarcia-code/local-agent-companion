import Database from "better-sqlite3";
import { chmodSync, lstatSync } from "node:fs";
import * as path from "node:path";
import { privateDirectory } from "./security";

/** OS-backed transaction lock. Parent death closes stdin and releases it; no stale PID lock. */
export async function holdBootstrapLock(directory: string): Promise<void> {
  await privateDirectory(directory);
  const file = path.join(directory, "bootstrap.sqlite");
  try {
    const info = lstatSync(file);
    if (!info.isFile() || info.isSymbolicLink() || process.getuid && info.uid !== process.getuid()) throw new Error("Unsafe bootstrap lock.");
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const database = new Database(file);
  if (process.platform !== "win32") chmodSync(file, 0o600);
  try { database.pragma("busy_timeout = 60000"); database.exec("BEGIN IMMEDIATE"); }
  catch (error) { database.close(); throw error; }
  let finished = false;
  const release = () => {
    if (finished) return;
    finished = true;
    database.exec("ROLLBACK"); database.close();
    process.stdin.pause();
  };
  process.stdin.once("end", release);
  process.stdin.once("error", release);
  process.once("SIGTERM", () => { release(); process.exit(0); });
  process.stdin.resume();
  process.stdout.write("BOOTSTRAP_LOCKED\n");
}

if (require.main === module) void holdBootstrapLock(process.argv[2]!).catch(() => {
  console.error("Cannot acquire the private bootstrap lock. Another client may still be preparing the engine.");
  process.exitCode = 1;
});
