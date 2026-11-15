// Qualification-client configuration only. No model invocation or new executor.
import assert from "node:assert/strict";
import type { ProviderSpec } from "../packages/contracts/src/index";

export function generationProviderSelection(ollamaModel?: string, openaiModel?: string) {
  assert.ok(Boolean(ollamaModel) !== Boolean(openaiModel), "Select exactly one explicit --ollama-model or --openai-model; no provider fallback.");
  const kind = openaiModel ? "openai" as const : "ollama" as const;
  const model = openaiModel ?? ollamaModel!;
  assert.match(model, /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/, "Invalid explicit model alias.");
  assert.ok(!model.includes("://"), "Choose a model alias, never a provider URL.");
  return { kind, model, endpoint: kind === "openai" ? "https://api.openai.com/v1" : "http://127.0.0.1:11434/v1" };
}

export function generationProviderSpec(selection: ReturnType<typeof generationProviderSelection>, roles: ProviderSpec["roles"], modelProfiles?: ProviderSpec["modelProfiles"]): ProviderSpec {
  return { kind: selection.kind, endpoint: selection.endpoint, authHeader: "authorization", roles, ...(modelProfiles ? { modelProfiles } : {}),
    ...(selection.kind === "openai" ? { credentialRef: "generation-openai" } : {}) };
}

export function generationServiceEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  // The provider credential is explicitly leased over authenticated IPC. Never
  // inherit it into the packaged service or its production worker descendants.
  const { OPENAI_API_KEY: _credential, ...result } = environment;
  return result;
}
