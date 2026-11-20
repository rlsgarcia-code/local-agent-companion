import assert from "node:assert/strict";
import fs from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import test, { type TestContext } from "node:test";
import { flushPublishedDirectory } from "../packages/platform-files/src/directory-flush";

function fixture(t: TestContext, platform: string, error?: unknown) {
  const descriptor = Object.getOwnPropertyDescriptor(process, "platform")!;
  Object.defineProperty(process, "platform", { value: platform });
  t.after(() => Object.defineProperty(process, "platform", descriptor));
  const info = { dev: 1, ino: 2, isDirectory: () => true, isSymbolicLink: () => false };
  let closed = 0, synced = 0;
  const handle = { stat: async () => info, sync: async () => { synced++;if (error) throw error; }, close: async () => { closed++; } };
  t.mock.method(fs, "lstat", async () => info as unknown as Awaited<ReturnType<typeof fs.lstat>>);
  t.mock.method(fs, "open", async () => handle as unknown as FileHandle);
  return { info, handle, counts: () => ({ closed, synced }) };
}

test("successful directory flush is required and its descriptor is closed", async t => {
  const f = fixture(t, "linux");
  assert.equal(await flushPublishedDirectory("fixture"), "flushed");
  assert.deepEqual(f.counts(), { closed: 1, synced: 1 });
});

test("only Windows directory fsync EPERM reports its explicit unsupported mode", async t => {
  const f = fixture(t, "win32", Object.assign(new Error("fixture"), { code: "EPERM", syscall: "fsync" }));
  assert.equal(await flushPublishedDirectory("fixture"), "unsupported-on-windows");
  assert.deepEqual(f.counts(), { closed: 1, synced: 1 });
});

for (const [platform, code, syscall] of [["linux", "EPERM", "fsync"], ["darwin", "EPERM", "fsync"], ["win32", "EIO", "fsync"], ["win32", "ENOSPC", "fsync"], ["win32", "EACCES", "fsync"], ["win32", "EPERM", "open"]]) {
  test(`directory ${platform} ${code}/${syscall} remains a failed publication`, async t => {
    const error = Object.assign(new Error("fixture"), { code, syscall }), f = fixture(t, platform!, error);
    await assert.rejects(flushPublishedDirectory("fixture"), e => e === error);
    assert.deepEqual(f.counts(), { closed: 1, synced: 1 });
  });
}

test("directory links and changed identities never reach a flush", async t => {
  const f = fixture(t, "win32");
  f.info.isSymbolicLink = () => true;
  await assert.rejects(flushPublishedDirectory("fixture"), /real directory/);
  f.info.isSymbolicLink = () => false;
  f.handle.stat = async () => ({ ...f.info, ino: 3 });
  await assert.rejects(flushPublishedDirectory("fixture"), /changed/);
  assert.deepEqual(f.counts(), { closed: 1, synced: 0 });
});
