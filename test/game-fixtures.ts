import type { GameDesignV2, GameDocument } from "../packages/contracts/src/games";

export function fixtureGameDesign(): GameDesignV2 {
  return {
    schemaVersion: 2, structure: "levels", premise: "Guide a seed through islands with changing gravity.",
    coreLoop: { actions: ["aim", "jump", "change gravity"], feedback: "Visible movement and collision feedback", mastery: "Combine jumps and gravity to reach the exit" },
    mechanics: [{ id: "gravity", name: "Change gravity", description: "Switch the gravity direction at marked anchors" }],
    rules: ["Reach the exit; hazards return the seed to its checkpoint"],
    controls: [{ action: "Change gravity", input: "Space or touch anchor", feedback: "Gravity indicator changes and the seed accelerates" }],
    camera: "Side view; follow the seed with bounded smoothing",
    progression: { description: "Teach gravity anchors and combine them", stages: [{ id: "island", objective: "Reach the exit", challenge: "Cross a pit", mechanicIds: ["gravity"], completion: "Seed touches exit" }], completion: { type: "ending", description: "The seed reaches its garden" } },
    art: { direction: "Warm illustrated botanical islands", palette: ["#173b30", "#f5c06a"], animation: "Readable anticipation, squash on landing, gentle foliage" },
    audio: { music: "Layered exploration theme", effects: "Distinct jump, anchor and landing sounds", mix: "Effects readable below a limited master volume" },
    content: [{ id: "island", kind: "level", description: "Garden island with a checkpoint, pit and gravity anchor" }],
    save: { mode: "persistent", version: 1, strategy: "Save completed islands and checkpoint; unavailable storage keeps the game playable" },
    playtests: [{ id: "anchor", category: "gameplay", description: "Changing gravity changes movement", steps: [{ action: "Press Space at an anchor", expected: "Indicator flips and seed motion changes toward the new gravity" }] }],
  };
}

export function fixtureGameDocument(): GameDocument {
  return { schemaVersion: 2, title: "Gravity Garden", engine: "phaser",
    brief: { request: "An original puzzle platform game about gravity", audience: "Casual players", genre: "puzzle-platform",
      dimension: "2d", playMode: "single-player", players: { min: 1, max: 1 }, devices: ["desktop", "mobile"], inputs: ["keyboard", "touch"] },
    design: fixtureGameDesign(), files: [], assets: [] };
}
