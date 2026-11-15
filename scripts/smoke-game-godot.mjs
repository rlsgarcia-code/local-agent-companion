// Real packaged service, isolated editor and browser. Fixtures do not certify portfolio quality.
import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm, lstat, unlink } from "node:fs/promises";
import { createConnection } from "node:net";
import path from "node:path";
import { once } from "node:events";
import security from "../dist-tests/packages/agent-service/src/security.js";
import storage from "../dist-tests/packages/agent-service/src/store.js";
import sdk from "../dist-tests/packages/client-ts/src/index.js";
import fixtures from "../dist-tests/test/game-fixtures.js";
import godot from "../dist-tests/test/game-godot-fixtures.js";
import identities from "../dist-tests/packages/contracts/src/identity.js";

const state = await mkdtemp("/tmp/cgd-"), output = path.resolve("output/playwright/godot-builds");
const provision = JSON.parse(await readFile(path.resolve(".cache/game-toolchains/godot.json"), "utf8"));
const isolated = (args) => promisify(execFile)(provision.dockerExecutable, args, { timeout: 15000, maxBuffer: 1024 * 1024 });
const ownedContainers = new Map();
const registration = { id: "godot-smoke", product: "companion-mac", profile: "fixture", workspace: "", providers: ["ollama"], hostTools: [] };
const identity = await security.ensureIdentity(state), credential = await security.createClientCredential(state, registration);
const store = new storage.Store(path.join(state, "metadata.sqlite")); store.register(credential); store.close();
await mkdir(path.join(state, "toolchains"), { mode: 0o700 });
await copyFile(path.resolve(".cache/game-toolchains/godot.json"), path.join(state, "toolchains/godot.json"));
const engineRoot = path.resolve("engine-dist"), node = path.join(engineRoot, process.platform === "win32" ? "node.exe" : "node");
let child, client, failure = "";
async function start() {
  child = spawn(node, [path.join(engineRoot, "service.cjs"), state], { stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (data) => { failure += data.toString(); }); child.stderr.on("data", (data) => { failure += data.toString(); });
  for (let i = 0; i < 600; i++) {
    if (child.exitCode !== null) throw new Error(`Packaged service exited: ${failure}`);
    try { const status = JSON.parse(await readFile(path.join(state, "runtime.json"), "utf8")); if (status.pid === child.pid) break; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  client = new sdk.AgentClient({ address: security.ipcPath(state), certificate: identity.cert, credential }); await client.connect();
}
async function stop() {
  client?.close(); client = undefined;
  if (child && child.exitCode === null) { child.kill("SIGTERM"); await once(child, "exit"); }
}
async function wait(id) {
  for (let i = 0; i < 6000; i++) {
    const job = await client.getGameProduction(id);
    if (!["queued", "running", "cancelling"].includes(job.state)) return job;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("The observed job has not settled within the smoke observation budget; inspect the same operation before any retry.");
}
async function observe(job, target) {
  assert.equal((await wait(job.id)).state, "completed", JSON.stringify(await client.getGameProduction(job.id)));
  const artifact = await client.getGameArtifact(job.id);
  const html = (await client.downloadGameArtifactFile(job.id, "index.html")).toString();
  assert.match(html, /http-equiv="Content-Security-Policy"/); assert.match(html, /connect-src 'self'/);
  assert.doesNotMatch(html, /<script>[^]*?<\/script>/);
  for (const file of artifact.files) {
    const destination = path.join(target, file.path); await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, await client.downloadGameArtifactFile(job.id, file.path));
  }
  const observation = await client.startGameValidation(`observe-${job.id}`, job.id, "web-browser-runtime-v1");
  const current = await wait(observation.id); assert.equal(current.state, "completed", current.error);
  const reports = await client.getGameReports(job.id);
  for (const report of reports) {
    for (const evidence of report.evidence ?? []) {
      const file = path.join(target, "observations", report.id, evidence.path); await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, await client.downloadGameReportFile(report.id, evidence.path));
    }
    assert.ok(report.checks.every((check) => check.status === "passed"), JSON.stringify(report));
  }
  assert.ok(reports.some((report) => report.testCase?.id === "godot-keyboard-motion"));
  const quality = await client.getGameQuality(job.projectId); assert.equal(quality.ready, false);
  await writeFile(path.join(target, "evidence.json"), JSON.stringify({ artifact, reports, quality, purpose: "real editor/browser toolchain fixture; no portfolio/human acceptance" }, null, 2));
  console.log(`GODOT_PACKAGED_BUILD_OBSERVED ${target} ${artifact.artifactHash}`);
  return artifact;
}
async function slowBuild(key) {
  const source = godot.godotFixture("2d"), document = fixtures.fixtureGameDocument(); document.engine = "godot";
  source.set("project.godot", source.get("project.godot") + '\n[editor_plugins]\nenabled=PackedStringArray("res://addons/probe/plugin.cfg")\n');
  source.set("addons/probe/plugin.cfg", '[plugin]\nname="Controlled interruption fixture"\ndescription="Smoke only"\nauthor="Companion test"\nversion="1.0"\nscript="plugin.gd"\n');
  source.set("addons/probe/plugin.gd", '@tool\nextends EditorPlugin\nfunc _enter_tree():\n\tOS.delay_msec(60000)\n');
  for (const [name, data] of source) document.files.push(await client.uploadGameFile(name, Buffer.from(data), "text/plain"));
  const project = await client.createGameProject(key, document), job = await client.startGameBuild(`build-${key}`, project.id, 1);
  const binding = { jobId: job.id, sourceHash: job.sourceHash, toolchain: job.toolchain, imageId: provision.imageId };
  const hash = identities.contentHash(binding), name = `companion-godot-${hash.slice(0, 40)}`; ownedContainers.set(name, hash);
  for (let i = 0; i < 300; i++) {
    const { stdout } = await isolated(["container", "ls", "--all", "--filter", `name=^/${name}$`, "--format", "{{.ID}}"]);
    if (stdout.trim()) {
      const [container] = JSON.parse((await isolated(["container", "inspect", name])).stdout);
      assert.equal(container.Config.Labels["org.companion.game-job"], hash);
      assert.equal(container.HostConfig.NetworkMode, "none"); assert.equal(container.HostConfig.ReadonlyRootfs, true);
      assert.equal(container.HostConfig.Privileged, false); assert.deepEqual(container.HostConfig.CapDrop, ["ALL"]);
      assert.equal(container.HostConfig.Memory, 3 * 1024 ** 3); assert.equal(container.HostConfig.MemorySwap, container.HostConfig.Memory);
      assert.equal(container.HostConfig.PidsLimit, 256); assert.ok(container.Config.User !== "0:0");
      assert.ok(container.HostConfig.SecurityOpt.includes("no-new-privileges"));
      assert.match(container.HostConfig.Tmpfs["/work"], /size=768m/); assert.match(container.HostConfig.Tmpfs["/tmp"], /size=128m/);
      assert.equal(container.Mounts.filter((mount) => mount.Type === "bind").length, 1);
      assert.ok(container.Mounts.some((mount) => mount.Destination === "/source" && !mount.RW));
      if (container.State.Running && /godot/.test((await isolated(["top", name, "-eo", "pid,comm"])).stdout)) return { project, job, name, isolation: {
        imageId: container.Image, network: container.HostConfig.NetworkMode, readOnlyRoot: container.HostConfig.ReadonlyRootfs,
        user: container.Config.User, memory: container.HostConfig.Memory, memorySwap: container.HostConfig.MemorySwap,
        pids: container.HostConfig.PidsLimit, tmpfs: container.HostConfig.Tmpfs, capDrop: container.HostConfig.CapDrop,
        securityOpt: container.HostConfig.SecurityOpt, mounts: container.Mounts.map((mount) => ({ type: mount.Type, destination: mount.Destination, writable: mount.RW })),
      } };
    }
    const current = await client.getGameProduction(job.id);
    assert.ok(["queued", "running"].includes(current.state), JSON.stringify(current));
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("The original controlled editor process was not observed; no retry was started.");
}
async function assertRemoved(name) {
  assert.equal((await isolated(["container", "ls", "--all", "--filter", `name=^/${name}$`, "--format", "{{.ID}}"])).stdout.trim(), "");
  ownedContainers.delete(name);
}
async function cleanOwnedTestSocketAfterCrash(processHandle) {
  // The real bootstrap owns stale-socket recovery. This direct-spawn harness
  // does not install/replace the user's LaunchAgent. Clean only its private test
  // endpoint after this exact child exited, never a live or unrelated socket.
  assert.ok(processHandle.exitCode !== null || processHandle.signalCode !== null);
  const runtime = JSON.parse(await readFile(path.join(state, "runtime.json"), "utf8")); assert.equal(runtime.pid, processHandle.pid);
  if (process.platform === "win32") return;
  const endpoint = security.ipcPath(state), original = await lstat(endpoint);
  assert.ok(original.isSocket() && original.uid === process.getuid());
  await new Promise((resolve, reject) => {
    const socket = createConnection(endpoint);
    socket.once("connect", () => { socket.destroy(); reject(new Error("The private test endpoint is still live; it was not removed")); });
    socket.once("error", (error) => error.code === "ECONNREFUSED" ? resolve() : reject(error));
    socket.setTimeout(1000, () => { socket.destroy(); reject(new Error("The private socket liveness check was inconclusive")); });
  });
  const current = await lstat(endpoint); assert.equal(current.ino, original.ino); assert.equal(current.dev, original.dev);
  await unlink(endpoint);
}
try {
  await start();
  const capabilities = await client.gameProductionCapabilities();
  assert.equal(capabilities.adapters.find((adapter) => adapter.engine === "godot")?.available, true, JSON.stringify(capabilities));
  for (const dimension of ["2d", "3d"]) {
    const source = godot.godotFixture(dimension), document = fixtures.fixtureGameDocument();
    document.engine = "godot"; document.brief.dimension = dimension;
    for (const [name, data] of source) document.files.push(await client.uploadGameFile(name, Buffer.from(data), "text/plain"));
    const project = await client.createGameProject(`godot-${dimension}`, document);
    const job = await client.startGameBuild(`build-${dimension}`, project.id, 1);
    const artifact = await observe(job, path.join(output, dimension, "revision-1"));
    if (dimension === "2d") {
      const changed = source.get("main.gd").replace("f5c06a", "65d4ee");
      const file = await client.uploadGameFile("main.gd", Buffer.from(changed), "text/plain");
      const edited = { ...document, files: [...document.files.filter((item) => item.path !== "main.gd"), file] };
      await client.commitGameRevision(project.id, `edit-${dimension}`, 1, edited, "Change the fixture color without replacing the editable project");
      await stop(); await start(); // Recover the exact source revision via the persistent service.
      const next = await client.startGameBuild("build-edited-2d", project.id, 2);
      const editedArtifact = await observe(next, path.join(output, dimension, "revision-2"));
      assert.notEqual(editedArtifact.artifactHash, artifact.artifactHash);
      assert.equal((await client.startGameBuild("build-edited-2d", project.id, 2)).id, next.id);
      console.log("GODOT_EDIT_RESTART_DEDUPLICATION_OK");
    }
  }
  const cancelling = await slowBuild("godot-cancel");
  const cancellationRequested = await client.cancelGameProduction(cancelling.job.id); assert.equal(cancellationRequested.state, "cancelling");
  const cancelled = await wait(cancelling.job.id); assert.equal(cancelled.state, "cancelled"); await assertRemoved(cancelling.name);
  const interrupted = await slowBuild("godot-service-crash");
  client.close(); client = undefined;
  const exited = once(child, "exit"); child.kill("SIGKILL"); await exited;
  await cleanOwnedTestSocketAfterCrash(child);
  await start();
  const afterCrash = await client.getGameProduction(interrupted.job.id); assert.equal(afterCrash.state, "awaiting_reconciliation");
  const reconciled = await client.reconcileGameProduction(interrupted.job.id); assert.equal(reconciled.state, "failed");
  await assertRemoved(interrupted.name);
  assert.equal((await client.getGameProject(interrupted.project.id)).revision, 1);
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, "lifecycle-evidence.json"), JSON.stringify({ engine: "godot", version: provision.engineVersion, imageId: provision.imageId,
    engineBuild: await client.call("engine.info"), isolation: cancelling.isolation,
    cancellation: { requested: cancellationRequested, acknowledged: cancelled, containerRemoved: true },
    serviceCrash: { recovered: afterCrash, reconciled, containerRemoved: true, sourceRevisionPreserved: 1 },
    assertions: ["network none", "read-only root/source", "no privileges or host home/socket", "bounded memory/swap/PIDs/tmpfs", "cancellation acknowledged after removal", "service crash enters reconciliation", "original orphan removed without repeating editor", "source revision preserved"] }, null, 2));
  console.log("GODOT_ISOLATION_CANCELLATION_CRASH_RECONCILIATION_OK");
} finally {
  await stop();
  for (const [name, hash] of ownedContainers) {
    const listed = await isolated(["container", "ls", "--all", "--filter", `name=^/${name}$`, "--format", "{{.ID}}"]);
    if (listed.stdout.trim()) {
      const [container] = JSON.parse((await isolated(["container", "inspect", name])).stdout);
      assert.equal(container.Config.Labels["org.companion.game-job"], hash);
      await isolated(["rm", "--force", name]);
    }
  }
  await rm(state, { recursive: true, force: true });
}
