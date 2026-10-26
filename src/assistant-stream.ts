export type StreamedAssistantMessage = {
  text: AsyncIterable<string>;
  output: PromiseLike<{ tool_calls?: unknown[] }>;
};

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
      const message = await stream.output;
      toolTurn = Boolean(Array.isArray(message.tool_calls) && message.tool_calls.length);
    } catch (error) {
      await onMessageEnd(false);
      throw error;
    }
    await onMessageEnd(toolTurn);
  }
}
