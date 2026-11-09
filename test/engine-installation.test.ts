import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import test from "node:test";
import { prepareInstallation, assertSafeActivation } from "../packages/client-ts/src/installation";
import { verifyBundle } from "../packages/client-ts/src/bootstrap";
import { ENGINE_VERSION, NODE_VERSION, PROTOCOL_VERSION } from "../packages/contracts/src/index";

test("older clients cannot downgrade a newer engine or replace the bytes of an immutable release", () => {
  assertSafeActivation("1.0.0-rc.2", "1.0.0-rc.3");
  assertSafeActivation("1.0.0-rc.3", "1.0.0");
  assert.throws(() => assertSafeActivation("1.0.0-rc.3", "1.0.0-rc.2"), /downgrade/);
  assert.throws(() => assertSafeActivation("1.0.0", "1.0.0-rc.3"), /downgrade/);
  assert.throws(() => assertSafeActivation("1.0.0", "1.0.0"), /immutable release/);
  assert.throws(() => assertSafeActivation("unknown", "1.0.0"), /Unknown/);
});

test("preparing a new engine keeps the exact previous files available to existing processes", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "engine-immutable-"));
  const source = path.join(root, "source"), state = path.join(root, "state");
  await mkdir(source);
  const keys = generateKeyPairSync("ed25519");
  const publicKey = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
  const node = process.platform === "win32" ? "node.exe" : "node";
  const publish = async (content: string) => {
    await writeFile(path.join(source, node), "runtime-fixture");
    await writeFile(path.join(source, "service.cjs"), content);
    await writeFile(path.join(source, "bootstrap-lock.cjs"), "lock-fixture");
    const files: Record<string, string> = {};
    for (const name of [node, "service.cjs", "bootstrap-lock.cjs"])
      files[name] = createHash("sha256").update(await readFile(path.join(source, name))).digest("hex");
    const raw = Buffer.from(JSON.stringify({ version: ENGINE_VERSION, protocol: PROTOCOL_VERSION, node: NODE_VERSION, target: `${process.platform}-${process.arch}`, files }));
    await writeFile(path.join(source, "manifest.json"), raw);
    await writeFile(path.join(source, "manifest.sig"), sign(null, raw, keys.privateKey));
  };
  const verify = (directory: string) => verifyBundle(directory, publicKey);
  try {
    await publish("previous-code");
    const first = await prepareInstallation(source, state, verify);
    assert.equal((await prepareInstallation(source, state, verify)).directory, first.directory);
    await publish("next-code");
    const second = await prepareInstallation(source, state, verify);
    assert.notEqual(first.directory, second.directory);
    assert.equal(await readFile(path.join(first.directory, "service.cjs"), "utf8"), "previous-code");
    assert.equal(await readFile(path.join(second.directory, "service.cjs"), "utf8"), "next-code");
    await writeFile(path.join(source, "service.cjs"), "unverified-change");
    await assert.rejects(prepareInstallation(source, state, verify), /integrity/);
    assert.equal(await readFile(path.join(first.directory, "service.cjs"), "utf8"), "previous-code");
  } finally { await rm(root, { recursive: true, force: true }); }
});
