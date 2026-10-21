/**
 * Generated/curated LiteLLM metadata snapshot. Runtime never fetches the
 * public catalog; update this file with scripts/update-litellm-catalog.mjs.
 */
export type LiteLlmCatalogMetadata = {
  model: string;
  provider: string;
  sourceDate: string;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  endpoints: Array<"chat_completions" | "responses">;
  inputModalities: string[];
  outputModalities: string[];
  supportsFunctionCalling: boolean;
  supportsParallelFunctionCalling: boolean;
  supportsReasoning: boolean;
  reasoningEfforts: string[];
  supportsNoneReasoningEffort: boolean;
  supportsStructuredOutput: boolean;
  toolChoice: string[];
  vision: boolean;
  pdf: boolean;
  audio: boolean;
  promptCaching: boolean;
  systemMessages: boolean;
  webSearch: boolean;
  computerUse: boolean;
  inputPricePerMillion?: number;
  outputPricePerMillion?: number;
  deprecationDate?: string;
};

export const LITELLM_CATALOG_SOURCE = "LiteLLM model_prices_and_context_window.json";
export const LITELLM_CATALOG_MODELS_SOURCE = "LiteLLM model catalog";
export const LITELLM_CATALOG_SNAPSHOT_DATE = "2026-10-21";

const metadata = (value: Omit<LiteLlmCatalogMetadata, "sourceDate">): LiteLlmCatalogMetadata => ({
  ...value,
  sourceDate: LITELLM_CATALOG_SNAPSHOT_DATE
});

export const LITELLM_MODEL_CATALOG: Record<string, LiteLlmCatalogMetadata> = {
  "gpt-6.1-sol": metadata({ model: "gpt-6.1-sol", provider: "openai", maxInputTokens: 400000, maxOutputTokens: 128000, endpoints: ["responses"], inputModalities: ["text", "image", "pdf"], outputModalities: ["text"], supportsFunctionCalling: true, supportsParallelFunctionCalling: true, supportsReasoning: true, reasoningEfforts: ["low", "medium", "high", "xhigh", "max"], supportsNoneReasoningEffort: false, supportsStructuredOutput: true, toolChoice: ["auto", "required", "allowed_tools"], vision: true, pdf: true, audio: false, promptCaching: true, systemMessages: true, webSearch: true, computerUse: true }),
  "gpt-6-astra": metadata({ model: "gpt-6-astra", provider: "openai", maxInputTokens: 400000, maxOutputTokens: 128000, endpoints: ["responses"], inputModalities: ["text", "image", "pdf"], outputModalities: ["text"], supportsFunctionCalling: true, supportsParallelFunctionCalling: true, supportsReasoning: true, reasoningEfforts: ["low", "medium", "high", "xhigh", "max"], supportsNoneReasoningEffort: false, supportsStructuredOutput: true, toolChoice: ["auto", "required", "allowed_tools"], vision: true, pdf: true, audio: false, promptCaching: true, systemMessages: true, webSearch: true, computerUse: true }),
  "gpt-6-sol": metadata({ model: "gpt-6-sol", provider: "openai", maxInputTokens: 400000, maxOutputTokens: 128000, endpoints: ["responses", "chat_completions"], inputModalities: ["text", "image", "pdf"], outputModalities: ["text"], supportsFunctionCalling: true, supportsParallelFunctionCalling: true, supportsReasoning: true, reasoningEfforts: ["none", "low", "medium", "high", "xhigh", "max"], supportsNoneReasoningEffort: true, supportsStructuredOutput: true, toolChoice: ["auto", "required"], vision: true, pdf: true, audio: false, promptCaching: true, systemMessages: true, webSearch: true, computerUse: false }),
  "gpt-6-luna": metadata({ model: "gpt-6-luna", provider: "openai", maxInputTokens: 400000, maxOutputTokens: 128000, endpoints: ["responses", "chat_completions"], inputModalities: ["text", "image", "pdf"], outputModalities: ["text"], supportsFunctionCalling: true, supportsParallelFunctionCalling: true, supportsReasoning: true, reasoningEfforts: ["none", "low", "medium", "high", "xhigh", "max"], supportsNoneReasoningEffort: true, supportsStructuredOutput: true, toolChoice: ["auto", "required"], vision: true, pdf: true, audio: false, promptCaching: true, systemMessages: true, webSearch: true, computerUse: false }),
  "gpt-5.6": metadata({ model: "gpt-5.6", provider: "openai", maxInputTokens: 400000, maxOutputTokens: 128000, endpoints: ["responses", "chat_completions"], inputModalities: ["text", "image", "pdf"], outputModalities: ["text"], supportsFunctionCalling: true, supportsParallelFunctionCalling: true, supportsReasoning: true, reasoningEfforts: ["none", "minimal", "low", "medium", "high", "xhigh", "max"], supportsNoneReasoningEffort: true, supportsStructuredOutput: true, toolChoice: ["auto", "required"], vision: true, pdf: true, audio: false, promptCaching: true, systemMessages: true, webSearch: true, computerUse: false }),
  "gpt-4.1": metadata({ model: "gpt-4.1", provider: "openai", maxInputTokens: 1047576, maxOutputTokens: 32768, endpoints: ["chat_completions", "responses"], inputModalities: ["text", "image"], outputModalities: ["text"], supportsFunctionCalling: true, supportsParallelFunctionCalling: true, supportsReasoning: false, reasoningEfforts: [], supportsNoneReasoningEffort: false, supportsStructuredOutput: true, toolChoice: ["auto", "required"], vision: true, pdf: false, audio: false, promptCaching: true, systemMessages: true, webSearch: false, computerUse: false }),
  "claude-sonnet-5": metadata({ model: "claude-sonnet-5", provider: "anthropic", endpoints: ["chat_completions", "responses"], inputModalities: ["text", "image", "pdf"], outputModalities: ["text"], supportsFunctionCalling: true, supportsParallelFunctionCalling: true, supportsReasoning: true, reasoningEfforts: ["low", "medium", "high", "xhigh", "max"], supportsNoneReasoningEffort: false, supportsStructuredOutput: true, toolChoice: ["auto", "required"], vision: true, pdf: true, audio: false, promptCaching: true, systemMessages: true, webSearch: false, computerUse: false })
};

export function liteLlmCatalogMetadata(model: string, provider = "litellm"): LiteLlmCatalogMetadata | undefined {
  const normalized = model.trim().toLowerCase();
  const found = LITELLM_MODEL_CATALOG[normalized];
  if (!found || (provider !== "litellm" && found.provider !== provider)) return undefined;
  return found;
}
