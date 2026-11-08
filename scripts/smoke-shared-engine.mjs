import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { createRequire } from "node:module";

// Explicit opt-in only. CI uses simulated inference and never invokes this smoke.
const model = process.argv.find((value) => value.startsWith("--ollama-model="))?.slice("--ollama-model=".length);
if (!model || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(model))
  throw new Error("Pass the exact already-configured model with --ollama-model=<name>.");
const require = createRequire(import.meta.url);
const { AgentClient } = require(path.resolve("release/sdk/typescript/client-ts/src/index.cjs"));
const { verifyBundle } = require(path.resolve("release/sdk/typescript/client-ts/src/bootstrap.cjs"));
const selectedBundle = process.argv.find((value) => value.startsWith("--bundle-dir="))?.slice("--bundle-dir=".length);
const bundle = path.resolve(selectedBundle || "engine-dist");
await verifyBundle(bundle, selectedBundle ? await readFile("release-keys/companion-ed25519.pub", "utf8") : undefined, !selectedBundle);
const directory = await mkdtemp(path.join(tmpdir(), "companion-read-only-"));
const id = createHash("sha256").update(directory).digest("hex");
const credential = { registration: { id, product: "companion-mac", profile: "read-only-smoke", workspace: "", providers: ["ollama"], hostTools: [] }, token: randomBytes(32).toString("base64url") };
await mkdir(path.join(directory, "clients"), { mode: 0o700 });
await writeFile(path.join(directory, "clients", `${id}.json`), JSON.stringify(credential), { mode: 0o600 });
const hash = createHash("sha256").update(path.resolve(directory)).digest("hex").slice(0, 24);
const address = process.platform === "win32" ? `\\\\.\\pipe\\companion-${hash}` : path.join(directory.length < 65 ? directory : path.join(tmpdir(), `companion-${process.getuid()}-${hash}`), "agent.sock");
const child = spawn(path.join(bundle, process.platform === "win32" ? "node.exe" : "node"), [path.join(bundle, "service.cjs"), directory], { stdio: "ignore", windowsHide: true });
const stopped = new Promise((resolve) => child.once("exit", resolve));
let client;
try {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      client = new AgentClient({ address, certificate: await readFile(path.join(directory, "server.crt"), "utf8"), credential });
      await client.connect();
      break;
    } catch (error) {
      client?.close();
      if (attempt === 99 || child.exitCode !== null) throw error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  const engine = await client.call("engine.info");
  const results = [];
  for (const runtime of ["standard", "deep"]) {
    const session = await client.call("sessions.create", { title: "Read-only engine acceptance smoke" });
    const run = await client.startRun(session.id, `read-only-${runtime}`, {
      runtime, mode: "plan", provider: { kind: "ollama", endpoint: "http://127.0.0.1:11434/v1", roles: { executor: model } },
      messages: [{ role: "user", content: "Responda somente MOTOR_OK. Não use ferramentas, não leia arquivos e não faça alterações." }],
      systemPrompt: "This is an explicit read-only installation check. Answer the user's tiny request without using tools.",
      tools: [], recursionLimit: 30,
    });
    const result = await client.waitForRun(run.id, session.id, () => {}, undefined, AbortSignal.timeout(180_000));
    if (result.state !== "completed" || !String(result.result?.text).includes("MOTOR_OK"))
      throw new Error(`Read-only ${runtime} smoke did not complete with the expected response: ${result.state}`);
    results.push({ runtime, state: result.state, response: result.result.text.slice(0, 200) });
  }
  console.log(JSON.stringify({ version: engine.version, protocol: engine.protocol, node: engine.node, build: engine.build, model, results }));
} finally {
  client?.close();
  child.kill("SIGTERM");
  const timer = setTimeout(() => child.kill("SIGKILL"), 10_000);
  await stopped;
  clearTimeout(timer);
  await rm(directory, { recursive: true, force: true });
  if (process.platform !== "win32") await rm(path.dirname(address) === directory ? directory : path.dirname(address), { recursive: true, force: true });
}
