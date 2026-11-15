import { createHash, randomBytes, verify } from "node:crypto";
import { createReadStream } from "node:fs";
import { spawn, execFile } from "node:child_process";
import { createConnection } from "node:net";
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  unlink,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import * as path from "node:path";
import { AgentClient } from "./index";
import { prepareInstallation, assertSafeActivation } from "./installation";
import { withBootstrapLock } from "./bootstrap-lock";
import { canonical } from "../../contracts/src/identity";
import {
  NODE_VERSION,
  ENGINE_VERSION,
  PROTOCOL_VERSION,
  MAX_FRAME_BYTES,
  AgentError,
  type ClientCredential,
  type EngineUpdateBlockers,
  type Product,
  type ProviderSpec,
  type ToolSpec,
} from "../../contracts/src/index";
export { COMPANION_RELEASE_PUBLIC_KEY } from "./release-key";

export function engineStateDirectory(): string {
  return process.platform === "win32"
    ? path.join(process.env.LOCALAPPDATA || homedir(), "Companion", "engine")
    : path.join(homedir(), ".local", "state", "companion-engine");
}
export function engineAddress(directory: string): string {
  const hash = createHash("sha256")
    .update(path.resolve(directory))
    .digest("hex")
    .slice(0, 24);
  return process.platform === "win32"
    ? `\\\\.\\pipe\\companion-${hash}`
    : path.join(
        directory.length < 65
          ? directory
          : path.join(
              tmpdir(),
              `companion-${process.getuid?.() ?? "user"}-${hash}`,
            ),
        "agent.sock",
      );
}
type BootstrapOptions = {
  bundleDirectory: string;
  product: Product;
  profile: string;
  workspace: string;
  providers: ProviderSpec["kind"][];
  hostTools: string[];
  toolCatalog?: ToolSpec[];
  stateDirectory?: string;
  development?: boolean;
  publicKey?: string;
  activation?: "idle" | "stop-managed";
};
export class PreparedEngineUpdateError extends Error {
  readonly name = "PreparedEngineUpdateError";
  constructor(
    readonly installedVersion: string,
    readonly requestedVersion: string,
    readonly reason: string,
    readonly blockers?: EngineUpdateBlockers,
  ) {
    super(`Companion engine ${requestedVersion} is ready, but engine ${installedVersion} is still active. ${reason}`);
  }
}
export async function verifyBundle(
  directory: string,
  publicKey?: string,
  development = false,
  expectedTarget = `${process.platform}-${process.arch}`,
): Promise<void> {
  const raw = await readFile(path.join(directory, "manifest.json"));
  const manifest = JSON.parse(raw.toString()) as {
    node: string;
    version: string;
    protocol: string;
    target: string;
    files: Record<string, string>;
    development?: boolean;
  };
  if (manifest.node !== NODE_VERSION)
    throw new Error("Engine runtime does not match the required Node version.");
  if (
    manifest.version !== ENGINE_VERSION ||
    manifest.protocol !== PROTOCOL_VERSION ||
    manifest.target !== expectedTarget
  )
    throw new Error(
      "Engine release version, protocol or platform does not match this product.",
    );
  if (publicKey) {
    const signature = await readFile(path.join(directory, "manifest.sig"));
    if (!verify(null, raw, publicKey, signature))
      throw new Error("Engine release signature is invalid.");
  } else if (!development || !manifest.development)
    throw new Error("A trusted release signing key is required.");
  const required = [
    "service.cjs",
    "bootstrap-lock.cjs",
    process.platform === "win32" ? "node.exe" : "node",
  ];
  if (required.some((name) => !manifest.files[name]))
    throw new Error(
      "Engine manifest does not cover the executable entry points.",
    );
  const declared = new Set([
    ...Object.keys(manifest.files),
    "manifest.json",
    ...(publicKey ? ["manifest.sig"] : []),
  ]);
  async function inspect(folder: string): Promise<void> {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const file = path.join(folder, entry.name);
      if (entry.isSymbolicLink())
        throw new Error("Engine bundle contains a symbolic link.");
      if (entry.isDirectory()) await inspect(file);
      else if (
        !entry.isFile() ||
        !declared.has(path.relative(directory, file).split(path.sep).join("/"))
      )
        throw new Error("Engine bundle contains an undeclared entry.");
    }
  }
  await inspect(directory);
  for (const [name, digest] of Object.entries(manifest.files)) {
    if (
      !name ||
      path.isAbsolute(name) ||
      name.split(/[\\/]/).some((p) => p === ".." || p === "." || !p)
    )
      throw new Error("Unsafe engine manifest path.");
    const target = path.join(directory, name),
      info = await lstat(target);
    if (!info.isFile() || info.isSymbolicLink())
      throw new Error("Invalid engine artifact entry.");
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(target)) hash.update(chunk);
    if (hash.digest("hex") !== digest)
      throw new Error(`Engine artifact failed integrity verification: ${name}`);
  }
}
function xml(value: string): string {
  return value.replace(
    /[<>&"']/g,
    (c) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        '"': "&quot;",
        "'": "&apos;",
      })[c]!,
  );
}
function execute(file: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => execFile(file, args, { windowsHide: true }, (error) => error ? reject(error) : resolve()));
}
async function engineIsLive(address: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const socket = createConnection(address);
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("error", () => resolve(false));
    socket.setTimeout(1000, () => { socket.destroy(); resolve(false); });
  });
}
async function stopLegacyEngineService(directory: string, address: string): Promise<void> {
  if (process.platform === "darwin") {
    await execute("/bin/launchctl", ["bootout", `gui/${process.getuid!()}/dev.localagent.engine`]);
  } else if (process.platform === "linux") {
    await execute("systemctl", ["--user", "stop", "companion-engine.service"]);
  } else {
    const runtimeFile = path.join(directory, "runtime.json"), info = await lstat(runtimeFile);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 4096 || (process.getuid && info.uid !== process.getuid()))
      throw new Error("Unsafe engine runtime metadata; restart the operating system before activating the update.");
    const runtime = JSON.parse(await readFile(runtimeFile, "utf8")) as { pid?: unknown };
    if (!Number.isInteger(runtime.pid) || Number(runtime.pid) <= 1)
      throw new Error("Invalid engine process identity; restart Windows before activating the update.");
    await execute("taskkill", ["/PID", String(runtime.pid), "/T", "/F"]);
  }
  for (let attempt = 0; attempt < 100; attempt++) {
    if (!await engineIsLive(address)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("The previous engine did not stop. Close other Companion clients and try again.");
}
export async function ensureEngine(
  options: BootstrapOptions,
): Promise<AgentClient> {
  const directory = options.stateDirectory || engineStateDirectory();
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || process.getuid && info.uid !== process.getuid()) throw new Error("Unsafe engine state directory.");
  const prepared = await prepareInstallation(options.bundleDirectory, directory, (folder) =>
    verifyBundle(folder, options.publicKey, options.development));
  return withBootstrapLock({
    executable: path.join(prepared.directory, process.platform === "win32" ? "node.exe" : "node"),
    script: path.join(prepared.directory, "bootstrap-lock.cjs"),
  }, directory, () => ensureEngineLocked(options, prepared));
}
async function ensureEngineLocked(options: BootstrapOptions, prepared: Awaited<ReturnType<typeof prepareInstallation>>): Promise<AgentClient> {
  const directory = options.stateDirectory || engineStateDirectory();
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await lstat(directory);
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    (process.getuid && info.uid !== process.getuid())
  )
    throw new Error("Unsafe engine state directory.");
  if (process.platform !== "win32") await chmod(directory, 0o700);
  const workspace = options.workspace ? await realpath(options.workspace) : "";
  const catalog = options.toolCatalog?.length ? options.toolCatalog : undefined;
  if (options.hostTools.length && !catalog)
    throw new Error("The installed host adapter must provide its exact authorized tool catalog.");
  const key = createHash("sha256")
    .update(JSON.stringify([options.product, options.profile, workspace, options.providers, catalog ?? options.hostTools]))
    .digest("hex");
  const clients = path.join(directory, "clients");
  await mkdir(clients, { recursive: true, mode: 0o700 });
  const clientsInfo = await lstat(clients);
  if (!clientsInfo.isDirectory() || clientsInfo.isSymbolicLink() || (process.getuid && clientsInfo.uid !== process.getuid()))
    throw new Error("Unsafe engine credential directory.");
  if (process.platform !== "win32") await chmod(clients, 0o700);
  const file = path.join(clients, `${key}.json`);
  const expected: ClientCredential["registration"] = {
    id: key, product: options.product, profile: options.profile, workspace, providers: options.providers,
    hostTools: options.hostTools, ...(catalog ? { toolCatalog: catalog } : {}),
  };
  let credential: ClientCredential;
  try {
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_FRAME_BYTES ||
        (process.getuid && info.uid !== process.getuid()) || (process.platform !== "win32" && (info.mode & 0o077) !== 0))
      throw new Error("Unsafe product credential file. Repair the trusted enrollment.");
    credential = JSON.parse(await readFile(file, "utf8")) as ClientCredential;
    if (canonical(credential.registration) !== canonical(expected) || typeof credential.token !== "string" || !/^[A-Za-z0-9_-]{40,256}$/.test(credential.token))
      throw new Error("Saved credentials do not match this product, profile, workspace and adapter.");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    credential = {
      registration: expected,
      token: randomBytes(32).toString("base64url"),
    };
    const encoded = JSON.stringify(credential);
    if (Buffer.byteLength(encoded) > MAX_FRAME_BYTES) throw new Error("Installed adapter catalog exceeds its enrollment limit.");
    await writeFile(file, encoded, {
      mode: 0o600,
      flag: "wx",
    });
  }
  const address = engineAddress(directory);
  const live = await engineIsLive(address);
  if (!live) {
    await verifyBundle(
      prepared.directory,
      options.publicKey,
      options.development,
    );
    if (process.platform !== "win32") {
      try {
        const stat = await lstat(address);
        if (
          !stat.isSocket() ||
          (process.getuid && stat.uid !== process.getuid())
        )
          throw new Error("Unsafe stale engine socket.");
        await unlink(address);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    const node = path.join(
        prepared.directory,
        process.platform === "win32" ? "node.exe" : "node",
      ),
      entry = path.join(prepared.directory, "service.cjs");
    const args = [entry, directory];
    if (process.platform === "darwin") {
      const agents = path.join(homedir(), "Library", "LaunchAgents");
      await mkdir(agents, { recursive: true });
      const plist = path.join(agents, "dev.localagent.engine.plist"),
        label = "dev.localagent.engine";
      const definition = `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>${label}</string><key>ProgramArguments</key><array>${[node, ...args].map((a) => `<string>${xml(a)}</string>`).join("")}</array><key>RunAtLoad</key><true/><key>LimitLoadToSessionType</key><string>Aqua</string><key>ProcessType</key><string>Interactive</string></dict></plist>`;
      await new Promise<void>((resolve) => execFile("/bin/launchctl", ["bootout", `gui/${process.getuid!()}/${label}`], () => resolve()));
      await writeFile(plist, definition, { mode: 0o600 });
      await new Promise<void>((resolve, reject) =>
        execFile(
          "/bin/launchctl",
          ["bootstrap", `gui/${process.getuid!()}`, plist],
          (error) =>
            error
              ? reject(
                  new Error("Cannot register the local engine LaunchAgent."),
                )
              : resolve(),
        ),
      );
    } else if (process.platform === "linux") {
      const units = path.join(homedir(), ".config", "systemd", "user");
      await mkdir(units, { recursive: true });
      const quote = (s: string) =>
        '"' +
        s.replace(/[%\\"\n\r]/g, (c) =>
          c === "%" ? "%%" : c === "\n" ? "\\n" : c === "\r" ? "\\r" : "\\" + c,
        ) +
        '"';
      await writeFile(
        path.join(units, "companion-engine.service"),
        `[Unit]\nDescription=Companion local intelligence engine\n[Service]\nExecStart=${[node, ...args].map(quote).join(" ")}\nUMask=0077\n[Install]\nWantedBy=default.target\n`,
        { mode: 0o600 },
      );
      for (const cmd of [
        ["--user", "daemon-reload"],
        ["--user", "start", "companion-engine.service"],
      ])
        await new Promise<void>((resolve, reject) =>
          execFile("systemctl", cmd, (error) =>
            error
              ? reject(new Error("Cannot start the per-user engine service."))
              : resolve(),
          ),
        );
    } else {
      const child = spawn(node, args, {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
      });
      child.unref();
    }
  }
  let failure: unknown;
  for (let attempt = 0; attempt < 40; attempt++) {
    let client: AgentClient | undefined;
    try {
      client = new AgentClient({
        address,
        certificate: await readFile(path.join(directory, "server.crt"), "utf8"),
        credential,
      });
      await client.connect();
      const info = await client.call<{ version: string; build?: { manifestSha256?: string } }>("engine.info");
      if (info.version !== ENGINE_VERSION || info.build?.manifestSha256 !== prepared.manifestSha256)
      {
        assertSafeActivation(info.version, ENGINE_VERSION, options.development);
        await writeFile(path.join(directory, "prepared-update.json"), JSON.stringify({
          directory: prepared.directory, manifestSha256: prepared.manifestSha256,
          version: ENGINE_VERSION, previous: info.build, preparedAt: Date.now(),
        }), { mode: 0o600 });
        const activation = await client.call<{ accepted: boolean; reason?: string; blockers?: EngineUpdateBlockers }>("engine.shutdownIfIdle");
        if (activation.accepted) {
          for (let wait = 0; wait < 100 && client.connected; wait++)
            await new Promise((resolve) => setTimeout(resolve, 50));
          if (!client.connected) return ensureEngineLocked(options, prepared);
        }
        if (options.activation === "stop-managed") {
          try {
            const stopped = await client.call<{ accepted: boolean; reason?: string; blockers?: EngineUpdateBlockers }>("engine.stopManagedResourcesForUpdate");
            if (!stopped.accepted)
              throw new PreparedEngineUpdateError(info.version, ENGINE_VERSION, stopped.reason ?? "Active work is protected from interruption.", stopped.blockers);
            for (let wait = 0; wait < 100 && client.connected; wait++)
              await new Promise((resolve) => setTimeout(resolve, 50));
            if (!client.connected) return ensureEngineLocked(options, prepared);
            throw new Error("The engine accepted the update but did not stop. Try again after closing other clients.");
          } catch (error) {
            if (!(error instanceof AgentError) || error.code !== -32601) throw error;
            client.close();
            await stopLegacyEngineService(directory, address);
            return ensureEngineLocked(options, prepared);
          }
        }
        throw new PreparedEngineUpdateError(info.version, ENGINE_VERSION,
          activation.reason ?? "Finish active work before activating the prepared update.", activation.blockers);
      }
      return client;
    } catch (error) {
      client?.close();
      if (error instanceof PreparedEngineUpdateError) throw error;
      failure = error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw failure instanceof Error
    ? failure
    : new Error(
        "Local intelligence service is unavailable. Repair the engine installation and reconnect.",
      );
}
