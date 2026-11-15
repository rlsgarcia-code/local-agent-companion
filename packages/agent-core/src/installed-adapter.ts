import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage, AIMessageChunk, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { ChatGenerationChunk } from "@langchain/core/outputs";
import { convertToOpenAITool } from "@langchain/core/utils/function_calling";
import type { ExecutionContext } from "./index";
import type { Registration, RunSpec, ToolSpec } from "../../contracts/src/index";
import type { GameProductionAdapter,GameAssetProcessor,GameValidationCollector } from "../../game-production/src/index";
import { coreInferenceEvent,coreInferenceReceipt } from "../../contracts/src/kidos-inference";
import { AgentError,errors } from "../../contracts/src/index";

/** Service-created operation identity, not an argument accepted from a model/UI. */
export type InstalledToolInvocation = Readonly<{ id: string; runId: string; sessionId: string }>;
export type InstalledToolReconciliation = { state: "known"; result: unknown } | { state: "unknown" } | { state: "unsupported" };

/** Process-owner integration. It is never registered, selected or implemented by RPC. */
export type InstalledAdapter = {
  product: "kidos";
  validate(registration: Registration, spec: RunSpec): void;
  execute(spec: RunSpec, context: ExecutionContext): Promise<unknown>;
  prepareTool(registration: Registration, definition: ToolSpec, input: unknown, state: unknown): unknown;
  invokeTool(registration: Registration, definition: ToolSpec, input: unknown, signal: AbortSignal, invocation?: InstalledToolInvocation): Promise<unknown>;
  /** Inspect the original Core operation; never accept UI evidence or repeat an effect. */
  reconcileTool?(registration: Registration, definition: ToolSpec, invocation: InstalledToolInvocation, signal: AbortSignal): Promise<InstalledToolReconciliation>;
  /** Signed, process-owner ports. Only the protected Core may perform their effects. */
  gameAdapters?: readonly GameProductionAdapter[];
  gameAssetProcessors?: readonly GameAssetProcessor[];
  gameValidationCollectors?: readonly GameValidationCollector[];
  /** Inspect only persisted provider attempts through the original authority. */
  reconcileInference?(registration: Registration, context: {threadId:string;memo:{get(key:string):unknown;put(key:string,value:unknown):void}}, signal: AbortSignal): Promise<InstalledToolReconciliation>;
  hasPendingInference?(registration: Registration, context: {threadId:string;memo:{get(key:string):unknown;put(key:string,value:unknown):void}}): boolean;
};
export const adapterModelAPI = {
  installedCoreInferenceVersion: 1 as const,installedCoreInferenceProjectVersion:1 as const,coreInferenceEvent,coreInferenceReceipt,
  protectedInferenceWait:(message:string,unknown:boolean)=>new AgentError(unknown?errors.reconciliation:errors.unavailable,message,{kind:"protected-inference-wait"}),
  installedToolInvocationVersion: 1 as const,
  BaseChatModel, AIMessage, AIMessageChunk, HumanMessage, SystemMessage,
  ChatGenerationChunk, convertToOpenAITool,
};
