import assert from "node:assert/strict";
import test from "node:test";
import { chmod, lstat, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { assertGenerationStateDirectory, createGenerationState, generationStateParent } from "./game-generation-state";

test("new real-model evaluation state is a unique private durable child; inspection preserves bytes and never recreates missing state", async () => {
  const first = await createGenerationState(), second = await createGenerationState();
  try {
    assert.notEqual(first, second);assert.equal(path.basename(path.dirname(first)), path.basename(generationStateParent()));
    if (process.getuid) { assert.equal((await lstat(first)).mode & 0o077, 0);assert.equal((await lstat(first)).uid, process.getuid()); }
    const file = path.join(first, "original.json");await writeFile(file, '{"fixture":true}\n', { mode: 0o600 });
    const bytes = await readFile(file);assert.equal(await assertGenerationStateDirectory(first), first);assert.deepEqual(await readFile(file), bytes);
    await rm(first, { recursive: true });await assert.rejects(assertGenerationStateDirectory(first), { code: "ENOENT" });
    await assert.rejects(lstat(first), { code: "ENOENT" });
  } finally { await rm(first, { recursive: true, force: true });await rm(second, { recursive: true, force: true }); }
});

test("generation state refuses public or symlinked state and unrelated private directories without changing them", { skip: process.platform === "win32" }, async () => {
  const state = await createGenerationState(), other = await mkdtemp(path.join(tmpdir(), "unrelated-generation-")), link = state + "-link";
  try {
    await chmod(state, 0o755);await assert.rejects(assertGenerationStateDirectory(state), /Private original generation state/);assert.equal((await lstat(state)).mode & 0o777, 0o755);
    await chmod(state, 0o700);await symlink(state, link, "dir");await assert.rejects(assertGenerationStateDirectory(link), /Private original generation state/);
    await assert.rejects(assertGenerationStateDirectory(other), /Unknown generation state directory/);
  } finally { await rm(link, { force: true });await rm(state, { recursive: true, force: true });await rm(other, { recursive: true, force: true }); }
});
