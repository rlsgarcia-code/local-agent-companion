import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { getEncoding, getEncodingNameForModel, type Tiktoken, type TiktokenModel } from "js-tiktoken";

const encoders = new Map<string, Tiktoken>();

/** Provider-independent local estimate for an opaque alias; never provider-reported usage. */
export function countTokensOffline(text: string, alias: string): number {
  let name: string;
  try { name = getEncodingNameForModel(alias as TiktokenModel); }
  catch { return Math.ceil(Buffer.byteLength(text, "utf8") / 3); }
  if (name !== "cl100k_base" && name !== "o200k_base") return Math.ceil(Buffer.byteLength(text, "utf8") / 3);
  let encoder = encoders.get(name);
  if (!encoder) { encoder = getEncoding(name); encoders.set(name, encoder); }
  return encoder.encode(text, [], []).length;
}

/** LangChain's public counting hook otherwise fetches ranks from a public CDN. */
export function withOfflineTokenCounting<T extends BaseChatModel>(model: T, alias: string): T {
  model.getNumTokens = async content => {
    const text = typeof content === "string" ? content : content.map(block =>
      typeof block === "string" ? block : block.type === "text" && typeof block.text === "string" ? block.text : ""
    ).join("");
    return countTokensOffline(text, alias);
  };
  return model;
}
