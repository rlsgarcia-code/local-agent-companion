/** Fixed one-job candidate. Core must provide the OS sandbox and process ledger. */
import { randomUUID } from "node:crypto";
import { mkdir, realpath, link, unlink, open } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { canonical } from "../../contracts/src/identity";
import { gameBrowserProcessRequest, gameBrowserProcessResult, type GameBrowserProcessResult } from "../../contracts/src/game-browser-worker";
import { GameProductionUncertain } from "../../game-production/src/index";
import { collect } from "./collect";
import { browserDigest, type QualifiedBrowser } from "./browser";
import { gameBrowserCandidateToolchain } from "./candidate-toolchain";
import { alive, checkDirectory, digest, readPrivate, writePrivate } from "./journal";
import { opendir } from "node:fs/promises";
import { flushPublishedDirectory } from "../../platform-files/src/directory-flush";

async function entries(directory: string, max: number) {
  const names: string[] = [];
  for await (const entry of await opendir(directory)) {
    if (names.length >= max) throw new Error("The sealed browser exchange has unexpected files.");
    names.push(entry.name);
  }
  return names;
}
async function directory(name: string) {
  await checkDirectory(name);
  if (await realpath(name) !== name) throw new Error("Browser exchanges cannot traverse directory links.");
}
async function syncDirectory(name: string) {
  await flushPublishedDirectory(name);
}
async function commit(directory: string, name: string, value: unknown) {
  const pending = path.join(directory, `${name}-${randomUUID()}.pending`);
  await writePrivate(pending, Buffer.from(canonical(value)));
  await link(pending, path.join(directory, name));
  await unlink(pending); await syncDirectory(directory);
}

/** Trusted host entry, also exercised with disposable test fixtures. No sandbox claim. */
export async function processBrowserCandidate(options: {
  inputDirectory: string; outputDirectory: string; implementationSha256: string;
  browser: QualifiedBrowser; signal?: AbortSignal;
  componentSha256?: string;
}): Promise<GameBrowserProcessResult> {
  const input = path.resolve(options.inputDirectory), output = path.resolve(options.outputDirectory);
  if (input === output || input.startsWith(output + path.sep) || output.startsWith(input + path.sep))
    throw new Error("Browser input and candidate must be separate directories.");
  const signal = options.signal ?? new AbortController().signal;
  const toolchain = gameBrowserCandidateToolchain(options.implementationSha256, options.browser.sha256, options.componentSha256);
  await directory(input); await directory(path.join(input, "blobs")); await directory(output);
  if ((await entries(output, 1)).length || canonical((await entries(input, 2)).sort()) !== canonical(["blobs", "request.json"]))
    throw new Error("The sealed browser exchange is not empty or exact.");
  signal.throwIfAborted();
  await writePrivate(path.join(output, "result.lock"), Buffer.alloc(0)); await syncDirectory(output);
  const raw = await readPrivate(path.join(input, "request.json"), 16 * 1024 * 1024);
  const request = gameBrowserProcessRequest.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw)));
  if (canonical(request.toolchain) !== canonical(toolchain)) throw new Error("The requested browser toolchain changed.");
  const binding = { schemaVersion: 1 as const, requestId: request.requestId, requestSha256: digest(raw),
    sourceHash: request.artifact.sourceHash, artifactHash: request.artifact.artifactHash, toolchain,
    ...(request.testSuite ? { testSuite: request.testSuite } : {}) };
  const files = new Map(request.artifact.files.map(file => [file.path, file]));
  const expected = new Set(request.artifact.files.map(file => file.sha256));
  const names = await entries(path.join(input, "blobs"), 20000);
  if (names.length !== expected.size || names.some(name => !expected.has(name))) throw new Error("The sealed build has unexpected or missing blobs.");
  // Stream/read one bounded blob at a time. The OS broker keeps the input read-only;
  // each served resource is checked again rather than trusting this preflight.
  const readFile = async (name: string) => {
    signal.throwIfAborted();
    const file = files.get(name); if (!file) throw new Error("The resource is not in this pinned build.");
    const bytes = await readPrivate(path.join(input, "blobs", file.sha256), file.size);
    if (bytes.length !== file.size || digest(bytes) !== file.sha256) throw new Error("A sealed build blob changed.");
    return bytes;
  };
  for (const file of request.artifact.files) await readFile(file.path);
  for (const component of options.browser.components) {
    signal.throwIfAborted();
    if (await browserDigest(component.path) !== component.sha256) throw new Error("The provisioned browser changed before collection.");
  }
  signal.throwIfAborted();
  let browserPid: number | undefined, stopped = false;
  const observations = await collect({ job: { id: request.requestId, testSuite: request.testSuite },
    artifact: request.artifact, designScenarios: request.designScenarios, signal, readFile }, options.browser, true,
  async () => {
    if (!browserPid) throw new GameProductionUncertain("The browser process was not identified; retain the reservation.");
    for (let i = 0; i < 50 && alive(browserPid); i++) await new Promise(resolve => setTimeout(resolve, 100));
    if (alive(browserPid)) throw new GameProductionUncertain("Browser shutdown is unconfirmed; retain the reservation.");
    await commit(output, "stopped.json", binding); stopped = true;
  }, async (browser, origin) => {
    const session = await browser.newBrowserCDPSession();
    try {
      const processes = await session.send("SystemInfo.getProcessInfo");
      const pid = Number(processes.processInfo.find(row => row.type === "browser")?.id);
      if (!Number.isSafeInteger(pid) || pid <= 0) throw new GameProductionUncertain("The browser PID was not observed.");
      browserPid = pid;
    } finally { await session.detach(); }
    await commit(output, "runtime.json", { ...binding, workerPid: process.pid, browserPid, origin });
  });
  if (!stopped) throw new GameProductionUncertain("A report cannot replace the original shutdown acknowledgment.");
  signal.throwIfAborted();
  const result = gameBrowserProcessResult.parse({ ...binding, observations: observations.map(({ evidenceFiles, ...observation }) => ({
    ...observation, evidenceFiles: (evidenceFiles ?? []).map(file => ({ path: file.path, mime: file.mime,
      size: file.data.byteLength, sha256: digest(file.data) })),
  })) });
  const resultBytes = Buffer.from(canonical(result));
  if (resultBytes.length > 4 * 1024 * 1024) throw new Error("The browser report exceeds 4 MiB.");
  await mkdir(path.join(output, "candidate"), { mode: 0o700 });
  const written = new Set<string>();
  for (const observation of observations) for (const file of observation.evidenceFiles ?? []) {
    signal.throwIfAborted(); const sha256 = digest(file.data);
    if (!written.has(sha256)) { await writePrivate(path.join(output, "candidate", sha256), file.data); written.add(sha256); }
  }
  await syncDirectory(path.join(output, "candidate")); signal.throwIfAborted();
  await commit(output, "result.json", result);
  return result;
}
