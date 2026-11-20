import { z } from "zod";
import type { GameStage } from "./game-workflow";

export const DEFAULT_INFERENCE_TOKEN_RESERVATION=65_536;

const quota = z.object({ callsPerBlock: z.number().int().min(1).max(1_000_000),
  tokensPerBlock: z.number().int().min(1).max(1_000_000_000_000), maxBlocks: z.number().int().min(1).max(1000) }).strict();
/** Provisioned by the service owner, never accepted from a client/model. */
export const inferenceBudgetPolicy = z.object({ namespace: quota, stage: quota,
  unknownTokensPerCall: z.number().int().min(1).max(1_000_000_000) }).strict().refine((value) =>
    value.unknownTokensPerCall <= Math.min(value.namespace.tokensPerBlock, value.stage.tokensPerBlock), "A block must cover at least one token reservation.");
export type InferenceBudgetPolicy = z.infer<typeof inferenceBudgetPolicy>;
export type InferenceBudgetScope = { kind: "namespace" } | { kind: "game-stage"; projectId: string; workflowId: string; stage: GameStage };
export type InferenceUsage = { input: number; output: number };
export type InferenceBudget = {
  scope: InferenceBudgetScope; version: number; blocks: number;
  policy: z.infer<typeof quota>; reservedTokensPerCall: number;
  calls: number; chargedTokens: number; reportedInput: number; reportedOutput: number;
  unreportedCalls: number; pendingCalls: number;
  authorizedCalls: number; authorizedTokens: number; exhausted: boolean; canContinue: boolean;
  /** Private model-start demand projected into a decision, never client authority. */
  nextReservationTokens?:number;
};
export type InferenceBudgetSnapshot = { budgets: InferenceBudget[] };

/** Pure read-only demand projection. The trusted model callback supplies demand;
 * this arithmetic never grants quota or gives client parameters authority. */
export function inferenceBudgetForReservation(value:InferenceBudget,reservation:number,includeRequestSize=false):InferenceBudget{
  if(!Number.isSafeInteger(reservation)||reservation<value.reservedTokensPerCall)throw new Error('Invalid model request reservation.');
  const exhausted=value.calls>=value.authorizedCalls||value.chargedTokens+reservation>value.authorizedTokens;
  const canContinue=exhausted&&value.blocks<value.policy.maxBlocks&&(!includeRequestSize||
    value.chargedTokens+reservation<=value.policy.tokensPerBlock*value.policy.maxBlocks&&value.calls<value.policy.callsPerBlock*value.policy.maxBlocks);
  return {...value,exhausted,canContinue,...(includeRequestSize?{nextReservationTokens:reservation}:{})};
}
