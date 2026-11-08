import { consumeAssistantMessageStreams, type StreamedAssistantMessage } from "./assistant-stream";
import { createProductGraph, type GraphToolStream, type ProductGraphOptions } from "./graph";
import { checkpointInput } from "./recovery";
import { isInterrupted } from "@langchain/langgraph";
import { AgentError, errors } from "../../contracts/src/index";

export type PreparedExecution = {
  runtime: "standard" | "deep";
  graph: ProductGraphOptions;
  threadId: string;
  signal: AbortSignal;
  recursionLimit: number;
  initial: unknown;
  reconciliations?: Record<string, unknown>;
  resume?: boolean;
  requireCheckpoint?: boolean;
  delta: (text: string) => Promise<void>;
  turn: (toolTurn: boolean) => Promise<void>;
  tools?: (stream: AsyncIterable<GraphToolStream>) => Promise<void>;
  expose?: (stream: StreamedAssistantMessage) => boolean;
};

/** The one execution path for prepared product profiles. LangChain owns its loop and checkpoints. */
export async function executePreparedGraph(execution: PreparedExecution): Promise<unknown> {
  execution.signal.throwIfAborted();
  const graph = createProductGraph(execution.runtime, execution.graph);
  const input = execution.resume === false ? execution.initial : await checkpointInput(
    graph, execution.graph.checkpointer, execution.threadId, execution.initial, execution.reconciliations, execution.requireCheckpoint,
  );
  const run = await graph.streamEvents(input, {
    version: "v3", durability: "sync", configurable: { thread_id: execution.threadId },
    signal: execution.signal, recursionLimit: execution.recursionLimit,
  });
  const settled = await Promise.allSettled([
    run.values,
    consumeAssistantMessageStreams(run.messages, execution.delta, execution.turn, execution.expose),
    execution.tools ? execution.tools(run.toolCalls) : (async () => {
      for await (const call of run.toolCalls)
        await Promise.allSettled([call.output, call.status, call.error]);
    })(),
  ]);
  const failure = settled.find((result) => result.status === "rejected");
  if (failure?.status === "rejected") throw failure.reason;
  const state = settled[0].status === "fulfilled" ? settled[0].value : undefined;
  execution.signal.throwIfAborted();
  if (isInterrupted(state) && state.__interrupt__.length > 0)
    throw new AgentError(errors.reconciliation, "The graph is interrupted. Resolve its pending request before continuing.");
  return state;
}
