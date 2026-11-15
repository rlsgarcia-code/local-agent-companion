import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import type { LLMResult } from "@langchain/core/outputs";
import type { InferenceUsage } from "../../contracts/src/inference-budget";
import {modelRequestReservation} from './inference-request-size';

/** Service-owned admission/accounting. No prompt, credential or provider result
 * crosses this port. LangChain retains execution, streaming and checkpoints. */
export type InferenceBudgetPort = {
  begin(callId: string,minimumReservationTokens?:number): Promise<void>;
  finish(callId: string, usage?: InferenceUsage): void;
};

export class InferenceBudgetCallback extends BaseCallbackHandler {
  name = "local_inference_budget";
  raiseError = true;
  awaitHandlers = true;
  constructor(private readonly budget: InferenceBudgetPort) { super(); }
  async handleChatModelStart(_model: unknown, messages: unknown, runId: string,_parentRunId?:string,extra?:Record<string,unknown>) { await this.budget.begin(runId,modelRequestReservation(messages,extra)); }
  async handleLLMStart(_model: unknown, prompts: unknown, runId: string,_parentRunId?:string,extra?:Record<string,unknown>) { await this.budget.begin(runId,modelRequestReservation(prompts,extra)); }
  handleLLMEnd(result: LLMResult, runId: string) {
    let input = 0, output = 0, known = result.generations.flat().length > 0;
    for (const generation of result.generations.flat()) {
      const metadata = (generation as { message?: { usage_metadata?: { input_tokens?: number; output_tokens?: number } } }).message?.usage_metadata;
      if (!metadata || !Number.isSafeInteger(metadata.input_tokens) || !Number.isSafeInteger(metadata.output_tokens) || metadata.input_tokens! < 0 || metadata.output_tokens! < 0) { known = false; continue; }
      input += metadata.input_tokens!; output += metadata.output_tokens!;
    }
    this.budget.finish(runId, known && Number.isSafeInteger(input + output) ? { input, output } : undefined);
  }
  handleLLMError(_error: unknown, runId: string) { this.budget.finish(runId); }
}
