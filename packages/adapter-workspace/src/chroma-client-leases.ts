import { readdirSync, readFileSync, unlinkSync } from "node:fs";
import * as path from "node:path";
import { parseChromaClientLease } from "./chroma-lifecycle";

export function releaseChromaClientLease(
  clientRoot: string,
  ownLeasePath: string,
  processIsAlive: (pid: number) => boolean = defaultProcessIsAlive
): boolean {
  try {
    unlinkSync(ownLeasePath);
  } catch {
    // A failed removal is treated conservatively as a live client below.
  }
  try {
    for (const entry of readdirSync(clientRoot, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const leasePath = path.join(clientRoot, entry.name);
      let lease;
      try {
        lease = parseChromaClientLease(JSON.parse(readFileSync(leasePath, "utf8")));
      } catch {
        lease = undefined;
      }
      if (lease && processIsAlive(lease.pid)) return false;
      try {
        unlinkSync(leasePath);
      } catch {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

function defaultProcessIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
