import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import path from "node:path";

const required = [
  "sessions", "runs", "events", "approvals", "goals", "sqlite-checkpoints",
  "chunked-transfers", "durable-approvals", "bound-tool-receipts",
  "ollama-model-jobs", "model-assistance", "public-session-snapshots",
];

for (const name of ["COMPANION_ENGINE_BUNDLE", "COMPANION_SDK_DIR", "COMPANION_RELEASE_PUBLIC_KEY", "COMPANION_APP_PROFILE"])
  if (!process.env[name]) throw new Error(`${name} is required.`);

const require = createRequire(import.meta.url);
const sdk = path.resolve(process.env.COMPANION_SDK_DIR);
const { ensureEngine } = require(path.join(sdk, "typescript/client-ts/src/bootstrap.cjs"));
const client = await ensureEngine({
  bundleDirectory: path.resolve(process.env.COMPANION_ENGINE_BUNDLE),
  publicKey: await readFile(path.resolve(process.env.COMPANION_RELEASE_PUBLIC_KEY), "utf8"),
  product: "companion-app",
  profile: process.env.COMPANION_APP_PROFILE,
  workspace: process.env.COMPANION_APP_WORKSPACE ? path.resolve(process.env.COMPANION_APP_WORKSPACE) : "",
  providers: ["ollama", "openai"],
  hostTools: [],
  activation: "idle",
});

try {
  const info = await client.engineInfo();
  const missing = required.filter((name) => !info.capabilities.includes(name));
  if (missing.length) throw new Error(`Companion is missing required capabilities: ${missing.join(", ")}`);
  process.stdout.write(`${JSON.stringify({ ready: true, version: info.version, protocol: info.protocol, product: info.product })}\n`);
} finally {
  client.close();
}
