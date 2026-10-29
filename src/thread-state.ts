import { isRunMode } from "./autonomy";
import type { RunMode } from "./types";

export const MAX_LOCAL_THREADS = 30;

export type ThreadMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
  runId?: string;
  status?: "complete";
  completedAt?: number;
};

export type ThreadPartialAssistant = {
  id: string;
  content: string;
  createdAt: number;
  updatedAt: number;
  sequence: number;
};

export type ThreadRunRecovery = {
  id: string;
  status: "running" | "interrupted" | "failed" | "cancelled";
  mode: RunMode;
  runtime: "standard" | "deep";
  startedAt: number;
  updatedAt: number;
  ownerSessionId?: string;
  ownerPid?: number;
  partialAssistant?: ThreadPartialAssistant;
};

export type LocalThread = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ThreadMessage[];
  pinned?: boolean;
  unread?: boolean;
  recovery?: ThreadRunRecovery;
};

export type ThreadCollection = {
  version: 1;
  activeThreadId: string;
  threads: LocalThread[];
};

export type ThreadSummary = {
  id: string;
  title: string;
  updatedAt: number;
  messageCount: number;
  pinned: boolean;
  unread?: boolean;
  recoveryStatus?: ThreadRunRecovery["status"];
};

export type ThreadSnapshot = {
  activeThreadId: string;
  threads: ThreadSummary[];
  messages: ThreadMessage[];
  recovery?: ThreadRunRecovery;
};

type NormalizationOptions = {
  now?: number;
  createId?: () => string;
};

type StageThreadRequestOptions = {
  now?: number;
  createId?: () => string;
  replacePendingUser?: boolean;
};

export function createLocalThread(id: string, now: number, title = "New thread"): LocalThread {
  return { id, title, createdAt: now, updatedAt: now, messages: [] };
}

export function normalizeThreadCollection(
  value: unknown,
  options: NormalizationOptions = {}
): ThreadCollection {
  const now = options.now ?? Date.now();
  const createId = options.createId ?? (() => crypto.randomUUID());
  const record = isRecord(value) ? value : undefined;

  if (record?.version === 1 && Array.isArray(record.threads)) {
    const threads = record.threads
      .map((thread, index) => normalizeThread(thread, now - index, createId))
      .filter((thread): thread is LocalThread => Boolean(thread));
    return boundedCollection(threads, stringValue(record.activeThreadId), now, createId);
  }

  if (typeof value === "string" && value.trim()) {
    const thread = createLocalThread(value, now);
    return { version: 1, activeThreadId: thread.id, threads: [thread] };
  }

  if (record?.id && Array.isArray(record.messages)) {
    const migrated = normalizeThread(record, now, createId);
    if (migrated) return { version: 1, activeThreadId: migrated.id, threads: [migrated] };
  }

  const thread = createLocalThread(createId(), now);
  return { version: 1, activeThreadId: thread.id, threads: [thread] };
}

export function summarizeThreads(collection: ThreadCollection): ThreadSummary[] {
  return [...collection.threads]
    .sort(compareThreads)
    .map((thread) => ({
      id: thread.id,
      title: thread.title,
      updatedAt: thread.updatedAt,
      messageCount: thread.messages.length,
      pinned: Boolean(thread.pinned),
      ...(thread.unread ? { unread: true } : {}),
      ...(thread.recovery ? { recoveryStatus: thread.recovery.status } : {})
    }));
}

export function titleFromRequest(request: string, maximumLength = 56): string {
  const normalized = request.replace(/\s+/g, " ").trim();
  if (!normalized) return "New thread";
  if (normalized.length <= maximumLength) return normalized;
  return `${normalized.slice(0, Math.max(1, maximumLength - 1)).trimEnd()}…`;
}

export function stageThreadRequest(
  thread: LocalThread,
  request: string,
  options: StageThreadRequestOptions = {}
): ThreadMessage[] {
  const now = options.now ?? Date.now();
  const createId = options.createId ?? (() => crypto.randomUUID());
  const pendingRecovery = thread.recovery?.status === "failed"
    || thread.recovery?.status === "cancelled"
    || thread.recovery?.status === "interrupted";
  // A failed/cancelled request is not a completed conversational turn. If
  // the user types a new request instead of pressing Retry/Edit, replace that
  // orphaned user message rather than replaying it alongside the new intent.
  // This prevents a missing final assistant message from making the next run
  // repeat the previous review forever.
  const replaceUnfinishedUser = !options.replacePendingUser
    && pendingRecovery
    && thread.messages.at(-1)?.role === "user";
  const priorMessages = options.replacePendingUser || replaceUnfinishedUser
    ? thread.messages.slice(0, -1)
    : [...thread.messages];

  if (options.replacePendingUser || replaceUnfinishedUser) {
    const pending = thread.messages.at(-1);
    if (!pending || pending.role !== "user") {
      throw new Error("There is no unfinished request to retry in this thread.");
    }
    thread.messages[thread.messages.length - 1] = {
      ...pending,
      content: request,
      createdAt: now
    };
  } else {
    thread.messages.push({
      id: createId(),
      role: "user",
      content: request,
      createdAt: now
    });
  }
  thread.updatedAt = now;
  return priorMessages;
}

export function discardUnfinishedRequest(thread: LocalThread, now = Date.now()): ThreadMessage {
  if (thread.recovery?.status === "running") {
    throw new Error("The request is still running and cannot be discarded.");
  }
  const pending = thread.messages.at(-1);
  if (!pending || pending.role !== "user") {
    throw new Error("There is no unfinished request to discard in this thread.");
  }
  thread.messages.pop();
  delete thread.recovery;
  thread.updatedAt = now;
  if (!thread.messages.length) thread.title = "New thread";
  return pending;
}

export function compactThreadMessages(
  messages: ThreadMessage[],
  maximumCharacters: number,
  maximumMessages = 30
): ThreadMessage[] {
  const groups: ThreadMessage[][] = [];
  for (const message of messages) {
    if (message.role === "user") {
      groups.push([message]);
    } else if (groups.length) {
      groups.at(-1)!.push(message);
    }
  }

  const retained: ThreadMessage[][] = [];
  let characters = 0;
  let messageCount = 0;
  for (let index = groups.length - 1; index >= 0; index -= 1) {
    const group = groups[index]!;
    const groupCharacters = group.reduce((sum, message) => sum + message.content.length, 0);
    if (messageCount + group.length > maximumMessages || characters + groupCharacters > maximumCharacters) {
      if (!retained.length) retained.unshift(truncateThreadGroup(group, maximumCharacters, maximumMessages));
      break;
    }
    retained.unshift(group);
    characters += groupCharacters;
    messageCount += group.length;
  }
  return retained.flat();
}

export function boundedThreadCollection(collection: ThreadCollection): ThreadCollection {
  return boundedCollection(
    collection.threads,
    collection.activeThreadId,
    Date.now(),
    () => crypto.randomUUID()
  );
}

function boundedCollection(
  inputThreads: LocalThread[],
  requestedActiveId: string | undefined,
  now: number,
  createId: () => string
): ThreadCollection {
  const unique = new Map<string, LocalThread>();
  for (const thread of inputThreads) {
    if (!unique.has(thread.id)) unique.set(thread.id, thread);
  }
  let threads = [...unique.values()].sort(compareThreads);
  const requestedActive = requestedActiveId ? unique.get(requestedActiveId) : undefined;
  threads = threads.slice(0, MAX_LOCAL_THREADS);
  if (requestedActive && !threads.some((thread) => thread.id === requestedActive.id)) {
    threads[threads.length - 1] = requestedActive;
  }
  if (!threads.length) threads = [createLocalThread(createId(), now)];
  const activeThreadId = threads.some((thread) => thread.id === requestedActiveId)
    ? requestedActiveId!
    : threads[0]!.id;
  return { version: 1, activeThreadId, threads };
}

function normalizeThread(
  value: unknown,
  fallbackTime: number,
  createId: () => string
): LocalThread | undefined {
  if (!isRecord(value)) return undefined;
  const id = stringValue(value.id) || createId();
  const messages = Array.isArray(value.messages)
    ? value.messages
        .map((message, index) => normalizeMessage(message, fallbackTime + index, createId))
        .filter((message): message is ThreadMessage => Boolean(message))
    : [];
  const createdAt = finiteNumber(value.createdAt) ?? messages[0]?.createdAt ?? fallbackTime;
  const updatedAt = finiteNumber(value.updatedAt) ?? messages.at(-1)?.createdAt ?? createdAt;
  const title = stringValue(value.title) || titleFromRequest(
    messages.find((message) => message.role === "user")?.content ?? ""
  );
  const recovery = messages.at(-1)?.role === "user"
    ? normalizeRecovery(value.recovery, updatedAt, createId)
    : undefined;
  return {
    id,
    title,
    createdAt,
    updatedAt,
    messages,
    ...(value.pinned === true ? { pinned: true } : {}),
    ...(value.unread === true ? { unread: true } : {}),
    ...(recovery ? { recovery } : {})
  };
}

function compareThreads(left: LocalThread, right: LocalThread): number {
  const pinnedDifference = Number(Boolean(right.pinned)) - Number(Boolean(left.pinned));
  return pinnedDifference || right.updatedAt - left.updatedAt;
}

function normalizeRecovery(
  value: unknown,
  fallbackTime: number,
  createId: () => string
): ThreadRunRecovery | undefined {
  if (!isRecord(value)) return undefined;
  const status = ["running", "interrupted", "failed", "cancelled"].includes(String(value.status))
    ? value.status as ThreadRunRecovery["status"]
    : undefined;
  const mode = isRunMode(value.mode) ? value.mode : undefined;
  const runtime = value.runtime === "deep" ? "deep" : value.runtime === "standard" ? "standard" : undefined;
  if (!status || !mode || !runtime) return undefined;
  const ownerPid = finiteNumber(value.ownerPid);
  const ownerSessionId = stringValue(value.ownerSessionId);
  const partialAssistant = normalizePartialAssistant(value.partialAssistant, fallbackTime, createId);
  return {
    id: stringValue(value.id) || createId(),
    status,
    mode,
    runtime,
    startedAt: finiteNumber(value.startedAt) ?? fallbackTime,
    updatedAt: finiteNumber(value.updatedAt) ?? fallbackTime,
    ...(ownerSessionId ? { ownerSessionId } : {}),
    ...(ownerPid && Number.isInteger(ownerPid) && ownerPid > 0 ? { ownerPid } : {}),
    ...(partialAssistant ? { partialAssistant } : {})
  };
}

function normalizeMessage(
  value: unknown,
  fallbackTime: number,
  createId: () => string
): ThreadMessage | undefined {
  if (!isRecord(value)) return undefined;
  const role = value.role === "user" || value.role === "assistant" ? value.role : undefined;
  const content = stringValue(value.content);
  if (!role || !content) return undefined;
  const runId = stringValue(value.runId);
  const completedAt = finiteNumber(value.completedAt);
  return {
    id: stringValue(value.id) || createId(),
    role,
    content,
    createdAt: finiteNumber(value.createdAt) ?? fallbackTime,
    ...(runId ? { runId } : {}),
    ...(value.status === "complete" ? { status: "complete" as const } : {}),
    ...(completedAt !== undefined ? { completedAt } : {})
  };
}

function normalizePartialAssistant(
  value: unknown,
  fallbackTime: number,
  createId: () => string
): ThreadPartialAssistant | undefined {
  if (!isRecord(value)) return undefined;
  const content = typeof value.content === "string" ? value.content.slice(0, 200_000) : "";
  if (!content) return undefined;
  const createdAt = finiteNumber(value.createdAt) ?? fallbackTime;
  const sequence = finiteNumber(value.sequence);
  return {
    id: stringValue(value.id) || createId(),
    content,
    createdAt,
    updatedAt: finiteNumber(value.updatedAt) ?? createdAt,
    sequence: sequence !== undefined && Number.isInteger(sequence) && sequence >= 0 ? sequence : 0
  };
}

function truncateThreadGroup(
  group: ThreadMessage[],
  maximumCharacters: number,
  maximumMessages: number
): ThreadMessage[] {
  const selected = group.slice(0, Math.max(1, maximumMessages));
  let remainingCharacters = Math.max(1, maximumCharacters);
  return selected.map((message, index) => {
    const remainingMessages = selected.length - index;
    const allocation = Math.max(1, Math.floor(remainingCharacters / remainingMessages));
    const content = message.content.length <= allocation
      ? message.content
      : `${message.content.slice(0, Math.max(0, allocation - 1))}…`;
    remainingCharacters -= content.length;
    return { ...message, content };
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
