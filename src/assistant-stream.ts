export type StreamedAssistantMessage = {
  text: AsyncIterable<string>;
  output: PromiseLike<unknown>;
};

/**
 * LangChain/provider adapters do not all resolve a streamed message to the
 * same shape. Depending on the adapter it can be an AIMessage, a run result
 * containing `messages`, or a provider payload with `additional_kwargs`.
 * Keep tool-turn detection tolerant so intermediate assistant prose is reset
 * before the next tool iteration instead of being appended repeatedly.
 */
function containsToolCalls(value: unknown, seen = new Set<unknown>()): boolean {
  if (!value || typeof value !== "object" || seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.some((item) => containsToolCalls(item, seen));
  const record = value as Record<string, unknown>;
  if (Array.isArray(record.tool_calls) && record.tool_calls.length > 0) return true;
  if (Array.isArray(record.toolCalls) && record.toolCalls.length > 0) return true;
  // Some runtimes resolve every streamed event to the full graph state. Do
  // not classify a final assistant turn as a tool turn just because an older
  // message in that state used a tool; only the current/last message matters.
  const messages = Array.isArray(record.messages) ? record.messages : undefined;
  return (messages?.length ? containsToolCalls(messages[messages.length - 1], seen) : false)
    || containsToolCalls(record.message, seen)
    || containsToolCalls(record.additional_kwargs, seen);
}

export async function consumeAssistantMessageStreams(
  streams: AsyncIterable<StreamedAssistantMessage>,
  onDelta: (delta: string) => Promise<void>,
  onMessageEnd: (toolTurn: boolean) => Promise<void>
): Promise<void> {
  for await (const stream of streams) {
    let toolTurn = false;
    let observedText = "";
    try {
      for await (const delta of stream.text) {
        if (!delta) continue;
        // Some OpenAI-compatible providers expose the accumulated assistant
        // text on every stream event instead of an incremental delta. Convert
        // that form back to deltas so the UI does not repeat earlier text.
        const nextText = String(delta);
        const normalizedDelta = observedText && nextText.startsWith(observedText)
          ? nextText.slice(observedText.length)
          : nextText === observedText
            ? ""
            : nextText;
        if (nextText.startsWith(observedText) && nextText.length >= observedText.length) {
          observedText = nextText;
        } else if (normalizedDelta) {
          observedText += normalizedDelta;
        }
        if (normalizedDelta) await onDelta(normalizedDelta);
      }
      const output = await stream.output;
      toolTurn = containsToolCalls(output);
    } catch (error) {
      await onMessageEnd(false);
      throw error;
    }
    await onMessageEnd(toolTurn);
  }
}
