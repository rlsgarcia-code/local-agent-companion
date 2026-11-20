import {z} from 'zod';
/** Effective input window declared by the authorized product/operator. Metadata
 * for native context management, never a provider option or authority grant. */
export const modelContextWindow=z.number().int().min(2048).max(2_000_000);
export const modelContextWindows=z.record(z.string().min(1).max(200).refine(alias=>alias.trim()===alias&& !['__proto__','constructor','prototype'].includes(alias)),modelContextWindow).refine(value=>Object.keys(value).length<=500,'Too many model context windows.');
export type ModelContextWindows=z.infer<typeof modelContextWindows>;
/** Optional owner policy for estimated working history. Not model capacity,
 * provider request options, a token allocation or an RPC permission. */
export const contextWorkingBudget=z.object({triggerTokens:z.number().int().min(2048).max(131072),keepTokens:z.number().int().min(512).max(32768)}).strict()
 .refine(value=>value.keepTokens<=Math.floor(value.triggerTokens/2),'Retained history must leave room below the working trigger.');
export type ContextWorkingBudget=z.infer<typeof contextWorkingBudget>;
export function parseOptionalModelContextWindow(value:unknown):number|undefined{
 if(value===undefined||value===null||value==='')return undefined;
 const parsed=typeof value==='string'&&/^\d+$/.test(value.trim())?Number(value.trim()):value;
 const result=modelContextWindow.safeParse(parsed);if(!result.success)throw Error('Context window must be an integer from 2048 to 2000000 tokens.');return result.data;
}
