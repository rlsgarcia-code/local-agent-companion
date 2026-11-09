import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import type { LLMResult } from "@langchain/core/outputs";
import { BaseMessage, RemoveMessage } from "@langchain/core/messages";
import { REMOVE_ALL_MESSAGES } from "@langchain/langgraph";
import { createMiddleware } from "langchain";
export class TokenUsageHandler extends BaseCallbackHandler {
  public name = "local_token_usage";
  public input = 0;
  public output = 0;

  public handleLLMEnd(result: LLMResult): void {
    for (const generation of result.generations.flat()) {
      const message = (generation as { message?: unknown }).message as {
        usage_metadata?: { input_tokens?: number; output_tokens?: number };
      } | undefined;
      if (message?.usage_metadata) {
        this.input += message.usage_metadata.input_tokens ?? 0;
        this.output += message.usage_metadata.output_tokens ?? 0;
      }
    }
  }
}

export function conversationWindowMiddleware(maximumCharacters: number) {
  return createMiddleware({
    name: "LocalConversationWindow",
    beforeModel: (state) => {
      const messages = state.messages as BaseMessage[];
      const total = messages.reduce((sum, message) => sum + message.text.length, 0);
      if (messages.length <= 30 && total <= maximumCharacters) return undefined;

      let characters = 0;
      let start = Math.max(0, messages.length - 30);
      for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        if (!message) continue;
        characters += message.text.length;
        if (message.type === "human") start = index;
        if ((characters >= maximumCharacters || messages.length - index >= 30) && message.type === "human") break;
      }
      return {
        messages: [new RemoveMessage({ id: REMOVE_ALL_MESSAGES }), ...messages.slice(start)]
      };
    }
  });
}

