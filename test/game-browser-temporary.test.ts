import assert from "node:assert/strict";
import { lstat, writeFile, readFile, rename, symlink, rm } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { createBrowserTemporary, checkBrowserTemporary, removeBrowserTemporary } from "../packages/adapter-game-browser/src/temporary";

test("browser socket temp is short, unique, private and removable only with its original identity", async () => {
  const first = await createBrowserTemporary(), second = await createBrowserTemporary();
  try {
    assert.notEqual(first.path, second.path);
    await checkBrowserTemporary(first); await checkBrowserTemporary(second);
    if (process.platform !== "win32") {
      assert.ok(Buffer.byteLength(path.join(first.path, "com.google.Chrome.XXXXXX/SingletonSocket")) < 104);
      assert.equal((await lstat(first.path)).mode & 0o077, 0);
    }
    await writeFile(path.join(first.path, "retained.txt"), "Private fixture only");
    await assert.rejects(removeBrowserTemporary({ ...first, inode: (BigInt(first.inode) + 1n).toString() }), /identity changed/);
    await assert.rejects(removeBrowserTemporary({ ...first, owner: "different-owner" }), /owner/);
    assert.equal(await readFile(path.join(first.path, "retained.txt"), "utf8"), "Private fixture only");
  } finally { await removeBrowserTemporary(first);await removeBrowserTemporary(second); }
  await assert.rejects(lstat(first.path), { code: "ENOENT" });
});

test("a replaced browser temporary directory link never deletes its target", { skip: process.platform === "win32" }, async () => {
  const value = await createBrowserTemporary(), original = value.path + "-original";
  await writeFile(path.join(value.path, "retained.txt"), "Original fixture");
  await rename(value.path, original);await symlink(original, value.path);
  try {
    await assert.rejects(removeBrowserTemporary(value), /identity changed/);
    assert.equal(await readFile(path.join(original, "retained.txt"), "utf8"), "Original fixture");
  } finally { await rm(value.path); await rm(original, { recursive: true }); }
});
