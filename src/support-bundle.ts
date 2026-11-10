import { CONNECTION_FAILURE_KINDS, type ConnectionFailureKind } from "./connection-test-log";
import type { LiteLlmAuthHeader, LiteLlmModelPreset, LiteLlmReasoningEffort } from "./litellm";
import type { AgentRuntime, RunMode } from "./types";
import type { ModelProvider } from "./model-provider";

export const SUPPORT_BUNDLE_KIND = "local-agent-companion-support-bundle";
export const SUPPORT_BUNDLE_VERSION = 1;

export type SupportBundleInput = {
  application: {
    extensionVersion: string;
    vscodeVersion: string;
    nodeVersion: string;
    platform: string;
    architecture: string;
    remote: boolean;
  };
  workspace: {
    folderCount: number;
    trusted: boolean;
  };
  agent: {
    runtime: AgentRuntime;
    autonomyMode: RunMode;
    autoContext: boolean;
    maxContextCharacters: number;
    maxConversationCharacters: number;
    standardRecursionLimit: number;
  };
  connection: {
    provider: ModelProvider;
    endpoint: string;
    modelsEndpoint: string;
    authHeader: LiteLlmAuthHeader;
    keyPresent: boolean;
    corporateCaPresent: boolean;
    chatModel: string;
    embeddingModel: string;
    semanticMemoryEnabled: boolean;
    modelProfileCount: number;
    selectedPreset: LiteLlmModelPreset;
    resolvedPreset: Exclude<LiteLlmModelPreset, "auto">;
    reasoningEffort?: LiteLlmReasoningEffort;
    temperatureConfigured: boolean;
    topPConfigured: boolean;
  };
  memory: {
    readable: boolean;
    entryCount: number;
    projectedEntries: number;
    omittedEntries: number;
  };
  conversations: {
    threadCount: number;
    activeMessageCount: number;
    recoveryStates: Record<string, number>;
  };
  diagnostics?: unknown;
};

export type SupportBundle = {
  kind: typeof SUPPORT_BUNDLE_KIND;
  version: typeof SUPPORT_BUNDLE_VERSION;
  generatedAt: string;
  privacy: {
    containsSecrets: false;
    containsEndpointValues: false;
    containsModelAliases: false;
    containsWorkspacePaths: false;
    containsChatOrPromptContent: false;
    containsCommandOrFileNames: false;
  };
  application: SupportBundleInput["application"];
  workspace: SupportBundleInput["workspace"];
  agent: SupportBundleInput["agent"];
  connection: Omit<SupportBundleInput["connection"], "endpoint" | "modelsEndpoint" | "chatModel" | "embeddingModel"> & {
    endpointConfigured: boolean;
    explicitChatCompletionsRoute: boolean;
    modelCatalogConfigured: boolean;
    chatModelConfigured: boolean;
    embeddingModelConfigured: boolean;
  };
  memory: SupportBundleInput["memory"];
  conversations: SupportBundleInput["conversations"];
  diagnostics: Array<{
    id: string;
    status: "passed" | "failed" | "skipped";
    durationMs?: number;
    testId?: string;
    failureKind?: ConnectionFailureKind;
    httpStatus?: number;
    suggestedFixKinds: string[];
  }>;
};

export function createSupportBundle(input: SupportBundleInput, now = new Date()): SupportBundle {
  return {
    kind: SUPPORT_BUNDLE_KIND,
    version: SUPPORT_BUNDLE_VERSION,
    generatedAt: now.toISOString(),
    privacy: {
      containsSecrets: false,
      containsEndpointValues: false,
      containsModelAliases: false,
      containsWorkspacePaths: false,
      containsChatOrPromptContent: false,
      containsCommandOrFileNames: false
    },
    application: { ...input.application },
    workspace: { ...input.workspace },
    agent: { ...input.agent },
    connection: {
      provider: input.connection.provider,
      authHeader: input.connection.authHeader,
      keyPresent: input.connection.keyPresent,
      corporateCaPresent: input.connection.corporateCaPresent,
      semanticMemoryEnabled: input.connection.semanticMemoryEnabled,
      modelProfileCount: boundedInteger(input.connection.modelProfileCount),
      selectedPreset: input.connection.selectedPreset,
      resolvedPreset: input.connection.resolvedPreset,
      ...(input.connection.reasoningEffort ? { reasoningEffort: input.connection.reasoningEffort } : {}),
      temperatureConfigured: input.connection.temperatureConfigured,
      topPConfigured: input.connection.topPConfigured,
      endpointConfigured: Boolean(input.connection.endpoint.trim()),
      explicitChatCompletionsRoute: /\/chat\/completions\/?$/i.test(input.connection.endpoint.trim()),
      modelCatalogConfigured: Boolean(input.connection.modelsEndpoint.trim()),
      chatModelConfigured: Boolean(input.connection.chatModel.trim()),
      embeddingModelConfigured: Boolean(input.connection.embeddingModel.trim())
    },
    memory: {
      readable: input.memory.readable,
      entryCount: boundedInteger(input.memory.entryCount),
      projectedEntries: boundedInteger(input.memory.projectedEntries),
      omittedEntries: boundedInteger(input.memory.omittedEntries)
    },
    conversations: {
      threadCount: boundedInteger(input.conversations.threadCount),
      activeMessageCount: boundedInteger(input.conversations.activeMessageCount),
      recoveryStates: Object.fromEntries(
        Object.entries(input.conversations.recoveryStates)
          .filter(([key]) => ["running", "interrupted", "failed", "cancelled"].includes(key))
          .map(([key, value]) => [key, boundedInteger(value)])
      )
    },
    diagnostics: safeDiagnostics(input.diagnostics)
  };
}

export function serializeSupportBundle(bundle: SupportBundle): string {
  return `${JSON.stringify(bundle, null, 2)}\n`;
}

function safeDiagnostics(value: unknown): SupportBundle["diagnostics"] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 10).flatMap((item): SupportBundle["diagnostics"] => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    const status = record.status;
    if (status !== "passed" && status !== "failed" && status !== "skipped") return [];
    const id = typeof record.id === "string" && /^[a-z][a-z0-9-]{0,31}$/i.test(record.id)
      ? record.id
      : "unknown";
    const durationMs = typeof record.durationMs === "number" && Number.isFinite(record.durationMs)
      ? Math.max(0, Math.min(300_000, Math.round(record.durationMs)))
      : undefined;
    const fixes = Array.isArray(record.fixes) ? record.fixes : [];
    const suggestedFixKinds = [...new Set(fixes.flatMap((fix) => {
      if (!fix || typeof fix !== "object" || Array.isArray(fix)) return [];
      const kind = (fix as Record<string, unknown>).kind;
      return typeof kind === "string" && /^[a-z][a-z0-9-]{0,40}$/i.test(kind) ? [kind] : [];
    }))].slice(0, 10);
    const testId = typeof record.testId === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(record.testId) ? record.testId : undefined;
    const failureKind = CONNECTION_FAILURE_KINDS.includes(record.failureKind as ConnectionFailureKind) ? record.failureKind as ConnectionFailureKind : undefined;
    const httpStatus = typeof record.httpStatus === "number" && Number.isInteger(record.httpStatus) && record.httpStatus >= 400 && record.httpStatus <= 599 ? record.httpStatus : undefined;
    return [{ id, status, ...(durationMs === undefined ? {} : { durationMs }), ...(testId ? { testId } : {}),
      ...(failureKind ? { failureKind } : {}), ...(httpStatus ? { httpStatus } : {}), suggestedFixKinds }];
  });
}

function boundedInteger(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1_000_000, Math.floor(value)));
}
