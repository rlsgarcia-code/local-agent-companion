import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { mkdtemp, realpath, mkdir, writeFile, readFile, rm, readdir, symlink, link, cp, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import type { Browser } from "playwright-core";
import { canonical, contentHash } from "../packages/contracts/src/identity";
import { gameArtifact } from "../packages/contracts/src/game-production";
import { gameBrowserProcessRequest, gameBrowserProcessResult } from "../packages/contracts/src/game-browser-worker";
import { processBrowserCandidate } from "../packages/adapter-game-browser/src/candidate";
import { coreBrowserManifest, loadCoreBrowser } from "../packages/adapter-game-browser/src/candidate-browser";
import { gameBrowserCandidateToolchain } from "../packages/adapter-game-browser/src/candidate-toolchain";
import { digest } from "../packages/adapter-game-browser/src/journal";
import * as collection from "../packages/adapter-game-browser/src/collect";
import { qualifyBrowser } from "../packages/adapter-game-browser/src/browser";

const pin = "a".repeat(64);
async function fixture() {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "browser-candidate-")));
  const input = path.join(root, "input"), output = path.join(root, "output");
  await mkdir(input, { mode: 0o700 }); await mkdir(output, { mode: 0o700 }); await mkdir(path.join(input, "blobs"), { mode: 0o700 });
  const browserBytes = Buffer.from("Synthetic browser identity; never executed");
  const executablePath = path.join(root, "browser"); await writeFile(executablePath, browserBytes, { mode: 0o600 });
  const browser = { executablePath, version: "Chromium 1.2.3.4", sha256: digest(browserBytes), components: [{ path: executablePath, sha256: digest(browserBytes) }] };
  const resources = new Map([
    ["index.html", Buffer.from('<!doctype html><html><body><canvas width="40" height="40"></canvas><script src="main.js"></script></body></html>')],
    ["main.js", Buffer.from('const c=document.querySelector("canvas").getContext("2d");c.fillStyle="red";c.fillRect(0,0,20,40);c.fillStyle="blue";c.fillRect(20,0,20,40);')],
  ]);
  const files = [...resources].map(([name, bytes]) => ({ path: name, mime: name.endsWith("html") ? "text/html" : "text/javascript", sha256: digest(bytes), size: bytes.length, transferId: name }));
  const sourceHash = "b".repeat(64), toolchain = { id: "fixture-build", version: "1", sha256: pin };
  const artifact = gameArtifact.parse({ id: "artifact", jobId: "build", projectId: "project", revision: 1, sourceHash,
    engine: "phaser", adapterId: "fixture-build", toolchain, entrypoint: "index.html", files, createdAt: 0,
    artifactHash: contentHash({ sourceHash, engine: "phaser", toolchain, entrypoint: "index.html", files: files.map(({ transferId: _id, ...file }) => file) }) });
  const request = gameBrowserProcessRequest.parse({ schemaVersion: 1, requestId: "validation", artifact,
    toolchain: gameBrowserCandidateToolchain(pin, browser.sha256), designScenarios: [] });
  const raw = Buffer.from(canonical(request));
  await writeFile(path.join(input, "request.json"), raw, { mode: 0o600 });
  for (const bytes of resources.values()) await writeFile(path.join(input, "blobs", digest(bytes)), bytes, { mode: 0o600 });
  return { root, input, output, request, raw, browser,
    run: (signal?: AbortSignal) => processBrowserCandidate({ inputDirectory: input, outputDirectory: output, implementationSha256: pin, browser, signal }),
    rewrite: () => writeFile(path.join(input, "request.json"), canonical(request)),
    close: () => rm(root, { recursive: true, force: true }) };
}
async function exitedPid() {
  const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
  await once(child, "close"); return child.pid!;
}
async function simulatedCollection(f: Awaited<ReturnType<typeof fixture>>, acknowledge = true) {
  const pid = await exitedPid();
  return mock.method(collection, "collect", async (...args: Parameters<typeof collection.collect>) => {
    assert.equal(args[2], true); assert.equal(args[0].artifact.artifactHash, f.request.artifact.artifactHash);
    await assert.rejects(args[0].readFile("/etc/passwd"));
    const browser = { newBrowserCDPSession: async () => ({ send: async () => ({ processInfo: [{ type: "browser", id: pid }] }), detach: async () => {} }) } as unknown as Browser;
    await args[4](browser, "http://127.0.0.1:1"); if (acknowledge) await args[3]();
    return [{ category: "runtime" as const, environment: { platform: "fixture", device: "Simulated browser transport", browser: f.browser.version, input: [], scope: "automated" as const },
      metrics: {}, checks: [{ id: "fixture", status: "unverified" as const, detail: "Test transport only, no browser/game qualification." }],
      evidenceFiles: [{ path: "trace.json", mime: "application/json", data: Buffer.from('{"fixture":true}') }] }];
  });
}

test("the candidate commits exact original bindings and hashed evidence only after an observed browser stop", { skip: process.platform === "win32" }, async () => {
  const f = await fixture(), mocked = await simulatedCollection(f);
  try {
    const result = await f.run(); gameBrowserProcessResult.parse(result);
    assert.equal(result.requestSha256, digest(f.raw)); assert.equal(result.artifactHash, f.request.artifact.artifactHash);
    assert.deepEqual(result.toolchain, f.request.toolchain); assert.equal(mocked.mock.callCount(), 1);
    const metadata = result.observations[0]!.evidenceFiles[0]!;
    assert.equal(digest(await readFile(path.join(f.output, "candidate", metadata.sha256))), metadata.sha256);
    const stopped = JSON.parse(await readFile(path.join(f.output, "stopped.json"), "utf8")); assert.equal(stopped.requestSha256, digest(f.raw));
    assert.deepEqual(JSON.parse(await readFile(path.join(f.output, "result.json"), "utf8")), result);
    assert.deepEqual(await readFile(path.join(f.input, "request.json")), f.raw);
    await assert.rejects(f.run()); assert.equal(mocked.mock.callCount(), 1);
  } finally { mocked.mock.restore(); await f.close(); }
});

test("a report without original shutdown acknowledgment cannot become a committed candidate", { skip: process.platform === "win32" }, async () => {
  const f = await fixture(), mocked = await simulatedCollection(f, false);
  try { await assert.rejects(f.run(), /shutdown acknowledgment/); assert.ok(!(await readdir(f.output)).includes("result.json")); }
  finally { mocked.mock.restore(); await f.close(); }
});

test("tampered blobs and changed runtime pins are refused before any collection", { skip: process.platform === "win32" }, async () => {
  for (const change of ["blob", "toolchain", "browser", "artifact", "extra"] as const) {
    const f = await fixture(), mocked = await simulatedCollection(f);
    try {
      if (change === "blob") await writeFile(path.join(f.input, "blobs", f.request.artifact.files[0]!.sha256), "changed");
      if (change === "toolchain") { f.request.toolchain.sha256 = "c".repeat(64); await f.rewrite(); }
      if (change === "browser") await writeFile(f.browser.executablePath, "changed");
      if (change === "artifact") { f.request.artifact.artifactHash = "c".repeat(64); await f.rewrite(); }
      if (change === "extra") await writeFile(path.join(f.input, "blobs", "unregistered"), "must not read");
      await assert.rejects(f.run()); assert.equal(mocked.mock.callCount(), 0);
      assert.ok(!(await readdir(f.output)).includes("result.json"));
    } finally { mocked.mock.restore(); await f.close(); }
  }
});

test("linked build inputs and overlapping exchanges preserve originals and never launch", { skip: process.platform === "win32" }, async () => {
  for (const kind of ["symlink", "hardlink", "directory", "overlap"] as const) {
    const f = await fixture(), mocked = await simulatedCollection(f);
    try {
      if (kind === "overlap") await assert.rejects(processBrowserCandidate({ inputDirectory: f.input, outputDirectory: f.input, implementationSha256: pin, browser: f.browser }));
      else {
        const target = kind === "directory" ? path.join(f.input, "blobs") : path.join(f.input, "blobs", f.request.artifact.files[0]!.sha256);
        const original = path.join(f.root, "preserved");
        if (kind === "directory") { await rm(target, { recursive: true }); await mkdir(original, { mode: 0o700 }); }
        else { await writeFile(original, await readFile(target), { mode: 0o600 }); await rm(target); }
        await (kind === "hardlink" ? link : symlink)(original, target); await assert.rejects(f.run());
      }
      assert.equal(mocked.mock.callCount(), 0); assert.deepEqual(await readFile(path.join(f.input, "request.json")), f.raw);
    } finally { mocked.mock.restore(); await f.close(); }
  }
});

test("a pre-cancelled operation writes nothing, and competing requests cannot collect twice", { skip: process.platform === "win32" }, async () => {
  const f = await fixture(), mocked = await simulatedCollection(f);
  try {
    await assert.rejects(f.run(AbortSignal.abort())); assert.deepEqual(await readdir(f.output), []);
    const outcomes = await Promise.allSettled([f.run(), f.run()]);
    assert.equal(outcomes.filter(outcome => outcome.status === "fulfilled").length, 1); assert.equal(mocked.mock.callCount(), 1);
  } finally { mocked.mock.restore(); await f.close(); }
});

test("the sealed ABI cannot select a host/browser command, replace suite contents or claim physical/human coverage", async () => {
  const f = await fixture();
  try {
    for (const extra of [{ browser: { executablePath: "/bin/sh" } }, { args: ["--no-sandbox"] }, { headless: false }, { uid: 0 }])
      assert.equal(gameBrowserProcessRequest.safeParse({ ...f.request, ...extra }).success, false);
    assert.equal(gameBrowserProcessRequest.safeParse({ ...f.request, testSuite: "data/playtests/missing.json" }).success, false);
    const row = { category: "runtime", checks: [{ id: "claimed", status: "passed", detail: "claimed" }], metrics: {}, evidenceFiles: [],
      environment: { platform: "fixture", browser: "fixture", device: "fixture", input: [], scope: "physical" } };
    const result = { schemaVersion: 1, requestId: "validation", requestSha256: digest(f.raw), sourceHash: f.request.artifact.sourceHash,
      artifactHash: f.request.artifact.artifactHash, toolchain: f.request.toolchain, observations: [row] };
    assert.equal(gameBrowserProcessResult.safeParse(result).success, false);
    row.environment.scope = "automated"; assert.equal(gameBrowserProcessResult.safeParse(result).success, true);
    assert.equal(gameBrowserProcessResult.safeParse({ ...result, observations: [{ ...row, coverage: { contentIds: ["game-won"], scenarioIds: [] } }] }).success, false);
    assert.equal(coreBrowserManifest.safeParse({ schemaVersion: 1, version: "Chromium 1.2.3.4", executable: "../sh", files: [] }).success, false);
  } finally { await f.close(); }
});

test("the fixed mount reader verifies the complete browser tree and pins its original manifest bytes", { skip: process.platform === "win32" }, async () => {
  const f = await fixture();
  try {
    const directory = path.join(f.root, "installation"); await mkdir(directory, { mode: 0o700 });
    await mkdir(path.join(directory, "resources"), { mode: 0o700 });
    const files = [{ path: "chrome", bytes: Buffer.from("not executed") }, { path: "resources/data", bytes: Buffer.from("pinned browser data") }];
    for (const file of files) await writeFile(path.join(directory, file.path), file.bytes, { mode: file.path === "chrome" ? 0o700 : 0o600 });
    const manifest = { schemaVersion: 1, target: process.arch === "arm64" ? "linux-arm64" : "linux-x64", version: "Chromium 1.2.3.4", executable: "chrome", files: files.map(file => ({ path: file.path, size: file.bytes.length, sha256: digest(file.bytes) })) };
    const raw = Buffer.from(JSON.stringify(manifest, null, 2)); await writeFile(path.join(directory, "manifest.json"), raw, { mode: 0o600 });
    const qualified = await loadCoreBrowser(directory);
    assert.equal(qualified.sha256, digest(raw)); assert.equal(qualified.components.length, 2);
    assert.equal(qualified.executablePath, path.join(directory, "chrome"));
    await writeFile(path.join(directory, "resources/data"), "changed"); await assert.rejects(loadCoreBrowser(directory));
    await writeFile(path.join(directory, "resources/data"), files[1]!.bytes);
    await writeFile(path.join(directory, "unlisted.js"), "not pinned"); await assert.rejects(loadCoreBrowser(directory));
    await rm(path.join(directory, "unlisted.js")); await chmod(path.join(directory, "chrome"), 0o600);
    if (process.platform !== "win32") await assert.rejects(loadCoreBrowser(directory));
  } finally { await f.close(); }
});

test("real disposable browser collection commits rendered pixels and closes the observed browser", { skip: process.env.COMPANION_GAME_BROWSER_CANDIDATE_REAL !== "1" }, async () => {
  const f = await fixture();
  try {
    const browser = await qualifyBrowser(); assert.ok(browser, "Provision an existing qualified browser; no automatic download.");
    f.request.toolchain = gameBrowserCandidateToolchain(pin, browser.sha256); await f.rewrite();
    const result = await processBrowserCandidate({ inputDirectory: f.input, outputDirectory: f.output, implementationSha256: pin, browser });
    assert.equal(result.observations[0]!.metrics.renderedPixelsObserved, true);
    assert.ok(result.observations[0]!.evidenceFiles.some(file => file.mime === "image/png"));
    assert.equal(result.requestSha256, digest(await readFile(path.join(f.input, "request.json"))));
    assert.ok((await readdir(f.output)).includes("stopped.json"));
    const core = process.env.COMPANION_GAME_BROWSER_CORE;
    if (core) {
      const { observations: _observations, ...binding } = result;
      const script = "import json,sys;from pathlib import Path;from kidos_core.game_browser_worker import verify_browser_candidate;b=json.load(sys.stdin);r=verify_browser_candidate(Path(sys.argv[1]),b);assert verify_browser_candidate(Path(sys.argv[1]),b)==r;print('CORE_BROWSER_CANDIDATE_VERIFIED')";
      const inspect = () => spawnSync("python3", ["-c", script, f.output], { input: canonical(binding), encoding: "utf8", timeout: 10000,
        env: { PATH: process.env.PATH, PYTHONPATH: core, PYTHONDONTWRITEBYTECODE: "1" } });
      const verified = inspect(); assert.equal(verified.status, 0, verified.stderr); assert.match(verified.stdout, /CORE_BROWSER_CANDIDATE_VERIFIED/);
      const evidence = result.observations[0]!.evidenceFiles[0]!;
      const file = path.join(f.output, "candidate", evidence.sha256), original = await readFile(file);
      await writeFile(file, Buffer.alloc(original.length)); assert.notEqual(inspect().status, 0);
      await writeFile(file, original); assert.equal(inspect().status, 0);
    }
    const destination = process.env.COMPANION_GAME_BROWSER_EVIDENCE_DIR;
    if (destination) {
      // Explicit test-only destination, create once; never overwrite past evidence.
      await mkdir(destination, { mode: 0o700 });
      await cp(f.output, path.join(destination, "output"), { recursive: true, force: false, errorOnExist: true });
      await writeFile(path.join(destination, "request.json"), await readFile(path.join(f.input, "request.json")), { mode: 0o600 });
      await writeFile(path.join(destination, "scope.json"), canonical({ platform: process.platform, arch: process.arch,
        node: process.versions.node, browser, coreBytesVerified: Boolean(core), installed: false, linuxSandboxVerified: false,
        humanAcceptance: false, gameAcceptance: false }), { mode: 0o600 });
    }
  } finally { await f.close(); }
});
