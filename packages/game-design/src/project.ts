import { z } from "zod";
import legacyContract from "../module.json";
import { gameDesignV2, gameDocument, type GameDocument, type LegacyGameDesignConversion } from "../../contracts/src/games";
import { contentHash } from "../../contracts/src/identity";

/** Transport references are namespace-local and cannot alter source identity. */
export function gameContentHash(value: GameDocument): string {
  const document = gameDocument.parse(value);
  return contentHash({ ...document, files: document.files.map(({ transferId: _transfer, ...file }) => file) });
}

export function defaultGameEngine(dimension: "2d" | "3d"): "phaser" | "babylon" {
  return dimension === "2d" ? "phaser" : "babylon";
}

/** Read/import only: never changes files, engine, approvals, or an existing game. */
export function convertLegacyGameDesign(input: unknown): LegacyGameDesignConversion {
  const source = z.fromJSONSchema(legacyContract.designSchema as Parameters<typeof z.fromJSONSchema>[0]).parse(input) as {
    premise: string; narrative_arc: string; progression: string; meaningful_choices: string;
    ending: string; save_strategy: string;
    stages: { id: string; objective: string; new_mechanic: string; challenge: string; story_beat: string; completion: string }[];
    playtest_scenarios: string[];
  };
  if (new Set(source.stages.map((stage) => stage.id.trim().toLocaleLowerCase("en-US"))).size !== source.stages.length)
    throw new Error("Legacy stage identities must be distinct before conversion.");
  const design = gameDesignV2.parse({
    schemaVersion: 2, structure: "campaign", premise: source.premise,
    coreLoop: { actions: ["Legacy gameplay: inspect existing source before modifying"],
      feedback: source.meaningful_choices, mastery: source.progression },
    mechanics: source.stages.map((stage, index) => ({ id: `legacy-mechanic-${index + 1}`, name: `Legacy mechanic ${index + 1}`, description: stage.new_mechanic })),
    rules: [source.meaningful_choices],
    controls: [{ action: "Preserve existing controls", input: "Read legacy source", feedback: "Control mapping requires review before production" }],
    camera: "Preserve the existing game camera; inspect source before editing",
    progression: { description: source.progression, stages: source.stages.map((stage, index) => ({
      id: `legacy-stage-${index + 1}`,
      objective: stage.objective, challenge: stage.challenge, mechanicIds: [`legacy-mechanic-${index + 1}`], completion: stage.completion,
    })), completion: { type: "ending", description: source.ending } },
    narrative: source.narrative_arc,
    art: { direction: "Preserve legacy art; art direction requires review", palette: ["legacy"], animation: "Preserve existing animation" },
    audio: { music: "Preserve existing music", effects: "Preserve existing effects", mix: "Preserve existing mix" },
    content: source.stages.map((stage, index) => ({ id: `legacy-content-${index + 1}`, kind: "stage", description: stage.story_beat })),
    save: { mode: "persistent", version: 1, strategy: source.save_strategy },
    playtests: source.playtest_scenarios.map((scenario, index) => ({ id: `legacy-test-${index + 1}`, category: "gameplay",
      description: scenario, steps: [{ action: scenario, expected: "Requires human review: legacy scenario did not separate action and expected result" }] })),
  });
  return { design, legacy: { schemaVersion: 1, reviewRequired: true, design: structuredClone(source) } };
}
