import { ToolMessage, isToolMessage, mapStoredMessageToChatMessage, type StoredMessage } from "@langchain/core/messages";
import { Command, interrupt, isCommand } from "@langchain/langgraph";
import { createMiddleware } from "langchain";
import { AgentError, errors } from "../../contracts/src/index";
import { contentHash } from "../../contracts/src/identity";

export type OperationExecutor = (
  id: string,
  tool: string,
  args: unknown,
  perform: () => Promise<unknown>,
) => Promise<unknown>;

export function graphOperationId(configurable: Record<string, unknown> | undefined, messageId: string | undefined, providerCallId: string | undefined): string {
  const taskId = configurable?.__pregel_task_id;
  if (typeof taskId !== "string" || !taskId || !messageId || !providerCallId)
    throw new AgentError(errors.invalid, "A persisted LangGraph task, message and tool call identity is required.");
  return contentHash({ taskId, messageId, providerCallId });
}

/** Durable receipts around the official tool handler, including backend tools. */
export function operationMiddleware(execute: OperationExecutor) {
  return createMiddleware({
    name: "DurableOperations",
    wrapToolCall: async (request, handler) => {
      const messageId = [...request.state.messages].reverse().find((message) =>
        "tool_calls" in message && Array.isArray(message.tool_calls) && message.tool_calls.length,
      )?.id;
      const callId = graphOperationId(request.runtime.configurable, messageId, request.toolCall.id);
      try {
        const result = await execute(callId, request.toolCall.name, request.toolCall.args, async () => {
          const value = await handler(request);
          if (isToolMessage(value)) return { kind: "tool-message", value: value.toDict() };
          if (isCommand(value)) return { kind: "command", value: { update: value.update, goto: value.goto, graph: value.graph, resume: value.resume } };
          throw new Error("Unsupported official tool result.");
        });
        const stored = result as { kind?: string; value?: unknown };
        if (stored?.kind === "tool-message")
          return mapStoredMessageToChatMessage(stored.value as StoredMessage) as ToolMessage;
        if (stored?.kind === "command")
          return new Command(stored.value as ConstructorParameters<typeof Command>[0]);
        // An administrator may reconcile a lost result using domain data.
        return new ToolMessage({
          tool_call_id: request.toolCall.id!,
          name: request.toolCall.name,
          content: typeof result === "string" ? result : JSON.stringify(result),
        });
      } catch (error) {
        if (error instanceof AgentError && error.code === errors.reconciliation)
          interrupt({ kind: "tool_reconciliation", callId });
        throw error;
      }
    },
  });
}
