import { fork, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { rm } from "node:fs/promises";
import { userInfo } from "node:os";
import * as path from "node:path";
import { contentHash } from "../../contracts/src/identity";
import { GameProductionFailure, GameProductionUncertain, type GameValidationCollector, type CollectedGameObservation, type GameRecovery } from "../../game-production/src/index";
import type { QualifiedBrowser } from "./browser";
import { alive, checkDirectory, digest, ensureDirectory, json, leaseSchema, operationSchema, privateDirectory, readOperation, readResult, receiptSchema, requestSchema, writeJson, writePrivate, type BrowserOperation, type BrowserReceipt } from "./journal";

type Access = Parameters<GameValidationCollector["validate"]>[0];
type Options = { stateDirectory: string; workerPath: string; workerSha256: string; browser: QualifiedBrowser; headless: boolean };

/** Host process management only; no generic commands, IPC server or agent loop. */
export function durableBrowser(options: Options) {
  const active = new Map<string, ChildProcess>();
  const directory = (access: Access) => {
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(access.job.id)) throw new GameProductionFailure("Invalid browser operation identity.");
    return path.join(options.stateDirectory, "game-browser-jobs", access.job.id);
  };
  const binding = (access: Access): BrowserOperation["binding"] => ({
    namespace: contentHash([process.getuid?.() ?? userInfo().username, access.registration.product, access.registration.profile, access.registration.workspace]),
    jobId: access.job.id, sourceHash: access.job.sourceHash, artifactHash: access.artifact.artifactHash, toolchain: access.job.toolchain,
    ...(access.job.testSuite ? { testSuite: access.job.testSuite } : {}),
  });
  async function operation(access: Access): Promise<BrowserOperation> {
    await checkDirectory(options.stateDirectory); await checkDirectory(path.join(options.stateDirectory, "game-browser-jobs"));
    const op = await readOperation(directory(access));
    if (contentHash(op.binding) !== contentHash(binding(access)) || op.workerSha256 !== options.workerSha256) throw new Error("Browser receipt does not belong to this exact namespace/build/toolchain.");
    return op;
  }
  async function receipt(access: Access): Promise<BrowserReceipt | undefined> {
    const op = await operation(access);
    let value: unknown;
    try { value = await json(path.join(directory(access), "receipt.json")); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const lease = leaseSchema.parse(await json(path.join(directory(access), "lease.json")));
      if (lease.operationHash !== contentHash(op)) throw new Error("Browser worker lease differs from its operation.");
      if (alive(lease.pid)) return undefined;
      let stopped;
      try { stopped = leaseSchema.parse(await json(path.join(directory(access), "stopped.json"))); }
      catch { throw new Error("The original browser supervisor disappeared without a shutdown acknowledgment. Preserve this operation for inspection; do not repeat it."); }
      if (stopped.operationHash !== contentHash(op) || stopped.pid !== lease.pid) throw new Error("Browser shutdown checkpoint differs from its lease.");
      return { operationHash: contentHash(op), pid: lease.pid, status: "failed", detail: "The browser and resource transport stopped before the candidate receipt was committed. No observation is certified; request new validation explicitly." };
    }
    const saved = receiptSchema.parse(value);
    if (saved.operationHash !== contentHash(op)) throw new Error("Browser shutdown acknowledgment differs from its operation.");
    try {
      const lease = leaseSchema.parse(await json(path.join(directory(access), "lease.json")));
      if (lease.operationHash !== saved.operationHash || lease.pid !== saved.pid) throw new Error("Browser acknowledgment differs from its worker lease.");
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT" || saved.status !== "cancelled") throw error; }
    if (saved.status === "completed") {
      const stopped = leaseSchema.parse(await json(path.join(directory(access), "stopped.json")));
      if (stopped.operationHash !== saved.operationHash || stopped.pid !== saved.pid) throw new Error("Completed browser candidate has no matching shutdown checkpoint.");
    }
    // Existence checks never send a terminating signal. PID reuse can delay
    // reconciliation, never kill an unrelated process or infer a false absence.
    if (alive(saved.pid)) return undefined;
    return saved;
  }
  async function recover(access: Access): Promise<GameRecovery<CollectedGameObservation[]>> {
    try {
      try {
        const op = await operation(access), disposed = await json(path.join(directory(access), "disposed.json")) as { operationHash?: unknown; state?: unknown };
        if (disposed.operationHash !== contentHash(op) || !["completed", "failed", "cancelled"].includes(String(disposed.state)) || !["completed", "failed", "cancelled"].includes(access.job.state)) throw new Error("A pending browser result cannot be declared disposed.");
        return { state: "missing", detail: "This terminal observation was acknowledged by the service; only its audit receipt remains in the adapter cache." };
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      const saved = await receipt(access);
      if (!saved) return { state: "running" };
      if (saved.status === "uncertain") throw new Error(saved.detail);
      if (saved.status === "completed") return { state: "completed", result: await readResult(directory(access), saved.resultSha256!) };
      return { state: "missing", detail: saved.detail || "The browser supervisor confirmed resource shutdown without an acknowledged result." };
    } catch (error) { throw new GameProductionUncertain(error instanceof Error ? error.message : "The original browser result cannot be confirmed."); }
  }
  async function prepare(access: Access): Promise<BrowserOperation> {
    access.signal.throwIfAborted();
    await checkDirectory(options.stateDirectory); await ensureDirectory(path.join(options.stateDirectory, "game-browser-jobs"));
    await privateDirectory(directory(access));
    const op = operationSchema.parse({ schemaVersion: 1, nonce: randomBytes(32).toString("hex"), workerSha256: options.workerSha256, binding: binding(access) });
    await writePrivate(path.join(directory(access), "operation.json"), Buffer.from(JSON.stringify(op)));
    for (const name of ["input", "home", "tmp"]) await privateDirectory(path.join(directory(access), name));
    let bytes = 0; const copied = new Set<string>();
    for (const file of access.artifact.files) {
      access.signal.throwIfAborted(); bytes += file.size;
      if (bytes > 256 * 1024 * 1024) throw new GameProductionFailure("Browser input exceeded its immutable build budget.");
      if (copied.has(file.sha256)) continue;
      const data = await access.readFile(file.path);
      if (data.byteLength !== file.size || digest(data) !== file.sha256) throw new GameProductionFailure("Browser input differs from its pinned build hash.");
      await writePrivate(path.join(directory(access), "input", file.sha256), data); copied.add(file.sha256);
    }
    const request = Buffer.from(JSON.stringify(requestSchema.parse({ artifact: access.artifact, browser: options.browser, headless: options.headless,
      designScenarios: access.document.design?.playtests.map(({ id, category }) => ({ id, category })) ?? [],
    })));
    if (request.byteLength > 32 * 1024 * 1024) throw new GameProductionFailure("Browser input metadata exceeded its transfer budget; source is preserved.");
    await writePrivate(path.join(directory(access), "request.json"), request);
    await writePrivate(path.join(directory(access), "prepared.json"), Buffer.from(JSON.stringify({ operationHash: contentHash(op), requestSha256: digest(request) })));
    return op;
  }
  function environment(access: Access): NodeJS.ProcessEnv {
    const home = path.join(directory(access), "home"), temp = path.join(directory(access), "tmp");
    const env: NodeJS.ProcessEnv = { HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: home, XDG_CACHE_HOME: home, TMPDIR: temp, TEMP: temp, TMP: temp,
      PATH: process.platform === "win32" ? path.join(process.env.SystemRoot ?? "C:\\Windows", "System32") : "/usr/bin:/bin", LANG: "en_US.UTF-8" };
    for (const key of process.platform === "win32" ? ["SystemRoot", "WINDIR"] : options.headless ? [] : ["DISPLAY", "WAYLAND_DISPLAY", "XAUTHORITY", "XDG_RUNTIME_DIR"])
      if (process.env[key]) env[key] = process.env[key];
    return env;
  }
  async function validate(access: Access): Promise<CollectedGameObservation[]> {
    let child: ChildProcess | undefined, op: BrowserOperation;
    try { op = await prepare(access); }
    catch (error) { access.signal.throwIfAborted(); throw new GameProductionFailure(error instanceof Error ? error.message : "Browser preparation failed before launch."); }
    access.signal.throwIfAborted();
    let ready!: () => void, failed!: (error: unknown) => void;
    const readyTask = new Promise<void>((resolve, reject) => { ready = resolve; failed = reject; });
    void readyTask.catch(() => {});
    let timeoutFailure!: (error: unknown) => void;
    const deadline = new Promise<never>((_resolve, reject) => { timeoutFailure = reject; });
    void deadline.catch(() => {});
    let exited!: () => void;
    const exitTask = new Promise<void>((resolve) => { exited = resolve; });
    const send = (kind: "start" | "cancel") => { if (child?.connected) child.send({ kind, nonce: op.nonce }, () => {}); };
    const cancel = () => send("cancel");
    const timeout = setTimeout(() => {
      if (child?.connected) child.disconnect();
      const error = new GameProductionUncertain("Browser supervisor acknowledgment timed out. Its original operation remains pending; do not repeat it.");
      child?.unref(); failed(error); timeoutFailure(error);
    }, 150000);
    try {
      child = fork(options.workerPath, [directory(access)], { execPath: process.execPath, execArgv: ["--max-old-space-size=768"],
        env: environment(access), stdio: ["ignore", "ignore", "ignore", "ipc"], windowsHide: true });
      active.set(access.job.id, child);
      child.once("exit", () => { exited(); failed(new Error("Browser supervisor exited before readiness.")); });
      child.once("error", (error) => { failed(error); if (!child?.pid) exited(); });
      child.on("message", (message: unknown) => {
        if (!message || typeof message !== "object" || (message as { nonce?: unknown }).nonce !== op.nonce) return;
        if ((message as { kind?: unknown }).kind === "ready") ready();
        else if ((message as { kind?: unknown }).kind === "uncertain") timeoutFailure(new GameProductionUncertain("The original browser supervisor could not confirm shutdown. Inspect its durable operation before repeating the observation."));
      });
      access.signal.addEventListener("abort", cancel, { once: true });
      if (!child.pid) { await readyTask; throw new Error("Browser supervisor spawn was not acknowledged."); }
      await writePrivate(path.join(directory(access), "lease.json"), Buffer.from(JSON.stringify({ operationHash: contentHash(op), pid: child.pid })));
      await Promise.race([readyTask, deadline]);
      if (access.signal.aborted) cancel(); else send("start");
      await Promise.race([exitTask, deadline]);
      const saved = await receipt(access);
      if (!saved || saved.status === "uncertain") throw new GameProductionUncertain(saved?.detail ?? "Browser termination has not been confirmed.");
      if (access.signal.aborted) throw access.signal.reason;
      if (saved.status !== "completed") throw new GameProductionFailure(saved.detail);
      return await readResult(directory(access), saved.resultSha256!);
    } catch (error) {
      // A failed preparation/spawn cannot run game code. Once a helper exists,
      // only a checked stopped receipt can acknowledge cancellation/failure.
      if (!child?.pid) throw new GameProductionFailure(error instanceof Error ? error.message : "Browser supervisor did not start.");
      if (error instanceof GameProductionFailure || (access.signal.aborted && error === access.signal.reason)) throw error;
      if (error instanceof GameProductionUncertain) { if (child.connected) child.disconnect(); child.unref(); throw error; }
      if (child.exitCode !== null || child.signalCode !== null) {
        try {
          const saved = await receipt(access);
          if (saved && saved.status !== "uncertain") {
            if (access.signal.aborted) throw access.signal.reason;
            if (saved.status === "completed") return await readResult(directory(access), saved.resultSha256!);
            throw new GameProductionFailure(saved.detail);
          }
        } catch (confirmed) {
          if (confirmed instanceof GameProductionFailure || (access.signal.aborted && confirmed === access.signal.reason)) throw confirmed;
        }
      }
      if (child.connected) child.disconnect(); child.unref();
      throw new GameProductionUncertain(error instanceof Error ? error.message : "Browser supervisor result is unknown.");
    } finally {
      clearTimeout(timeout); access.signal.removeEventListener("abort", cancel); active.delete(access.job.id);
      void readyTask.catch(() => {});
    }
  }
  async function dispose(access: Access): Promise<void> {
    if (!["completed", "failed", "cancelled"].includes(access.job.state) || active.has(access.job.id)) return;
    const op = await operation(access);
    // Payload cleanup follows a committed terminal job; retain the small binding
    // and acknowledgment for audit. Never erase an unknown operation's candidate.
    await writeJson(path.join(directory(access), "disposed.json"), { operationHash: contentHash(op), state: access.job.state });
    for (const name of ["input", "output", "home", "tmp", "request.json", "result.json"])
      await rm(path.join(directory(access), name), { recursive: true, force: true });
  }
  return { validate, recover, dispose };
}
