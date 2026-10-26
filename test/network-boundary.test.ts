import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const sourceFiles = readdirSync("src")
  .filter((name) => name.endsWith(".ts"))
  .map((name) => `src/${name}`);
const sources = new Map(sourceFiles.map((file) => [file, readFileSync(file, "utf8")]));
const agent = sources.get("src/agent.ts") ?? "";
const semanticMemory = sources.get("src/semantic-memory.ts") ?? "";
const gateway = sources.get("src/gateway.ts") ?? "";
const chroma = sources.get("src/chroma.ts") ?? "";
const mcpCatalog = sources.get("src/mcp-catalog.ts") ?? "";
const processManager = sources.get("src/process-manager.ts") ?? "";

function count(source: string, pattern: RegExp): number {
  return [...source.matchAll(pattern)].length;
}

test("keeps direct source-level network calls inside the reviewed gateway and loopback boundaries", () => {
  const directNetworkCallFiles = [...sources]
    .filter(([, source]) => /\b(?:fetch|undiciFetch)\s*\(/.test(source))
    .map(([file]) => file)
    .sort();
  assert.deepEqual(directNetworkCallFiles, ["src/agent.ts", "src/chroma.ts", "src/mcp-catalog.ts"]);
  assert.equal(count(agent, /\bundiciFetch\s*\(/g), 1, "only the explicit model catalog may call undici directly");
  assert.match(chroma, /http:\/\/127\.0\.0\.1:/, "the remaining direct fetch must target local Chroma");
  assert.match(mcpCatalog, /https:\/\/registry\.modelcontextprotocol\.io\/v0\.1\/servers/,
    "the public MCP catalog must use the explicit official registry source");
  assert.match(processManager, /new URL\(normalizeLocalBrowserUrl\(urlText\)\)/,
    "managed-process readiness must validate loopback before using node:http");

  for (const [file, source] of sources) {
    if (file === "src/webview.ts") continue;
    const destinations = source.match(/https?:\/\/[^`"'\s]+/g) ?? [];
    const remoteDestinations = destinations.filter((destination) =>
      !destination.includes("${") &&
      !/^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(?::|\/|$)/.test(destination)
    );
    if (file === "src/model-provider.ts") {
      assert.deepEqual(remoteDestinations, ["https://api.openai.com/v1"],
        "the optional OpenAI variant may hard-code only the official fixed API base");
      continue;
    }
    if (file === "src/mcp-catalog.ts") {
      assert.deepEqual(remoteDestinations, ["https://registry.modelcontextprotocol.io/v0.1/servers?limit=100"],
        "the built-in public catalog must use only the official registry");
      continue;
    }
    assert.deepEqual(remoteDestinations, [], `${file} must not hard-code a remote network destination`);
  }
});

test("keeps browser automation local and approval-gated", () => {
  const browser = sources.get("src/browser.ts") ?? "";
  const browserPolicy = sources.get("src/browser-policy.ts") ?? "";
  const tools = sources.get("src/tools.ts") ?? "";

  assert.match(browserPolicy, /Browser access is restricted to credential-free http\(s\) loopback URLs/);
  assert.match(browserPolicy, /\["http:", "https:", "ws:", "wss:"\]/);
  assert.match(browser, /serviceWorkers: "block"/);
  assert.match(browser, /acceptDownloads: false/);
  assert.match(browser, /chromiumSandbox: true/);
  assert.match(browser, /openedPage\.close/);
  assert.match(agent, /sanitizeText: \(value\) => redactSensitiveText\(value, sensitiveValues\)/);
  assert.match(browser, /routeWebSocket/);
  assert.match(tools, /Allow the local agent to inspect and control this localhost application/);
  assert.match(browser, /does not fill password fields/);
  assert.match(agent, /UI completion gate:/);
  assert.match(agent, /state exactly what remains unverified/);
});

test("routes every LangChain model client through the exact-route gateway transport", () => {
  assert.equal(count(agent, /new ChatOpenAICompletions\s*\(/g), 4);
  assert.equal(count(agent, /new OpenAIEmbeddings\s*\(/g), 1);
  assert.equal(count(semanticMemory, /new OpenAIEmbeddings\s*\(/g), 1);

  assert.match(agent, /const chatFetch = gatewayFetch\(\s*chatCompletionsUrl\(connection\)/);
  assert.match(agent, /const embeddingFetch = gatewayFetch\(\s*embeddingsUrl\(embeddingConnection(?:, (?:embeddingModel|options\.embeddingModel))?(?:, Boolean\([^)]*\))?\)/);
  assert.match(agent, /fetch: chatFetch/);
  assert.match(agent, /fetch: embeddingFetch/);
  assert.match(agent, /fetch: gatewayFetch\(\s*chatCompletionsUrl\(connection\)/);
  assert.match(agent, /fetch: gatewayFetch\(\s*embeddingsUrl\(embeddingConnection(?:, embeddingModel)?(?:, Boolean\([^)]*\))?\)/);
  assert.match(semanticMemory, /options\.fetch \? \{ fetch: options\.fetch \} : \{\}/);
  assert.match(gateway, /validateGatewayRequest\(input, init, allowedUrl\)/);
  assert.match(gateway, /redirect: "manual"/);
  const mcpTransport = sources.get("src/mcp-transport.ts") ?? "";
  assert.match(mcpTransport, /validateMcpRequest\(input, init, allowedUrl\)/);
  assert.match(mcpTransport, /redirect: "manual"/);
  assert.match(mcpTransport, /target\.href !== allowed\.href/);
});

test("keeps hosted tracing explicitly disabled before agent execution", () => {
  for (const variable of [
    "LANGSMITH_TRACING",
    "LANGSMITH_TRACING_V2",
    "LANGCHAIN_TRACING_V2",
    "LANGSMITH_OTEL_ENABLED",
    "OTEL_ENABLED"
  ]) {
    assert.match(agent, new RegExp(`process\\.env\\.${variable} = "false"`));
  }
  assert.match(agent, /delete process\.env\.LANGCHAIN_TRACING/);
});
