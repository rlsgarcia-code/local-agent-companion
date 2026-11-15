// Real packaged engine/browser. Only exact processes spawned by this fixture
// are interrupted; no personal browser profile, provider, installation or game acceptance.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { createConnection } from "node:net";
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir, lstat, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import security from "../dist-tests/packages/agent-service/src/security.js";
import storage from "../dist-tests/packages/agent-service/src/store.js";
import sdk from "../dist-tests/packages/client-ts/src/index.js";
import fixtures from "../dist-tests/test/game-fixtures.js";
import webFixtures from "../dist-tests/test/game-web-fixtures.js";

const state = await mkdtemp(path.join(tmpdir(), "companion-browser-recovery-")), engine = path.resolve("engine-dist"), output = path.resolve("output/playwright/game-browser-recovery");
const registration = { id: "browser-recovery-fixture", product: "companion-mac", profile: "synthetic", workspace: "", providers: ["ollama"], hostTools: [] };
const identity = await security.ensureIdentity(state), credential = await security.createClientCredential(state, registration);
const initial = new storage.Store(path.join(state, "metadata.sqlite")); initial.register(credential); initial.close();
let child, client, logs = "", report;
const tick = () => new Promise((resolve) => setTimeout(resolve, 20));
const jobDirectory = (id) => path.join(state, "game-browser-jobs", id);
function alive(pid) { try { process.kill(pid, 0); return true; } catch (error) { if (error.code === "ESRCH") return false; throw error; } }
async function until(check, message, attempts = 1500) { for (let i = 0; i < attempts; i++) { if (await check()) return; await tick(); } throw new Error(message); }
async function boot() {
  logs = ""; child = spawn(path.join(engine, process.platform === "win32" ? "node.exe" : "node"), [path.join(engine, "service.cjs"), state], { stdio: ["ignore", "pipe", "pipe"] });
  for (const stream of [child.stdout, child.stderr]) stream.on("data", (data) => { logs = (logs + data).slice(-100000); });
  await until(async () => { if (child.exitCode !== null) throw new Error(`Engine stopped: ${logs}`); try { return JSON.parse(await readFile(path.join(state, "runtime.json"), "utf8")).pid === child.pid; } catch { return false; } }, "Engine did not start");
  client = new sdk.AgentClient({ address: security.ipcPath(state), certificate: identity.cert, credential }); await client.connect();
}
async function cleanOwnedTestSocketAfterCrash() {
  // Real installations use bootstrap health checks. This direct-spawn harness
  // only removes its exact dead child's private socket after inode/liveness checks.
  assert.ok(child.exitCode !== null || child.signalCode !== null);
  assert.equal(JSON.parse(await readFile(path.join(state, "runtime.json"), "utf8")).pid, child.pid);
  if (process.platform === "win32") return;
  const endpoint = security.ipcPath(state), before = await lstat(endpoint); assert.ok(before.isSocket() && before.uid === process.getuid());
  await new Promise((resolve, reject) => {
    const socket = createConnection(endpoint);
    socket.once("connect", () => { socket.destroy(); reject(new Error("The owned test endpoint is still live; it was preserved")); });
    socket.once("error", (error) => { socket.destroy(); error.code === "ECONNREFUSED" ? resolve() : reject(error); });
    socket.setTimeout(1000, () => { socket.destroy(); reject(new Error("Test endpoint liveness is inconclusive; it was preserved")); });
  });
  const after = await lstat(endpoint); assert.equal(after.ino, before.ino); assert.equal(after.dev, before.dev); await unlink(endpoint);
}
async function stop(signal = "SIGTERM") { client?.close(); client = undefined; if (child?.exitCode === null) {
  const exited = once(child, "exit"); child.kill(signal); await exited;
  if (signal === "SIGKILL") await cleanOwnedTestSocketAfterCrash();
} }
async function settled(id, allowed = ["completed"]) {
  let job;
  await until(async () => { job = await client.getGameProduction(id); if (allowed.includes(job.state)) return true; if (["completed", "failed", "cancelled", "awaiting_reconciliation"].includes(job.state)) throw new Error(`Unexpected job: ${JSON.stringify(job)}`); return false; }, "Operation did not settle", 6000);
  return job;
}
async function build(key, slow) {
  const document = fixtures.fixtureGameDocument(), source = webFixtures.webFixture("phaser");
  source.set("data/playtests.json", JSON.stringify({ schemaVersion: 1, scenarios: [{ id: "fixture", steps: slow ? Array.from({ length: 15 }, () => ({ action: "wait", ms: 2000 })) : [{ action: "wait", ms: 100 }] }] }));
  for (const [name, content] of source) document.files.push(await client.uploadGameFile(name, Buffer.from(content), "text/plain"));
  const project = await client.createGameProject(key, document), job = await client.startGameBuild(`build-${key}`, project.id, 1); await settled(job.id); return { project, build: job };
}
async function runtime(id) { let value; await until(async () => {
  const job = await client.getGameProduction(id); if (["failed", "cancelled", "completed", "awaiting_reconciliation"].includes(job.state)) throw new Error(`Observation ended before the live-browser check: ${job.state}: ${job.error ?? ""}`);
  try { value = JSON.parse(await readFile(path.join(jobDirectory(id), "runtime.json"), "utf8")); return true; } catch { return false; }
}, "The real browser was not observed"); return value; }
async function closedPort(origin) {
  return new Promise((resolve, reject) => { const address = new URL(origin), socket = createConnection({ host: "127.0.0.1", port: Number(address.port) });
    socket.setTimeout(1000); socket.once("connect", () => { socket.destroy(); resolve(false); }); socket.once("error", (error) => { socket.destroy(); error.code === "ECONNREFUSED" ? resolve(true) : reject(error); }); socket.once("timeout", () => { socket.destroy(); resolve(false); }); });
}
async function expectPayloadCleaned(id) {
  await until(async () => {
    const names = await readdir(jobDirectory(id));
    return names.includes("disposed.json") && !["input", "output", "home", "tmp", "request.json", "result.json"].some((name) => names.includes(name));
  }, "Committed operation cache was not cleaned");
}
try {
  await boot(); const caps = await client.gameProductionCapabilities(); assert.ok(caps.collectors.some((item) => item.id === "web-browser-runtime-v1" && item.available));
  const first = await build("crash-live", true), active = await client.startGameValidation("observe-live", first.build.id, "web-browser-runtime-v1");
  const observed = await runtime(active.id); assert.ok(alive(observed.workerPid)); assert.ok(alive(observed.browserPid));
  await stop("SIGKILL");
  await until(() => !alive(observed.workerPid) && !alive(observed.browserPid), "Original browser/supervisor did not stop after coordinator loss");
  assert.equal(await closedPort(observed.origin), true, "The original resource listener must also stop");
  const stoppedReceipt = JSON.parse(await readFile(path.join(jobDirectory(active.id), "receipt.json"), "utf8")); assert.equal(stoppedReceipt.status, "cancelled");
  await boot(); assert.equal((await client.getGameProduction(active.id)).state, "awaiting_reconciliation");
  const acknowledged = await client.reconcileGameProduction(active.id); assert.equal(acknowledged.state, "failed"); await expectPayloadCleaned(active.id);
  assert.equal((await client.getGameProject(first.project.id)).revision, 1);
  const liveEvents = await client.readGameProductionEvents(first.project.id); assert.equal(liveEvents.events.filter((event) => event.job.id === active.id && event.job.state === "running").length, 1);

  const second = await build("candidate-before-ack", false);
  const db = new storage.Store(path.join(state, "metadata.sqlite"));
  db.db.exec("CREATE TRIGGER reject_browser_ack BEFORE INSERT ON game_validation_reports BEGIN SELECT RAISE(ABORT,'fixture lost service acknowledgment'); END"); db.close();
  const candidate = await client.startGameValidation("observe-candidate", second.build.id, "web-browser-runtime-v1");
  await settled(candidate.id, ["awaiting_reconciliation"]);
  const candidateRuntime = JSON.parse(await readFile(path.join(jobDirectory(candidate.id), "runtime.json"), "utf8"));
  const candidateReceipt = JSON.parse(await readFile(path.join(jobDirectory(candidate.id), "receipt.json"), "utf8")); assert.equal(candidateReceipt.status, "completed");
  assert.equal(alive(candidateRuntime.workerPid), false); assert.equal(alive(candidateRuntime.browserPid), false);
  const opBefore = await readFile(path.join(jobDirectory(candidate.id), "operation.json"));
  await stop("SIGKILL");
  const repair = new storage.Store(path.join(state, "metadata.sqlite")); repair.db.exec("DROP TRIGGER reject_browser_ack"); repair.close();
  await boot(); assert.equal((await client.getGameProduction(candidate.id)).state, "awaiting_reconciliation");
  const recovered = await client.reconcileGameProduction(candidate.id); assert.equal(recovered.state, "completed");
  const reports = await client.getGameReports(second.build.id); assert.ok(reports.length >= 2);
  for (const observation of reports) for (const file of observation.evidence ?? []) {
    const bytes = await client.downloadGameReportFile(observation.id, file.path); assert.equal(createHash("sha256").update(bytes).digest("hex"), file.sha256);
  }
  assert.deepEqual(await readFile(path.join(jobDirectory(candidate.id), "operation.json")), opBefore, "Recovery must not create another browser operation");
  await expectPayloadCleaned(candidate.id);
  const candidateEvents = await client.readGameProductionEvents(second.project.id); assert.equal(candidateEvents.events.filter((event) => event.job.id === candidate.id && event.job.state === "running").length, 1);
  assert.equal((await client.getGameQuality(second.project.id)).ready, false);
  report = { purpose: "Real packaged coordinator crash and durable exact browser candidate recovery; not game quality or full platform acceptance", platform: `${process.platform}-${process.arch}`,
    manifestSha256: createHash("sha256").update(await readFile(path.join(engine, "manifest.json"))).digest("hex"),
    coordinatorLoss: { observed, stoppedReceipt, acknowledged, resourceListenerClosed: true, sourceRevision: 1 }, candidateRecovery: { candidateRuntime, candidateReceipt, recovered, reports, browserLaunches: 1 },
  };
} finally {
  await stop();
  let jobs = []; try { jobs = await readdir(path.join(state, "game-browser-jobs")); } catch (error) { if (error.code !== "ENOENT") throw error; }
  for (const id of jobs) {
    for (const [file, field] of [["lease.json", "pid"], ["runtime.json", "browserPid"]]) {
      let record; try { record = JSON.parse(await readFile(path.join(jobDirectory(id), file), "utf8")); } catch (error) { if (error.code === "ENOENT") continue; throw error; }
      await until(() => !alive(record[field]), `Test process ${record[field]} still lives; state preserved at ${state}`);
    }
    try { const receipt = JSON.parse(await readFile(path.join(jobDirectory(id), "receipt.json"), "utf8")); assert.notEqual(receipt.status, "uncertain", `Unconfirmed cleanup; inspect retained state at ${state}`); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  if (report) await rm(state, { recursive: true, force: true });
  else console.error(`Test resources stopped; diagnostic state preserved at ${state}`);
}
await mkdir(output, { recursive: true }); await writeFile(path.join(output, "evidence.json"), JSON.stringify({ ...report, completedAt: new Date().toISOString(), cleanupVerified: true }, null, 2));
console.log(`PACKAGED_BROWSER_CRASH_RECOVERY_OK live shutdown, listener closure, exact candidate recovery, no duplicate launch and cache cleanup ${output}`);
