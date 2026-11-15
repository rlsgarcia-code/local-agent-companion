import { gameStages, type GameStageGate, type GameStage } from "../../contracts/src/game-workflow";
import type { GameQualityAssessment } from "../../contracts/src/game-production";

export const gameStageLabels: Record<GameStage, string> = { design: "Design", core: "Experiência central", systems: "Sistemas", content: "Conteúdo",
  polish: "Acabamento", testing: "Testes", corrections: "Correções", candidate: "Candidato de entrega" };

/** Technical gates, not creative self-approval. Input comes from the service's
 * exact-build assessment. Later stages cannot override missing earlier evidence. */
export function gameStageGates(quality: GameQualityAssessment): GameStageGate[] {
  const groups: Record<GameStage, string[]> = { design: [], core: [], systems: [], content: [], polish: [], testing: [], corrections: [], candidate: [] };
  for (const blocker of quality.blockers) {
    let stage: GameStage;
    if (["design-missing", "legacy-design-review-required"].includes(blocker)) stage = "design";
    else if (["build-not-produced", "stale-source-revision", "missing-runtime-assessment", "missing-runtime-boots", "missing-runtime-controls"].includes(blocker)) stage = "core";
    else if (blocker.startsWith("missing-runtime-") || blocker === "unresolved-runtime-checks" || blocker === "local-multiplayer-unverified") stage = "systems";
    else if (blocker.includes("content") && !blocker.startsWith("unverified-scenario:")) stage = "content";
    else if (/^(?:missing|unresolved)-(?:visual|audio|license)/.test(blocker) || blocker === "placeholder-assets") stage = "polish";
    else if (/^(?:missing|unresolved)-(?:performance|human)/.test(blocker) || /^(?:unverified-(?:desktop|mobile)-performance|human-playtest-targets-unverified)$/.test(blocker)) stage = "testing";
    else stage = "candidate";
    groups[stage].push(blocker);
  }
  // Corrections cannot pass while any collected category still contains a failed
  // or unverified check; missing coverage remains an explicit gate elsewhere.
  groups.corrections = quality.blockers.filter((blocker) => blocker.startsWith("unresolved-"));
  return gameStages.map((stage) => ({ stage, blockers: groups[stage], ready: groups[stage].length === 0 }));
}
