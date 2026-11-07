import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import * as path from "node:path";
import type { DesktopAgentRuntime, DesktopMessage, DesktopRunMode, DesktopRunOutputs, DesktopState, DesktopThread } from "./contracts";
import { redactSensitiveText } from "../src/redaction";
import {
  OLLAMA_RECOMMENDATION_SCHEMA_VERSION,
  type OllamaRecommendationPlan,
  type OllamaRoleConfiguration
} from "../src/ollama-recommendation";

const DEFAULT_MODEL = "qwen3-coder:30b";
const MAX_EXECUTION_STEPS = 60;
const MAX_EXECUTION_STEP_CHARACTERS = 12_000;

export class DesktopStateStore {
  private state: DesktopState;

  private constructor(private readonly filePath: string, initial: DesktopState) {
    this.state = initial;
  }

  public static async open(filePath: string): Promise<DesktopStateStore> {
    let stored: Partial<DesktopState> & { model?: unknown } = {};
    try {
      stored = JSON.parse(await readFile(filePath, "utf8")) as Partial<DesktopState>;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const threads = normalizeThreads(stored.threads);
    const initial = threads[0] ?? createThread();
    if (!threads.length) threads.push(initial);
    return new DesktopStateStore(filePath, {
      workspacePath: typeof stored.workspacePath === "string" ? stored.workspacePath : "",
      modelRoles: normalizeModelRoles(stored.modelRoles, stored.model),
      ollamaPublicCatalogEnabled: stored.ollamaPublicCatalogEnabled === true,
      dockerSandboxEnabled: stored.dockerSandboxEnabled === true,
      ...(isRecommendationPlan(stored.lastRecommendation) ? { lastRecommendation: stored.lastRecommendation } : {}),
      mode: parseMode(stored.mode),
      agentRuntime: parseAgentRuntime(stored.agentRuntime),
      activeThreadId: threads.some((thread) => thread.id === stored.activeThreadId) ? stored.activeThreadId! : initial.id,
      threads
    });
  }

  public snapshot(): DesktopState {
    return structuredClone(this.state);
  }

  public activeThread(): DesktopThread {
    return this.thread(this.state.activeThreadId);
  }

  public thread(id: string): DesktopThread {
    const thread = this.state.threads.find((candidate) => candidate.id === id);
    if (!thread) throw new Error("Conversation not found.");
    return thread;
  }

  public async update(values: Partial<Pick<DesktopState, "workspacePath" | "modelRoles" | "ollamaPublicCatalogEnabled" | "dockerSandboxEnabled" | "lastRecommendation" | "mode" | "agentRuntime" | "activeThreadId">>): Promise<void> {
    this.state = { ...this.state, ...values };
    await this.save();
  }

  public async createThread(): Promise<DesktopThread> {
    const thread = createThread();
    this.state.threads.unshift(thread);
    this.state.activeThreadId = thread.id;
    await this.save();
    return structuredClone(thread);
  }

  public async toggleThreadPinned(threadId: string): Promise<void> {
    const thread = this.thread(threadId);
    thread.pinned = !thread.pinned;
    await this.save();
  }

  public async appendMessage(threadId: string, message: DesktopThread["messages"][number]): Promise<void> {
    const thread = this.thread(threadId);
    thread.messages.push(message);
    thread.updatedAt = Date.now();
    if (message.role === "user" && thread.messages.filter((item) => item.role === "user").length === 1) {
      thread.title = titleFrom(message.text);
    }
    this.state.activeThreadId = threadId;
    await this.save();
  }

  public async replaceMessage(threadId: string, message: DesktopThread["messages"][number]): Promise<void> {
    const thread = this.thread(threadId);
    const index = thread.messages.findIndex((candidate) => candidate.id === message.id);
    if (index >= 0) thread.messages[index] = message;
    else thread.messages.push(message);
    thread.updatedAt = Date.now();
    await this.save();
  }

  private async save(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.tmp`;
    await writeFile(temporary, `${JSON.stringify(this.state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, this.filePath);
  }
}

function normalizeModelRoles(value: unknown, legacyModel: unknown): OllamaRoleConfiguration {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const executor = typeof record.executor === "string" && record.executor.trim()
    ? record.executor.trim()
    : typeof legacyModel === "string" && legacyModel.trim()
      ? legacyModel.trim()
      : DEFAULT_MODEL;
  const optional = (name: string): string | undefined => typeof record[name] === "string" && record[name].trim() ? record[name].trim() : undefined;
  return {
    executor,
    ...(optional("planner") ? { planner: optional("planner") } : {}),
    ...(optional("evaluator") ? { evaluator: optional("evaluator") } : {}),
    ...(optional("vision") ? { vision: optional("vision") } : {}),
    ...(optional("embedding") ? { embedding: optional("embedding") } : {})
  };
}

function isRecommendationPlan(value: unknown): value is OllamaRecommendationPlan {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<OllamaRecommendationPlan>;
  return record.schemaVersion === OLLAMA_RECOMMENDATION_SCHEMA_VERSION
    && (record.source === "baseline" || record.source === "advisor")
    && Boolean(record.roles && typeof record.roles.executor === "string")
    && Array.isArray(record.requiredPulls)
    && Array.isArray(record.warnings);
}

function createThread(): DesktopThread {
  const now = Date.now();
  return { id: randomUUID(), title: "Nova conversa", messages: [], createdAt: now, updatedAt: now };
}

function titleFrom(text: string): string {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > 48 ? `${compact.slice(0, 47)}…` : compact || "Nova conversa";
}

function parseMode(value: unknown): DesktopRunMode {
  return value === "execute" || value === "plan" ? value : "review";
}

function parseAgentRuntime(value: unknown): DesktopAgentRuntime {
  return value === "deep" ? "deep" : "standard";
}

function normalizeThreads(value: unknown): DesktopThread[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const record = candidate as Partial<DesktopThread>;
    if (typeof record.id !== "string" || !Array.isArray(record.messages)) return [];
    return [{
      id: record.id,
      title: typeof record.title === "string" ? record.title : "Conversa",
      messages: record.messages.flatMap(normalizeMessage),
      createdAt: typeof record.createdAt === "number" ? record.createdAt : Date.now(),
      updatedAt: typeof record.updatedAt === "number" ? record.updatedAt : Date.now(),
      ...(record.pinned === true ? { pinned: true } : {})
    }];
  }).slice(0, 100);
}

function normalizeMessage(value: unknown): DesktopMessage[] {
  if (!value || typeof value !== "object") return [];
  const message = value as Partial<DesktopMessage>;
  if ((message.role !== "user" && message.role !== "assistant") || typeof message.text !== "string") return [];
  const executionSteps = message.role === "assistant" && Array.isArray(message.executionSteps)
    ? message.executionSteps.flatMap((candidate) => {
        if (!candidate || typeof candidate !== "object") return [];
        const step = candidate as Record<string, unknown>;
        if (typeof step.id !== "string" || typeof step.text !== "string" || !step.text.trim()) return [];
        return [{
          id: step.id.slice(0, 200),
          text: step.text.slice(0, MAX_EXECUTION_STEP_CHARACTERS),
          createdAt: typeof step.createdAt === "number" ? step.createdAt : Date.now()
        }];
      }).slice(-MAX_EXECUTION_STEPS)
    : undefined;
  const outputs = normalizeRunOutputs(message.outputs);
  return [{
    id: typeof message.id === "string" ? message.id : randomUUID(),
    role: message.role,
    text: message.text,
    createdAt: typeof message.createdAt === "number" ? message.createdAt : Date.now(),
    ...(message.status === "complete" || message.status === "streaming" || message.status === "failed" ? { status: message.status } : {}),
    ...(executionSteps?.length ? { executionSteps } : {}),
    ...(outputs ? { outputs } : {})
  }];
}

function normalizeRunOutputs(value: unknown): DesktopRunOutputs | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Partial<DesktopRunOutputs>;
  const boundedCount = (candidate: unknown): number => typeof candidate === "number" && Number.isFinite(candidate)
    ? Math.max(0, Math.min(10_000, Math.round(candidate)))
    : 0;
  const previewUrls = Array.isArray(record.previewUrls)
    ? record.previewUrls.filter((url): url is string => typeof url === "string" && /^http:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?(?:\/|$)/i.test(url)).slice(0, 8)
    : [];
  const changes = Array.isArray(record.changes)
    ? record.changes.flatMap((change) => {
        if (!change || typeof change !== "object") return [];
        const item = change as { path?: unknown; kind?: unknown };
        if (typeof item.path !== "string" || !["created", "modified", "deleted"].includes(String(item.kind))) return [];
        return [{ path: item.path.slice(0, 1_000), kind: item.kind as "created" | "modified" | "deleted" }];
      }).slice(0, 500)
    : [];
  const commands = Array.isArray(record.commands)
    ? record.commands.flatMap((command) => {
        if (!command || typeof command !== "object") return [];
        const item = command as { title?: unknown; detail?: unknown; status?: unknown };
        if (typeof item.title !== "string" || !["complete", "failed"].includes(String(item.status))) return [];
        return [{
          title: redactSensitiveText(item.title).slice(0, 300),
          ...(typeof item.detail === "string" ? { detail: redactSensitiveText(item.detail).slice(0, 2_000) } : {}),
          status: item.status as "complete" | "failed"
        }];
      }).slice(0, 100)
    : [];
  const activities = Array.isArray(record.activities)
    ? record.activities.flatMap((activity) => {
        if (!activity || typeof activity !== "object") return [];
        const item = activity as { kind?: unknown; title?: unknown; detail?: unknown; status?: unknown };
        const kinds = ["context", "read", "search", "edit", "command", "thinking", "verification"];
        if (!kinds.includes(String(item.kind)) || typeof item.title !== "string" || !["complete", "failed"].includes(String(item.status))) return [];
        return [{
          kind: item.kind as "context" | "read" | "search" | "edit" | "command" | "thinking" | "verification",
          title: redactSensitiveText(item.title).slice(0, 300),
          ...(typeof item.detail === "string" ? { detail: redactSensitiveText(item.detail).slice(0, 2_000) } : {}),
          status: item.status as "complete" | "failed"
        }];
      }).slice(0, 200)
    : [];
  return {
    activityCount: boundedCount(record.activityCount),
    commandCount: boundedCount(record.commandCount),
    changeCount: boundedCount(record.changeCount),
    contextCount: boundedCount(record.contextCount),
    previewUrls,
    changes,
    commands,
    activities
  };
}
