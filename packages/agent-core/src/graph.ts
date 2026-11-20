import {declaredModelContextWindow} from './model-context';
import type { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { isStructuredTool, type ClientTool, type ServerTool, type StructuredTool, type ToolRuntime } from "@langchain/core/tools";
import { isToolMessage, ToolMessage } from "@langchain/core/messages";
import type { BaseCheckpointSaver } from "@langchain/langgraph";
import { createDeepAgent, createSummarizationMiddleware, StateBackend, GENERAL_PURPOSE_SUBAGENT, type AnyBackendProtocol, type FilesystemPermission, type SubAgent } from "deepagents";
import { createAgent, summarizationMiddleware, tool, type AnyAgentMiddleware } from "langchain";
import type { StreamedAssistantMessage } from "./assistant-stream";
import { modelMessageIdentity } from "./model-message-identity";
import {contextWorkingBudget,type ContextWorkingBudget} from '../../contracts/src/model-context';

export type ProductGraphOptions = {
  model: BaseChatModel;
  tools: Array<ClientTool | ServerTool>;
  systemPrompt: string;
  checkpointer: BaseCheckpointSaver;
  middleware?: AnyAgentMiddleware[];
  backend?: AnyBackendProtocol;
  permissions?: FilesystemPermission[];
  subagents?: SubAgent[];
  /** Captured by the service owner, never a model context-window declaration. */
  contextWorkingBudget?:ContextWorkingBudget;
};
export type GraphToolStream = {
  name: string; callId: string; input: unknown;
  output: Promise<unknown>;
  status: Promise<"running" | "finished" | "error">;
  error: Promise<string | undefined>;
};
export type GraphSubagentStream = {
  output: PromiseLike<unknown>;
  messages: AsyncIterable<StreamedAssistantMessage>;
  toolCalls: AsyncIterable<GraphToolStream>;
  subagents?: AsyncIterable<GraphSubagentStream>;
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
    subagents?: AsyncIterable<GraphSubagentStream>;
  }>;
};

// DeepAgents owns these names and their backend. Keep host adapters distinct,
// forwarding to the original registered tool rather than replacing a built-in.
const deepFilesystemNames = new Set(["ls", "read_file", "write_file", "edit_file", "delete", "glob", "grep", "execute"]);
function deepHostTools(entries: StructuredTool[]): StructuredTool[];
function deepHostTools(entries: Array<ClientTool | ServerTool>): Array<ClientTool | ServerTool>;
function deepHostTools(entries: Array<ClientTool | ServerTool>): Array<ClientTool | ServerTool> {
  const names = new Set(entries.map(entry => "name" in entry ? entry.name : undefined));
  return entries.map(entry => {
    if (typeof entry.name !== "string" || !deepFilesystemNames.has(entry.name)) return entry;
    const original = entry as ClientTool;
    if (!isStructuredTool(original)) throw new Error("A reserved Deep Agent tool name requires an invocable host adapter.");
    const name = `companion_host_${original.name}`;
    if (names.has(name)) throw new Error(`Host tool alias conflicts with an existing tool: ${name}`);
    return tool(async (input, runtime) => {
      const current = runtime as unknown as ToolRuntime;
      if (!current.toolCall?.id) throw new Error("A host tool alias requires its original graph call identity.");
      const originalCall = { type: "tool_call" as const, name: original.name, id: current.toolCall.id, args: input };
      const result = await original.invoke(originalCall, { ...current, toolCall: originalCall });
      return isToolMessage(result) ? new ToolMessage({ ...result, name }) : result;
    }, { name, description: original.description, schema: original.schema });
  });
}

/** All products construct the official graph here. Profiles supply adapters and middleware. */
export function createProductGraph(runtime: "standard" | "deep", options: ProductGraphOptions): ProductGraph {
  const { backend, permissions, contextWorkingBudget:workingInput, ...common } = options;
  if (runtime === "deep") common.tools = deepHostTools(common.tools);
  const working=workingInput===undefined?undefined:contextWorkingBudget.parse(workingInput);
  const window=declaredModelContextWindow(options.model);
  const workingFor=(model:BaseChatModel)=>{
    if(!working)return undefined;
    const capacity=model.profile?.maxInputTokens,known=typeof capacity==='number'&&Number.isFinite(capacity)&&capacity>0?capacity:undefined;
    const trigger=Math.max(1,Math.min(working.triggerTokens,known===undefined?Infinity:Math.floor(known*.85)));
    const keep=Math.max(1,Math.min(working.keepTokens,Math.floor(trigger/2),known===undefined?Infinity:Math.floor(known*.1)));
    return {trigger,keep};
  };
  const standardWorking=workingFor(options.model);
  const standardLimits=standardWorking??(window===undefined?undefined:{trigger:Math.floor(window*.85),keep:Math.floor(window*.1)});
  common.middleware = [modelMessageIdentity(), ...(runtime==='standard'&&standardLimits?[summarizationMiddleware({model:options.model,trigger:{tokens:standardLimits.trigger},keep:{tokens:standardLimits.keep}})]:[]), ...(common.middleware ?? [])];
  // Use the public built-in spec when a product has not supplied its own general
  // purpose profile, so the same response boundary also covers delegated turns.
  // Tools/backend/permissions still come from the official product configuration.
  const subagents = [...(options.subagents ?? [])];
  if (runtime === "deep" && !subagents.some(agent => agent.name === GENERAL_PURPOSE_SUBAGENT.name)) subagents.unshift({ ...GENERAL_PURPOSE_SUBAGENT });
  common.subagents = subagents.map(agent => ({ ...agent,
    ...(runtime === "deep" && agent.tools ? { tools: deepHostTools(agent.tools) } : {}),
    middleware: [modelMessageIdentity(), ...(agent.middleware ?? [])] }));
  const effectiveBackend=backend??((config:ConstructorParameters<typeof StateBackend>[0])=>new StateBackend(config));
  if(runtime==='deep'){
    // The pinned Deep middleware uses request.model even when options.model is
    // supplied. Bind official nostream metadata only while it summarizes, then
    // restore the original model before native execution. No new model/client,
    // callback layer, mutable global tags, scheduler or summary algorithm.
    // Native defaults/session state are lazy mutable closure data. Each graph
    // stack must own its instance: a supervisor without a model profile must
    // not impose its fixed fallback on a specialist with a smaller window.
    const privateSummary=()=>{
      const template=createSummarizationMiddleware({backend:effectiveBackend});let native=template,signature='';
      return {...template,wrapModelCall:((request,handler)=>{
      const model=request.model as BaseChatModel;
      const limits=workingFor(model);
      if(limits){const next=`${limits.trigger}:${limits.keep}`;if(next!==signature){signature=next;native=createSummarizationMiddleware({backend:effectiveBackend,trigger:{type:'tokens',value:limits.trigger},keep:{type:'tokens',value:limits.keep}});}}
      const wrap=native.wrapModelCall!;
      if(typeof model.withConfig!=='function')throw Error('The selected model cannot provide a private compaction call.');
      const binding=Object.assign(model.withConfig({tags:['nostream'],metadata:{lc_source:'summarization'}}),{profile:model.profile??{}});
      // The pinned middleware consumes only invoke/profile of this public
      // Runnable binding. Ordinary execution retains its original model.
      return wrap({...request,model:binding as unknown as BaseChatModel},next=>handler({...next,model:request.model}));
      }) as NonNullable<typeof template.wrapModelCall>};
    };
    common.middleware=[privateSummary(),...common.middleware];
    common.subagents=common.subagents.map(agent=>({...agent,middleware:[privateSummary(),...(agent.middleware??[])]}));
  }
  const graph = runtime === "deep"
    ? createDeepAgent({ ...common, backend:effectiveBackend, permissions })
    : createAgent(common);
  // The profiles intentionally expose only this stable subset of the official
  // stream API; their middleware-specific state remains private to the engine.
  return graph as unknown as ProductGraph;
}
