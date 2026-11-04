import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import sandboxModule from "../dist-tests/desktop/docker-sandbox.js";

const { DockerSandboxManager } = sandboxModule;
const root = await mkdtemp(path.join(process.cwd(), ".desktop-preview-smoke-"));
const serverPath = path.join(root, "index.html");
const manager = new DockerSandboxManager();
const execFileAsync = promisify(execFile);
let processId;

try {
  await writeFile(serverPath, "local-preview-ready", "utf8");
  const started = await manager.startApplication({
    workspacePath: root,
    image: process.env.LOCAL_COMPANION_SMOKE_IMAGE || "python:3.13-slim",
    executable: "python",
    args: ["-m", "http.server", "8080", "--bind", "0.0.0.0"],
    containerPort: 8080
  });
  processId = started.id;
  const ready = await manager.waitForReady(started.id, 15_000, AbortSignal.timeout(17_000));
  if (!ready.ready || !ready.url) throw new Error(`Preview did not become ready: ${ready.detail}\n${JSON.stringify(ready.process)}`);
  const response = await fetch(ready.url, { signal: AbortSignal.timeout(2_000), redirect: "error" });
  if (!response.ok || await response.text() !== "local-preview-ready") throw new Error("Preview response was not verified.");
  let egressBlocked = false;
  try {
    await execFileAsync("docker", ["exec", started.containerName, "python", "-c", "import socket; socket.create_connection(('1.1.1.1',443),2)"], { timeout: 5_000 });
  } catch {
    egressBlocked = true;
  }
  if (!egressBlocked) throw new Error("Application container unexpectedly reached an external address.");
  console.log(`DESKTOP_LOCAL_PREVIEW_READY ${ready.url}`);
  console.log("DESKTOP_SANDBOX_EGRESS_BLOCKED");
} finally {
  if (processId) await manager.stop(processId).catch(() => undefined);
  manager.dispose();
  await rm(root, { recursive: true, force: true });
}
