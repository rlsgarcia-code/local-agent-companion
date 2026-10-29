import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("src/extension.ts", "utf8");

test("routes the command palette to the single guided LiteLLM form", () => {
  assert.match(
    source,
    /registerCommand\("localAgentCompanion\.configureLiteLlm", async \(\) => \{\s+await provider\.openConnectionSettings\(\);\s+\}\)/
  );
  assert.doesNotMatch(source, /LiteLLM setup \([1-8]\/8\)/);
  assert.doesNotMatch(source, /normalizeLiteLlmEndpoint/);
  assert.doesNotMatch(source, /updateLiteLlmModelProfile/);
});

test("keeps browser access behind the explicit guided command", () => {
  assert.match(source, /registerCommand\("localAgentCompanion\.configureBrowserAccess"/);
  assert.match(source, /showQuickPick/);
});
