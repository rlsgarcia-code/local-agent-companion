import {createAudioCodecProcessor} from "../../adapter-game-audio-codec/src/index";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import * as path from "node:path";
import { ENGINE_VERSION, NODE_VERSION } from "../../contracts/src/index";
import {
  defaultStateDirectory,
  ensureIdentity,
  privateDirectory,
} from "./security";
import { Store } from "./store";
import { systemAdapter } from "./installed-adapter";
import { AgentService } from "./service";
import { LocalServer, loadProvisionedClients } from "./server";
import { createWebGameAdapters } from "../../adapter-game-web/src/index";
import { createBrowserGameCollector } from "../../adapter-game-browser/src/index";
import { createGodotGameAdapter } from "../../adapter-game-godot/src/index";
import { createLocalGameAssetProcessor } from "../../adapter-game-assets/src/index";
import { createBlenderAssetProcessor } from "../../adapter-game-blender/src/index";
import {createGameLibraryProcessor} from "../../adapter-game-library/src/index";
import { readOwnerInferenceLimits } from "./inference-limits";
import { readOwnerContextWorkingBudget } from './context-working-budget';

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
  const inferenceBudgetPolicy = await readOwnerInferenceLimits(directory);
  const contextWorkingBudget = await readOwnerContextWorkingBudget(directory);
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
    filesystem: { fileFlushRequired: true, directoryFlush: process.platform === "win32" ? "unsupported" : "required" },
    manifestSha256: createHash("sha256").update(rawManifest).digest("hex"),
  };
  const resourceDirectory = path.dirname(process.argv[1]!);
  const service = new AgentService(store, directory, undefined, build, { deferRecovery: true, adapter: await systemAdapter({version:ENGINE_VERSION,...build}), resourceDirectory, inferenceBudgetPolicy, contextWorkingBudget,
    gameAdapters: [...createWebGameAdapters(path.join(resourceDirectory, "game-runtimes"), build.manifestSha256), await createGodotGameAdapter({
      stateDirectory: directory, implementationSha256: build.manifestSha256,
      driverSha256: createHash("sha256").update(await readFile(path.join(resourceDirectory, "game-editors/godot/build.mjs"))).digest("hex"),
    })],
    gameAssetProcessors:[createLocalGameAssetProcessor({workerPath:path.join(resourceDirectory,"game-assets-worker.cjs"),rasterizerPath:path.join(resourceDirectory,"game-codecs/resvg.wasm"),implementationSha256:build.manifestSha256}),
      await createGameLibraryProcessor({directory:path.join(resourceDirectory,"game-libraries"),implementationSha256:build.manifestSha256}),
      await createAudioCodecProcessor({stateDirectory:directory,implementationSha256:build.manifestSha256,driverSha256:createHash("sha256").update(await readFile(path.join(resourceDirectory,"game-editors/audio-codec/process.py"))).digest("hex")}),
      await createBlenderAssetProcessor({stateDirectory:directory,implementationSha256:build.manifestSha256,driverSha256:createHash("sha256").update(await readFile(path.join(resourceDirectory,"game-editors/blender/process.py"))).digest("hex")})],
    gameCollectors: [await createBrowserGameCollector({ stateDirectory: directory, workerPath: path.join(resourceDirectory, "game-browser-worker.cjs"), implementationSha256: build.manifestSha256 })] }),
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
