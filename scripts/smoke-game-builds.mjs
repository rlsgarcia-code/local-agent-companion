// Real packaged engine + authenticated SDK. Small fixtures test toolchains, not portfolio quality.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import security from "../dist-tests/packages/agent-service/src/security.js";
import storage from "../dist-tests/packages/agent-service/src/store.js";
import sdk from "../dist-tests/packages/client-ts/src/index.js";
import fixtures from "../dist-tests/test/game-fixtures.js";
import webFixtures from "../dist-tests/test/game-web-fixtures.js";

const state = await mkdtemp(path.join(tmpdir(), "companion-real-game-builds-"));
const output = path.resolve("output/playwright/game-builds");
const observe = process.argv.includes("--observe");
const registration = { id: "game-build-smoke", product: "companion-mac", profile: "fixture", workspace: "", providers: ["ollama"], hostTools: [] };
const identity = await security.ensureIdentity(state), credential = await security.createClientCredential(state, registration);
const store = new storage.Store(path.join(state, "metadata.sqlite")); store.register(credential); store.close();
const engineRoot = path.resolve("engine-dist"), node = path.join(engineRoot, process.platform === "win32" ? "node.exe" : "node");
const child = spawn(node, [path.join(engineRoot, "service.cjs"), state], { stdio: ["ignore", "pipe", "pipe"] });
let failure = "", client;
child.stdout.on("data", (data) => { failure += data.toString(); }); child.stderr.on("data", (data) => { failure += data.toString(); });
try {
  for (let i = 0; i < 600; i++) {
    if (child.exitCode !== null) throw new Error(`Packaged engine exited: ${failure}`);
    try { await readFile(path.join(state, "runtime.json")); break; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  client = new sdk.AgentClient({ address: security.ipcPath(state), certificate: identity.cert, credential }); await client.connect();
  const capabilities = await client.gameProductionCapabilities();
  assert.ok(["phaser", "babylon"].every((engine) => capabilities.adapters.some((adapter) => adapter.engine === engine && adapter.available)));
  const collector = capabilities.collectors.find((item) => item.id === "web-browser-runtime-v1");
  if (observe) assert.ok(collector?.available, collector?.reason ?? "The qualified browser collector is unavailable.");
  for (const engine of ["phaser", "babylon"]) {
    const document = fixtures.fixtureGameDocument(); document.engine = engine;
    if (engine === "babylon") document.brief.dimension = "3d";
    const source = webFixtures.webFixture(engine);
    if (observe) source.set("data/playtests.json", JSON.stringify({ schemaVersion: 1, viewport: { width: 640, height: 360 }, scenarios: [{ id: "observed-movement", steps: [
      { action: "wait", ms: 200 }, { action: "capture", selector: "canvas", name: "before" }, { action: "press", key: "Space" }, { action: "wait", ms: 100 },
      { action: "expect-image", selector: "canvas", baseline: "before", comparison: "changed", threshold: 0.001 },
    ] }] }));
    for (const [name, data] of source) document.files.push(await client.uploadGameFile(name, Buffer.from(data), "text/plain"));
    const project = await client.createGameProject(`smoke-${engine}`, document), job = await client.startGameBuild(`build-${engine}`, project.id, 1);
    let current = job;
    for (let i = 0; i < 300; i++) {
      current = await client.getGameProduction(job.id);
      if (!["queued", "running"].includes(current.state)) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(current.state, "completed", current.error);
    const artifact = await client.getGameArtifact(job.id), target = path.join(output, engine);
    for (const file of artifact.files) {
      const destination = path.join(target, file.path); await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, await client.downloadGameArtifactFile(job.id, file.path));
    }
    const quality = await client.getGameQuality(project.id);
    assert.equal(quality.ready, false);
    await writeFile(path.join(target, "build-evidence.json"), JSON.stringify({ artifact, quality, purpose: "toolchain integration fixture; not game acceptance" }, null, 2));
    console.log(`PACKAGED_GAME_BUILD_OK ${engine} ${artifact.artifactHash} ${target}`);
    if (observe) {
      const validation = await client.startGameValidation(`observe-${engine}`, job.id, collector.id);
      let observed = validation;
      for (let i = 0; i < 2000; i++) {
        observed = await client.getGameProduction(validation.id);
        if (!["queued", "running"].includes(observed.state)) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert.equal(observed.state, "completed", observed.error);
      const reports = await client.getGameReports(job.id);
      assert.equal(reports[0].checks.find((check) => check.id === "boots").status, "passed");
      assert.equal(reports[0].checks.find((check) => check.id === "console").status, "passed");
      assert.equal(reports.find((report) => report.testCase).checks[0].status, "passed");
      for (const report of reports) for (const file of report.evidence ?? []) {
        const destination = path.join(target, "observations", report.id, file.path);
        await mkdir(path.dirname(destination), { recursive: true });
        await writeFile(destination, await client.downloadGameReportFile(report.id, file.path));
      }
      await writeFile(path.join(target, "observations.json"), JSON.stringify({ reports, quality: await client.getGameQuality(project.id), purpose: "Independent automated observations, not full game acceptance" }, null, 2));
      console.log(`PACKAGED_GAME_OBSERVATION_OK ${engine} ${reports.length} reports ${target}`);
    }
  }
} finally {
  client?.close();
  if (child.exitCode === null) { const exited = once(child, "exit"); child.kill("SIGTERM"); await exited; }
  await rm(state, { recursive: true, force: true });
}
