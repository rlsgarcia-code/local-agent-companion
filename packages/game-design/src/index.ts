import contract from "../module.json";
export { defaultGameEngine, gameContentHash, convertLegacyGameDesign } from "./project";

/** Content and preparation only. No model, tools, agent loop, storage or UI. */
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
export const gameDesignModule = freeze(contract);
export type GameProductionOperation = "project" | "edit" | "build" | "run" | "test";
export type GameCapability = {
  engine: string;
  operation: GameProductionOperation;
  availability: "verified" | "unavailable" | "unknown";
  authorized: boolean;
};

/** Advisory preflight, never an authority decision or proof of execution.
 * Inputs must come from the installed adapter's current probes and policy.
 */
export function assessGameProduction(
  engine: string,
  capabilities: readonly GameCapability[],
  mode: "plan" | "review" | "execute",
) {
  const operations: GameProductionOperation[] = ["project", "edit", "build", "run", "test"];
  const missing = operations.filter((operation) => {
    const matches = capabilities.filter((row) => row.engine === engine && row.operation === operation);
    return matches.length !== 1 || matches[0]!.availability !== "verified" || matches[0]!.authorized !== true;
  });
  return { engine, mode, canProduce: (mode === "review" || mode === "execute") && missing.length === 0, missing,
    requiresOperationApproval: mode === "review", evidence: "capability-preflight-only" as const };
}

/** The host still supplies models and intersects names with its authorized catalog.
 * The result fits the existing shared executor; it does not create another loop.
 */
export function prepareGameDesign(options: {
  readTools: readonly { name: string; effect: string }[];
  adapterGuidance?: string;
}) {
  if (options.readTools.some((tool) => tool.effect !== "read") ||
      new Set(options.readTools.map((tool) => tool.name)).size !== options.readTools.length)
    throw new Error("Game design specialists require unique, read-only tools from the authorized adapter.");
  const systemPrompt = contract.guide + (options.adapterGuidance ? "\n" + options.adapterGuidance : "");
  return {
    module: { id: contract.id, version: contract.version, schemaVersion: contract.schemaVersion },
    systemPrompt,
    specialists: contract.specialists.map((specialist) => ({
      ...specialist, systemPrompt: systemPrompt + "\n" + specialist.instruction,
      tools: options.readTools.map((tool) => tool.name),
    })),
  };
}

/** v2 production profile is separate from the frozen v1 KidOS import/snapshot contract. */
export { gameProductionModule, prepareGameProduction } from "./production";
