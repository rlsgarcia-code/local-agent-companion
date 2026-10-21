import { X509Certificate } from "node:crypto";
import * as path from "node:path";

export const LITELLM_API_KEY_SECRET = "localAgentCompanion.liteLlmApiKey";

export type LiteLlmAuthHeader = "authorization" | "api-key" | "ocp-apim-subscription-key";

export type LiteLlmReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export type LiteLlmModelPreset =
  | "auto"
  | "gpt-6-chat-tools"
  | "gpt-6-responses-tools"
  | "gpt-5.6"
  | "gpt-5-reasoning"
  | "gpt-standard"
  | "claude-modern"
  | "claude-4.6"
  | "claude-legacy"
  | "custom";

export type LiteLlmModelCapabilities = {
  label: string;
  reasoningEfforts: LiteLlmReasoningEffort[];
  sampling: "supported" | "reasoning-none-only" | "reasoning-omitted-only" | "unsupported" | "custom";
  toolCalling: "supported" | "reasoning-none-only" | "unsupported" | "custom";
  guidance: string;
};

export const LITELLM_MODEL_CAPABILITIES: Record<Exclude<LiteLlmModelPreset, "auto">, LiteLlmModelCapabilities> = {
  "gpt-6-chat-tools": {
    label: "GPT-6 Sol / Luna · Chat tools",
    reasoningEfforts: ["none", "low", "medium", "high", "xhigh", "max"],
    sampling: "reasoning-none-only",
    toolCalling: "reasoning-none-only",
    guidance: "Chat Completions function tools require reasoning_effort none. Temperature and top_p are optional only with reasoning none."
  },
  "gpt-6-responses-tools": {
    label: "GPT-6 Astra / 6.1 Sol",
    reasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
    sampling: "unsupported",
    toolCalling: "unsupported",
    guidance: "These models require Responses API for function tools, while this extension is Chat Completions only."
  },
  "gpt-5.6": {
    label: "GPT-5.6 family",
    reasoningEfforts: ["none", "low", "medium", "high", "xhigh", "max"],
    sampling: "reasoning-none-only",
    toolCalling: "reasoning-none-only",
    guidance: "For Chat Completions tools, use reasoning none. Temperature and top_p are optional only when reasoning is none."
  },
  "gpt-5-reasoning": {
    label: "GPT-5.2–5.5 reasoning",
    reasoningEfforts: ["none", "minimal", "low", "medium", "high", "xhigh"],
    sampling: "reasoning-none-only",
    toolCalling: "reasoning-none-only",
    guidance: "Reasoning deployments vary. With tools, use none when supported; sampling parameters require reasoning none."
  },
  "gpt-standard": {
    label: "GPT-4 / 4o standard",
    reasoningEfforts: [],
    sampling: "supported",
    toolCalling: "supported",
    guidance: "Function tools, temperature, and top_p are supported. reasoning_effort is not sent."
  },
  "claude-modern": {
    label: "Claude 4.7+ / Claude 5",
    reasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
    sampling: "unsupported",
    toolCalling: "supported",
    guidance: "LiteLLM maps reasoning_effort to Claude effort/thinking. Omit temperature and top_p on Claude 4.7 and later."
  },
  "claude-4.6": {
    label: "Claude 4.6 adaptive thinking",
    reasoningEfforts: ["low", "medium", "high", "max"],
    sampling: "reasoning-omitted-only",
    toolCalling: "supported",
    guidance: "LiteLLM maps reasoning_effort to adaptive thinking. Sampling is available only when reasoning is omitted."
  },
  "claude-legacy": {
    label: "Claude 4.5 or earlier",
    reasoningEfforts: ["low", "medium", "high", "max"],
    sampling: "reasoning-omitted-only",
    toolCalling: "supported",
    guidance: "LiteLLM maps reasoning_effort to the model's supported thinking mode. Omit sampling whenever thinking is enabled."
  },
  custom: {
    label: "Custom / gateway-defined",
    reasoningEfforts: ["none", "minimal", "low", "medium", "high", "xhigh", "max"],
    sampling: "custom",
    toolCalling: "custom",
    guidance: "No compatibility assumptions are applied. Configure only parameters accepted by the gateway alias."
  }
};

export type LiteLlmModelProfile = {
  preset?: LiteLlmModelPreset;
  reasoningEffort?: LiteLlmReasoningEffort;
  temperature?: number;
  topP?: number;
};

export type LiteLlmModelProfiles = Record<string, LiteLlmModelProfile>;

export type LiteLlmConnection = {
  endpoint: string;
  model: string;
  apiKey: string;
  authHeader?: LiteLlmAuthHeader;
};

export type ValidatedLiteLlmConnection = Required<LiteLlmConnection>;

export function normalizeLiteLlmEndpoint(value: string): string {
  const raw = value.trim();
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("LiteLLM endpoint must be a valid HTTPS URL.");
  }
  if (url.protocol !== "https:") {
    throw new Error("LiteLLM endpoint must use HTTPS.");
  }
  if (url.username || url.password) {
    throw new Error("LiteLLM base URL must not contain credentials.");
  }
  const pathname = url.pathname.replace(/\/+$/, "");
  if (/\/responses$/i.test(pathname)) {
    throw new Error("LiteLLM endpoint must use the Chat Completions route, not /responses.");
  }
  if (url.search) {
    throw new Error("LiteLLM endpoint must not contain query parameters or secrets.");
  }
  url.pathname = pathname;
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

export function normalizeLiteLlmModelsEndpoint(value: string): string {
  const raw = value.trim();
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Models endpoint must be a valid HTTPS URL.");
  }
  if (url.protocol !== "https:") throw new Error("Models endpoint must use HTTPS.");
  if (url.username || url.password) throw new Error("Models endpoint must not contain credentials.");
  if (url.search) throw new Error("Models endpoint must not contain query parameters or secrets.");
  url.pathname = url.pathname.replace(/\/+$/, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

export function parseLiteLlmModelsResponse(value: unknown): string[] {
  const root = value as { data?: unknown; models?: unknown } | unknown[] | undefined;
  const candidates = Array.isArray(root)
    ? root
    : root && typeof root === "object" && Array.isArray(root.data)
      ? root.data
      : root && typeof root === "object" && Array.isArray(root.models)
        ? root.models
        : [];
  const models = candidates.flatMap((entry) => {
    if (typeof entry === "string") return [entry];
    if (!entry || typeof entry !== "object") return [];
    const record = entry as Record<string, unknown>;
    const id = record.id ?? record.model ?? record.name;
    return typeof id === "string" ? [id] : [];
  });
  return [...new Set(models.map((model) => model.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

export function liteLlmModelsRequestHeaders(apiKey: string): Record<string, string> {
  const key = apiKey.trim();
  if (!key) throw new Error("Gateway API key is required to load models.");
  return {
    Accept: "application/json",
    "Cache-Control": "no-cache",
    "api-key": key
  };
}

export function liteLlmModelsRequestInit(apiKey: string, signal?: AbortSignal): RequestInit {
  return {
    method: "GET",
    headers: liteLlmModelsRequestHeaders(apiKey),
    redirect: "manual",
    ...(signal ? { signal } : {})
  };
}

export function parseLiteLlmAuthHeader(value: unknown): LiteLlmAuthHeader {
  if (value === "api-key" || value === "ocp-apim-subscription-key") return value;
  return "authorization";
}

export function validateLiteLlmConnection(connection: LiteLlmConnection): ValidatedLiteLlmConnection {
  const model = connection.model.trim();
  const apiKey = connection.apiKey.trim();
  if (!model) {
    throw new Error("LiteLLM model alias is required.");
  }
  if (!apiKey) {
    throw new Error("Gateway API or subscription key is required.");
  }
  return {
    endpoint: normalizeLiteLlmEndpoint(connection.endpoint),
    model,
    apiKey,
    authHeader: parseLiteLlmAuthHeader(connection.authHeader)
  };
}

export function openAiClientAuthentication(
  connection: Pick<ValidatedLiteLlmConnection, "apiKey" | "authHeader">
): { apiKey: string; defaultHeaders?: Record<string, string | null>; stripAuthorization: boolean } {
  if (connection.authHeader === "api-key") {
    return {
      apiKey: "local-gateway-header",
      defaultHeaders: { "api-key": connection.apiKey },
      stripAuthorization: true
    };
  }
  if (connection.authHeader === "ocp-apim-subscription-key") {
    return {
      apiKey: "local-gateway-header",
      defaultHeaders: {
        "Ocp-Apim-Subscription-Key": connection.apiKey
      },
      stripAuthorization: true
    };
  }
  return { apiKey: connection.apiKey, stripAuthorization: false };
}

export function parseLiteLlmReasoningEffort(value: unknown): LiteLlmReasoningEffort | undefined {
  if (
    value === "none" ||
    value === "minimal" ||
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "xhigh" ||
    value === "max"
  ) {
    return value;
  }
  return undefined;
}

export function parseLiteLlmModelPreset(value: unknown): LiteLlmModelPreset {
  if (
    value === "gpt-6-chat-tools" ||
    value === "gpt-6-responses-tools" ||
    value === "gpt-5.6" ||
    value === "gpt-5-reasoning" ||
    value === "gpt-standard" ||
    value === "claude-modern" ||
    value === "claude-4.6" ||
    value === "claude-legacy" ||
    value === "custom"
  ) return value;
  return "auto";
}

export function detectLiteLlmModelPreset(model: string): Exclude<LiteLlmModelPreset, "auto"> {
  const normalized = model.trim().toLowerCase();
  if (/gpt-6(?:\.1)?[-_/ ]*(?:astra|sol)/.test(normalized) && /gpt-6\.1|astra/.test(normalized)) {
    return "gpt-6-responses-tools";
  }
  if (/gpt-6[-_/ ]*(?:sol|luna)/.test(normalized)) return "gpt-6-chat-tools";
  if (/gpt-5\.6/.test(normalized)) return "gpt-5.6";
  if (/gpt-5(?:\.[2-5])?/.test(normalized)) return "gpt-5-reasoning";
  if (/gpt-4|gpt-4o/.test(normalized)) return "gpt-standard";
  if (normalized.includes("claude")) {
    if (/claude.*(?:5(?:[._-]|$)|4[._-](?:7|8|9))/.test(normalized)) return "claude-modern";
    if (/claude.*4[._-]6/.test(normalized)) return "claude-4.6";
    return "claude-legacy";
  }
  return "custom";
}

export function resolveLiteLlmModelPreset(model: string, value: unknown): Exclude<LiteLlmModelPreset, "auto"> {
  const preset = parseLiteLlmModelPreset(value);
  return preset === "auto" ? detectLiteLlmModelPreset(model) : preset;
}

export function parseOptionalTemperature(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  const normalized = typeof value === "string" ? value.trim() : value;
  if (normalized === "") return undefined;
  const temperature = typeof normalized === "number" ? normalized : Number(normalized);
  if (!Number.isFinite(temperature)) {
    throw new Error("Temperature must be a finite number or left blank so it is not sent.");
  }
  return temperature;
}

export function parseOptionalTopP(value: unknown): number | undefined {
  const topP = parseOptionalTemperature(value);
  if (topP !== undefined && (topP < 0 || topP > 1)) {
    throw new Error("Top P must be between 0 and 1 or left blank so it is not sent.");
  }
  return topP;
}

export function parseLiteLlmModelProfiles(value: unknown): LiteLlmModelProfiles {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const profiles: LiteLlmModelProfiles = {};
  for (const [model, rawProfile] of Object.entries(value)) {
    if (
      !model.trim() ||
      model === "__proto__" ||
      model === "constructor" ||
      model === "prototype" ||
      !rawProfile ||
      typeof rawProfile !== "object" ||
      Array.isArray(rawProfile)
    ) continue;
    const source = rawProfile as Record<string, unknown>;
    const preset = parseLiteLlmModelPreset(source.preset);
    const reasoningEffort = parseLiteLlmReasoningEffort(source.reasoningEffort);
    let temperature: number | undefined;
    let topP: number | undefined;
    try {
      temperature = parseOptionalTemperature(source.temperature);
      topP = parseOptionalTopP(source.topP);
    } catch {
      continue;
    }
    profiles[model] = {
      ...(preset !== "auto" ? { preset } : {}),
      ...(reasoningEffort ? { reasoningEffort } : {}),
      ...(temperature !== undefined ? { temperature } : {}),
      ...(topP !== undefined ? { topP } : {})
    };
  }
  return profiles;
}

export function liteLlmModelProfile(value: unknown, model: string): LiteLlmModelProfile {
  return parseLiteLlmModelProfiles(value)[model.trim()] ?? {};
}

export function updateLiteLlmModelProfile(
  value: unknown,
  model: string,
  profile: LiteLlmModelProfile
): LiteLlmModelProfiles {
  const profiles = parseLiteLlmModelProfiles(value);
  const alias = model.trim();
  const normalized: LiteLlmModelProfile = {
    ...(parseLiteLlmModelPreset(profile.preset) !== "auto" ? { preset: parseLiteLlmModelPreset(profile.preset) } : {}),
    ...(parseLiteLlmReasoningEffort(profile.reasoningEffort) ? { reasoningEffort: profile.reasoningEffort } : {}),
    ...(profile.temperature !== undefined
      ? { temperature: parseOptionalTemperature(profile.temperature) }
      : {}),
    ...(profile.topP !== undefined ? { topP: parseOptionalTopP(profile.topP) } : {})
  };
  if (
    normalized.preset === undefined &&
    normalized.reasoningEffort === undefined &&
    normalized.temperature === undefined &&
    normalized.topP === undefined
  ) {
    delete profiles[alias];
  } else {
    profiles[alias] = normalized;
  }
  return profiles;
}

export function validateLiteLlmModelProfile(
  model: string,
  profile: LiteLlmModelProfile
): LiteLlmModelCapabilities {
  const preset = resolveLiteLlmModelPreset(model, profile.preset);
  const capabilities = LITELLM_MODEL_CAPABILITIES[preset];
  if (capabilities.toolCalling === "unsupported") {
    throw new Error(`${capabilities.label} requires an API other than Chat Completions for function tools. Choose a compatible model or the Custom preset if your gateway exposes different capabilities.`);
  }
  if (profile.reasoningEffort && !capabilities.reasoningEfforts.includes(profile.reasoningEffort)) {
    throw new Error(`${capabilities.label} does not allow reasoning_effort ${profile.reasoningEffort} in this compatibility profile.`);
  }
  if (capabilities.toolCalling === "reasoning-none-only" && profile.reasoningEffort !== "none") {
    throw new Error(`${capabilities.label} requires reasoning_effort none for Chat Completions function tools.`);
  }
  const hasSampling = profile.temperature !== undefined || profile.topP !== undefined;
  if (profile.temperature !== undefined && profile.topP !== undefined) {
    throw new Error("Configure either Temperature or Top P, not both.");
  }
  if (hasSampling && capabilities.sampling === "unsupported") {
    throw new Error(`${capabilities.label} does not accept Temperature or Top P. Leave both blank.`);
  }
  if (hasSampling && capabilities.sampling === "reasoning-none-only" && profile.reasoningEffort !== "none") {
    throw new Error(`${capabilities.label} accepts Temperature or Top P only with reasoning_effort none.`);
  }
  if (hasSampling && capabilities.sampling === "reasoning-omitted-only" && profile.reasoningEffort !== undefined) {
    throw new Error(`${capabilities.label} accepts sampling only when reasoning_effort is omitted.`);
  }
  return capabilities;
}

export function chatCompletionsModelOptions(profile: LiteLlmModelProfile): {
  temperature?: number;
  topP?: number;
  modelKwargs?: Record<string, unknown>;
} {
  return {
    ...(profile.temperature !== undefined ? { temperature: profile.temperature } : {}),
    ...(profile.topP !== undefined ? { topP: profile.topP } : {}),
    ...(profile.reasoningEffort
      ? { modelKwargs: { reasoning_effort: profile.reasoningEffort } }
      : {})
  };
}

export function chatCompletionsUrl(connection: Pick<LiteLlmConnection, "endpoint">): string {
  const endpoint = connection.endpoint.replace(/\/$/, "");
  return /\/chat\/completions$/i.test(new URL(endpoint).pathname)
    ? endpoint
    : `${endpoint}/chat/completions`;
}

export function chatCompletionsBaseUrl(connection: Pick<LiteLlmConnection, "endpoint">): string {
  const url = new URL(connection.endpoint.replace(/\/$/, ""));
  url.pathname = url.pathname.replace(/\/chat\/completions$/i, "");
  return url.toString().replace(/\/$/, "");
}

export function embeddingsBaseUrl(
  connection: Pick<LiteLlmConnection, "endpoint"> & Partial<Pick<LiteLlmConnection, "model">>,
  embeddingModel?: string
): string {
  const url = new URL(connection.endpoint.replace(/\/$/, ""));
  url.pathname = url.pathname
    .replace(/\/chat\/completions$/i, "")
    .replace(/\/embeddings$/i, "");
  const model = embeddingModel?.trim();
  if (model) {
    const encodedModel = encodeURIComponent(model);
    const chatModel = connection.model?.trim() ?? "";
    const encodedChatModel = chatModel ? encodeURIComponent(chatModel) : "";
    // Corporate gateways commonly expose /{model}/embeddings rather than a
    // shared /embeddings route. Support both an explicit {model} placeholder
    // and a complete chat route that already contains the chat alias.
    const decodedPath = decodeURIComponent(url.pathname);
    if (decodedPath.includes("/{model}")) {
      url.pathname = decodedPath.replace(/\/\{model\}(?=\/|$)/i, `/${encodedModel}`);
    } else if (encodedChatModel && url.pathname.endsWith(`/${encodedChatModel}`)) {
      url.pathname = url.pathname.slice(0, -encodedChatModel.length) + encodedModel;
    }
  }
  return url.toString().replace(/\/$/, "");
}

export function embeddingsUrl(
  connection: Pick<LiteLlmConnection, "endpoint"> & Partial<Pick<LiteLlmConnection, "model">>,
  embeddingModel?: string
): string {
  return `${embeddingsBaseUrl(connection, embeddingModel)}/embeddings`;
}

export function resolveWorkspaceCertificatePath(
  workspaceRoot: string,
  configuredPath: string
): string {
  const root = path.resolve(workspaceRoot);
  const certificate = path.resolve(root, configuredPath.trim());
  const relative = path.relative(root, certificate);
  if (!configuredPath.trim() || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Gateway CA certificate must be a .pem file inside the opened workspace.");
  }
  if (path.extname(certificate).toLowerCase() !== ".pem") {
    throw new Error("Gateway CA certificate must use the .pem extension.");
  }
  return certificate;
}

export function validateGatewayCaPem(contents: string | Uint8Array): void {
  const text = typeof contents === "string" ? contents : new TextDecoder().decode(contents);
  const certificates = text.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g);
  if (!certificates?.length) {
    throw new Error("Gateway CA PEM must contain at least one certificate.");
  }
  try {
    certificates.forEach((certificate) => new X509Certificate(certificate));
  } catch {
    throw new Error("Gateway CA PEM contains an invalid certificate.");
  }
}
