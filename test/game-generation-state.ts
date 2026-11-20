// Development evaluation storage only, never a product enrollment or recovery
// authority. Validation is read-only and does not recreate missing state.
import assert from "node:assert/strict";
import type { Stats } from "node:fs";
import { lstat, mkdir, mkdtemp, realpath } from "node:fs/promises";
import path from "node:path";

export const generationStateParent = () => path.resolve(".cache/game-generation-state");
function privateDirectory(stat: Stats) {
  return stat.isDirectory() && !stat.isSymbolicLink() &&
    (!process.getuid || (stat.uid === process.getuid() && (stat.mode & 0o077) === 0));
}
export async function createGenerationState(): Promise<string> {
  const parent = generationStateParent();
  await mkdir(parent, { recursive: true, mode: 0o700 });
  assert.ok(privateDirectory(await lstat(parent)), "Private generation state parent required.");
  const state = await mkdtemp(path.join(parent, "cgg-"));
  return assertGenerationStateDirectory(state);
}
export async function assertGenerationStateDirectory(directory: string): Promise<string> {
  const stat = await lstat(directory);
  assert.ok(privateDirectory(stat), "Private original generation state required.");
  const state = await realpath(directory);
  if (/^\/(?:private\/)?tmp\/cgg-[A-Za-z0-9]+$/.test(state)) return state; // Existing legacy attempts only.
  assert.match(path.basename(state), /^cgg-[A-Za-z0-9]+$/, "Unknown generation state directory.");
  const parent = generationStateParent();
  assert.ok(privateDirectory(await lstat(parent)), "Private generation state parent required.");
  assert.equal(path.dirname(state), await realpath(parent), "Only the exact private generation state parent is accepted.");
  return state;
}
