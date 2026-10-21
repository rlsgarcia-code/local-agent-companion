import { parseRunMode } from "./autonomy";
import {
  normalizeLiteLlmEndpoint,
  normalizeLiteLlmModelsEndpoint,
  parseLiteLlmAuthHeader,
  parseLiteLlmModelProfiles,
  parseLiteLlmModelPreset,
  parseLiteLlmReasoningEffort,
  parseOptionalTemperature,
  parseOptionalTopP,
  validateLiteLlmModelProfile
} from "./litellm";
import type { LiteLlmAuthHeader, LiteLlmModelProfiles } from "./litellm";
import { parseAgentRuntime } from "./runtime";
import type { AgentRuntime, RunMode } from "./types";

export const CONNECTION_PROFILE_KIND = "local-agent-companion-connection-profile";
export const CONNECTION_PROFILE_VERSION = 1;

export type ConnectionProfile = {
  kind: typeof CONNECTION_PROFILE_KIND;
  version: typeof CONNECTION_PROFILE_VERSION;
  exportedAt: string;
  gateway: {
    endpoint: string;
    modelsEndpoint: string;
    authHeader: LiteLlmAuthHeader;
    requiresKey: true;
    requiresCorporateCa: boolean;
  };
  models: {
    chat: string;
    embedding: string;
    semanticMemoryEnabled: boolean;
    profiles: LiteLlmModelProfiles;
  };
  workspace: {
    runtime: AgentRuntime;
    autonomyMode: RunMode;
  };
};

type ProfileInput = Omit<ConnectionProfile, "kind" | "version" | "exportedAt">;

const ROOT_KEYS = new Set(["kind", "version", "exportedAt", "gateway", "models", "workspace"]);
const GATEWAY_KEYS = new Set(["endpoint", "modelsEndpoint", "authHeader", "requiresKey", "requiresCorporateCa"]);
const MODEL_KEYS = new Set(["chat", "embedding", "semanticMemoryEnabled", "profiles"]);
const WORKSPACE_KEYS = new Set(["runtime", "autonomyMode"]);
const MODEL_PROFILE_KEYS = new Set(["api", "preset", "reasoningEffort", "temperature", "topP"]);
const SECRET_KEYS = /^(?:api[-_]?key|key|secret|token|password|credential|authorization|certificate|caCertificate|pem)$/i;

export function createConnectionProfile(input: ProfileInput, now = new Date()): ConnectionProfile {
  return parseConnectionProfile({
    kind: CONNECTION_PROFILE_KIND,
    version: CONNECTION_PROFILE_VERSION,
    exportedAt: now.toISOString(),
    ...input
  });
}

export function parseConnectionProfile(value: unknown): ConnectionProfile {
  const root = objectValue(value, "Connection profile must be a JSON object.");
  assertNoSecretFields(root);
  assertAllowedKeys(root, ROOT_KEYS, "profile");
  if (root.kind !== CONNECTION_PROFILE_KIND || root.version !== CONNECTION_PROFILE_VERSION) {
    throw new Error("Unsupported Local Agent Companion connection-profile format or version.");
  }
  const exportedAt = boundedString(root.exportedAt, "Profile exportedAt must be an ISO timestamp.", 100);
  if (!Number.isFinite(Date.parse(exportedAt))) throw new Error("Profile exportedAt must be an ISO timestamp.");

  const gateway = objectValue(root.gateway, "Profile gateway settings are required.");
  const models = objectValue(root.models, "Profile model settings are required.");
  const workspace = objectValue(root.workspace, "Profile workspace settings are required.");
  assertAllowedKeys(gateway, GATEWAY_KEYS, "gateway");
  assertAllowedKeys(models, MODEL_KEYS, "models");
  assertAllowedKeys(workspace, WORKSPACE_KEYS, "workspace");

  const endpoint = normalizeLiteLlmEndpoint(boundedString(gateway.endpoint, "Gateway endpoint is required.", 2_048));
  const modelsEndpointInput = optionalString(gateway.modelsEndpoint, 2_048);
  const modelsEndpoint = modelsEndpointInput ? normalizeLiteLlmModelsEndpoint(modelsEndpointInput) : "";
  if (!isAuthHeader(gateway.authHeader)) throw new Error("Profile authHeader is not supported.");
  if (gateway.requiresKey !== true) throw new Error("Connection profiles must declare that a separate Secret Storage key is required.");
  if (typeof gateway.requiresCorporateCa !== "boolean") throw new Error("Profile requiresCorporateCa must be boolean.");

  const chat = boundedString(models.chat, "Chat model alias is required.", 256);
  const embedding = optionalString(models.embedding, 256);
  if (typeof models.semanticMemoryEnabled !== "boolean") {
    throw new Error("Profile semanticMemoryEnabled must be boolean.");
  }
  validateRawModelProfiles(models.profiles);
  const profiles = parseLiteLlmModelProfiles(models.profiles);
  validateLiteLlmModelProfile(chat, profiles[chat] ?? {});

  if (workspace.runtime !== "standard" && workspace.runtime !== "deep") {
    throw new Error("Profile runtime must be standard or deep.");
  }
  if (workspace.autonomyMode !== "review" && workspace.autonomyMode !== "execute" && workspace.autonomyMode !== "plan") {
    throw new Error("Profile autonomyMode is not supported.");
  }

  return {
    kind: CONNECTION_PROFILE_KIND,
    version: CONNECTION_PROFILE_VERSION,
    exportedAt: new Date(exportedAt).toISOString(),
    gateway: {
      endpoint,
      modelsEndpoint,
      authHeader: parseLiteLlmAuthHeader(gateway.authHeader),
      requiresKey: true,
      requiresCorporateCa: gateway.requiresCorporateCa
    },
    models: {
      chat,
      embedding,
      semanticMemoryEnabled: models.semanticMemoryEnabled,
      profiles
    },
    workspace: {
      runtime: parseAgentRuntime(workspace.runtime),
      autonomyMode: parseRunMode(workspace.autonomyMode)
    }
  };
}

export function serializeConnectionProfile(profile: ConnectionProfile): string {
  return `${JSON.stringify(parseConnectionProfile(profile), null, 2)}\n`;
}

function validateRawModelProfiles(value: unknown): void {
  const profiles = objectValue(value, "Profile model profiles must be an object.");
  if (Object.keys(profiles).length > 500) throw new Error("Connection profile contains too many model profiles.");
  for (const [alias, raw] of Object.entries(profiles)) {
    if (!alias.trim() || alias.length > 256 || alias === "__proto__" || alias === "constructor" || alias === "prototype") {
      throw new Error("Profile contains an invalid model alias.");
    }
    const profile = objectValue(raw, `Profile for ${alias} must be an object.`);
    assertAllowedKeys(profile, MODEL_PROFILE_KEYS, `model profile ${alias}`);
    if (profile.api !== undefined && profile.api !== "chat_completions" && profile.api !== "responses") {
      throw new Error(`Profile for ${alias} contains an unsupported model API.`);
    }
    if (profile.preset !== undefined && parseLiteLlmModelPreset(profile.preset) !== profile.preset) {
      throw new Error(`Profile for ${alias} contains an unsupported compatibility preset.`);
    }
    if (profile.reasoningEffort !== undefined && !parseLiteLlmReasoningEffort(profile.reasoningEffort)) {
      throw new Error(`Profile for ${alias} contains an unsupported reasoning effort.`);
    }
    if (profile.temperature !== undefined && typeof profile.temperature !== "number") {
      throw new Error(`Profile for ${alias} temperature must be numeric.`);
    }
    if (profile.topP !== undefined && typeof profile.topP !== "number") {
      throw new Error(`Profile for ${alias} topP must be numeric.`);
    }
    const temperature = parseOptionalTemperature(profile.temperature);
    const topP = parseOptionalTopP(profile.topP);
    if (temperature !== undefined && topP !== undefined) {
      throw new Error(`Profile for ${alias} must not configure both temperature and topP.`);
    }
  }
}

function assertNoSecretFields(value: unknown, path = "profile"): void {
  const pending: Array<{ value: unknown; path: string }> = [{ value, path }];
  while (pending.length) {
    const current = pending.pop()!;
    if (!current.value || typeof current.value !== "object") continue;
    for (const [key, child] of Object.entries(current.value)) {
      if (SECRET_KEYS.test(key)) throw new Error(`Connection profile must not contain secrets (${current.path}.${key}).`);
      pending.push({ value: child, path: `${current.path}.${key}` });
    }
  }
}

function assertAllowedKeys(value: Record<string, unknown>, allowed: Set<string>, label: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`Unsupported ${label} field: ${key}.`);
  }
}

function objectValue(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, message: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(message);
  return value.trim();
}

function boundedString(value: unknown, message: string, maximumLength: number): string {
  const result = stringValue(value, message);
  if (result.length > maximumLength) throw new Error(`${message} Maximum length is ${maximumLength} characters.`);
  return result;
}

function optionalString(value: unknown, maximumLength: number): string {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string") throw new Error("Optional profile values must be strings.");
  const result = value.trim();
  if (result.length > maximumLength) throw new Error(`Optional profile value exceeds ${maximumLength} characters.`);
  return result;
}

function isAuthHeader(value: unknown): value is LiteLlmAuthHeader {
  return value === "authorization" || value === "api-key" || value === "ocp-apim-subscription-key";
}
