// Packaged engine, two authenticated products, real codec cancellation and web build.
// Temporary synthetic projects only; no provider, user data, installation or game acceptance.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import security from "../dist-tests/packages/agent-service/src/security.js";
import storage from "../dist-tests/packages/agent-service/src/store.js";
import sdk from "../dist-tests/packages/client-ts/src/index.js";
import fixtures from "../dist-tests/test/game-fixtures.js";
import webFixtures from "../dist-tests/test/game-web-fixtures.js";

const directory = await mkdtemp(path.join(tmpdir(), "companion-packaged-scheduling-")), engine = path.resolve("engine-dist");
const destination = path.resolve("output/playwright/game-scheduling");
const registrations = ["companion-mac", "companion-vscode"].map((product) => ({ id: `scheduling-${product}`, product, profile: "synthetic-fixture", workspace: "", providers: ["ollama"], hostTools: [] }));
const identity = await security.ensureIdentity(directory), credentials = [];
for (const registration of registrations) credentials.push(await security.createClientCredential(directory, registration));
const store = new storage.Store(path.join(directory, "metadata.sqlite")); for (const credential of credentials) store.register(credential); store.close();
const pause = () => new Promise((resolve) => setTimeout(resolve, 10));
let child, logs = "", clients = [];
async function waitFor(client, id, expected) {
  for (let i = 0; i < 6000; i++) {
    const job = await client.getGameProduction(id);
    if (expected.includes(job.state)) return job;
    if (["completed", "failed", "cancelled", "awaiting_reconciliation"].includes(job.state)) throw new Error(`Unexpected job state ${job.state}: ${job.error ?? ""}`);
    await pause();
  }
  throw new Error("Packaged scheduling smoke did not reach the expected state.");
}
function sound(durationMs) {
  return { processorId: "local-media-v1", target: { id: "tone", role: "Synthetic scheduling fixture", placeholder: true },
    operation: { type: "audio.render", output: "assets/tone.wav", durationMs, sampleRate: 48000, channels: 2,
      notes: [{ waveform: "saw", frequency: 880, startMs: 0, durationMs, gain: 0.2 }, { waveform: "triangle", frequency: 330, startMs: 0, durationMs, gain: 0.2 }] } };
}
try {
  child = spawn(path.join(engine, process.platform === "win32" ? "node.exe" : "node"), [path.join(engine, "service.cjs"), directory], { stdio: ["ignore", "pipe", "pipe"] });
  for (const stream of [child.stdout, child.stderr]) stream.on("data", (data) => { logs = (logs + data).slice(-100000); });
  let ready = false;
  for (let i = 0; i < 600; i++) {
    if (child.exitCode !== null) throw new Error(`Packaged engine exited: ${logs}`);
    try { ready = JSON.parse(await readFile(path.join(directory, "runtime.json"), "utf8")).pid === child.pid; } catch {}
    if (ready) break; await pause();
  }
  assert.ok(ready, "Packaged engine did not start");
  for (const credential of credentials) { const client = new sdk.AgentClient({ address: security.ipcPath(directory), certificate: identity.cert, credential }); await client.connect(); clients.push(client); }
  const [mac, editor] = clients, capabilities = await mac.gameProductionCapabilities();
  assert.ok(capabilities.resourceBudget); assert.ok(capabilities.assetProcessors.some((item) => item.id === "local-media-v1" && item.available));
  const webDocument = fixtures.fixtureGameDocument();
  for (const [name, source] of webFixtures.webFixture("phaser")) webDocument.files.push(await editor.uploadGameFile(name, Buffer.from(source), "text/plain"));
  const buildProject = await editor.createGameProject("web", webDocument);
  const projects = [];
  for (let i = 0; i < 3; i++) projects.push(await mac.createGameProject(`media-${i}`, fixtures.fixtureGameDocument()));
  const running = await mac.processGameAsset("long-running", projects[0].id, 1, sound(180000));
  await waitFor(mac, running.id, ["running"]);
  const waiting = await mac.processGameAsset("next-media", projects[1].id, 1, sound(100));
  assert.equal(waiting.state, "queued"); assert.equal(waiting.waitingReason, "resources");
  const cancelled = await mac.processGameAsset("cancel-before-start", projects[2].id, 1, sound(100));
  assert.equal(cancelled.state, "queued");
  const build = await editor.startGameBuild("editor-build", buildProject.id, 1);
  assert.equal(build.state, "queued", "FIFO must retain an older media request even if the web build could fit");
  await assert.rejects(editor.getGameProduction(running.id), /not found/);
  await mac.cancelGameProduction(cancelled.id); await waitFor(mac, cancelled.id, ["cancelled"]);
  await mac.cancelGameProduction(running.id); await waitFor(mac, running.id, ["cancelled"]);
  const finished = await waitFor(mac, waiting.id, ["completed"]), built = await waitFor(editor, build.id, ["completed"]);
  assert.equal((await mac.processGameAsset("cancel-before-start", projects[2].id, 1, sound(100))).state, "cancelled");
  const wav = await mac.downloadGameAssetFile(waiting.id, "assets/tone.wav"); assert.equal(wav.subarray(0, 4).toString(), "RIFF");
  const mediaEvents = await mac.readGameProductionEvents(projects[1].id), cancelledEvents = await mac.readGameProductionEvents(projects[2].id), buildEvents = await editor.readGameProductionEvents(buildProject.id);
  assert.ok(!cancelledEvents.events.some((event) => event.job.state === "running"));
  assert.ok(mediaEvents.events.find((event) => event.job.state === "running").sequence < buildEvents.events.find((event) => event.job.state === "running").sequence);
  const artifact = await editor.getGameArtifact(build.id); assert.ok(artifact.files.some((file) => file.path === "game.js"));
  assert.equal((await editor.getGameQuality(buildProject.id)).ready, false);
  const manifestBytes = await readFile(path.join(engine, "manifest.json"));
  await mkdir(destination, { recursive: true });
  await writeFile(path.join(destination, "evidence.json"), JSON.stringify({
    purpose: "Packaged user-wide resource admission, isolated products, real codec cancellation, queued cancellation and Phaser build; not physical performance or game acceptance",
    platform: `${process.platform}-${process.arch}`, completedAt: new Date().toISOString(), manifestSha256: createHash("sha256").update(manifestBytes).digest("hex"),
    budget: capabilities.resourceBudget, running: await mac.getGameProduction(running.id), finished, cancelled: await mac.getGameProduction(cancelled.id), built,
    mediaEvents, cancelledEvents, buildEvents, artifactHash: artifact.artifactHash,
  }, null, 2));
} finally {
  for (const client of clients) client.close();
  if (child?.exitCode === null) { const exited = once(child, "exit"); child.kill("SIGTERM"); await exited; }
  await rm(directory, { recursive: true, force: true });
}
console.log(`PACKAGED_GAME_SCHEDULING_OK two products, live/queued cancellation, codec, Phaser and service cleanup ${destination}`);
