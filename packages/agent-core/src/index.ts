import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";
import {
  Command,
  interrupt,
  type BaseCheckpointSaver,
} from "@langchain/langgraph";
import { ChatOpenAICompletions } from "@langchain/openai";
import { createDeepAgent, StateBackend } from "deepagents";
import { createAgent, tool } from "langchain";
import { z } from "zod";
import {
  AgentError,
  errors,
  type Registration,
  type RunSpec,
  type ToolSpec,
} from "../../contracts/src/index";
import { gatewayFetch } from "../../../src/gateway";
import { extractFinalAssistantText } from "../../../src/assistant-final";
import { consumeAssistantMessageStreams } from "../../../src/assistant-stream";

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
  reconciliations?: Record<string, unknown>;
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
): Promise<{ text: string; files?: unknown }> {
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
  if (!context.model && spec.provider.kind === "kidos-gateway")
    throw new AgentError(
      errors.unavailable,
      "Install the signed KidOS model adapter before starting a KidOS run.",
    );
  const model =
    context.model ??
    new ChatOpenAICompletions({
      model: spec.provider.roles.executor,
      apiKey: context.credential || "ollama-local",
      streaming: true,
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
  const tools = spec.tools.map((definition) =>
    tool(
      async (input, runtime) => {
        context.signal.throwIfAborted();
        if (spec.mode === "plan" && definition.effect !== "read")
          throw new AgentError(
            errors.forbidden,
            "Plan mode cannot perform mutations.",
          );
        const callId = runtime?.toolCall?.id;
        if (!callId)
          throw new Error(
            "A stable LangGraph tool call identifier is required.",
          );
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
  const messages = spec.messages.map((m) =>
    m.role === "user"
      ? new HumanMessage(m.content)
      : m.role === "assistant"
        ? new AIMessage(m.content)
        : new SystemMessage(m.content),
  );
  // Both products use the official graph/tool execution and checkpoint machinery.
  // StateBackend contains virtual files only; it never grants OS filesystem or shell access.
  const graph =
    spec.runtime === "deep"
      ? createDeepAgent({
          model,
          tools,
          systemPrompt: spec.systemPrompt,
          backend: new StateBackend(),
          checkpointer: context.checkpointer,
        })
      : createAgent({
          model,
          tools,
          systemPrompt: spec.systemPrompt,
          checkpointer: context.checkpointer,
        });
  const previous = await context.checkpointer.getTuple({
    configurable: { thread_id: context.threadId },
  });
  const snapshot = (
    previous
      ? await graph.getState({ configurable: { thread_id: context.threadId } })
      : undefined
  ) as
    | { tasks?: { interrupts?: { id?: string; value: unknown }[] }[] }
    | undefined;
  const resumes: Record<string, unknown> = {};
  for (const task of snapshot?.tasks ?? [])
    for (const pause of task.interrupts ?? []) {
      const value = pause.value as { callId?: string } | undefined;
      if (
        pause.id &&
        value?.callId &&
        Object.hasOwn(context.reconciliations ?? {}, value.callId)
      )
        resumes[pause.id] = context.reconciliations![value.callId];
    }
  const run = await graph.streamEvents(
    Object.keys(resumes).length
      ? new Command({ resume: resumes })
      : previous
        ? null
        : { messages, ...(spec.files ? { files: spec.files } : {}) },
    {
      version: "v3",
      configurable: { thread_id: context.threadId },
      signal: context.signal,
      recursionLimit: spec.recursionLimit,
    },
  );
  const [state] = await Promise.all([
    run.values,
    consumeAssistantMessageStreams(
      run.messages,
      async (delta) => {
        context.emit("text.delta", { text: delta });
      },
      async (toolTurn) => {
        if (toolTurn) context.emit("text.reset", {});
      },
    ),
  ]);
  const text = extractFinalAssistantText(state);
  if (!text)
    throw new Error("The graph stopped without a final assistant response.");
  const files =
    state && typeof state === "object" && "files" in state
      ? state.files
      : undefined;
  context.emit("text.final", { text });
  return { text, ...(files ? { files } : {}) };
}
