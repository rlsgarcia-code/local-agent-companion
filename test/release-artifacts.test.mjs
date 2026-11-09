import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import test from "node:test";
import { collectReleaseAssets, signReleaseArtifacts, verifyReleaseArtifacts } from "../scripts/release-artifacts.mjs";

test("candidate verification binds artifact bytes and rejects tampering or signed unsafe paths", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "companion-release-"));
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  try {
    await writeFile(path.join(directory, "candidate.zip"), "version one");
    await signReleaseArtifacts(directory, privateKey, { commit: "a".repeat(40), engine: "test" });
    assert.equal((await verifyReleaseArtifacts(directory, publicKey)).commit, "a".repeat(40));
    await writeFile(path.join(directory, "candidate.zip"), "version two");
    await assert.rejects(verifyReleaseArtifacts(directory, publicKey), /integrity verification/);
    const source = JSON.parse(await readFile(path.join(directory, "companion-release.manifest.json"), "utf8"));
    const bytes = Buffer.from(JSON.stringify({ ...source, files: { "../outside.zip": "0".repeat(64) } }));
    await writeFile(path.join(directory, "companion-release.manifest.json"), bytes);
    await writeFile(path.join(directory, "companion-release.manifest.sig"), sign(null, bytes, privateKey));
    await assert.rejects(verifyReleaseArtifacts(directory, publicKey), /Unsafe release artifact/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("workflow artifacts are flattened before signing and duplicate release names are rejected", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "companion-assets-"));
  try {
    await mkdir(path.join(directory, "source", "engine"), { recursive: true });
    await writeFile(path.join(directory, "source", "engine", "candidate.tar.gz"), "artifact");
    await collectReleaseAssets(path.join(directory, "source"), path.join(directory, "flat"));
    assert.equal(await readFile(path.join(directory, "flat", "candidate.tar.gz"), "utf8"), "artifact");
    await writeFile(path.join(directory, "source", "candidate.tar.gz"), "other artifact");
    await assert.rejects(collectReleaseAssets(path.join(directory, "source"), path.join(directory, "duplicates")), /Duplicate/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
