import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import * as path from "node:path";
import type { DesktopAgentRuntime, DesktopMessage, DesktopRunMode, DesktopState, DesktopThread } from "./contracts";
import type { OllamaRecommendationPlan, OllamaRoleConfiguration } from "../src/ollama-recommendation";

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

  public async update(values: Partial<Pick<DesktopState, "workspacePath" | "modelRoles" | "ollamaPublicCatalogEnabled" | "lastRecommendation" | "mode" | "agentRuntime" | "activeThreadId">>): Promise<void> {
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
  return (record.source === "baseline" || record.source === "advisor")
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
      updatedAt: typeof record.updatedAt === "number" ? record.updatedAt : Date.now()
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
  return [{
    id: typeof message.id === "string" ? message.id : randomUUID(),
    role: message.role,
    text: message.text,
    createdAt: typeof message.createdAt === "number" ? message.createdAt : Date.now(),
    ...(message.status === "complete" || message.status === "streaming" || message.status === "failed" ? { status: message.status } : {}),
    ...(executionSteps?.length ? { executionSteps } : {})
  }];
}
