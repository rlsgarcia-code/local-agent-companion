import { createMiddleware } from "langchain";
import { ToolMessage } from "@langchain/core/messages";
import { gameAgentSchemas, type GameAgentToolName, type GameToolInputRejection } from "../../contracts/src/game-agent";
import { errors, type ToolSpec } from "../../contracts/src/index";
import { graphOperationId } from "./operations";

/** Read only declared schema metadata, never input values or remote references.
 * Ambiguous or over-budget branches yield no hint rather than a guessed one. */
function fieldHint(schema: unknown, path: readonly PropertyKey[]): string | undefined {
  if (path.length > 12) return undefined;
  const hints = new Set<string | null>();let visited = 0, incomplete = false;
  const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
  const visit = (value: unknown, index: number): void => {
    if (++visited > 64) { incomplete = true;return; }
    if (!record(value)) return;
    if (Object.hasOwn(value, "$ref")) { incomplete = true;return; }
    if (index === path.length && Object.hasOwn(value, "description") && typeof value.description === "string" && value.description.trim()) {
      if (value.description.length > 4096) { incomplete = true;return; }
      hints.add(value.description.trim());return;
    }
    if (index < path.length) {
      const part = path[index];
      if (typeof part === "string" && Object.hasOwn(value, "properties") && record(value.properties) && Object.hasOwn(value.properties, part)) visit(value.properties[part], index + 1);
      else if (typeof part === "number" && Number.isSafeInteger(part) && part >= 0 && Object.hasOwn(value, "items")) visit(value.items, index + 1);
    }
    let branched = false;
    for (const key of ["anyOf", "oneOf", "allOf"]) {
      if (!Object.hasOwn(value, key)) continue;
      const branches = value[key];if (!Array.isArray(branches)) continue;
      branched = true;
      if (branches.length > 16) { incomplete = true;continue; }
      for (const branch of branches) visit(branch, index);
    }
    if (index === path.length && !branched) hints.add(null);
  };
  visit(schema, 0);
  const hint = hints.size === 1 ? [...hints][0] : undefined;
  return !incomplete && typeof hint === "string" ? [...hint].slice(0, 160).join("") : undefined;
}

/** Reject before the official handler with bounded canonical feedback. The
 * service still validates and authorizes every accepted request independently.
 * No coercion, retry, exception swallowing or handler-result substitution. */
export function gameArgumentValidation(catalog: readonly ToolSpec[], rejected: (value: GameToolInputRejection) => void) {
  const schemas = new Map(catalog.map(tool => [tool.name, tool.schema]));
  return createMiddleware({ name: "GameArgumentValidation", wrapToolCall: async (request, handler) => {
    const name = request.toolCall.name;
    if (!schemas.has(name) || !Object.hasOwn(gameAgentSchemas, name)) return handler(request);
    const parsed = gameAgentSchemas[name as GameAgentToolName].safeParse(request.toolCall.args);
    if (parsed.success) return handler(request);
    const messageId = [...request.state.messages].reverse().find(message =>
      "tool_calls" in message && Array.isArray(message.tool_calls) && message.tool_calls.length)?.id;
    const callId = graphOperationId(request.runtime.configurable, messageId, request.toolCall.id);
    const value: GameToolInputRejection = { tool: name as GameAgentToolName, callId, rejectedBeforeDispatch: true,
      error: { code: errors.invalid, kind: "invalid_game_arguments", issues: parsed.error.issues.slice(0, 12).map(issue => {
        const hint = fieldHint(schemas.get(name), issue.path);
        return {
        path: issue.path.filter((part): part is string | number => typeof part === "string" || typeof part === "number").slice(0, 12).map(part => typeof part === "string" ? part.slice(0, 120) : part),
        code: issue.code,
        ...("expected" in issue && typeof issue.expected === "string" ? { expected: issue.expected } : {}),
        // Unknown property names and submitted values are not echoed.
        message: issue.code === "unrecognized_keys" ? "Remove fields not declared at this location."
          : issue.code === "invalid_type" && "expected" in issue ? `Expected ${issue.expected}.` : issue.message.slice(0, 160),
        ...(hint ? { hint } : {}),
      }; }), omittedIssues: Math.max(0, parsed.error.issues.length - 12) } };
    rejected(value);
    return new ToolMessage({ tool_call_id: request.toolCall.id!, name, status: "error", content: JSON.stringify({
      ok: false, ...value,
      next: "No operation was dispatched. Correct the indicated fields using the declared schema. Preserve valid fields; do not JSON-encode objects as strings. Never repeat an effect whose outcome is unknown.",
    }) });
  } });
}
