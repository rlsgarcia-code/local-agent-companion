import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as path from "node:path";
import test from "node:test";
import { OLLAMA_CATALOG } from "../src/ollama-catalog";
import {
  mergeOllamaCandidates,
  OllamaRecommendationEngine,
  publicOllamaCatalogSchema,
  detectAcceleration,
  type MachineProfile
} from "../src/ollama-recommendation";
import { fetchPublicOllamaCatalog, OLLAMA_PUBLIC_CATALOG_URL } from "../src/ollama-public-catalog";

const machine: MachineProfile = {
  platform: "darwin",
  architecture: "arm64",
  totalMemoryGb: 32,
  availableDiskGb: 100,
  acceleration: "apple-metal",
  ollamaVersion: "0.4.0"
};

test("machine acceleration classification is cross-platform and anonymous", () => {
  assert.equal(detectAcceleration("darwin", "arm64"), "apple-metal");
  assert.equal(detectAcceleration("win32", "x64", "0"), "cuda");
  assert.equal(detectAcceleration("linux", "x64", "-1"), "cpu");
});

test("bundled, public and installed Ollama facts merge with local facts taking precedence", async () => {
  const catalog = publicOllamaCatalogSchema.parse(JSON.parse(await readFile(path.join(process.cwd(), "catalogs/ollama-models.json"), "utf8")));
  const candidates = mergeOllamaCandidates({
    bundled: OLLAMA_CATALOG,
    publicCatalog: catalog,
    installed: [{ name: "qwen3-coder:30b", size: 123, capabilities: ["tools", "vision"], contextLength: 999 }]
  });
  const installed = candidates.find((candidate) => candidate.alias === "qwen3-coder:30b");
  assert.equal(installed?.source, "installed");
  assert.equal(installed?.sizeBytes, 123);
  assert.equal(installed?.contextTokens, 999);
  assert.deepEqual(installed?.capabilities, ["tools", "vision"]);
  assert.ok(candidates.some((candidate) => candidate.alias === "deepseek-r1:14b"));
});

test("recommendation uses a declared baseline when no local advisor is usable", async () => {
  const candidates = mergeOllamaCandidates({ bundled: OLLAMA_CATALOG });
  const plan = await new OllamaRecommendationEngine().recommend({
    machine,
    candidates,
    supportedRoles: ["executor", "planner", "evaluator", "vision", "embedding"]
  });
  assert.equal(plan.source, "baseline");
  assert.ok(plan.roles.executor);
  assert.ok(plan.warnings.some((warning) => warning.includes("Estimativa")));
});

test("advisor selects only compatible catalog aliases and receives anonymous facts", async () => {
  const candidates = mergeOllamaCandidates({
    bundled: OLLAMA_CATALOG,
    installed: [{ name: "qwen3-coder:30b", size: 18_000_000_000, capabilities: ["tools", "coding"] }]
  });
  let prompt = "";
  const plan = await new OllamaRecommendationEngine().recommend({
    machine,
    candidates,
    supportedRoles: ["executor", "planner", "evaluator"],
    advisorModel: "qwen3-coder:30b",
    invokeAdvisor: async (value) => {
      prompt = value;
      return JSON.stringify({
        roles: { executor: "qwen3-coder:30b", planner: "deepseek-r1:14b", evaluator: "deepseek-r1:14b" },
        rationaleByRole: { executor: "Installed coding model.", planner: "Reasoning model.", evaluator: "Independent review." },
        warnings: []
      });
    }
  });
  assert.equal(plan.source, "advisor");
  assert.equal(plan.roles.planner, "deepseek-r1:14b");
  assert.doesNotMatch(prompt, /workspace|conversation|\/Users\//i);
});

test("invented advisor aliases fall back safely", async () => {
  const candidates = mergeOllamaCandidates({
    bundled: OLLAMA_CATALOG,
    installed: [{ name: "qwen3-coder:30b", capabilities: ["tools"] }]
  });
  const plan = await new OllamaRecommendationEngine().recommend({
    machine,
    candidates,
    supportedRoles: ["executor"],
    advisorModel: "qwen3-coder:30b",
    invokeAdvisor: async () => JSON.stringify({ roles: { executor: "invented:900b" }, rationaleByRole: {}, warnings: [] })
  });
  assert.equal(plan.source, "baseline");
  assert.ok(plan.warnings.some((warning) => warning.includes("não pôde ser validada")));
});

test("public catalog request is exact, no-cache and redirect-blocked", async () => {
  let request: { url: string; init?: RequestInit } | undefined;
  const payload = await readFile(path.join(process.cwd(), "catalogs/ollama-models.json"), "utf8");
  const catalog = await fetchPublicOllamaCatalog(async (input, init) => {
    request = { url: input.toString(), init };
    return new Response(payload, { status: 200, headers: { "content-type": "application/json" } });
  });
  assert.equal(request?.url, OLLAMA_PUBLIC_CATALOG_URL);
  assert.equal(new Headers(request?.init?.headers).get("cache-control"), "no-cache");
  assert.equal(request?.init?.redirect, "manual");
  assert.equal(catalog.version, 1);
  await assert.rejects(
    fetchPublicOllamaCatalog(async () => new Response("", { status: 302, headers: { location: "https://example.com" } })),
    /redirect/i
  );
  await assert.rejects(
    fetchPublicOllamaCatalog(async () => new Response("{}", { status: 200, headers: { "content-length": String(512 * 1024 + 1) } })),
    /512 KB/
  );
});
