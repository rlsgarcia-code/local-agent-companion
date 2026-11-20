import * as path from "node:path";
import { contentHash } from "../../contracts/src/identity";
import { GameProductionFailure, GameProductionUncertain } from "../../game-production/src/index";
import { browserDigest } from "./browser";
import { collect } from "./collect";
import { checkBrowserTemporary } from "./temporary";
import { alive, checkDirectory, digest, json, operationSchema, preparedSchema, readOperation, readPrivate, requestSchema, writeJson, writeResult, type BrowserOperation, type BrowserReceipt } from "./journal";

// Fixed installed helper, not a client registry, shell or intelligence runtime.
// IPC is the inherited private descriptor; no listening control endpoint.
const controller = new AbortController();
let operation: BrowserOperation | undefined, directory = "", running = false, finishing = false;
let idle: NodeJS.Timeout | undefined;
const abort = () => { controller.abort(new Error("The owning coordinator disconnected or cancelled this observation.")); if (operation && !running) void finish("cancelled", "The observation was stopped before browser launch."); };
process.on("disconnect", abort);
process.on("SIGTERM", abort); process.on("SIGINT", abort);
process.on("message", (message: unknown) => {
  if (!message || typeof message !== "object" || !operation || finishing) return;
  const request = message as { kind?: unknown; nonce?: unknown };
  if (request.nonce !== operation.nonce) return;
  if (request.kind === "cancel") abort();
  else if (request.kind === "start" && !running && !controller.signal.aborted) { running = true; if (idle) clearTimeout(idle); void run(); }
});
async function finish(status: BrowserReceipt["status"], detail: string, resultSha256?: string): Promise<void> {
  if (finishing || !operation) return; finishing = true;
  if (idle) clearTimeout(idle);
  try {
    await writeJson(path.join(directory, "receipt.json"), { operationHash: contentHash(operation), pid: process.pid, status, detail: detail.slice(0, 4000), ...(resultSha256 ? { resultSha256 } : {}) });
    if (status === "uncertain" && process.connected) await new Promise<void>((resolve) => { process.send!({ kind: "uncertain", nonce: operation!.nonce }, () => resolve()); });
    if (process.connected) process.disconnect();
  } catch {
    // Without a durable acknowledgment, the parent must keep reconciliation.
    if (process.connected) process.disconnect();
  }
}
async function run(): Promise<void> {
  if (!operation) return;
  let stopped = false, collectionAttempted = false;
  let browserPid: number | undefined;
  try {
    const prepared = preparedSchema.parse(await json(path.join(directory, "prepared.json")));
    if (prepared.operationHash !== contentHash(operation)) throw new Error("Prepared browser operation changed.");
    const raw = await readPrivate(path.join(directory, "request.json"), 32 * 1024 * 1024);
    if (digest(raw) !== prepared.requestSha256) throw new Error("Browser request differs from its prepared fingerprint.");
    const request = requestSchema.parse(JSON.parse(raw.toString("utf8")));
    if (request.artifact.sourceHash !== operation.binding.sourceHash || request.artifact.artifactHash !== operation.binding.artifactHash) throw new Error("Browser request differs from its pinned build.");
    for (const component of request.browser.components) if (await browserDigest(component.path) !== component.sha256) throw new Error("The qualified browser changed before launch.");
    const files = new Map(request.artifact.files.map((file) => [file.path, file]));
    await checkDirectory(path.join(directory, "input"));
    controller.signal.throwIfAborted(); collectionAttempted = true;
    const observations = await collect({ job: { id: operation.binding.jobId, testSuite: operation.binding.testSuite }, artifact: request.artifact,
      designScenarios: request.designScenarios, signal: controller.signal,
      readFile: async (name) => {
        const file = files.get(name); if (!file) throw new Error("Resource is not in this immutable build.");
        const data = await readPrivate(path.join(directory, "input", file.sha256), file.size);
        if (data.byteLength !== file.size || digest(data) !== file.sha256) throw new Error("Prepared resource differs from the immutable build."); return data;
      },
    }, request.browser, request.headless, async () => {
      if (!browserPid) throw new GameProductionUncertain("The launched browser process was not identified; resource shutdown cannot be acknowledged.");
      for (let i = 0; i < 50 && alive(browserPid); i++) await new Promise((resolve) => setTimeout(resolve, 100));
      if (alive(browserPid)) throw new GameProductionUncertain("The original browser process still exists after close; preserve its resource reservation.");
      stopped = true;
      await writeJson(path.join(directory, "stopped.json"), { operationHash: contentHash(operation!), pid: process.pid });
    }, async (browser, origin) => {
      const cdp = await browser.newBrowserCDPSession();
      let pid: number;
      try {
        const info = await cdp.send("SystemInfo.getProcessInfo");
        pid = Number(info.processInfo.find((item: { type: string }) => item.type === "browser")?.id);
        if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error("The browser process identity was not observed.");
      } finally { await cdp.detach(); }
      browserPid = pid;
      await writeJson(path.join(directory, "runtime.json"), { operationHash: contentHash(operation!), workerPid: process.pid, browserPid: pid, origin });
    });
    // collect returns only after browser and resource shutdown. A lost parent
    // after completion still gets a durable exact candidate, never a rerun.
    const sha256 = await writeResult(directory, observations);
    await finish("completed", "Browser and resource transport stopped; candidate saved.", sha256);
  } catch (error) {
    const safe = stopped || (!collectionAttempted && !(error instanceof GameProductionUncertain)) || error instanceof GameProductionFailure;
    const detail = error instanceof Error ? error.message : "Browser worker failed.";
    await finish(!safe ? "uncertain" : controller.signal.aborted ? "cancelled" : "failed", detail);
  }
}
async function main(): Promise<void> {
  const argument = process.argv[2];
  if (!argument || !path.isAbsolute(argument) || !process.send) throw new Error("Browser workers require a private coordinator descriptor and absolute state directory.");
  directory = argument; operation = operationSchema.parse(await readOperation(directory));
  // The service bound this parent into the operation before replacing TMPDIR.
  // Workers only validate it; deletion uses the service's original OS temp base.
  if (operation.temporary) {
    if (process.env.TMPDIR !== operation.temporary.path || process.env.TEMP !== operation.temporary.path)
      throw new Error("The worker temporary environment differs from its pinned operation.");
    await checkBrowserTemporary(operation.temporary, path.dirname(operation.temporary.path));
  }
  if (path.basename(directory) !== operation.binding.jobId || await browserDigest(process.argv[1]!) !== operation.workerSha256) throw new Error("Installed browser worker identity changed.");
  if (!process.connected || controller.signal.aborted) { await finish("cancelled", "The coordinator disconnected before browser launch."); return; }
  idle = setTimeout(abort, 30000);
  process.send({ kind: "ready", nonce: operation.nonce });
}
void main().catch(() => { if (process.connected) process.disconnect(); process.exitCode = 1; });
