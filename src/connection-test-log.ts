import { randomUUID } from "node:crypto";
import { appendAgentLog } from "./agent-log";
import type { ConnectionDiagnostic } from "./types";

export const CONNECTION_FAILURE_KINDS = ["agent_api_timeout", "model_not_found", "authentication", "rate_limit", "gateway_http", "certificate", "dns", "provider_timeout", "cancelled", "network", "configuration", "unknown"] as const;
export type ConnectionFailureKind = typeof CONNECTION_FAILURE_KINDS[number];

/** Classify errors without serializing provider response bodies, causes or request objects. */
export function connectionFailure(error: unknown): { failureKind: ConnectionFailureKind; httpStatus?: number } {
  const message = error instanceof Error ? error.message : String(error);
  const statusValue = error && typeof error === "object" ? (error as { status?: unknown }).status : undefined;
  const status = typeof statusValue === "number" && statusValue >= 400 && statusValue <= 599
    ? statusValue : Number(/\b([45]\d\d)\b/.exec(message)?.[1]) || undefined;
  let failureKind: ConnectionFailureKind = "unknown";
  if (/Agent API timeout/.test(message)) failureKind = "agent_api_timeout";
  else if (status === 404 && /model.*not[ _-]?found|model_not_found|no.*model/i.test(message)) failureKind = "model_not_found";
  else if (status === 401 || status === 403) failureKind = "authentication";
  else if (status === 429) failureKind = "rate_limit";
  else if (status) failureKind = "gateway_http";
  else if (/certificate|CERT_|self.signed|unable to verify/i.test(message)) failureKind = "certificate";
  else if (/ENOTFOUND|EAI_AGAIN|DNS/i.test(message)) failureKind = "dns";
  else if (/timeout|timed out/i.test(message)) failureKind = "provider_timeout";
  else if (/abort|cancel/i.test(message)) failureKind = "cancelled";
  else if (/ECONN|fetch failed|network/i.test(message)) failureKind = "network";
  else if (/required|configure|declare|invalid|profile|alias|workspace|unsupported|not allow/i.test(message)) failureKind = "configuration";
  return { failureKind, ...(status ? { httpStatus: status } : {}) };
}

export class ConnectionTestLog {
  readonly id = randomUUID();
  available = false;
  constructor(private readonly root: string | undefined, private readonly metadata: { provider: string; model: string; api?: string; reasoningEffort?: string }, private readonly secrets: readonly string[] = []) {}
  async record(phase: "started" | "finished", stage: string, diagnostic?: ConnectionDiagnostic): Promise<void> {
    if (!this.root) return;
    try {
      await appendAgentLog(this.root, {
        event: "connection-test", testId: this.id, phase, stage,
        ...this.metadata, platform: process.platform, architecture: process.arch,
        ...(stage === "chat" || stage === "embeddings" ? { operation: "models.assist" } : {}),
        ...(diagnostic ? { status: diagnostic.status, durationMs: diagnostic.durationMs,
          failureKind: diagnostic.failureKind, httpStatus: diagnostic.httpStatus } : {}),
      }, this.secrets);
      this.available = true;
    } catch { this.available = false; /* Logging never changes the connection result. */ }
  }
}
