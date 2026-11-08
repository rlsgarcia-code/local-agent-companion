import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import * as path from "node:path";
import { NODE_VERSION } from "../../contracts/src/index";
import {
  defaultStateDirectory,
  ensureIdentity,
  privateDirectory,
} from "./security";
import { Store } from "./store";
import { systemAdapter } from "./installed-adapter";
import { AgentService } from "./service";
import { LocalServer, loadProvisionedClients } from "./server";

async function main(): Promise<void> {
  for (const name of [
    "LANGSMITH_TRACING",
    "LANGSMITH_TRACING_V2",
    "LANGCHAIN_TRACING_V2",
    "LANGSMITH_OTEL_ENABLED",
    "OTEL_ENABLED",
  ])
    process.env[name] = "false";
  delete process.env.LANGCHAIN_TRACING;
  if (
    process.versions.node !== NODE_VERSION &&
    process.env.COMPANION_ENGINE_TEST_RUNTIME !== "1"
  )
    throw new Error(`This engine requires bundled Node ${NODE_VERSION}.`);
  const directory = process.argv[2] || defaultStateDirectory();
  await privateDirectory(directory);
  await ensureIdentity(directory);
  const store = new Store(path.join(directory, "metadata.sqlite"));
  await loadProvisionedClients(store, directory);
  const rawManifest = await readFile(
    path.join(path.dirname(process.argv[1]!), "manifest.json"),
  );
  const manifest = JSON.parse(rawManifest.toString()) as {
    commit?: string;
    target?: string;
  };
  const build = {
    commit: manifest.commit,
    target: manifest.target,
    manifestSha256: createHash("sha256").update(rawManifest).digest("hex"),
  };
  const service = new AgentService(store, directory, undefined, build, { deferRecovery: true, adapter: await systemAdapter(), resourceDirectory: path.dirname(process.argv[1]!) }),
    server = new LocalServer(service, directory);
  await server.listen();
  // Refresh bootstrap registrations without exposing a provisioning RPC.
  const timer = setInterval(() => {
    void loadProvisionedClients(store, directory).catch(() => {});
  }, 2000);
  timer.unref();
  await writeFile(
    path.join(directory, "runtime.json"),
    JSON.stringify({
      pid: process.pid,
      node: process.versions.node,
      startedAt: Date.now(),
      build,
    }),
    { mode: 0o600 },
  );
  for (const signal of ["SIGTERM", "SIGINT"] as const)
    process.once(signal, () => {
      clearInterval(timer);
      void server.close().finally(() => process.exit(0));
    });
}
void main().catch(() => {
  console.error(
    "Companion engine failed to start. Verify the bundled runtime, private state directory and local endpoint.",
  );
  process.exitCode = 1;
});
