import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_WEB_RESEARCH_CONFIGURATION, modelConfiguration } from "../packages/contracts/src/models";
import { createWebResearchTools, normalizeSearxngEndpoint, parseSearxngResults } from "../packages/agent-core/src/web-research";

test("web research stays disabled by default and migrates legacy model settings", () => {
  const parsed = modelConfiguration.parse({ revision: 0, roles: { executor: "qwen3.5:latest" } });
  assert.deepEqual(parsed.webResearch, DEFAULT_WEB_RESEARCH_CONFIGURATION);
});

test("provider-matched web research exposes one engine tool only after opt-in", () => {
  const signal = new AbortController().signal;
  assert.equal(createWebResearchTools({ provider: "ollama", settings: DEFAULT_WEB_RESEARCH_CONFIGURATION, signal }).length, 0);
  const settings = { ...DEFAULT_WEB_RESEARCH_CONFIGURATION, enabled: true };
  assert.equal(createWebResearchTools({ provider: "ollama", settings, signal })[0]?.name, "web_search");
  assert.equal((createWebResearchTools({ provider: "openai", settings, signal })[0] as { type?: string })?.type, "web_search");
  assert.equal(createWebResearchTools({ provider: "litellm", settings, signal }).length, 0);
});

test("SearXNG is loopback-only and returns bounded public sources", () => {
  assert.equal(normalizeSearxngEndpoint("http://localhost:8080/search"), "http://localhost:8080");
  assert.throws(() => normalizeSearxngEndpoint("https://example.com"), /loopback/);
  const results = parseSearxngResults({ results: [
    { title: "Evidence", url: "https://example.org/paper", content: "A useful abstract", engines: ["pubmed"] },
    { title: "Unsafe", url: "file:///etc/passwd", content: "ignore" },
  ] });
  assert.deepEqual(results, [{ title: "Evidence", url: "https://example.org/paper", snippet: "A useful abstract", engines: ["pubmed"] }]);
});
