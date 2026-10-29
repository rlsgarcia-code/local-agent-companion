/**
 * Extract the last assistant text from LangGraph v3 terminal state.
 *
 * Different Chat Completions adapters serialize the same state differently:
 * a plain message array, `{ messages }`, serialized LangChain `kwargs`, or an
 * adapter-specific `{ output }` wrapper. Only the terminal assistant turn is
 * eligible: an earlier answer must not conceal a later tool-only termination.
 */
export function extractFinalAssistantText(state: unknown, seen = new Set<unknown>()): string {
  if (typeof state === "string") return state.trim();
  if (!state || typeof state !== "object" || seen.has(state)) return "";
  seen.add(state);
  const messages: unknown[] | undefined = Array.isArray(state)
    ? state
    : Array.isArray((state as Record<string, unknown>).messages)
      ? (state as Record<string, unknown>).messages as unknown[]
      : undefined;
  if (messages) {
    const message = messages.at(-1);
    if (message && typeof message === "object") {
      const record = message as Record<string, unknown>;
      const serializedId = Array.isArray(record.id) ? record.id.at(-1) : undefined;
      const type = record.type ?? record.role
        ?? (serializedId === "AIMessage" ? "ai" : serializedId === "HumanMessage" ? "human" : undefined);
      if ((type !== "ai" && type !== "assistant")
        || (Array.isArray(record.tool_calls) && record.tool_calls.length > 0)
        || (Array.isArray(record.toolCalls) && record.toolCalls.length > 0)) return "";
      const serializedKwargs = record.kwargs && typeof record.kwargs === "object"
        ? record.kwargs as Record<string, unknown>
        : undefined;
      if (Array.isArray(serializedKwargs?.tool_calls) && serializedKwargs.tool_calls.length > 0) return "";
      const content = record.content ?? serializedKwargs?.content;
      const text = typeof content === "string"
        ? content
        : Array.isArray(content)
          ? content.map((block) => {
            if (typeof block === "string") return block;
            if (!block || typeof block !== "object") return "";
            const value = block as Record<string, unknown>;
            return typeof value.text === "string" ? value.text : "";
          }).join("")
          : typeof record.text === "string" ? record.text : "";
      if (text.trim()) return text.trim();
    }
    return "";
  }
  const record = !Array.isArray(state) ? state as Record<string, unknown> : undefined;
  if (record?.kwargs) {
    const text = extractFinalAssistantText(record.kwargs, seen);
    if (text) return text;
  }
  if (record?.output) {
    const text = extractFinalAssistantText(record.output, seen);
    if (text) return text;
  }
  return "";
}

export function hasTerminalAssistantMessage(state: unknown, seen = new Set<unknown>()): boolean {
  if (typeof state === "string") return Boolean(state.trim());
  if (!state || typeof state !== "object" || seen.has(state)) return false;
  seen.add(state);
  const record = state as Record<string, unknown>;
  const messages = Array.isArray(state) ? state : Array.isArray(record.messages) ? record.messages : undefined;
  if (messages) {
    const last = messages.at(-1);
    if (!last || typeof last !== "object") return false;
    const message = last as Record<string, unknown>;
    const serializedId = Array.isArray(message.id) ? message.id.at(-1) : undefined;
    const type = message.type ?? message.role ?? (serializedId === "AIMessage" ? "ai" : undefined);
    const kwargs = message.kwargs && typeof message.kwargs === "object" ? message.kwargs as Record<string, unknown> : undefined;
    return (type === "ai" || type === "assistant")
      && !(Array.isArray(message.tool_calls) && message.tool_calls.length)
      && !(Array.isArray(message.toolCalls) && message.toolCalls.length)
      && !(Array.isArray(kwargs?.tool_calls) && kwargs.tool_calls.length);
  }
  return hasTerminalAssistantMessage(record.kwargs, seen) || hasTerminalAssistantMessage(record.output, seen);
}
