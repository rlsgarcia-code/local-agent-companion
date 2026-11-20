import { constants, type Stats } from "node:fs";
import { lstat, open } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { inferenceBudgetPolicy, type InferenceBudgetPolicy } from "../../contracts/src/inference-budget";
import { defaultInferenceBudgetPolicy } from "./inference-budgets";

export const INFERENCE_LIMITS_FILE = "inference-limits.json";
const document = z.object({ schemaVersion: z.literal(1), policy: inferenceBudgetPolicy }).strict();
function safe(stat: Stats) {
  return stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 &&
    (!process.getuid || (stat.uid === process.getuid() && (stat.mode & 0o077) === 0));
}
/** Optional service-owner ceiling, never client parameters or an authority grant.
 * Existing ledgers remain authoritative; this can only restrict compiled defaults.
 * Absence preserves defaults. Invalid/present configuration refuses startup. */
export async function readOwnerInferenceLimits(directory: string): Promise<InferenceBudgetPolicy | undefined> {
  const file = path.join(directory, INFERENCE_LIMITS_FILE);
  let before: Stats;
  try { before = await lstat(file); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;throw new Error("Cannot inspect owner inference limits."); }
  try {
    if (!safe(before) || before.size < 1 || before.size > 16384) throw Error();
    const handle = await open(file, constants.O_RDONLY | (process.platform === "win32" ? 0 : constants.O_NOFOLLOW));
    try {
      const current = await handle.stat();
      if (!safe(current) || current.ino !== before.ino || current.dev !== before.dev || current.size !== before.size) throw Error();
      const buffer = Buffer.alloc(16385);let used = 0;
      while (used < buffer.length) { const result = await handle.read(buffer, used, buffer.length - used, null);if (!result.bytesRead) break;used += result.bytesRead; }
      const after = await handle.stat();if (used !== before.size || used > 16384 || !safe(after) || after.size !== used || after.mtimeMs !== before.mtimeMs) throw Error();
      const { policy } = document.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, used))));
      for (const scope of ["namespace", "stage"] as const) for (const key of ["callsPerBlock", "tokensPerBlock", "maxBlocks"] as const)
        if (policy[scope][key] > defaultInferenceBudgetPolicy[scope][key]) throw Error();
      if (policy.unknownTokensPerCall < defaultInferenceBudgetPolicy.unknownTokensPerCall) throw Error();
      return policy;
    } finally { await handle.close(); }
  } catch { throw new Error("Invalid or unsafe owner inference limits. Existing state was preserved; no default fallback is allowed."); }
}
