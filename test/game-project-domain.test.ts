import assert from "node:assert/strict";
import test from "node:test";
import { gameDesignV2, gameDocument, gameFilePath } from "../packages/contracts/src/games";
import { convertLegacyGameDesign, defaultGameEngine, gameContentHash } from "../packages/game-design/src/project";
import { fixtureGameDesign, fixtureGameDocument } from "./game-fixtures";

test("game design v2 supports complete campaigns and non-narrative endless/sandbox games without invented stages", () => {
  const design = fixtureGameDesign();
  assert.equal(gameDesignV2.parse(design).progression.stages.length, 1);
  design.structure = "endless";
  design.progression.stages = [];
  design.progression.completion = { type: "score", description: "Each run ends with a final score and restart" };
  assert.equal(gameDesignV2.parse(design).narrative, undefined);
  design.structure = "sandbox";
  design.progression.completion = { type: "open-ended", description: "Explore and save the world" };
  assert.ok(gameDesignV2.safeParse(design).success);
  design.structure = "campaign";
  const rejected = gameDesignV2.safeParse(design);
  assert.equal(rejected.success, false);
  if (!rejected.success) {
    const completion = rejected.error.issues.find(issue => issue.path.join(".") === "progression.completion.type");
    assert.ok(completion);
    assert.match(completion.message, /type="ending"/);
  }
});

test("design references, local multiplayer, portable files and unearned success claims are validated", () => {
  const document = fixtureGameDocument();
  document.design!.progression.stages[0]!.mechanicIds = ["missing"];
  assert.equal(gameDocument.safeParse(document).success, false);
  document.design = fixtureGameDesign();
  document.brief.playMode = "local-coop";
  assert.equal(gameDocument.safeParse(document).success, false);
  document.brief.players.max = 2;
  assert.ok(gameDocument.safeParse(document).success);
  assert.equal(gameDocument.safeParse({ ...document, published: true, quality: "passed" }).success, false);
  document.brief.dimension = "3d";
  assert.equal(gameDocument.safeParse(document).success, false);
  document.engine = "babylon";
  assert.ok(gameDocument.safeParse(document).success);
  assert.equal(defaultGameEngine("2d"), "phaser");
  assert.equal(defaultGameEngine("3d"), "babylon");
  for (const name of ["../secret", "/private/secret", "a/../b", "a//b", "a\\b", "C:secret", "file?x", "a/NUL.txt", "a/end.", "e\u0301.js", "*.js"])
    assert.equal(gameFilePath.safeParse(name).success, false, name);
  assert.equal(gameFilePath.parse("src/scenes/garden.ts"), "src/scenes/garden.ts");
  for (const name of ["assets/\ud800.png", "assets/\udfff.png", "a".repeat(256), "é".repeat(128), "🌱".repeat(64)])
    assert.equal(gameFilePath.safeParse(name).success, false, "Invalid Unicode/oversized component must not be silently changed");
  for (const name of ["assets/🌱.png", "a".repeat(255), "é".repeat(127), "🌱".repeat(63)])
    assert.equal(gameFilePath.safeParse(name).success, true);
});

test("transport IDs do not change content identity but source/assets/design edits do", () => {
  const document = fixtureGameDocument();
  document.files = [{ path: "src/game.ts", sha256: "a".repeat(64), size: 10, mime: "text/plain", transferId: "local-one" }];
  const hash = gameContentHash(document);
  document.files[0]!.transferId = "local-two";
  assert.equal(gameContentHash(document), hash);
  document.files[0]!.sha256 = "b".repeat(64);
  assert.notEqual(gameContentHash(document), hash);
  document.files[0]!.sha256 = "a".repeat(64);
  document.design!.art.direction = "Changed direction";
  assert.notEqual(gameContentHash(document), hash);
});

test("game project layouts reject file/directory collisions in either order and preserve portable shared directory spelling", () => {
  const document = fixtureGameDocument();
  const file = (path: string) => ({ path, sha256: "a".repeat(64), size: 1, mime: "text/plain", transferId: "fixture" });
  for (const paths of [["art", "art/player.png"], ["art/player.png", "art"], ["Art/a.png", "art/b.png"], ["src/Game.ts", "src/game.ts"], ["a/b", "a/b/c"]]) {
    document.files = paths.map(file);
    assert.equal(gameDocument.safeParse(document).success, false, JSON.stringify(paths));
    document.files.reverse();
    assert.equal(gameDocument.safeParse(document).success, false, JSON.stringify(paths));
  }
  for (const paths of [["a", "ab/c"], ["Art/icon.png", "Art/icons/button.png"], ["a/b/c", "a/bb/c"], ["src/a.ts", "src/B.ts", "assets/player.png"]]) {
    document.files = paths.map(file);
    assert.equal(gameDocument.safeParse(document).success, true, JSON.stringify(paths));
  }
});

test("asset provenance stays project-local and acyclic", () => {
  const document = fixtureGameDocument();
  document.files = [{ path: "assets/seed.png", sha256: "a".repeat(64), size: 10, mime: "image/png", transferId: "blob" }];
  const asset = { id: "seed", kind: "image" as const, role: "character", files: ["assets/seed.png"],
    origin: { kind: "procedural" as const, source: "Local generator", author: "Project author", license: "Original work", referenceIds: [] as string[] }, placeholder: false };
  document.assets = [asset, { ...asset, id: "sprout", origin: { ...asset.origin, referenceIds: ["seed"] } }];
  assert.ok(gameDocument.safeParse(document).success);
  document.assets[0]!.origin.referenceIds = ["sprout"];
  assert.equal(gameDocument.safeParse(document).success, false);
  document.assets[0]!.origin.referenceIds = ["another-project"];
  assert.equal(gameDocument.safeParse(document).success, false);
});

test("legacy design conversion preserves its exact source and requires design review without claiming execution", () => {
  const source = { premise: "Original", narrative_arc: "Beginning and ending", progression: "Learn and combine", meaningful_choices: "Gravity routes", ending: "Garden", save_strategy: "Checkpoints",
    stages: [0, 1, 2].map((i) => ({ id: `fase ${i}`, objective: `objective ${i}`, new_mechanic: "m".repeat(500), challenge: `challenge ${i}`, story_beat: `beat ${i}`, completion: `exit ${i}` })),
    playtest_scenarios: ["start", "lose and resume", "finish"] };
  const original = structuredClone(source), converted = convertLegacyGameDesign(source);
  assert.deepEqual(converted.legacy.design, original);
  assert.equal(converted.legacy.reviewRequired, true);
  assert.equal(converted.design.playtests[0]!.steps.length, 1);
  source.stages[0]!.objective = "changed";
  assert.deepEqual(converted.legacy.design, original);
  assert.equal("executed" in converted.design.playtests[0]!, false);
  assert.throws(() => convertLegacyGameDesign({ ...original, stages: [] }));
});
