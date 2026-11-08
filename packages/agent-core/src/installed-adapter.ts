import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage, AIMessageChunk, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { ChatGenerationChunk } from "@langchain/core/outputs";
import { convertToOpenAITool } from "@langchain/core/utils/function_calling";
import type { ExecutionContext } from "./index";
import type { Registration, RunSpec, ToolSpec } from "../../contracts/src/index";

/** Process-owner integration. It is never registered, selected or implemented by RPC. */
export type InstalledAdapter = {
  product: "kidos";
  validate(registration: Registration, spec: RunSpec): void;
  execute(spec: RunSpec, context: ExecutionContext): Promise<unknown>;
  prepareTool(registration: Registration, definition: ToolSpec, input: unknown, state: unknown): unknown;
  invokeTool(registration: Registration, definition: ToolSpec, input: unknown, signal: AbortSignal): Promise<unknown>;
};
export const adapterModelAPI = {
  BaseChatModel, AIMessage, AIMessageChunk, HumanMessage, SystemMessage,
  ChatGenerationChunk, convertToOpenAITool,
};
