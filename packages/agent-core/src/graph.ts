import type { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { ClientTool, ServerTool } from "@langchain/core/tools";
import type { BaseCheckpointSaver } from "@langchain/langgraph";
import { createDeepAgent, type AnyBackendProtocol, type FilesystemPermission, type SubAgent } from "deepagents";
import { createAgent, type AnyAgentMiddleware } from "langchain";
import type { StreamedAssistantMessage } from "./assistant-stream";

export type ProductGraphOptions = {
  model: BaseChatModel;
  tools: Array<ClientTool | ServerTool>;
  systemPrompt: string;
  checkpointer: BaseCheckpointSaver;
  middleware?: AnyAgentMiddleware[];
  backend?: AnyBackendProtocol;
  permissions?: FilesystemPermission[];
  subagents?: SubAgent[];
};
export type GraphToolStream = {
  name: string; callId: string; input: unknown;
  output: Promise<unknown>;
  status: Promise<"running" | "finished" | "error">;
  error: Promise<string | undefined>;
};
export type ProductGraph = {
  getState(config: { configurable: { thread_id: string } }): Promise<unknown>;
  streamEvents(input: unknown, config: {
    version: "v3";
    durability: "sync";
    configurable: { thread_id: string };
    signal: AbortSignal;
    recursionLimit: number;
    callbacks?: BaseCallbackHandler[];
  }): Promise<{
    values: Promise<unknown>;
    messages: AsyncIterable<StreamedAssistantMessage>;
    toolCalls: AsyncIterable<GraphToolStream>;
  }>;
};

/** All products construct the official graph here. Profiles supply adapters and middleware. */
export function createProductGraph(runtime: "standard" | "deep", options: ProductGraphOptions): ProductGraph {
  const { backend, permissions, ...common } = options;
  const graph = runtime === "deep"
    ? createDeepAgent({ ...common, backend, permissions })
    : createAgent(common);
  // The profiles intentionally expose only this stable subset of the official
  // stream API; their middleware-specific state remains private to the engine.
  return graph as unknown as ProductGraph;
}
