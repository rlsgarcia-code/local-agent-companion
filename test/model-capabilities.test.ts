import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { modelCapabilityDeclaration, providerSpec, type ModelCapabilityDeclaration } from "../packages/contracts/src/index";
import { parseLiteLlmModelProfiles, updateLiteLlmModelProfile, resolveLiteLlmModelApi, validateLiteLlmModelProfile } from "../src/litellm";
import { createConnectionProfile, parseConnectionProfile, serializeConnectionProfile } from "../src/connection-profile";
import { parseIncomingMessage } from "../src/webview-protocol";
import { assistModel } from "../packages/agent-core/src/model-assistance";
import { ProviderModels } from "../packages/agent-core/src/provider-models";

const features: ModelCapabilityDeclaration = {
  functionCalling: true, vision: true, jsonMode: true, toolChoice: true,
  parallelCalls: true, promptCaching: true, reasoning: true, pdfInput: true,
};

test("exact user aliases and declarations override catalog and family restrictions", () => {
  for (const alias of ["gpt-5.4", "Corp/Unknown-EXACT", "gpt-6-astra"]) {
    const profile = { capabilities: features, preset: "gpt-6-responses-tools" as const };
    assert.equal(resolveLiteLlmModelApi(alias, profile), "chat_completions");
    assert.doesNotThrow(() => validateLiteLlmModelProfile(alias, profile, true));
    assert.equal(resolveLiteLlmModelApi(alias, { ...profile, api: "responses" }), "responses");
  }
  assert.doesNotThrow(() => validateLiteLlmModelProfile("unknown", {}, true));
  assert.equal(resolveLiteLlmModelApi("claude-sonnet-5", {}), "chat_completions");
  assert.equal(resolveLiteLlmModelApi("unknown", {}, "https://gateway.invalid/v1/responses"), "responses");
});

test("declarations require eight booleans and cannot include authority or arbitrary options", () => {
  assert.equal(modelCapabilityDeclaration.safeParse(features).success, true);
  for (const candidate of [{ ...features, vision: "true" }, { ...features, tools: ["shell"] }, { ...features, endpoint: "https://other.invalid" }]) {
    assert.equal(modelCapabilityDeclaration.safeParse(candidate).success, false);
  }
  const { pdfInput, ...incomplete } = features;
  assert.equal(modelCapabilityDeclaration.safeParse(incomplete).success, false);
  assert.deepEqual(parseLiteLlmModelProfiles({ broken: { capabilities: incomplete } }), {});
});

test("agent tools and reasoning need explicit features, while a vision-only role is allowed", () => {
  const noTools = { capabilities: { ...features, functionCalling: false } };
  assert.throws(() => validateLiteLlmModelProfile("gpt-5.4", noTools, true), /Function calling/);
  assert.doesNotThrow(() => validateLiteLlmModelProfile("vision-only", noTools, true, false));
  assert.throws(() => validateLiteLlmModelProfile("gpt-5.4", {
    capabilities: { ...features, reasoning: false }, reasoningEffort: "low",
  }), /Reasoning is not declared/);
  assert.throws(() => validateLiteLlmModelProfile("gpt-5.4", {
    capabilities: features, temperature: 0.5, topP: 0.9,
  }), /not both/);
});

test("per-alias declarations roundtrip through preferences, portable profiles and the service contract", () => {
  const profiles = updateLiteLlmModelProfile({}, "gpt-5.4", { capabilities: features });
  profiles["Another-EXACT"] = { api: "responses", capabilities: { ...features, pdfInput: false } };
  assert.deepEqual(parseLiteLlmModelProfiles(profiles), profiles);
  const profile = createConnectionProfile({
    gateway: { endpoint: "https://gateway.invalid/v1", modelsEndpoint: "", authHeader: "api-key", requiresKey: true, requiresCorporateCa: false },
    models: { chat: "gpt-5.4", embedding: "", semanticMemoryEnabled: false, profiles },
    workspace: { runtime: "deep", autonomyMode: "review" },
  });
  assert.deepEqual(parseConnectionProfile(JSON.parse(serializeConnectionProfile(profile))).models.profiles, profiles);
  assert.deepEqual(providerSpec.parse({ kind: "litellm", endpoint: "https://gateway.invalid/v1", roles: { executor: "gpt-5.4" }, profile: profiles["gpt-5.4"], modelProfiles: profiles }).modelProfiles, profiles);
  assert.throws(() => parseConnectionProfile({ ...profile, models: { ...profile.models, profiles: { "gpt-5.4": { capabilities: { ...features, shell: true } } } } }));
});

test("the webview contract carries current and independently edited alias declarations", () => {
  const message = { type: "testLiteLlm", provider: "litellm", endpoint: "https://gateway.invalid/v1", model: "gpt-5.4", apiKey: "", authHeader: "api-key", modelsEndpoint: "", preset: "custom", reasoningEffort: "omit", temperature: "", topP: "", semanticMemoryEnabled: false, embeddingModel: "", capabilities: features, capabilityDeclarations: { "gpt-5.4": features, "vision-only": { ...features, functionCalling: false } } };
  assert.ok(parseIncomingMessage(message));
  assert.equal(parseIncomingMessage({ ...message, capabilities: { ...features, reasoning: "yes" } }), undefined);
  assert.equal(parseIncomingMessage({ ...message, capabilityDeclarations: { invalid: { ...features, tools: true } } }), undefined);
});

test("the real LangChain probe sends the exact alias and configured parameters without fabricating feature flags", async () => {
  const requests: any[] = [];
  const server = createServer((request, response) => {
    let raw = "";
    request.on("data", chunk => { raw += chunk; });
    request.on("end", () => {
      requests.push(JSON.parse(raw));
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.write(`data: ${JSON.stringify({ id: "test", object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant", content: "OK" }, finish_reason: "stop" }] })}\n\n`);
      response.end("data: [DONE]\n\n");
    });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  // Local transport fixture only. The real service still requires HTTPS for LiteLLM.
  const provider = { kind: "litellm" as const, endpoint: `http://127.0.0.1:${address.port}/v1`, roles: { executor: "gpt-5.4" }, authHeader: "authorization" as const, profile: { capabilities: features, reasoningEffort: "low" as const } };
  try {
    await assistModel({ purpose: "connection", provider }, undefined, AbortSignal.timeout(5000));
    const body = requests[0];
    assert.equal(body.model, "gpt-5.4");
    assert.equal(body.reasoning_effort, "low");
    assert.equal(body.stream, true);
    assert.equal(body.tools[0].function.name, "connection_probe");
    for (const key of ["capabilities", "pdfInput", "promptCaching", "response_format", "tool_choice", "parallel_tool_calls"]) assert.equal(key in body, false, key);
    const models = new ProviderModels({ ...provider, roles: { executor: "gpt-5.4", vision: "vision-only" }, modelProfiles: { "vision-only": { capabilities: { ...features, functionCalling: false, vision: false } } } }, undefined, AbortSignal.timeout(5000));
    try { assert.throws(() => models.model("vision", false, { requiresTools: false }), /Vision is not declared/); }
    finally { await models.close(); }
    const noTools = { ...provider, profile: { capabilities: { ...features, functionCalling: false } } };
    await assert.rejects(assistModel({ purpose: "connection", provider: noTools }, undefined, AbortSignal.timeout(5000)), /Function calling/);
    assert.equal(requests.length, 1);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
