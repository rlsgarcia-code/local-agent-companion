import { appendFile, mkdir, rename, stat } from "node:fs/promises";
import * as path from "node:path";
import { redactSensitiveText } from "./redaction";

const LOG_DIRECTORY = path.join(".local-agent", "logs");
const LOG_FILE = "agent.log";
const ROTATED_FILE = "agent.log.1";
const MAX_LOG_BYTES = 1_000_000;
const MAX_EVENT_BYTES = 24_000;

const OMITTED_FIELDS = /^(?:api[-_]?key|authorization|token|secret|password|prompt|input|messages|content|body)$/i;

function safeEvent(value: unknown, knownSecrets: readonly string[]): unknown {
  if (typeof value === "string") return redactSensitiveText(value.slice(0, 2_000), knownSecrets);
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, 32).map((item) => safeEvent(item, knownSecrets));
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value).slice(0, 64)) {
      if (OMITTED_FIELDS.test(key)) continue;
      result[key] = safeEvent(item, knownSecrets);
    }
    return result;
  }
  return undefined;
}

/**
 * Appends a bounded, secret-free operational event for local troubleshooting.
 * Request prompts, message bodies, and credentials are deliberately omitted.
 */
export async function appendAgentLog(
  workspaceRoot: string,
  event: Record<string, unknown>,
  knownSecrets: readonly string[] = []
): Promise<void> {
  const directory = path.join(workspaceRoot, LOG_DIRECTORY);
  const file = path.join(directory, LOG_FILE);
  await mkdir(directory, { recursive: true });
  try {
    if ((await stat(file)).size >= MAX_LOG_BYTES) {
      await rename(file, path.join(directory, ROTATED_FILE)).catch(() => undefined);
    }
  } catch {
    // The log is best effort and must never affect an agent run.
  }
  const sanitized = safeEvent(event, knownSecrets);
  const payload: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    ...(sanitized && typeof sanitized === "object" && !Array.isArray(sanitized) ? sanitized : {})
  };
  let line = JSON.stringify(payload);
  if (Buffer.byteLength(line, "utf8") > MAX_EVENT_BYTES) {
    line = JSON.stringify({
      timestamp: payload.timestamp,
      event: payload.event,
      status: payload.status,
      detail: typeof payload.detail === "string" ? payload.detail.slice(0, 4_000) : undefined,
      truncated: true
    });
  }
  await appendFile(file, `${line}\n`, { encoding: "utf8", mode: 0o600 });
}

export const agentLogPath = LOG_DIRECTORY;
