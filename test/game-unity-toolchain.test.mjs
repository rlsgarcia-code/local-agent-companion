import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { verifyUnityInstallerSignature, verifyUnityInput, unityTreeManifest } from "../scripts/prepare-game-unity.mjs";

test("Unity preparation requires the Apple-trusted exact publisher certificate, not a digest-only or invalid signature", () => {
  const publisher = { teamIdentifier: "TEAM123", installerCertificateSha256: "ab".repeat(32) };
  const report = `Package: Unity.pkg\nStatus: signed by a developer certificate issued by Apple for distribution\n1. Developer ID Installer: Unity Technologies SF (TEAM123)\nSHA256 Fingerprint:\n${"AB ".repeat(32)}\n----------------\n2. Developer ID Certification Authority\n`;
  assert.doesNotThrow(() => verifyUnityInstallerSignature(report, publisher));
  for (const invalid of [report.replace("signed by a developer certificate issued by Apple for distribution", "invalid signature"), report.replace("TEAM123", "OTHER"), report.replace("AB AB", "00 00"), "SHA-256 matches, no certificate"])
    assert.throws(() => verifyUnityInstallerSignature(invalid, publisher));
});

test("Unity inputs are bounded regular files and must match both exact length and SHA-256", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "unity-inputs-"));
  try {
    const input = path.join(directory, "Unity.pkg"), bytes = Buffer.from("controlled installer fixture"); await writeFile(input, bytes);
    const record = { size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
    await verifyUnityInput(input, record);
    await assert.rejects(verifyUnityInput(input, { ...record, size: record.size + 1 }), /integrity mismatch/);
    await assert.rejects(verifyUnityInput(input, { ...record, sha256: "0".repeat(64) }), /integrity mismatch/);
    const link = path.join(directory, "linked.pkg"); await symlink(input, link);
    await assert.rejects(verifyUnityInput(link, record), /integrity mismatch/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("Unity inventories are deterministic and reject links to personal paths outside the toolchain", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "unity-inventory-"));
  try {
    const a = path.join(directory, "a"), b = path.join(directory, "b"); await mkdir(a); await mkdir(b);
    for (const [root, names] of [[a, ["z.bin", "a.bin"]], [b, ["a.bin", "z.bin"]]])
      for (const name of names) await writeFile(path.join(root, name), name);
    await symlink("a.bin", path.join(a, "current")); await symlink("a.bin", path.join(b, "current"));
    assert.equal(JSON.stringify(await unityTreeManifest(a)), JSON.stringify(await unityTreeManifest(b)));
    await writeFile(path.join(directory, "outside"), "canary only"); await symlink("../outside", path.join(a, "escape"));
    await assert.rejects(unityTreeManifest(a), /outside its root/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
