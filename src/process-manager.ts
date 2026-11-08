import { spawn, type ChildProcess } from "node:child_process";
import * as http from "node:http";
import * as https from "node:https";
import * as path from "node:path";
import type * as vscode from "vscode";
import { normalizeLocalBrowserUrl } from "./browser-policy";
import { redactSensitiveText } from "./redaction";
import type { AgentUiEvent } from "./types";

const MAX_PROCESSES = 3;
const MAX_RETAINED_PROCESSES = 20;
const MAX_OUTPUT_CHARACTERS = 40_000;
const MAX_DISCOVERED_URLS = 12;

export type LocalProcessSpec = {
  command: string;
  args: string[];
  cwd: string;
  knownUrls?: string[];
  onExit?: () => void;
};

export type LocalProcessSnapshot = {
  id: string;
  command: string;
  cwd: string;
  state: "running" | "exited";
  pid?: number;
  exitCode?: number;
  signal?: string;
  startedAt: number;
  stoppedAt?: number;
  detectedUrls: string[];
  stdout: string;
  stderr: string;
};

type ManagedProcess = {
  id: string;
  spec: LocalProcessSpec;
  displayCommand: string;
  child: ChildProcess;
  state: LocalProcessSnapshot["state"];
  startedAt: number;
  stoppedAt?: number;
  exitCode?: number;
  signal?: string;
  stdout: string;
  stderr: string;
  detectedUrls: Set<string>;
};

export class LocalProcessManager implements vscode.Disposable {
  private readonly processes = new Map<string, ManagedProcess>();
  private eventSink: (event: AgentUiEvent) => void = () => undefined;
  private sanitize: (value: string) => string = (value) => value;
  private disposed = false;

  public constructor(
    private readonly readinessCheck: (urlText: string, timeoutMs: number) => Promise<boolean> = localHttpReady
  ) {}

  public setEventSink(onEvent: (event: AgentUiEvent) => void): void {
    this.eventSink = onEvent;
  }

  public setSanitizer(sanitize: (value: string) => string): void {
    this.sanitize = sanitize;
  }

  public async start(spec: LocalProcessSpec): Promise<LocalProcessSnapshot> {
    if (this.disposed) throw new Error("The local process manager has been disposed.");
    this.pruneHistory(MAX_RETAINED_PROCESSES - 1);
    const running = [...this.processes.values()].filter((entry) => entry.state === "running");
    if (running.length >= MAX_PROCESSES) {
      throw new Error(`At most ${MAX_PROCESSES} managed local processes may run at once.`);
    }

    const id = crypto.randomUUID().slice(0, 12);
    const displayCommand = [spec.command, ...spec.args].map(shellDisplay).join(" ");
    const child = spawn(commandForPlatform(spec.command), spec.args, {
      cwd: spec.cwd,
      shell: false,
      windowsHide: true,
      detached: process.platform !== "win32",
      env: safeProcessEnvironment()
    });
    const entry: ManagedProcess = {
      id,
      spec,
      displayCommand,
      child,
      state: "running",
      startedAt: Date.now(),
      stdout: "",
      stderr: "",
      detectedUrls: new Set((spec.knownUrls ?? []).map((url) => safeUrl(normalizeLocalBrowserUrl(url))))
    };
    this.processes.set(id, entry);

    child.stdout?.on("data", (chunk) => this.appendOutput(entry, "stdout", chunk));
    child.stderr?.on("data", (chunk) => this.appendOutput(entry, "stderr", chunk));
    child.once("error", (error) => {
      entry.stderr = boundedAppend(entry.stderr, error.message);
    });
    child.once("close", (code, signal) => {
      entry.state = "exited";
      entry.exitCode = code ?? -1;
      entry.signal = signal ?? undefined;
      entry.stoppedAt = Date.now();
      this.eventSink({
        type: "activity",
        kind: "process",
        title: `${this.safeDisplay(entry.displayCommand)} · exited ${entry.exitCode}`,
        detail: this.safeDisplay(tail([entry.stdout, entry.stderr].filter(Boolean).join("\n"), 1_800))
      });
      try { entry.spec.onExit?.(); } catch { /* Process cleanup is best effort. */ }
      this.pruneHistory(MAX_RETAINED_PROCESSES);
    });

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, 250);
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once("spawn", () => {
        this.eventSink({
          type: "activity",
          kind: "process",
          title: `Started ${this.safeDisplay(displayCommand)}`
        });
      });
    }).catch((error) => {
      this.processes.delete(id);
      throw error;
    });
    return this.snapshot(entry);
  }

  public inspect(id?: string): LocalProcessSnapshot[] {
    const entries = id ? [this.required(id)] : [...this.processes.values()];
    return entries.map((entry) => this.snapshot(entry));
  }

  public async stop(id: string): Promise<LocalProcessSnapshot> {
    const entry = this.required(id);
    if (entry.state === "running") await terminateProcessTree(entry.child);
    return this.snapshot(entry);
  }

  public async restart(id: string): Promise<LocalProcessSnapshot> {
    const entry = this.required(id);
    const spec = entry.spec;
    if (entry.state === "running") await terminateProcessTree(entry.child);
    return this.start(spec);
  }

  public async waitForReady(
    id: string,
    urlInput: string | undefined,
    timeoutMs: number,
    signal: AbortSignal
  ): Promise<{ ready: boolean; url?: string; process: LocalProcessSnapshot; detail: string }> {
    const entry = this.required(id);
    const deadline = Date.now() + timeoutMs;
    let selectedUrl = urlInput ? normalizeLocalBrowserUrl(urlInput) : firstHttpUrl(entry.detectedUrls);
    while (Date.now() < deadline) {
      signal.throwIfAborted();
      if (entry.state !== "running") {
        return {
          ready: false,
          process: this.snapshot(entry),
          detail: `Process exited with code ${entry.exitCode ?? -1} before becoming ready.`
        };
      }
      selectedUrl = selectedUrl ?? firstHttpUrl(entry.detectedUrls);
      if (selectedUrl && await this.readinessCheck(selectedUrl, 1_500)) {
        this.eventSink({ type: "activity", kind: "process", title: `Ready · ${safeUrl(selectedUrl)}` });
        return { ready: true, url: safeUrl(selectedUrl), process: this.snapshot(entry), detail: "Local HTTP endpoint responded." };
      }
      await delay(300, signal);
    }
    return {
      ready: false,
      ...(selectedUrl ? { url: safeUrl(selectedUrl) } : {}),
      process: this.snapshot(entry),
      detail: selectedUrl
        ? "The local endpoint did not respond before the readiness timeout."
        : "No localhost URL was detected in process output; provide readiness_url explicitly."
    };
  }

  public async waitForExit(id: string, timeoutMs: number, signal: AbortSignal): Promise<LocalProcessSnapshot> {
    const entry = this.required(id);
    const deadline = Date.now() + timeoutMs;
    while (entry.state === "running" && Date.now() < deadline) {
      signal.throwIfAborted();
      await delay(100, signal);
    }
    if (entry.state === "running") throw new Error("The managed process did not exit before the timeout.");
    return this.snapshot(entry);
  }

  public dispose(): void {
    void this.shutdown();
  }

  public async shutdown(): Promise<void> {
    this.disposed = true;
    const running = [...this.processes.values()].filter((entry) => entry.state === "running");
    this.processes.clear();
    await Promise.allSettled(running.map((entry) => terminateProcessTree(entry.child)));
  }

  private appendOutput(entry: ManagedProcess, stream: "stdout" | "stderr", chunk: Buffer | string): void {
    const text = String(chunk);
    entry[stream] = boundedAppend(entry[stream], text);
    for (const url of detectLoopbackUrls(text)) {
      entry.detectedUrls.add(url);
      while (entry.detectedUrls.size > MAX_DISCOVERED_URLS) {
        const first = entry.detectedUrls.values().next().value as string | undefined;
        if (!first) break;
        entry.detectedUrls.delete(first);
      }
    }
  }

  private snapshot(entry: ManagedProcess): LocalProcessSnapshot {
    return {
      id: entry.id,
      command: this.safeDisplay(entry.displayCommand),
      cwd: path.basename(entry.spec.cwd) || ".",
      state: entry.state,
      ...(entry.child.pid ? { pid: entry.child.pid } : {}),
      ...(entry.exitCode !== undefined ? { exitCode: entry.exitCode } : {}),
      ...(entry.signal ? { signal: entry.signal } : {}),
      startedAt: entry.startedAt,
      ...(entry.stoppedAt ? { stoppedAt: entry.stoppedAt } : {}),
      detectedUrls: [...entry.detectedUrls].map(safeUrl),
      stdout: this.safeDisplay(tail(entry.stdout, 12_000)),
      stderr: this.safeDisplay(tail(entry.stderr, 12_000))
    };
  }

  private required(id: string): ManagedProcess {
    const entry = this.processes.get(id);
    if (!entry) throw new Error("The requested managed process is no longer available.");
    return entry;
  }

  private pruneHistory(targetSize: number): void {
    const exited = [...this.processes.values()]
      .filter((entry) => entry.state === "exited")
      .sort((left, right) => left.startedAt - right.startedAt);
    for (const entry of exited) {
      if (this.processes.size <= targetSize) break;
      this.processes.delete(entry.id);
    }
  }

  private safeDisplay(value: string): string {
    return this.sanitize(redactSensitiveText(value));
  }
}

export function detectLoopbackUrls(text: string): string[] {
  const urls = new Set<string>();
  for (const match of text.matchAll(/https?:\/\/(?:localhost|127(?:\.\d{1,3}){3}|\[::1\]|0\.0\.0\.0)(?::\d{1,5})?(?![:0-9])(?:\/[^\s"'<>]*)?/gi)) {
    try {
      urls.add(safeUrl(normalizeLocalBrowserUrl(match[0].replace(/[),.;]+$/, ""))));
    } catch {
      // Invalid or out-of-range ports are ignored.
    }
  }
  return [...urls];
}

function firstHttpUrl(urls: Set<string>): string | undefined {
  return [...urls].find((url) => url.startsWith("http://") || url.startsWith("https://"));
}

function safeUrl(value: string): string {
  const url = new URL(value);
  url.username = "";
  url.password = "";
  url.search = "";
  url.hash = "";
  if (url.hostname === "0.0.0.0") url.hostname = "127.0.0.1";
  return url.toString();
}

function localHttpReady(urlText: string, timeoutMs: number): Promise<boolean> {
  const url = new URL(normalizeLocalBrowserUrl(urlText));
  const request = url.protocol === "https:" ? https.request : http.request;
  return new Promise((resolve) => {
    const call = request(url, { method: "GET", timeout: timeoutMs }, (response) => {
      response.resume();
      resolve((response.statusCode ?? 0) > 0);
    });
    call.once("timeout", () => call.destroy());
    call.once("error", () => resolve(false));
    call.end();
  });
}

async function terminateProcessTree(child: ChildProcess): Promise<void> {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform === "win32") {
    await new Promise<void>((resolve) => {
      const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        windowsHide: true,
        shell: false,
        stdio: "ignore"
      });
      killer.once("error", () => {
        child.kill();
        resolve();
      });
      killer.once("close", () => resolve());
    });
    await Promise.race([
      new Promise<void>((resolve) => child.once("close", () => resolve())),
      new Promise<void>((resolve) => setTimeout(resolve, 1_500))
    ]);
    return;
  }
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
  await Promise.race([
    new Promise<void>((resolve) => child.once("close", () => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, 1_500))
  ]);
  if (child.exitCode === null) {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  }
}

function safeProcessEnvironment(): NodeJS.ProcessEnv {
  const allowed = [
    "HOME", "USER", "LOGNAME", "PATH", "SHELL", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL",
    "TERM", "COLORTERM", "SystemRoot", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "COMSPEC", "PATHEXT"
  ];
  return Object.fromEntries(allowed.flatMap((key) => process.env[key] ? [[key, process.env[key]]] : []));
}

function commandForPlatform(command: string): string {
  if (process.platform === "win32" && ["npm", "npx", "pnpm", "yarn"].includes(command)) {
    return `${command}.cmd`;
  }
  return command;
}

function shellDisplay(value: string): string {
  return /^[a-zA-Z0-9_./:=+-]+$/.test(value) ? value : JSON.stringify(value);
}

function boundedAppend(current: string, chunk: string): string {
  const combined = `${current}${chunk}`;
  return combined.length <= MAX_OUTPUT_CHARACTERS
    ? combined
    : `…[earlier output omitted]\n${combined.slice(-MAX_OUTPUT_CHARACTERS)}`;
}

function tail(value: string, maximum: number): string {
  return value.length <= maximum ? value : `…[earlier output omitted]\n${value.slice(-maximum)}`;
}

function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("Readiness wait was cancelled."));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
