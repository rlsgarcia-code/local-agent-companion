import assert from "node:assert/strict";
import test from "node:test";
import { generationProviderSelection, generationProviderSpec, generationServiceEnvironment } from "./game-generation-provider";
import { validateProvider } from "../packages/agent-core/src/provider-models";
import type { Registration } from "../packages/contracts/src/index";

test("generation provider selection is explicit, exclusive and preserves the fixed OpenAI route", () => {
  for (const args of [[], ["qwen3-coder:30b", "gpt-5-mini"], [undefined, "https://invalid.example"]])
    assert.throws(() => generationProviderSelection(...args));
  const openai = generationProviderSelection(undefined, "gpt-5-mini");
  const spec = generationProviderSpec(openai, { executor: openai.model, planner: openai.model, evaluator: openai.model });
  assert.equal(spec.endpoint, "https://api.openai.com/v1");assert.equal(spec.credentialRef, "generation-openai");
  assert.equal(validateProvider({ providers: ["openai"] } as Registration, spec).href, "https://api.openai.com/v1");
  assert.throws(() => validateProvider({ providers: ["ollama"] } as Registration, spec));
  assert.throws(() => validateProvider({ providers: ["openai"] } as Registration, { ...spec, endpoint: "http://127.0.0.1:1234/v1" }));
  const ollama = generationProviderSelection("qwen3-coder:30b");
  assert.deepEqual(generationProviderSpec(ollama, { executor: ollama.model }), { kind: "ollama", endpoint: "http://127.0.0.1:11434/v1", authHeader: "authorization", roles: { executor: "qwen3-coder:30b" } });
});

test("qualification strips the ephemeral credential from service/worker inheritance without persisting or mutating its host environment", () => {
  const environment = { PATH: "fixture-path", OPENAI_API_KEY: "PRIVATE_CREDENTIAL_FIXTURE", TASK: "non-secret" };
  const inherited = generationServiceEnvironment(environment);
  assert.deepEqual(inherited, { PATH: "fixture-path", TASK: "non-secret" });assert.equal(environment.OPENAI_API_KEY, "PRIVATE_CREDENTIAL_FIXTURE");
  assert.equal(JSON.stringify(generationProviderSpec(generationProviderSelection(undefined, "gpt-5-mini"), { executor: "gpt-5-mini" })).includes("PRIVATE_CREDENTIAL_FIXTURE"), false);
});
