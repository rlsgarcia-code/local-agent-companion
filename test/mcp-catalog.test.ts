import assert from "node:assert/strict";
import test from "node:test";
import { defaultMcpCatalogSources, searchMcpCatalog } from "../src/mcp-catalog";

test("keeps the public MCP registry opt-in", () => {
  assert.equal(defaultMcpCatalogSources[0]?.enabled, false);
  assert.match(defaultMcpCatalogSources[0]?.url ?? "", /registry\.modelcontextprotocol\.io\/v0\.1\/servers/);
});

test("ranks catalog entries from a natural-language query without connecting to them", () => {
  const entries = searchMcpCatalog([
    { id: "1", name: "io.github/issues", title: "GitHub Issues", description: "Read issues and pull requests", sourceId: "official", sourceName: "Official", updatedAt: 1 },
    { id: "2", name: "docs/search", title: "Technical Docs", description: "Search API documentation", sourceId: "official", sourceName: "Official", updatedAt: 1 }
  ], "I need read-only access to GitHub issues");
  assert.equal(entries[0]?.id, "1");
});
