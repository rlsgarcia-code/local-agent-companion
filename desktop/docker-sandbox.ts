import { spawn } from "node:child_process";
import { createServer } from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { LocalProcessManager, type LocalProcessSnapshot } from "../src/process-manager";
import { DOCKER_SANDBOX_PROXY_IMAGE } from "../src/docker-recommendation";
import { dockerResourceLimits } from "../src/docker-recommendation";
import { resolveDockerExecutable } from "./local-executable";

const SANDBOX_NETWORK = "local-companion-sandbox";
const IMAGE_ALIAS = /^[A-Za-z0-9][A-Za-z0-9._/:@-]{0,255}$/;
const CONTAINER_PATH = /^\/?(?:[A-Za-z0-9._-]+\/?)*$/;
const MAX_OUTPUT = 80_000;

export type DockerImageInfo = {
  alias: string;
  id: string;
  size: string;
};

export type DockerSandboxSnapshot = LocalProcessSnapshot & {
  image: string;
  containerName: string;
  containerPort: number;
  url: string;
  proxyContainerName: string;
};

type SandboxEntry = {
  processId: string;
  image: string;
  containerName: string;
  containerPort: number;
  url: string;
  proxyContainerName: string;
};

export class DockerSandboxManager {
  private readonly processes: LocalProcessManager;
  private readonly entries = new Map<string, SandboxEntry>();

  public constructor(processes = new LocalProcessManager()) {
    this.processes = processes;
  }

  public setEventSink(sink: Parameters<LocalProcessManager["setEventSink"]>[0]): void {
    this.processes.setEventSink(sink);
  }

  public async status(): Promise<{ available: boolean; version?: string; images: DockerImageInfo[]; error?: string }> {
    try {
      const version = (await runDocker(["version", "--format", "{{.Server.Version}}"], undefined, 8_000)).output.trim();
      return { available: true, version, images: await this.listImages() };
    } catch (error) {
      return { available: false, images: [], error: singleLine(error) };
    }
  }

  public async listImages(): Promise<DockerImageInfo[]> {
    const result = await runDocker(["image", "ls", "--format", "{{json .}}"], undefined, 10_000);
    return result.output.split(/\r?\n/).flatMap((line) => {
      if (!line.trim()) return [];
      try {
        const value = JSON.parse(line) as { Repository?: string; Tag?: string; ID?: string; Size?: string };
        if (!value.Repository || value.Repository === "<none>" || !value.Tag || value.Tag === "<none>") return [];
        return [{ alias: `${value.Repository}:${value.Tag}`, id: value.ID ?? "", size: value.Size ?? "" }];
      } catch {
        return [];
      }
    });
  }

  public async runCommand(options: {
    workspacePath: string;
    image: string;
    executable: string;
    args: string[];
    cwd?: string;
    signal: AbortSignal;
  }): Promise<string> {
    await this.requireInstalledImage(options.image);
    const args = [
      "run", "--rm", "--init", "--network", "none",
      ...resourceArguments(),
      ...mountArguments(options.workspacePath, options.cwd),
      options.image, options.executable, ...options.args
    ];
    const result = await runDocker(args, options.signal, 120_000, options.workspacePath);
    return `${result.output.trim()}\n\n[exit ${result.exitCode}]`.trim();
  }

  public async startApplication(options: {
    workspacePath: string;
    image: string;
    executable: string;
    args: string[];
    cwd?: string;
    containerPort: number;
  }): Promise<DockerSandboxSnapshot> {
    await this.requireInstalledImage(options.image);
    await this.requireInstalledImage(DOCKER_SANDBOX_PROXY_IMAGE);
    await this.ensureInternalNetwork();
    const hostPort = await availableLoopbackPort();
    const containerName = `local-companion-${crypto.randomUUID().slice(0, 12)}`;
    const proxyContainerName = `${containerName}-gateway`;
    const url = `http://127.0.0.1:${hostPort}/`;
    const args = [
      "run", "--rm", "--init", "--name", containerName,
      "--network", SANDBOX_NETWORK,
      ...resourceArguments(),
      ...mountArguments(options.workspacePath, options.cwd),
      options.image, options.executable, ...options.args
    ];
    const process = await this.processes.start({
      command: resolveDockerExecutable(),
      args,
      cwd: options.workspacePath,
      knownUrls: [url],
      onExit: () => {
        const cleanup = spawn(resolveDockerExecutable(), ["rm", "--force", proxyContainerName], { shell: false, stdio: "ignore", env: dockerEnvironment() });
        cleanup.unref();
      }
    });
    try {
      await runDocker([
        "run", "--rm", "--detach", "--init", "--name", proxyContainerName,
        "--publish", `127.0.0.1:${hostPort}:18080`,
        "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true",
        "--pids-limit", "64", "--memory", "128m", "--cpus", "0.25", "--read-only",
        DOCKER_SANDBOX_PROXY_IMAGE,
        "-d", "-d", "TCP-LISTEN:18080,fork,reuseaddr", `TCP:${containerName}:${options.containerPort}`
      ], undefined, 15_000);
      await runDocker(["network", "connect", SANDBOX_NETWORK, proxyContainerName], undefined, 10_000);
      if (this.processes.inspect(process.id)[0]?.state !== "running") {
        throw new Error("The application container exited before the loopback gateway became ready.");
      }
    } catch (error) {
      await runDocker(["rm", "--force", proxyContainerName, containerName], undefined, 15_000).catch(() => undefined);
      await this.processes.stop(process.id).catch(() => undefined);
      throw error;
    }
    const entry = { processId: process.id, image: options.image, containerName, proxyContainerName, containerPort: options.containerPort, url };
    this.entries.set(process.id, entry);
    return this.snapshot(process, entry);
  }

  public inspect(id?: string): DockerSandboxSnapshot[] {
    const processes = this.processes.inspect(id);
    return processes.flatMap((process) => {
      const entry = this.entries.get(process.id);
      return entry ? [this.snapshot(process, entry)] : [];
    });
  }

  public async waitForReady(id: string, timeoutMs: number, signal: AbortSignal) {
    const entry = this.required(id);
    return this.processes.waitForReady(entry.processId, entry.url, timeoutMs, signal);
  }

  public async stop(id: string): Promise<DockerSandboxSnapshot> {
    const entry = this.required(id);
    await runDocker(["rm", "--force", entry.proxyContainerName, entry.containerName], undefined, 15_000).catch(() => undefined);
    const stopped = await this.processes.stop(entry.processId);
    return this.snapshot(stopped, entry);
  }

  public dispose(): void {
    for (const entry of this.entries.values()) {
      const cleanup = spawn(resolveDockerExecutable(), ["rm", "--force", entry.proxyContainerName, entry.containerName], { shell: false, stdio: "ignore", env: dockerEnvironment() });
      cleanup.unref();
    }
    this.processes.dispose();
    this.entries.clear();
  }

  private async requireInstalledImage(image: string): Promise<void> {
    if (!IMAGE_ALIAS.test(image)) throw new Error("Choose a valid Docker image alias.");
    const installed = await this.listImages();
    if (!installed.some((candidate) => candidate.alias.toLowerCase() === image.toLowerCase())) {
      throw new Error(`Docker image ${image} is not installed. Use the reviewed setup command to pull it before execution.`);
    }
  }

  private async ensureInternalNetwork(): Promise<void> {
    const inspected = await runDocker(["network", "inspect", "--format", "{{.Internal}}", SANDBOX_NETWORK], undefined, 8_000).then((result) => result.output.trim(), () => "");
    if (inspected === "true") return;
    if (inspected) throw new Error(`Docker network ${SANDBOX_NETWORK} exists but is not internal; refusing to use it.`);
    await runDocker(["network", "create", "--driver", "bridge", "--internal", SANDBOX_NETWORK], undefined, 15_000);
  }

  private required(id: string): SandboxEntry {
    const entry = this.entries.get(id);
    if (!entry) throw new Error("The requested Docker sandbox is no longer available.");
    return entry;
  }

  private snapshot(process: LocalProcessSnapshot, entry: SandboxEntry): DockerSandboxSnapshot {
    return { ...process, command: `docker sandbox · ${entry.image}`, image: entry.image, containerName: entry.containerName, proxyContainerName: entry.proxyContainerName, containerPort: entry.containerPort, url: entry.url };
  }
}

function resourceArguments(): string[] {
  const { memoryLimitGb, cpuLimit } = dockerResourceLimits(Math.round(os.totalmem() / 1024 ** 3), os.cpus().length);
  return [
    "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true",
    "--pids-limit", "256", "--memory", `${memoryLimitGb}g`, "--cpus", String(cpuLimit),
    "--read-only", "--tmpfs", "/tmp:rw,noexec,nosuid,size=256m",
    "--env", "HOME=/tmp", "--user", hostUser()
  ];
}

function mountArguments(workspacePath: string, relativeCwd?: string): string[] {
  const normalized = (relativeCwd ?? "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!CONTAINER_PATH.test(normalized) || normalized.split("/").includes("..")) throw new Error("Docker working directory must stay inside the workspace.");
  const workdir = normalized ? `/workspace/${normalized}` : "/workspace";
  return ["--volume", `${path.resolve(workspacePath)}:/workspace:rw`, "--workdir", workdir];
}

function hostUser(): string {
  const uid = typeof process.getuid === "function" ? process.getuid() : 65532;
  const gid = typeof process.getgid === "function" ? process.getgid() : 65532;
  return `${uid}:${gid}`;
}

async function availableLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function runDocker(args: string[], signal?: AbortSignal, timeoutMs = 30_000, cwd?: string): Promise<{ output: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(resolveDockerExecutable(), args, { cwd, shell: false, stdio: ["ignore", "pipe", "pipe"], env: dockerEnvironment() });
    let output = "";
    const append = (chunk: Buffer) => { if (output.length < MAX_OUTPUT) output += chunk.toString("utf8").slice(0, MAX_OUTPUT - output.length); };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    const abort = () => child.kill("SIGTERM");
    signal?.addEventListener("abort", abort, { once: true });
    child.once("error", (error) => { clearTimeout(timer); signal?.removeEventListener("abort", abort); reject(error); });
    child.once("exit", (code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (signal?.aborted) return reject(signal.reason ?? new Error("Docker command cancelled."));
      if (code !== 0) return reject(new Error(output.trim() || `docker exited with code ${code ?? "unknown"}.`));
      resolve({ output, exitCode: code ?? 0 });
    });
  });
}

function dockerEnvironment(): NodeJS.ProcessEnv {
  const allowed = ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "DOCKER_HOST", "DOCKER_CONTEXT"];
  return Object.fromEntries(allowed.flatMap((name) => process.env[name] ? [[name, process.env[name]]] : []));
}

function singleLine(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(/[\r\n\t]+/g, " ").slice(0, 300);
}
