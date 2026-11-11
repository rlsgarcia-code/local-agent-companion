import { modelCapabilityDeclaration } from "./model-capabilities";
export { modelCapabilityDeclaration, modelCapabilityDeclarations, type ModelCapabilityDeclaration } from "./model-capabilities";
import { z } from "zod";
import versions from "./version.json";
import { identifier } from "./schema";
import { workspaceOptions } from "./workspace";
export { identifier } from "./schema";
export * from "./goals";
export * from "./memory";
export * from "./models";
export * from "./execution";
export * from "./ollama";

export const PROTOCOL_VERSION = versions.protocol;
export const ENGINE_VERSION = versions.engine;
export const NODE_VERSION = versions.node;
export const products = ["companion-mac", "companion-vscode", "kidos"] as const;
export type Product = (typeof products)[number];
export const runStates = [
  "running",
  "cancelling",
  "awaiting_approval",
  "awaiting_host",
  "awaiting_credentials",
  "awaiting_reconciliation",
  "cancelled",
  "failed",
  "completed",
] as const;
export type RunState = (typeof runStates)[number];
export const terminalStates: ReadonlySet<RunState> = new Set([
  "cancelled",
  "failed",
  "completed",
]);
export const modelRoles = z
  .object({
    executor: z.string().min(1).max(200),
    planner: z.string().max(200).optional(),
    evaluator: z.string().max(200).optional(),
    advisor: z.string().max(200).optional(),
    vision: z.string().max(200).optional(),
    embedding: z.string().max(200).optional(),
  })
  .strict();
export const modelConfigurationProfile = z.object({capabilities:modelCapabilityDeclaration.optional(),api:z.enum(["auto","chat_completions","responses"]).optional(),preset:z.enum(["auto","gpt-6-chat-tools","gpt-6-responses-tools","gpt-5.6","gpt-5-reasoning","gpt-standard","claude-modern","claude-4.6","claude-legacy","custom"]).optional(),reasoningEffort:z.enum(["none","minimal","low","medium","high","xhigh","max"]).optional(),temperature:z.number().min(0).max(2).optional(),topP:z.number().min(0).max(1).optional()}).strict();
export const providerSpec = z
  .object({
    kind: z.enum(["ollama", "litellm", "openai", "kidos-gateway"]),
    endpoint: z.string().url(),
    roles: modelRoles,
    credentialRef: identifier.optional(),
    profile: modelConfigurationProfile.optional(),
    modelProfiles: z.record(z.string().min(1).max(200), modelConfigurationProfile)
      .refine(value => Object.keys(value).length <= 500, "Too many model profiles.").optional(),
    corporateCa: z.array(z.string().max(65536).regex(/^-----BEGIN CERTIFICATE-----[\s\S]+-----END CERTIFICATE-----\s*$/)).max(512).optional(),
    authHeader: z
      .enum(["authorization", "api-key", "ocp-apim-subscription-key"])
      .default("authorization"),
  })
  .strict();
export type ProviderSpec = z.infer<typeof providerSpec>;
export const contentBlock = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string().max(1_000_000) }).strict(),
  z.object({ type: z.literal("image"), attachmentId: identifier, detail: z.enum(["auto", "low", "high"]).default("auto") }).strict(),
]);
export const message = z
  .object({
    id: identifier.optional(),
    role: z.enum(["user", "assistant", "system"]),
    content: z.union([z.string().max(1_000_000), z.array(contentBlock).max(100)]),
  })
  .strict()
  .refine((message) => message.role === "user" || typeof message.content === "string" || message.content.every((block) => block.type === "text"),
    "Images are accepted only in user messages.");
/** Read-only, single-call model tasks. These never admit tools or parental authority. */
export const modelAssistance = z.discriminatedUnion("purpose", [
  z.object({ purpose: z.literal("catalog"), provider: providerSpec,
    instructions: z.string().max(1_000_000), images: z.array(identifier).max(4).default([]) }).strict(),
  z.object({ purpose: z.literal("advisor"), provider: providerSpec, prompt: z.string().max(100_000) }).strict(),
  z.object({ purpose: z.literal("connection"), provider: providerSpec }).strict(),
  z.object({ purpose: z.literal("embedding"), provider: providerSpec,
    model: z.string().min(1).max(200), endpoint: z.string().url().optional() }).strict(),
]);
export type ModelAssistance = z.infer<typeof modelAssistance>;
export type ModelAssistanceResult = { text: string; dimensions?: number };

export const toolSpec = z
  .object({
    name: identifier,
    description: z.string().max(8000),
    schema: z.record(z.string(), z.unknown()),
    effect: z.enum(["read", "write", "external"]),
    evidenceKind: z.enum(["test", "diagnostic", "diff", "visual", "command", "mcp", "note"]).optional(),
    host: z.string().max(128).optional(),
  })
  .strict();
export const runSpec = z
  .object({
    runtime: z.enum(["standard", "deep"]),
    mode: z.enum(["plan", "review", "execute"]),
    provider: providerSpec,
    messages: z.array(message).max(2000),
    systemPrompt: z.string().max(200_000),
    tools: z.array(toolSpec).max(200),
    goalId: identifier.optional(),
    productContext: z.record(z.string(), z.unknown()).optional(),
    workspace: workspaceOptions.optional(),
    recursionLimit: z.number().int().min(10).max(2000).default(240),
    files: z
      .record(
        z.string(),
        z
          .object({
            content: z.union([z.string(), z.array(z.string())]),
            encoding: z.enum(["utf-8", "base64"]).optional(),
            created_at: z.string(),
            modified_at: z.string(),
          })
          .strict(),
      )
      .optional(),
  })
  .strict();
export type RunSpec = z.infer<typeof runSpec>;
export type ToolSpec = z.infer<typeof toolSpec>;
export type Registration = {
  id: string;
  product: Product;
  profile: string;
  workspace: string;
  providers: ProviderSpec["kind"][];
  hostTools: string[];
  /** Installed adapter catalog. RPC tool descriptions cannot change its authority. */
  toolCatalog?: ToolSpec[];
};
export type ClientCredential = { registration: Registration; token: string };
export type Session = {
  id: string;
  namespace: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  importedFrom?: string;
};
export type Run = {
  id: string;
  sessionId: string;
  state: RunState;
  createdAt: number;
  updatedAt: number;
  result?: unknown;
  resultAvailable?: boolean;
  error?: string;
};
export type EngineEvent = {
  id: string;
  sequence: number;
  sessionId: string;
  runId?: string;
  timestamp: number;
  type: string;
  data: unknown;
  correlationId?: string;
};
export type EngineUpdateBlockers = {
  activeRuns: number;
  managedProcesses: number;
  modelOperations: number;
  desktopResources: number;
};
export type EngineUpdateStatus = {
  ready: boolean;
  quiescing: boolean;
  blockers: EngineUpdateBlockers;
};
/** An atomic public view. Graph checkpoints and private model context are excluded. */
export type SessionSnapshot = {
  schema: 1;
  session: Session;
  runs: Run[];
  domain: unknown;
  events: EngineEvent[];
  cursor: number;
  /** Recent events are bounded; older activity can be replayed from zero. */
  eventsComplete: boolean;
  pendingApprovals: { id: string; runId: string; payload: unknown; actionable: boolean }[];
  reconciliation: { runId: string; operationId: string; callId: string; tool: string }[];
};
export type RpcRequest = {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: unknown;
};
export type RpcResponse = {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};
export const rpcRequest = z
  .object({
    jsonrpc: z.literal("2.0"),
    id: z.union([z.string().max(128), z.number().int()]),
    method: z.string().max(128),
    params: z.unknown().optional(),
  })
  .strict();
export const MAX_FRAME_BYTES = 8 * 1024 * 1024;
export class AgentError extends Error {
  constructor(
    public readonly code: number,
    message: string,
    public readonly data?: unknown,
  ) {
    super(message);
  }
}
export const errors = {
  invalid: -32602,
  missing: -32004,
  forbidden: -32003,
  conflict: -32009,
  incompatible: -32010,
  unavailable: -32011,
  reconciliation: -32012,
} as const;
export function negotiate(protocol: string): void {
  if (protocol.split(".")[0] !== PROTOCOL_VERSION.split(".")[0])
    throw new AgentError(
      errors.incompatible,
      `Agent API ${PROTOCOL_VERSION} required.`,
    );
}
