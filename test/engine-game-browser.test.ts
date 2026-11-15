import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as path from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { chromium } from "playwright-core";
import { AgentService } from "../packages/agent-service/src/service";
import { Store } from "../packages/agent-service/src/store";
import { LocalServer } from "../packages/agent-service/src/server";
import { AgentClient } from "../packages/client-ts/src/index";
import { createClientCredential, ensureIdentity, ipcPath } from "../packages/agent-service/src/security";
import { createWebGameAdapters } from "../packages/adapter-game-web/src/index";
import { createBrowserGameCollector } from "../packages/adapter-game-browser/src/index";
import { collect } from "../packages/adapter-game-browser/src/collect";
import { openGamePreview } from "../packages/adapter-game-browser/src/preview";
import { gameBrowserTestGuide, gameBrowserTestSuite, gameTestSuitePath } from "../packages/contracts/src/game-browser-tests";
import type { Registration } from "../packages/contracts/src/index";
import { fixtureGameDocument } from "./game-fixtures";
import { webFixture } from "./game-web-fixtures";

const reg: Registration = { id: "browser-game-test", product: "companion-mac", profile: "fixture", workspace: "", providers: ["ollama"], hostTools: [] };
const fixtureDirectories = new WeakMap<AgentClient, string>();

test("browser launch diagnostics preserve the original cause and never acknowledge unknown shutdown", async t => {
  const f = await fixture();
  try {
    const { job } = await build(f, webFixture("phaser"), "launch-diagnostic");
    const artifact = await f.client.getGameArtifact(job.id);
    t.mock.method(chromium, "launch", async () => { throw new Error("Synthetic sandbox launch refusal"); });
    let acknowledged = false;
    await assert.rejects(collect({ job: { id: "launch-diagnostic" }, artifact, designScenarios: [], signal: new AbortController().signal,
      readFile: name => f.client.downloadGameArtifactFile(job.id, name) },
      { executablePath: "never-executed" } as Parameters<typeof collect>[1], true,
      async () => { acknowledged = true; }, async () => assert.fail("No browser was launched")),
    /shutdown was not confirmed.*Original browser launch failed:.*Synthetic sandbox launch refusal/);
    assert.equal(acknowledged, false);
  } finally { await f.close(); }
});

test("interactive preview uses immutable blobs in a disposable browser, blocks other origins and closes on host abort",async(t)=>{
  const f=await fixture();let preview:Awaited<ReturnType<typeof openGamePreview>>|undefined;
  const canary=createServer((_request,response)=>{response.end("must not be read");});let hits=0;canary.on("request",()=>hits++);
  try{
    if(!(await f.collector.probe!(reg)).available){t.skip("Qualified Chromium browser unavailable");return;}
    canary.listen(0,"127.0.0.1");await once(canary,"listening");const address=canary.address();assert.ok(address&&typeof address==="object");
    const source=webFixture("phaser");source.set("src/main.ts",source.get("src/main.ts")+`\nwindow.addEventListener('keydown',()=>{fetch('http://127.0.0.1:${address.port}/canary').catch(()=>{});window.open('http://127.0.0.1:${address.port}/popup');});`);
    const {project,job}=await build(f,source,"preview"),artifact=await f.client.getGameArtifact(job.id),abort=new AbortController();
    preview=await openGamePreview({artifact,readFile:(name)=>f.client.downloadGameArtifactFile(job.id,name),signal:abort.signal,headless:true});
    await preview.page.locator("canvas").waitFor();await preview.page.keyboard.press("Space");await tick();
    assert.equal(hits,0);assert.ok(preview.errors.length||preview.blocked.length,"the external request must not be silently treated as accepted");
    const browser=preview.page.context().browser()!;abort.abort();await preview.close();assert.equal(browser.isConnected(),false);
    assert.equal((await f.client.getGameProject(project.id)).revision,1,"preview never mutates the source or quality");
    assert.equal((await f.client.getGameQuality(project.id)).ready,false);
  }finally{await preview?.close();canary.closeAllConnections();await new Promise<void>((resolve)=>canary.close(()=>resolve()));await f.close();}
});
const tick = () => new Promise((resolve) => setTimeout(resolve, 20));
async function settled(client: AgentClient, id: string): Promise<import("../packages/contracts/src/game-production").GameProductionJob> {
  for (let i = 0; i < 1000; i++) {
    const job = await client.getGameProduction(id);
    if (!["queued", "running", "cancelling"].includes(job.state)) {
      const directory = fixtureDirectories.get(client);
      if (job.state === "awaiting_reconciliation" && directory && /^[a-zA-Z0-9_-]{1,128}$/.test(job.id)) {
        // This is the test's disposable fixture, never personal engine state.
        // Preserve the supervisor's reason; it does not acknowledge shutdown.
        try {
          const receipt = JSON.parse(await readFile(path.join(directory, "game-browser-jobs", job.id, "receipt.json"), "utf8"));
          console.error("FIXTURE_BROWSER_RECONCILIATION", JSON.stringify({ status: receipt.status, detail: String(receipt.detail).slice(0, 2200) }));
        } catch { console.error("FIXTURE_BROWSER_RECONCILIATION", "No committed diagnostic receipt"); }
      }
      return job;
    }
    await tick();
  }
  throw new Error("Browser collection did not settle");
}
async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), "game-browser-")), store = new Store(path.join(directory, "state.sqlite"));
  const credential = await createClientCredential(directory, reg); store.register(credential);
  const collector = await createBrowserGameCollector({ stateDirectory: directory });
  assert.equal(collector.projectGuide, gameBrowserTestGuide);
  assert.equal(collector.testSuiteFormat, "browser-v1");
  const identity = await ensureIdentity(directory), service = new AgentService(store, directory, undefined, {}, { gameAdapters: createWebGameAdapters(path.resolve("packages/adapter-game-web/runtimes")), gameCollectors: [collector] });
  const server = new LocalServer(service, directory); await server.listen();
  const client = new AgentClient({ address: ipcPath(directory), certificate: identity.cert, credential }); await client.connect();
  fixtureDirectories.set(client, directory);
  return { directory, store, collector, client, service, server, async close() { client.close(); await server.close(); await rm(directory, { recursive: true, force: true }); } };
}
function suite(changed = true) {
  return { schemaVersion: 1, viewport: { width: 640, height: 360 }, scenarios: [{ id: "move", designScenarioId: "anchor", steps: [
    { action: "wait", ms: 200 }, { action: "capture", selector: "canvas", name: "before" }, { action: "press", key: changed ? "Space" : "ArrowLeft" }, { action: "wait", ms: 100 },
    { action: "expect-image", selector: "canvas", baseline: "before", comparison: "changed", threshold: 0.001 },
  ] }] };
}
async function build(f: Awaited<ReturnType<typeof fixture>>, source = webFixture("phaser"), key = "game", engine: "phaser" | "babylon" = "phaser") {
  const document = fixtureGameDocument(); document.engine = engine;
  if (engine === "babylon") document.brief.dimension = "3d";
  for (const [name, data] of source) document.files.push(await f.client.uploadGameFile(name, Buffer.from(data), "text/plain"));
  const project = await f.client.createGameProject(key, document);
  const job = await f.client.startGameBuild(`build-${key}`, project.id, 1);
  assert.equal((await settled(f.client, job.id)).state, "completed");
  return { project, job };
}

test("browser recipes reject JavaScript, undeclared fields, unsafe paths and comparisons without a baseline", () => {
  assert.equal(gameBrowserTestSuite.parse(suite()).scenarios.length, 1);
  assert.throws(() => gameBrowserTestSuite.parse({ ...suite(), scenarios: [{ id: "unsafe", steps: [{ action: "eval", code: "process.env" }] }] }));
  assert.throws(() => gameBrowserTestSuite.parse({ ...suite(), ready: true }));
  assert.throws(() => gameBrowserTestSuite.parse({ ...suite(), scenarios: [{ id: "missing", steps: [{ action: "expect-image", baseline: "never", comparison: "changed" }] }] }));
  for (const value of ["../tests.json", "/etc/passwd", "data/playtests/../private.json", "data/tests.js"]) assert.throws(() => gameTestSuitePath.parse(value));
});

test("the one-job collector independently rejects an invalid recipe before browser launch with the same bounded diagnostics", async () => {
  const marker = "PRIVATE_UNRECOGNIZED_RECIPE_FIELD";
  for (const text of [JSON.stringify({ schemaVersion: 1, scenarios: [{ id: "bad", steps: [{ action: "wait", ms: 3000 }] }] }),
    JSON.stringify({ schemaVersion: 1, [marker]: marker, scenarios: [] }), "{" + marker]) {
    const bytes = Buffer.from(text);let reads = 0, launched = 0, stopped = 0;
    const artifact = { files: [{ path: "data/playtests.json", size: bytes.length }] } as Parameters<typeof collect>[0]["artifact"];
    // No usable browser was supplied: format rejection must precede launch and
    // resource binding even if a caller bypasses service admission.
    await assert.rejects(collect({ job: { id: "invalid-recipe" }, artifact, designScenarios: [], signal: new AbortController().signal,
      readFile: async name => { assert.equal(name, "data/playtests.json");reads++;return bytes; } },
      undefined as never, true, async () => { stopped++; }, async () => { launched++; }),
      (error: unknown) => error instanceof Error && /Invalid saved browser test suite/.test(error.message) && !error.message.includes(marker));
    assert.equal(reads, 1);assert.equal(launched, 0);assert.equal(stopped, 0);
  }
});

test("real Chromium observes keyboard-to-pixel changes and stores private verifiable PNG/trace evidence without certifying gameplay", async (t) => {
  const f = await fixture();
  try {
    const probe = await f.collector.probe!(reg);
    if (!probe.available) { t.skip(probe.reason); return; }
    const source = webFixture("phaser"); source.set("data/playtests.json", JSON.stringify(suite()));
    const { project, job } = await build(f, source);
    const validation = await f.client.startGameValidation("observe", job.id, f.collector.id);
    const result = await settled(f.client, validation.id);
    assert.equal(result.state, "completed", result.error);
    const reports = await f.client.getGameReports(job.id);
    assert.equal(reports.length, 2);
    assert.equal(reports[0]!.checks.find((check) => check.id === "boots")!.status, "passed");
    assert.equal(reports[0]!.checks.find((check) => check.id === "console")!.status, "passed");
    assert.equal(reports[1]!.checks[0]!.status, "passed");
    assert.deepEqual(reports[1]!.coverage!.scenarioIds, [], "a declared semantic scenario is not certified by a generic image delta");
    const evidence = reports[1]!.evidence!;
    assert.ok(evidence.some((file) => file.mime === "image/png"));
    const trace = JSON.parse((await f.client.downloadGameReportFile(reports[1]!.id, "trace.json")).toString());
    assert.ok(trace.trace.at(-1).changedRatio > 0.001);
    const png = await f.client.downloadGameReportFile(reports[1]!.id, evidence.find((file) => file.mime === "image/png")!.path);
    assert.equal(png.subarray(1, 4).toString(), "PNG");
    if (process.platform !== "win32") {
      const certificate = path.join(f.directory, "python-cert"), credentials = path.join(f.directory, "python-credential.json");
      await writeFile(certificate, (await ensureIdentity(f.directory)).cert, { mode: 0o600 });
      await writeFile(credentials, JSON.stringify(f.client.options.credential), { mode: 0o600 });
      const script = `import sys,json\nsys.path.insert(0,sys.argv[1])\nfrom pathlib import Path\nfrom companion_client import AgentClient\nc=AgentClient(sys.argv[2],Path(sys.argv[3]),Path(sys.argv[4])); c.connect()\nt=json.loads(c.download_game_report_file(sys.argv[5],'trace.json'))\nassert t['trace'][-1]['changedRatio']>.001\nc.close()\nprint('PYTHON_BROWSER_EVIDENCE_OK')`;
      const result = await promisify(execFile)("python3", ["-I", "-c", script, path.resolve("packages/client-python"), ipcPath(f.directory), certificate, credentials, reports[1]!.id], { timeout: 30000 });
      assert.match(result.stdout, /PYTHON_BROWSER_EVIDENCE_OK/);
    }
    assert.throws(() => f.store.db.prepare("DELETE FROM transfers WHERE id=?").run(evidence[0]!.transferId), /FOREIGN KEY/);
    await assert.rejects(f.service.dispatch({ ...reg, product: "companion-vscode" }, "games.validation.file", { reportId: reports[1]!.id, path: "trace.json" }, "other"), /not found/);
    const quality = await f.client.getGameQuality(project.id);
    assert.equal(quality.ready, false);
    assert.ok(quality.blockers.includes("human-playtest-targets-unverified"));
    assert.ok(quality.blockers.includes("unverified-scenario:anchor"));
    const inspection = { registration: reg, job: result, document: (await f.client.getGameRevision(project.id, 1)).document,
      artifact: await f.client.getGameArtifact(job.id), signal: new AbortController().signal,
      readFile: (name: string) => f.client.downloadGameArtifactFile(job.id, name) };
    assert.equal((await f.collector.reconcile!(inspection)).state, "missing", "the original collector acknowledged its browser/resource shutdown");
    const freshCollector = await createBrowserGameCollector({ stateDirectory: f.directory });
    assert.equal((await freshCollector.reconcile!(inspection)).state, "missing", "a new exact collector reads the durable acknowledgment after confirmed shutdown");
  } finally { await f.close(); }
});

test("a failed expected image change remains a failed external observation even if the game declares success", async (t) => {
  const f = await fixture();
  try {
    if (!(await f.collector.probe!(reg)).available) { t.skip("Qualified Chromium browser unavailable"); return; }
    const source = webFixture("phaser"); source.set("src/main.ts", source.get("src/main.ts")! + "\nglobalThis.gameTestResult={ready:true,controls:true,passed:true};");
    source.set("data/playtests.json", JSON.stringify(suite(false)));
    const { job } = await build(f, source);
    const validation = await f.client.startGameValidation("observe-failure", job.id, f.collector.id);
    assert.equal((await settled(f.client, validation.id)).state, "completed");
    const reports = await f.client.getGameReports(job.id);
    assert.equal(reports[1]!.checks[0]!.status, "failed");
    const trace = JSON.parse((await f.client.downloadGameReportFile(reports[1]!.id, "trace.json")).toString());
    assert.match(trace.trace.at(-1).detail, /did not meet/);
  } finally { await f.close(); }
});

test("browser network isolation blocks another loopback service and missing packaged resources are reported", async (t) => {
  const f = await fixture(); let requests = 0;
  const external = createServer((_request, response) => { requests++; response.end("not game data"); });
  external.listen(0, "127.0.0.1"); await once(external, "listening");
  try {
    if (!(await f.collector.probe!(reg)).available) { t.skip("Qualified Chromium browser unavailable"); return; }
    const port = (external.address() as { port: number }).port;
    const source = webFixture("phaser");
    source.set("src/main.ts", source.get("src/main.ts")! + `\nfetch('http://127.0.0.1:${port}/private').catch(()=>{}); fetch('./missing-data.json').catch(()=>{});`);
    const { job } = await build(f, source);
    const validation = await f.client.startGameValidation("network", job.id, f.collector.id);
    const result = await settled(f.client, validation.id); assert.equal(result.state, "completed", result.error);
    assert.equal(requests, 0);
    const reports = await f.client.getGameReports(job.id);
    assert.equal(reports[0]!.checks.find((check) => check.id === "console")!.status, "failed");
    const trace = JSON.parse((await f.client.downloadGameReportFile(reports[0]!.id, "runtime.json")).toString());
    assert.ok(trace.errors.some((message: string) => message.includes("missing-data")));
  } finally { await new Promise<void>((resolve) => external.close(() => resolve())); await f.close(); }
});

test("the actual Babylon runtime renders through the same collector without a real HTTP listener", async (t) => {
  const f = await fixture();
  try {
    if (!(await f.collector.probe!(reg)).available) { t.skip("Qualified Chromium browser unavailable"); return; }
    const { job } = await build(f, webFixture("babylon"), "babylon", "babylon");
    const validation = await f.client.startGameValidation("babylon-observation", job.id, f.collector.id);
    const result = await settled(f.client, validation.id); assert.equal(result.state, "completed", result.error);
    const reports = await f.client.getGameReports(job.id);
    assert.equal(reports[0]!.checks.find((check) => check.id === "boots")!.status, "passed");
    assert.equal(reports[0]!.environment.scope, "automated");
    assert.ok(reports[0]!.evidence!.some((file) => file.path === "boot.png"));
  } finally { await f.close(); }
});

test("named suites remain distinct, while replaying a validation request does not launch another observation", async (t) => {
  const f = await fixture();
  try {
    if (!(await f.collector.probe!(reg)).available) { t.skip("Qualified Chromium browser unavailable"); return; }
    const source = webFixture("phaser"); source.set("data/playtests.json", JSON.stringify(suite(false))); source.set("data/playtests/second.json", JSON.stringify(suite()));
    const { job } = await build(f, source);
    const first = await f.client.startGameValidation("first-suite", job.id, f.collector.id);
    assert.equal((await settled(f.client, first.id)).state, "completed");
    const second = await f.client.startGameValidation("second-suite", job.id, f.collector.id, "data/playtests/second.json");
    assert.equal((await settled(f.client, second.id)).state, "completed");
    assert.equal((await f.client.startGameValidation("second-suite", job.id, f.collector.id, "data/playtests/second.json")).id, second.id);
    await assert.rejects(f.client.startGameValidation("second-suite", job.id, f.collector.id, "data/playtests.json"), /different content/);
    const reports = (await f.client.getGameReports(job.id)).filter((report) => report.testCase);
    assert.deepEqual(reports.map((report) => [report.testCase!.suite, report.checks[0]!.status]), [["data/playtests.json", "failed"], ["data/playtests/second.json", "passed"]]);
  } finally { await f.close(); }
});

test("cancelling a live browser collector waits for it to close and does not publish partial reports", async (t) => {
  const f = await fixture();
  try {
    if (!(await f.collector.probe!(reg)).available) { t.skip("Qualified Chromium browser unavailable"); return; }
    const source = webFixture("phaser");
    source.set("data/playtests.json", JSON.stringify({ schemaVersion: 1, scenarios: [{ id: "waiting", steps: Array.from({ length: 20 }, () => ({ action: "wait", ms: 2000 })) }] }));
    const { job } = await build(f, source);
    const validation = await f.client.startGameValidation("cancel-browser", job.id, f.collector.id);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    assert.equal((await f.client.cancelGameProduction(validation.id)).state, "cancelling");
    assert.equal((await settled(f.client, validation.id)).state, "cancelled");
    assert.deepEqual(await f.client.getGameReports(job.id), []);
    assert.equal((f.store.db.prepare("SELECT count(*) AS n FROM game_report_files").get() as { n: number }).n, 0);
  } finally { await f.close(); }
});

test("Windows qualification reads pinned version/DLL identity without executing a personal-browser launcher", async () => {
  const { mkdir } = await import("node:fs/promises");
  const { qualifyBrowser } = await import("../packages/adapter-game-browser/src/browser");
  const directory = await mkdtemp(path.join(tmpdir(), "browser-version-"));
  try {
    const executable = path.join(directory, "chrome.exe");
    await writeFile(executable, "Not executable: qualification must not launch it");
    for (const version of ["140.0.1.1", "141.0.2.2", "142.0.3.3"]) await mkdir(path.join(directory, version));
    await writeFile(path.join(directory, "140.0.1.1", "chrome.dll"), "older runtime");
    await writeFile(path.join(directory, "141.0.2.2", "chrome.dll"), "current runtime");
    const browser = await qualifyBrowser(executable, "win32");
    assert.equal(browser!.version, "Google Chrome 141.0.2.2");
    assert.equal(browser!.components.length, 2);
    const previous = browser!.sha256;
    await writeFile(path.join(directory, "141.0.2.2", "chrome.dll"), "changed runtime");
    assert.notEqual((await qualifyBrowser(executable, "win32"))!.sha256, previous);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
