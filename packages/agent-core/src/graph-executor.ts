import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import { consumeAssistantMessageStreams, type StreamedAssistantMessage } from "./assistant-stream";
import { createProductGraph, type GraphToolStream, type ProductGraphOptions } from "./graph";
import { checkpointInput } from "./recovery";
import { isInterrupted } from "@langchain/langgraph";
import { AgentError, errors } from "../../contracts/src/index";
import { MiddlewareError } from "langchain";
import { settleSubagentStreams, settleToolCallStreams } from "./subagent-streams";

export type PreparedExecution = {
  runtime: "standard" | "deep";
  graph: ProductGraphOptions;
  threadId: string;
  signal: AbortSignal;
  recursionLimit: number;
  callbacks?: BaseCallbackHandler[];
  initial: unknown;
  reconciliations?: Record<string, unknown>;
  resume?: boolean;
  requireCheckpoint?: boolean;
  delta: (text: string) => Promise<void>;
  turn: (toolTurn: boolean) => Promise<void>;
  tools?: (stream: AsyncIterable<GraphToolStream>) => Promise<void>;
  expose?: (stream: StreamedAssistantMessage) => boolean;
};

/** v3 stream error events serialize only name/message. Keep the original root
 * invocation failure in memory so status, authority errors and model identity
 * survive that presentation boundary. Never infer origin from matching text. */
class GraphFailureCallback extends BaseCallbackHandler {
  name = "local_graph_failure";
  awaitHandlers = true;
  private root?: string;
  failure?: { error: unknown };
  handleChainStart(_chain: unknown, _inputs: unknown, runId: string) { this.root ??= runId; }
  handleChainError(error: unknown, runId: string) {
    if (runId !== this.root) return;
    // Official middleware wrappers retain the original on cause, but omit its
    // status/code. Unwrap only this known wrapper, never arbitrary tool causes.
    const visited = new Set<unknown>();
    while (MiddlewareError.isInstance(error) && error.cause instanceof Error && !visited.has(error)) {
      visited.add(error); error = error.cause;
    }
    this.failure = { error };
  }
}

/** The one execution path for prepared product profiles. LangChain owns its loop and checkpoints. */
export async function executePreparedGraph(execution: PreparedExecution): Promise<unknown> {
  execution.signal.throwIfAborted();
  const graph = createProductGraph(execution.runtime, execution.graph);
  const input = execution.resume === false ? execution.initial : await checkpointInput(
    graph, execution.graph.checkpointer, execution.threadId, execution.initial, execution.reconciliations, execution.requireCheckpoint,
  );
  const failures = new GraphFailureCallback();
  const run = await graph.streamEvents(input, {
    version: "v3", durability: "sync", configurable: { thread_id: execution.threadId },
    signal: execution.signal, recursionLimit: execution.recursionLimit, callbacks: [...(execution.callbacks ?? []), failures],
  });
  const settled = await Promise.allSettled([
    run.values,
    consumeAssistantMessageStreams(run.messages, execution.delta, execution.turn, execution.expose),
    execution.tools ? execution.tools(run.toolCalls) : settleToolCallStreams(run.toolCalls),
    settleSubagentStreams(run.subagents),
  ]);
  const failure = settled.find((result) => result.status === "rejected");
  if (failure?.status === "rejected")
    throw settled[0].status === "rejected" && failures.failure ? failures.failure.error : failure.reason;
  const state = settled[0].status === "fulfilled" ? settled[0].value : undefined;
  execution.signal.throwIfAborted();
  if (isInterrupted(state) && state.__interrupt__.length > 0)
    throw new AgentError(errors.reconciliation, "The graph is interrupted. Resolve its pending request before continuing.");
  return state;
}
