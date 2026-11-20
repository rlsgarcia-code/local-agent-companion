import content from "../production.json";

function freeze<T>(value: T): T {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
export const gameProductionModule = freeze(content);
export function prepareGameProduction(readTools: readonly { name: string; effect: string }[]) {
  if (readTools.some((tool) => tool.effect !== "read") || new Set(readTools.map((tool) => tool.name)).size !== readTools.length)
    throw new Error("Game production specialists require unique read-only tools.");
  return { routing: content.routing, guide: content.guide,
    module: { id: content.id, version: content.version, schemaVersion: content.schemaVersion },
    specialists: content.specialists.map((specialist) => ({ ...specialist, systemPrompt: `${content.guide}\n${specialist.instruction}`,
      tools: readTools.map((tool) => tool.name), modelRole: specialist.modelRole as "executor" | "planner" | "evaluator" })) };
}
