import { z } from "zod";

export const PROTOCOL_VERSION = "1.0" as const;
export const ENGINE_VERSION = "1.0.0-rc.1";
export const NODE_VERSION = "22.23.4";
export const products = ["companion-mac", "companion-vscode", "kidos"] as const;
export type Product = (typeof products)[number];
export const runStates = [
  "running",
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
export const identifier = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9_.:-]+$/);
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
export const providerSpec = z
  .object({
    kind: z.enum(["ollama", "litellm", "openai", "kidos-gateway"]),
    endpoint: z.string().url(),
    roles: modelRoles,
    credentialRef: identifier.optional(),
    authHeader: z
      .enum(["authorization", "api-key", "ocp-apim-subscription-key"])
      .default("authorization"),
  })
  .strict();
export type ProviderSpec = z.infer<typeof providerSpec>;
export const message = z
  .object({
    role: z.enum(["user", "assistant", "system"]),
    content: z.string().max(1_000_000),
  })
  .strict();
export const toolSpec = z
  .object({
    name: identifier,
    description: z.string().max(8000),
    schema: z.record(z.string(), z.unknown()),
    effect: z.enum(["read", "write", "external"]),
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
    recursionLimit: z.number().int().min(10).max(2000).default(240),
    files: z
      .record(
        z.string(),
        z
          .object({
            content: z.array(z.string()),
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
