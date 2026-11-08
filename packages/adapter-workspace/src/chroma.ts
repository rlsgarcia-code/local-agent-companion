import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import * as path from "node:path";
import { releaseChromaClientLease } from "./chroma-client-leases";
import {
  CHROMA_HEARTBEAT_TIMEOUT_MS,
  CHROMA_LOCK_WAIT_TIMEOUT_MS,
  CHROMA_POLL_INTERVAL_MS,
  CHROMA_STARTUP_TIMEOUT_MS,
  parseChromaHeartbeat,
  parseChromaServerMetadata,
  parseChromaStartLock,
  shouldReclaimChromaStartLock,
  type ChromaServerMetadata,
  type ChromaStartLock,
  type ChromaClientLease
} from "./chroma-lifecycle";

const SERVER_METADATA_FILE = "server.json";
const START_LOCK_FILE = "starting.lock";
const CLIENT_DIRECTORY = "clients";

export class LocalChromaServer {
  private endpoint: Promise<string> | undefined;
  private ownedChild: ChildProcess | undefined;
  private readonly clientId = crypto.randomUUID();
  private clientLeasePath: string | undefined;
  private clientRoot: string | undefined;
  private disposed = false;

  public constructor(private readonly options: { storageRoot: string; launcher: string }) {}

  public async start(): Promise<string> {
    if (this.disposed) throw new Error("The local ChromaDB service has already been disposed.");
    if (this.endpoint) {
      const existing = await this.endpoint;
      if (await heartbeat(existing)) return existing;
      this.endpoint = undefined;
    }
    this.endpoint = this.startOrReuse();
    try {
      return await this.endpoint;
    } catch (error) {
      this.endpoint = undefined;
      throw error;
    }
  }

  public dispose(): void {
    this.disposed = true;
    this.endpoint = undefined;
    const child = this.ownedChild;
    this.ownedChild = undefined;
    const clientRoot = this.clientRoot;
    const clientLeasePath = this.clientLeasePath;
    this.clientRoot = undefined;
    this.clientLeasePath = undefined;
    if (!clientRoot || !clientLeasePath) {
      if (child?.pid) terminateChild(child);
      return;
    }
    const lastClient = releaseChromaClientLease(clientRoot, clientLeasePath);
    if (!lastClient) {
      child?.unref();
      return;
    }
    if (child?.pid) {
      terminateChild(child);
    } else {
      void terminateRecordedServer(path.join(path.dirname(clientRoot), SERVER_METADATA_FILE));
    }
  }

  private async startOrReuse(): Promise<string> {
    const root = path.join(this.options.storageRoot, "chroma");
    const database = path.join(root, "data");
    const metadataPath = path.join(root, SERVER_METADATA_FILE);
    const lockPath = path.join(root, START_LOCK_FILE);
    await mkdir(database, { recursive: true });
    await this.ensureClientLease(root);

    const existing = await this.readHealthyServer(metadataPath);
    if (existing) return existing;

    const lock = await this.acquireStartLock(lockPath, metadataPath);
    if (!lock) return this.startOrReuse();

    try {
      const afterLock = await this.readHealthyServer(metadataPath);
      if (afterLock) return afterLock;
      return await this.startOwnedServer(database, metadataPath);
    } finally {
      await lock.close();
      await unlink(lockPath).catch(() => undefined);
    }
  }

  private async ensureClientLease(root: string): Promise<void> {
    if (this.clientLeasePath) return;
    const clientRoot = path.join(root, CLIENT_DIRECTORY);
    await mkdir(clientRoot, { recursive: true, mode: 0o700 });
    const leasePath = path.join(clientRoot, `${this.clientId}.json`);
    const lease: ChromaClientLease = {
      version: 1,
      id: this.clientId,
      pid: process.pid,
      createdAt: Date.now()
    };
    await writeFile(leasePath, `${JSON.stringify(lease)}\n`, { encoding: "utf8", mode: 0o600 });
    if (this.disposed) {
      await unlink(leasePath).catch(() => undefined);
      throw new Error("The local ChromaDB service was disposed during startup.");
    }
    this.clientRoot = clientRoot;
    this.clientLeasePath = leasePath;
  }

  private async acquireStartLock(lockPath: string, metadataPath: string) {
    try {
      const lock = await open(lockPath, "wx", 0o600);
      try {
        const record: ChromaStartLock = { version: 1, pid: process.pid, createdAt: Date.now() };
        await lock.writeFile(`${JSON.stringify(record)}\n`, "utf8");
        return lock;
      } catch (error) {
        await lock.close();
        await unlink(lockPath).catch(() => undefined);
        throw error;
      }
    } catch (error) {
      if (!isFileExistsError(error)) throw error;
    }

    const deadline = Date.now() + CHROMA_LOCK_WAIT_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await delay(CHROMA_POLL_INTERVAL_MS);
      const running = await this.readHealthyServer(metadataPath);
      if (running) return undefined;

      const lockState = await readStartLockState(lockPath);
      if (!lockState.exists) return undefined;
      if (shouldReclaimChromaStartLock(
        lockState.lock,
        lockState.modifiedAt,
        Date.now(),
        processIsAlive
      )) {
        await unlink(lockPath).catch(() => undefined);
        return undefined;
      }
    }
    throw new Error("Timed out waiting for another VS Code window to start the local ChromaDB service.");
  }

  private async startOwnedServer(database: string, metadataPath: string): Promise<string> {
    const port = await availablePort();
    const launcher = this.options.launcher;
    const child = spawn(process.execPath, [
      launcher,
      "run",
      "--path",
      database,
      "--host",
      "127.0.0.1",
      "--port",
      String(port)
    ], {
      stdio: "ignore",
      env: chromaEnvironment(),
      windowsHide: true
    });
    if (!child.pid) {
      child.kill();
      throw new Error("The bundled local ChromaDB service could not be started.");
    }

    this.ownedChild = child;
    const pid = child.pid;
    child.once("exit", () => {
      if (this.ownedChild === child) {
        this.ownedChild = undefined;
        this.endpoint = undefined;
      }
      void removeMetadataIfOwned(metadataPath, pid);
    });

    const endpoint = `http://127.0.0.1:${port}`;
    try {
      await waitForHeartbeat(endpoint, pid, CHROMA_STARTUP_TIMEOUT_MS);
      if (this.disposed) throw new Error("The local ChromaDB service was disposed during startup.");
      const metadata: ChromaServerMetadata = { version: 1, pid, port, startedAt: Date.now() };
      await writeMetadataAtomically(metadataPath, metadata);
      return endpoint;
    } catch (error) {
      terminateChild(child);
      throw error;
    }
  }

  private async readHealthyServer(metadataPath: string): Promise<string | undefined> {
    let metadata: ChromaServerMetadata | undefined;
    try {
      metadata = parseChromaServerMetadata(JSON.parse(await readFile(metadataPath, "utf8")));
    } catch (error) {
      if (!isFileNotFoundError(error)) await unlink(metadataPath).catch(() => undefined);
      return undefined;
    }
    if (!metadata) {
      await unlink(metadataPath).catch(() => undefined);
      return undefined;
    }
    if (!processIsAlive(metadata.pid)) {
      await removeMetadataIfOwned(metadataPath, metadata.pid);
      return undefined;
    }
    const endpoint = `http://127.0.0.1:${metadata.port}`;
    if (await heartbeat(endpoint)) return endpoint;
    throw new Error(
      `Local ChromaDB process ${metadata.pid} is running but did not return a valid heartbeat on 127.0.0.1:${metadata.port}. ` +
      "Reload the VS Code window before retrying semantic memory."
    );
  }
}

async function availablePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForHeartbeat(endpoint: string, pid: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await heartbeat(endpoint)) return;
    if (!processIsAlive(pid)) break;
    await delay(CHROMA_POLL_INTERVAL_MS);
  }
  throw new Error("The bundled local ChromaDB service did not become ready.");
}

async function heartbeat(endpoint: string): Promise<boolean> {
  try {
    const response = await fetch(`${endpoint}/api/v2/heartbeat`, {
      cache: "no-store",
      signal: AbortSignal.timeout(CHROMA_HEARTBEAT_TIMEOUT_MS)
    });
    if (!response.ok) return false;
    return parseChromaHeartbeat(await response.json()) !== undefined;
  } catch {
    return false;
  }
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function readStartLockState(lockPath: string): Promise<{
  exists: boolean;
  lock?: ChromaStartLock;
  modifiedAt: number;
}> {
  try {
    const [contents, fileStat] = await Promise.all([readFile(lockPath, "utf8"), stat(lockPath)]);
    let parsed: unknown;
    try {
      parsed = JSON.parse(contents);
    } catch {
      parsed = undefined;
    }
    const lock = parseChromaStartLock(parsed);
    return { exists: true, ...(lock ? { lock } : {}), modifiedAt: fileStat.mtimeMs };
  } catch (error) {
    if (isFileNotFoundError(error)) return { exists: false, modifiedAt: 0 };
    throw error;
  }
}

async function writeMetadataAtomically(metadataPath: string, metadata: ChromaServerMetadata): Promise<void> {
  const temporaryPath = `${metadataPath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(metadata)}\n`, { encoding: "utf8", mode: 0o600 });
  try {
    await rename(temporaryPath, metadataPath);
  } finally {
    await unlink(temporaryPath).catch(() => undefined);
  }
}

async function removeMetadataIfOwned(metadataPath: string, pid: number): Promise<void> {
  try {
    const metadata = parseChromaServerMetadata(JSON.parse(await readFile(metadataPath, "utf8")));
    if (metadata?.pid === pid) await unlink(metadataPath);
  } catch {
    // Missing or malformed metadata cannot identify this process as the owner.
  }
}

async function terminateRecordedServer(metadataPath: string): Promise<void> {
  try {
    const metadata = parseChromaServerMetadata(JSON.parse(await readFile(metadataPath, "utf8")));
    if (!metadata || !processIsAlive(metadata.pid)) return;
    const endpoint = `http://127.0.0.1:${metadata.port}`;
    if (!await heartbeat(endpoint)) return;
    terminatePid(metadata.pid);
  } catch {
    // Never signal a process unless valid metadata and the strict Chroma heartbeat agree.
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function terminateChild(child: ChildProcess): void {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGINT");
  const forceTimer = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }, 3_000);
  child.once("exit", () => clearTimeout(forceTimer));
}

function terminatePid(pid: number): void {
  try {
    process.kill(pid, "SIGINT");
  } catch {
    return;
  }
  setTimeout(() => {
    if (!processIsAlive(pid)) return;
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // The process may have exited between the liveness check and the signal.
    }
  }, 3_000);
}

function isFileExistsError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}

function isFileNotFoundError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function chromaEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    ELECTRON_RUN_AS_NODE: "1",
    ANONYMIZED_TELEMETRY: "FALSE"
  };
  for (const name of ["PATH", "TMPDIR", "TMP", "TEMP", "SystemRoot", "WINDIR"]) {
    const value = process.env[name];
    if (value) environment[name] = value;
  }
  return environment;
}
