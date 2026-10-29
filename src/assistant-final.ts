/**
 * Extract the last assistant text from LangGraph v3 terminal state.
 *
 * Different Chat Completions adapters serialize the same state differently:
 * a plain message array, `{ messages }`, serialized LangChain `kwargs`, or an
 * adapter-specific `{ output }` wrapper. This parser deliberately follows
 * only those known containers and scans from the end, so an earlier tool-call
 * message cannot replace the final assistant turn.
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
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (!message || typeof message !== "object") continue;
      const record = message as Record<string, unknown>;
      const serializedId = Array.isArray(record.id) ? record.id.at(-1) : undefined;
      const type = record.type ?? record.role
        ?? (serializedId === "AIMessage" ? "ai" : serializedId === "HumanMessage" ? "human" : undefined);
      if (type !== "ai" && type !== "assistant") continue;
      const serializedKwargs = record.kwargs && typeof record.kwargs === "object"
        ? record.kwargs as Record<string, unknown>
        : undefined;
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
