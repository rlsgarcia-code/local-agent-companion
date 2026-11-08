import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";
import {
  interrupt,
  type BaseCheckpointSaver,
} from "@langchain/langgraph";
import { ChatOpenAICompletions } from "@langchain/openai";
import { StateBackend } from "deepagents";
import { tool } from "langchain";
import { z } from "zod";
import {
  AgentError,
  errors,
  type Registration,
  type RunSpec,
  type ToolSpec,
} from "../../contracts/src/index";
import { gatewayFetch } from "./gateway";
import { extractFinalAssistantText } from "./assistant-final";
import { executePreparedGraph } from "./graph-executor";
import type { ToolRuntime } from "@langchain/core/tools";
import { graphOperationId } from "./operations";
import { evaluateGoalEvidence, type GoalEvidence } from "./goal-evaluation";
import type { GoalRecord, GoalEvaluation } from "../../contracts/src/goal-state";
import { contentHash } from "../../contracts/src/identity";

export type ExecutionContext = {
  registration: Registration;
  threadId: string;
  checkpointer: BaseCheckpointSaver;
  signal: AbortSignal;
  credential?: string;
  emit: (type: string, data: unknown) => void;
  invokeTool: (
    tool: ToolSpec,
    input: unknown,
    callId: string,
  ) => Promise<unknown>;
  /** Test/model adapters are injected by the process owner, never by RPC. */
  model?: BaseChatModel;
  models?: Partial<Record<"executor" | "planner" | "evaluator", BaseChatModel>>;
  goal?: GoalRecord;
  evidence?: () => GoalEvidence[];
  memo?: { get: (key: string) => unknown; put: (key: string, value: unknown) => void };
  requireCheckpoint?: boolean;
  reconciliations?: Record<string, unknown>;
  resolveAttachment?: (id: string) => Promise<{ mime: string; data: string }>;
};

export function validateProvider(
  reg: Registration,
  spec: RunSpec["provider"],
): URL {
  if (!reg.providers.includes(spec.kind))
    throw new AgentError(
      errors.forbidden,
      "This product does not permit the requested provider.",
    );
  const url = new URL(spec.endpoint);
  if (url.username || url.password || url.hash || url.search)
    throw new AgentError(
      errors.invalid,
      "Provider URLs cannot contain credentials, query or fragment.",
    );
  if (spec.kind === "ollama") {
    if (
      !["127.0.0.1", "[::1]", "localhost"].includes(url.hostname) ||
      !["http:", "https:"].includes(url.protocol) ||
      !/^\/v1\/?$/.test(url.pathname)
    )
      throw new AgentError(
        errors.forbidden,
        "Ollama must use an explicit loopback /v1 endpoint.",
      );
  } else if (spec.kind === "openai") {
    if (url.href.replace(/\/$/, "") !== "https://api.openai.com/v1")
      throw new AgentError(
        errors.forbidden,
        "OpenAI variant permits only the fixed Chat Completions endpoint.",
      );
  } else if (spec.kind === "kidos-gateway") {
    if (url.href.replace(/\/$/, "") !== "http://127.0.0.1:8788")
      throw new AgentError(
        errors.forbidden,
        "KidOS uses only its protected local gateway.",
      );
  } else if (url.protocol !== "https:")
    throw new AgentError(
      errors.forbidden,
      "LiteLLM requires the configured HTTPS endpoint.",
    );
  return url;
}

export async function executeGraph(
  spec: RunSpec,
  context: ExecutionContext,
): Promise<{ text: string; files?: unknown; goalEvaluation?: GoalEvaluation }> {
  validateProvider(context.registration, spec.provider);
  for (const definition of spec.tools) {
    if (!context.registration.hostTools.includes(definition.name))
      throw new AgentError(
        errors.forbidden,
        `Tool is not registered: ${definition.name}`,
      );
    if (
      context.registration.product === "kidos" &&
      !definition.name.startsWith("kidos_")
    )
      throw new AgentError(
        errors.forbidden,
        "KidOS tools must be mediated by Core.",
      );
  }
  if (!context.model && !context.models?.executor && spec.provider.kind === "kidos-gateway")
    throw new AgentError(
      errors.unavailable,
      "Install the signed KidOS model adapter before starting a KidOS run.",
    );
  const hasImages = spec.messages.some((message) => Array.isArray(message.content) && message.content.some((block) => block.type === "image"));
  const modelForRole = (role: "executor" | "planner" | "evaluator"): BaseChatModel => {
    const supplied = context.models?.[role] ?? (role === "executor" ? context.model : undefined);
    if (supplied) return supplied;
    if (spec.provider.kind === "kidos-gateway")
      throw new AgentError(errors.unavailable, "The protected model adapter did not provide this configured role.");
    return new ChatOpenAICompletions({
      model: role === "executor" && hasImages && spec.provider.roles.vision ? spec.provider.roles.vision : spec.provider.roles[role] || spec.provider.roles.executor,
      apiKey: context.credential || "ollama-local",
      streaming: role === "executor",
      maxRetries: 0,
      configuration: {
        baseURL: spec.provider.endpoint,
        defaultHeaders:
          context.credential && spec.provider.authHeader !== "authorization"
            ? { [spec.provider.authHeader]: context.credential }
            : undefined,
        fetch: gatewayFetch(
          `${spec.provider.endpoint.replace(/\/$/, "")}/chat/completions`,
          spec.provider.authHeader !== "authorization",
          undefined,
          context.signal,
        ),
      },
    });
  };
  const model = modelForRole("executor");
  let systemPrompt = spec.systemPrompt;
  if (spec.runtime === "deep" && spec.provider.roles.planner) {
    let guidance = context.memo?.get("planner") as string | undefined;
    if (guidance === undefined) {
    const planned = await modelForRole("planner").invoke([
      new SystemMessage("Produce concise planning guidance for the executor: at most eight concrete actions. Do not claim to execute tools or finish the task. Do not provide private reasoning."),
      new HumanMessage(JSON.stringify({ request: spec.messages.filter((message) => message.role === "user").at(-1)?.content, mode: spec.mode })),
    ], { signal: context.signal });
    guidance = planned.text.slice(0, 8000);
    context.memo?.put("planner", guidance);
    }
    systemPrompt += `\n\nAdvisory planner guidance; verify through the authorized tools:\n${guidance}`;
  }
  const tools = spec.tools.map((definition) =>
    tool(
      async (input, runtime) => {
        context.signal.throwIfAborted();
        if (spec.mode === "plan" && definition.effect !== "read")
          throw new AgentError(
            errors.forbidden,
            "Plan mode cannot perform mutations.",
          );
        const toolRuntime = runtime as unknown as ToolRuntime;
        const providerCallId = toolRuntime.toolCall?.id;
        const state = toolRuntime.state as { messages?: { id?: string; tool_calls?: unknown[] }[] } | undefined;
        const messageId = [...(state?.messages ?? [])].reverse().find((message) => message.tool_calls?.length)?.id;
        // Provider IDs can repeat in later model turns. The persisted AI message
        // distinguishes graph invocations while remaining stable on replay.
        const callId = graphOperationId(toolRuntime.config.configurable, messageId, providerCallId);
        let result: unknown;
        try {
          result = await context.invokeTool(definition, input, callId);
        } catch (error) {
          if (
            error instanceof AgentError &&
            error.code === errors.reconciliation
          ) {
            // LangGraph interrupts escape tool error handling and cannot be
            // converted into an error message followed by an automatic retry.
            interrupt({ kind: "tool_reconciliation", callId });
          }
          throw error;
        }
        return typeof result === "string" ? result : JSON.stringify(result);
      },
      {
        name: definition.name,
        description: definition.description,
        schema: z.fromJSONSchema(
          definition.schema as Parameters<typeof z.fromJSONSchema>[0],
        ),
      },
    ),
  );
  const messages = await Promise.all(spec.messages.map(async (message) => {
    const content = typeof message.content === "string" ? message.content : await Promise.all(message.content.map(async (block) => {
      if (block.type === "text") return block;
      if (!context.resolveAttachment) throw new AgentError(errors.unavailable, "The authenticated attachment adapter is unavailable.");
      const image = await context.resolveAttachment(block.attachmentId);
      return { type: "image_url" as const, image_url: { url: `data:${image.mime};base64,${image.data}`, detail: block.detail } };
    }));
    const fields = { content, ...(message.id ? { id: message.id } : {}) };
    return message.role === "user" ? new HumanMessage(fields) : message.role === "assistant" ? new AIMessage(fields) : new SystemMessage(fields);
  }));
  // Both products use the official graph/tool execution and checkpoint machinery.
  // StateBackend contains virtual files only; it never grants OS filesystem or shell access.
  const state = await executePreparedGraph({
    runtime: spec.runtime,
    graph: { model, tools, systemPrompt, checkpointer: context.checkpointer,
      ...(spec.runtime === "deep" ? { backend: new StateBackend() } : {}) },
    threadId: context.threadId, signal: context.signal, recursionLimit: spec.recursionLimit,
    initial: { messages, ...(spec.files ? { files: spec.files } : {}) },
    reconciliations: context.reconciliations,
    requireCheckpoint: context.requireCheckpoint,
    delta: async (text) => context.emit("text.delta", { text }),
    turn: async (toolTurn) => { if (toolTurn) context.emit("text.reset", {}); },
  });
  const text = extractFinalAssistantText(state);
  if (!text)
    throw new Error("The graph stopped without a final assistant response.");
  const files =
    state && typeof state === "object" && "files" in state
      ? state.files
      : undefined;
  context.emit("text.final", { text });
  let goalEvaluation: GoalEvaluation | undefined;
  if (context.goal) {
    const virtualEvidence: GoalEvidence[] = [];
    if (files && typeof files === "object") for (const [name, value] of Object.entries(files)) {
      const previous = spec.files?.[name];
      if (contentHash(value) !== contentHash(previous ?? null)) virtualEvidence.push({
        operationId: `virtual:${contentHash(name)}`, kind: "diff", status: "completed",
        result: { kind: "virtual_file", path: name, beforeSha256: previous ? contentHash(previous) : null, afterSha256: contentHash(value) },
      });
    }
    try {
      goalEvaluation = await evaluateGoalEvidence(modelForRole("evaluator"), context.goal, text,
        [...(context.evidence?.() ?? []), ...virtualEvidence], context.signal);
    } catch (error) {
      if (context.signal.aborted || [401, 403].includes(Number((error as { status?: number })?.status))) throw error;
      goalEvaluation = { decision: "blocked", criteria: [], completedMilestones: [],
        reason: "The evidence evaluation failed. The response and work remain saved for explicit continuation." };
    }
  }
  return { text, ...(files ? { files } : {}), ...(goalEvaluation ? { goalEvaluation } : {}) };
}
