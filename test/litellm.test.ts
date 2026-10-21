import assert from "node:assert/strict";
import * as path from "node:path";
import test from "node:test";
import { rootCertificates } from "node:tls";
import {
  chatCompletionsBaseUrl,
  chatCompletionsModelOptions,
  chatCompletionsUrl,
  detectLiteLlmModelPreset,
  embeddingsBaseUrl,
  embeddingsUrl,
  responsesBaseUrl,
  responsesUrl,
  liteLlmModelProfile,
  liteLlmModelsRequestHeaders,
  liteLlmModelsRequestInit,
  normalizeLiteLlmEndpoint,
  normalizeLiteLlmModelsEndpoint,
  openAiClientAuthentication,
  parseLiteLlmAuthHeader,
  parseLiteLlmModelProfiles,
  parseLiteLlmModelsResponse,
  parseOptionalTemperature,
  resolveWorkspaceCertificatePath,
  resolveLiteLlmModelApi,
  liteLlmModelMetadata,
  updateLiteLlmModelProfile,
  validateGatewayCaPem,
  validateLiteLlmConnection,
  validateLiteLlmModelProfile
} from "../src/litellm";

test("normalizes HTTPS LiteLLM base and full model API URLs", () => {
  assert.equal(normalizeLiteLlmEndpoint("https://gateway.example.com/v1/"), "https://gateway.example.com/v1");
  assert.equal(normalizeLiteLlmEndpoint("https://gateway.example.com/team/litellm"), "https://gateway.example.com/team/litellm");
  assert.equal(
    normalizeLiteLlmEndpoint("https://gateway.example.com/team/litellm/chat/completions/"),
    "https://gateway.example.com/team/litellm/chat/completions"
  );
  assert.equal(
    normalizeLiteLlmEndpoint("https://gateway.example.com/team/litellm/v1/responses/"),
    "https://gateway.example.com/team/litellm/v1/responses"
  );
});

test("rejects invalid and insecure gateway URLs", () => {
  assert.throws(() => normalizeLiteLlmEndpoint("not-a-url"), /valid HTTPS URL/);
  assert.throws(() => normalizeLiteLlmEndpoint("http://gateway.example.com/v1"), /use HTTPS/);
  assert.throws(
    () => normalizeLiteLlmEndpoint("https://user:secret@gateway.example.com/v1"),
    /must not contain credentials/
  );
  assert.throws(() => normalizeLiteLlmEndpoint("https://gateway.example.com/v1?api_key=secret"), /must not contain query/);
});

test("validates the Chat Completions connection and constructs its route", () => {
  const connection = validateLiteLlmConnection({
    endpoint: "https://gateway.example.com/v1/",
    model: " company-coding-model ",
    apiKey: " secret ",
    authHeader: "api-key"
  });
  assert.deepEqual(connection, {
    endpoint: "https://gateway.example.com/v1",
    model: "company-coding-model",
    apiKey: "secret",
    authHeader: "api-key"
  });
  assert.equal(chatCompletionsUrl(connection), "https://gateway.example.com/v1/chat/completions");
  assert.equal(chatCompletionsBaseUrl(connection), "https://gateway.example.com/v1");
  assert.equal(
    chatCompletionsUrl({ endpoint: "https://gateway.example.com/v1/responses" }),
    "https://gateway.example.com/v1/chat/completions"
  );
  assert.equal(
    chatCompletionsBaseUrl({ endpoint: "https://gateway.example.com/v1/responses" }),
    "https://gateway.example.com/v1"
  );
  assert.equal(
    chatCompletionsUrl({ endpoint: "https://gateway.example.com/proxy/chat/completions" }),
    "https://gateway.example.com/proxy/chat/completions"
  );
  assert.equal(
    chatCompletionsBaseUrl({ endpoint: "https://gateway.example.com/proxy/chat/completions" }),
    "https://gateway.example.com/proxy"
  );
  assert.throws(
    () => validateLiteLlmConnection({ endpoint: "https://gateway.example.com/v1", model: "", apiKey: "secret" }),
    /model alias is required/
  );
  assert.throws(
    () => validateLiteLlmConnection({ endpoint: "https://gateway.example.com/v1", model: "model", apiKey: "" }),
    /Gateway API or subscription key is required/
  );
});

test("maps the stored key to the selected gateway authentication header", () => {
  assert.deepEqual(openAiClientAuthentication({ apiKey: "secret", authHeader: "authorization" }), {
    apiKey: "secret",
    stripAuthorization: false
  });
  assert.deepEqual(openAiClientAuthentication({ apiKey: "secret", authHeader: "api-key" }), {
    apiKey: "local-gateway-header",
    defaultHeaders: { "api-key": "secret" },
    stripAuthorization: true
  });
  assert.deepEqual(openAiClientAuthentication({ apiKey: "secret", authHeader: "ocp-apim-subscription-key" }), {
    apiKey: "local-gateway-header",
    defaultHeaders: { "Ocp-Apim-Subscription-Key": "secret" },
    stripAuthorization: true
  });
  assert.equal(parseLiteLlmAuthHeader("unknown"), "authorization");
});

test("builds only the model parameters explicitly configured for an alias", () => {
  const profiles = updateLiteLlmModelProfile({}, "gpt-6-Luna", { reasoningEffort: "none" });
  assert.deepEqual(profiles, { "gpt-6-Luna": { reasoningEffort: "none" } });
  assert.deepEqual(
    chatCompletionsModelOptions(liteLlmModelProfile(profiles, "gpt-6-Luna")),
    { modelKwargs: { reasoning_effort: "none" } }
  );
  assert.deepEqual(chatCompletionsModelOptions(liteLlmModelProfile(profiles, "gpt-4o")), {});

  const withTemperature = updateLiteLlmModelProfile(profiles, "creative-model", {
    temperature: 0.7,
    reasoningEffort: "low"
  });
  assert.deepEqual(chatCompletionsModelOptions(liteLlmModelProfile(withTemperature, "creative-model")), {
    temperature: 0.7,
    modelKwargs: { reasoning_effort: "low" }
  });
  assert.equal(parseOptionalTemperature(""), undefined);
  assert.equal(parseOptionalTemperature("0"), 0);
  assert.throws(() => parseOptionalTemperature("not-a-number"), /finite number/);
  assert.deepEqual(parseLiteLlmModelProfiles({ broken: { temperature: "nope" } }), {});
});

test("selects documented GPT and Claude compatibility profiles", () => {
  assert.equal(detectLiteLlmModelPreset("gpt-6-Luna"), "gpt-6-chat-tools");
  assert.equal(detectLiteLlmModelPreset("gpt-6.1-sol"), "gpt-6-responses-tools");
  assert.equal(detectLiteLlmModelPreset("gpt-5.6-terra"), "gpt-5.6");
  assert.equal(detectLiteLlmModelPreset("gpt-4o"), "gpt-standard");
  assert.equal(detectLiteLlmModelPreset("claude-opus-4-8"), "claude-modern");
  assert.equal(detectLiteLlmModelPreset("claude-sonnet-4-6"), "claude-4.6");
  assert.doesNotThrow(() => validateLiteLlmModelProfile("gpt-6-luna", { reasoningEffort: "none" }));
  assert.doesNotThrow(() => validateLiteLlmModelProfile("gpt-6-luna", {}));
  assert.throws(() => validateLiteLlmModelProfile("gpt-6-luna", { api: "chat_completions" }), /requires reasoning_effort none/);
  assert.equal(resolveLiteLlmModelApi("gpt-6-luna", {}), "responses");
  assert.equal(resolveLiteLlmModelApi("gpt-6-luna", { reasoningEffort: "none", api: "chat_completions" }), "chat_completions");
  assert.equal(liteLlmModelMetadata("gpt-6-luna")?.supportsNoneReasoningEffort, true);
  assert.equal(liteLlmModelMetadata("company-coding-model"), undefined);
  assert.throws(
    () => validateLiteLlmModelProfile("claude-opus-4-8", { temperature: 0.5 }),
    /does not accept Temperature or Top P/
  );
  assert.doesNotThrow(() => validateLiteLlmModelProfile("opaque-corporate-alias", {
    preset: "custom",
    reasoningEffort: "minimal",
    temperature: 0.5
  }));
});

test("normalizes and parses the authenticated model catalog", () => {
  assert.equal(
    normalizeLiteLlmModelsEndpoint("https://gateway.example.com/catalog/models/"),
    "https://gateway.example.com/catalog/models"
  );
  assert.deepEqual(liteLlmModelsRequestHeaders(" secret "), {
    Accept: "application/json",
    "Cache-Control": "no-cache",
    "api-key": "secret"
  });
  const catalogRequest = liteLlmModelsRequestInit(" secret ");
  assert.equal(catalogRequest.method, "GET");
  assert.equal(catalogRequest.redirect, "manual");
  assert.deepEqual(catalogRequest.headers, {
    Accept: "application/json",
    "Cache-Control": "no-cache",
    "api-key": "secret"
  });
  assert.deepEqual(parseLiteLlmModelsResponse({
    data: [{ id: "gpt-6-luna" }, { model: "claude-opus-4-8" }, { id: "gpt-6-luna" }]
  }), ["claude-opus-4-8", "gpt-6-luna"]);
  assert.deepEqual(parseLiteLlmModelsResponse({ models: ["z-model", { name: "a-model" }] }), ["a-model", "z-model"]);
  assert.throws(() => normalizeLiteLlmModelsEndpoint("http://gateway.example.com/models"), /use HTTPS/);
});

test("derives the embeddings route from the same LiteLLM base URL", () => {
  assert.equal(
    embeddingsBaseUrl({ endpoint: "https://gateway.example.com/proxy/chat/completions" }),
    "https://gateway.example.com/proxy"
  );
  assert.equal(
    embeddingsBaseUrl({ endpoint: "https://gateway.example.com/litellm" }),
    "https://gateway.example.com/litellm"
  );
  assert.equal(
    embeddingsUrl({ endpoint: "https://gateway.example.com/proxy/chat/completions" }),
    "https://gateway.example.com/proxy/embeddings"
  );
  assert.equal(
    embeddingsUrl(
      { endpoint: "https://gateway.example.com/litellm/team/{model}/chat/completions", model: "chat-alias" },
      "embedding-alias"
    ),
    "https://gateway.example.com/litellm/team/embedding-alias/embeddings"
  );
  assert.equal(
    embeddingsUrl(
      { endpoint: "https://gateway.example.com/litellm/team/chat-alias/chat/completions", model: "chat-alias" },
      "embedding alias"
    ),
    "https://gateway.example.com/litellm/team/embedding%20alias/embeddings"
  );
  assert.equal(
    embeddingsUrl(
      { endpoint: "https://gateway.example.com/litellm/something", model: "chat-alias" },
      "embedding-alias",
      true
    ),
    "https://gateway.example.com/litellm/something/embedding-alias/embeddings"
  );
});

test("derives the Responses API route from a configured Chat Completions route", () => {
  const connection = { endpoint: "https://gateway.example.com/team/chat/completions" };
  assert.equal(responsesUrl(connection), "https://gateway.example.com/team/responses");
  assert.equal(responsesBaseUrl(connection), "https://gateway.example.com/team");
  assert.equal(responsesUrl({ endpoint: "https://gateway.example.com/team/responses" }), "https://gateway.example.com/team/responses");
  assert.equal(
    responsesUrl({ endpoint: "https://gateway.example.com/team/{model}/chat/completions", model: "chat" }, "responses-model"),
    "https://gateway.example.com/team/responses-model/responses"
  );
});

test("keeps the gateway CA certificate inside the workspace", () => {
  assert.equal(
    resolveWorkspaceCertificatePath("/workspace/project", "corporate-root.pem"),
    path.resolve("/workspace/project", "corporate-root.pem")
  );
  assert.throws(
    () => resolveWorkspaceCertificatePath("/workspace/project", "../outside.pem"),
    /inside the opened workspace/
  );
  assert.throws(
    () => resolveWorkspaceCertificatePath("/workspace/project", "certificate.crt"),
    /.pem extension/
  );
});

test("accepts certificate bundles and rejects non-PEM CA content", () => {
  assert.doesNotThrow(() => validateGatewayCaPem(rootCertificates[0] ?? ""));
  assert.throws(
    () => validateGatewayCaPem("not a certificate"),
    /must contain at least one certificate/
  );
  assert.throws(
    () => validateGatewayCaPem("-----BEGIN CERTIFICATE-----\ninvalid\n-----END CERTIFICATE-----"),
    /contains an invalid certificate/
  );
});
