import { z } from "zod";
import { identifier } from "./schema";

export const gameEngine = z.enum(["phaser", "babylon", "godot", "unity"]);
export const gameDimension = z.enum(["2d", "3d"]);
const text = z.string().trim().min(1).max(4000);
const short = z.string().trim().min(1).max(300);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const uniqueIds = (rows: { id: string }[]) => new Set(rows.map((row) => row.id.toLocaleLowerCase("en-US"))).size === rows.length;
const utf8 = new TextEncoder();
export const gameFilePath = z.string().min(1).max(400).refine((name) =>
  !/[\\\x00-\x1f\x7f:?#%<>"|*]/.test(name) && !/[\uD800-\uDFFF]/u.test(name) && name.normalize("NFC") === name && !name.startsWith("/") &&
  name.split("/").every((part) => part && part !== "." && part !== ".." &&
    part.length <= 255 && utf8.encode(part).byteLength <= 255 &&
    !/[. ]$/.test(part) && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)),
  "Game files require portable relative paths without traversal or reserved names.");

/** Validate the whole layout after validating each portable path. Files cannot
 * also be directories, and shared directories must retain the same spelling on
 * both case-sensitive and case-insensitive filesystems. No disk I/O or renaming. */
export function gameFileTreeConflict(paths: readonly string[]): { index: number; message: string } | undefined {
  type Node = { name: string; file: boolean; children: Map<string, Node> };
  const root: Node = { name: "", file: false, children: new Map() };
  for (const [index, name] of paths.entries()) {
    let parent = root;
    const parts = name.split("/");
    for (const [depth, part] of parts.entries()) {
      if (parent.file) return { index, message: "A game file cannot also be a directory for another file." };
      const key = part.toLocaleLowerCase("en-US"), leaf = depth === parts.length - 1;
      let node = parent.children.get(key);
      if (node) {
        if (leaf && node.file) return { index, message: "File paths must be unique across supported filesystems." };
        if (leaf && node.children.size) return { index, message: "A game directory cannot also be a file." };
        if (node.name !== part) return { index, message: "Shared game directory paths must use consistent capitalization across supported filesystems." };
      } else { node = { name: part, file: false, children: new Map() }; parent.children.set(key, node); }
      if (leaf) node.file = true;
      parent = node;
    }
  }
  return undefined;
}

export const gamePlaytest = z.object({
  id: identifier,
  category: z.enum(["gameplay", "technical", "visual", "audio", "performance", "accessibility", "human"]),
  description: text,
  steps: z.array(z.object({ action: text, expected: text }).strict()).min(1).max(100),
}).strict();

/** Domain design, not a claim that any generated artifact works or is approved. */
export function createGameDesignSchema<Version extends z.ZodType<2>>(schemaVersion: Version) { return z.object({
  schemaVersion,
  structure: z.enum(["campaign", "levels", "endless", "sandbox", "competitive"]).describe("Choose the game's structure, independently of genre. A campaign requires progression.completion.type = ending. Score-only replayable rounds may use levels, endless or competitive; do not invent a campaign ending for them."),
  premise: text,
  coreLoop: z.object({ actions: z.array(short).min(1).max(30), feedback: text, mastery: text }).strict(),
  mechanics: z.array(z.object({ id: identifier, name: short, description: text }).strict()).min(1).max(100).refine(uniqueIds, "Mechanic identities must be unique."),
  rules: z.array(text).min(1).max(100),
  controls: z.array(z.object({ action: short, input: short, feedback: text }).strict()).min(1).max(100),
  camera: text.describe("Plain text describing the viewpoint and camera behavior. Use a string, not a camera configuration object."),
  progression: z.object({
    description: text,
    stages: z.array(z.object({ id: identifier, objective: text, challenge: text,
      mechanicIds: z.array(identifier).min(1).max(100), completion: text.describe("Stage success condition as plain text. Never an object: the {type,description} object belongs only to the whole game's progression.completion."),
    }).strict()).max(500).refine(uniqueIds, "Stage identities must be unique."),
    completion: z.object({ type: z.enum(["ending", "score", "open-ended"]).describe("ending: finite campaign conclusion; score: a run ends with a score; open-ended: no final conclusion. If structure is campaign, this field must be ending."), description: text }).strict().describe("Whole-game completion object with type and description. Individual stage completion fields are plain text instead."),
  }).strict(),
  narrative: text.optional(),
  art: z.object({ direction: text, palette: z.array(short).min(1).max(32), animation: text }).strict(),
  audio: z.object({ music: text, effects: text, mix: text }).strict(),
  content: z.array(z.object({ id: identifier, kind: short, description: text }).strict()).min(1).max(2000).refine(uniqueIds, "Content identities must be unique.").describe("Nonempty array of content records {id,kind,description}, not a keyed object or an empty array."),
  save: z.object({ mode: z.enum(["persistent", "session-only"]), version: z.number().int().min(1), strategy: text }).strict().describe("Save specification object with mode, integer version and plain-text strategy, not a string."),
  playtests: z.array(gamePlaytest).min(1).max(500).refine(uniqueIds, "Playtest identities must be unique.").describe("Nonempty array of planned test records with id, category, description and steps [{action,expected}]. These plans are not passed tests."),
}).strict().superRefine((design, context) => {
  const mechanics = new Set(design.mechanics.map((row) => row.id));
  design.progression.stages.forEach((stage, index) => {
    if (stage.mechanicIds.some((id) => !mechanics.has(id)) || new Set(stage.mechanicIds).size !== stage.mechanicIds.length)
      context.addIssue({ code: "custom", path: ["progression", "stages", index, "mechanicIds"], message: "Stage must reference distinct existing mechanics." });
  });
  if (["campaign", "levels"].includes(design.structure) && !design.progression.stages.length)
    context.addIssue({ code: "custom", path: ["progression", "stages"], message: "A campaign or level-based game must describe its stages." });
  if (design.structure === "campaign" && design.progression.completion.type !== "ending")
    context.addIssue({ code: "custom", path: ["progression", "completion", "type"], message: 'Campaign requires progression.completion.type="ending". For score-only rounds use a non-campaign structure; preserve the requested genre.' });
}); }
export const gameDesignV2 = createGameDesignSchema(z.literal(2));
export type GameDesignV2 = z.infer<typeof gameDesignV2>;

export const gameFile = z.object({ path: gameFilePath, sha256: hash,
  size: z.number().int().nonnegative().max(256 * 1024 * 1024),
  mime: z.string().min(1).max(128).regex(/^[a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+$/),
  transferId: identifier,
}).strict();
export type GameFile = z.infer<typeof gameFile>;
export const gameAsset = z.object({
  id: identifier,
  kind: z.enum(["image", "sprite", "atlas", "model", "animation", "material", "audio", "font", "other"]),
  role: short,
  files: z.array(gameFilePath).min(1).max(1000).describe("Array of actual file paths already registered in this project revision. Do not declare missing resources; process and apply candidates first."),
  origin: z.object({ kind: z.enum(["generated", "procedural", "library", "local"]),
    source: text, author: short, license: text,
    referenceIds: z.array(identifier).max(100).describe("Required array of actual source asset IDs in this project. Use [] when not derived from another project asset. Never omit it or supply prose/paths."),
    operationId: identifier.optional(), model: short.optional(),
  }).strict(),
  placeholder: z.boolean(),
  processing: z.object({ jobId: identifier, sourceRevision: z.number().int().positive(), processorId: identifier,
    toolchainSha256: hash, recipeHash: hash }).strict().optional(),
}).strict();

export function createGameDocumentSchema<Version extends z.ZodType<2>, Design extends z.ZodType<GameDesignV2>>(schemaVersion: Version, design: Design) { return z.object({
  schemaVersion,
  title: short,
  brief: z.object({ request: text, audience: short, genre: short,
    dimension: gameDimension, playMode: z.enum(["single-player", "local-coop", "local-versus"]),
    players: z.object({ min: z.number().int().min(1).max(16), max: z.number().int().min(1).max(16) }).strict(),
    devices: z.array(z.enum(["desktop", "tablet", "mobile"])).min(1).max(3),
    inputs: z.array(z.enum(["keyboard", "pointer", "touch", "gamepad"])).min(1).max(4),
  }).strict(),
  engine: gameEngine,
  design: design.nullable(),
  files: z.array(gameFile).max(20000),
  assets: z.array(gameAsset).max(10000).refine(uniqueIds, "Asset identities must be unique."),
  legacy: z.object({ schemaVersion: z.literal(1), reviewRequired: z.literal(true), design: z.record(z.string(), z.unknown()) }).strict().optional(),
}).strict().superRefine((document, context) => {
  const brief = document.brief;
  if (brief.players.min > brief.players.max ||
      (brief.playMode === "single-player" && (brief.players.min !== 1 || brief.players.max !== 1)) ||
      (brief.playMode !== "single-player" && brief.players.max < 2))
    context.addIssue({ code: "custom", path: ["brief", "players"], message: "Player counts must match the selected local play mode." });
  for (const key of ["devices", "inputs"] as const)
    if (new Set(brief[key]).size !== brief[key].length)
      context.addIssue({ code: "custom", path: ["brief", key], message: "Entries must be unique." });
  if (document.engine === "phaser" && brief.dimension !== "2d")
    context.addIssue({ code: "custom", path: ["engine"], message: "The Phaser adapter produces 2D games; choose an available 3D adapter explicitly." });
  const names = new Set(document.files.map((file) => file.path));
  const conflict = gameFileTreeConflict(document.files.map((file) => file.path));
  if (conflict) context.addIssue({ code: "custom", path: ["files", conflict.index, "path"], message: conflict.message });
  const assets = new Set(document.assets.map((row) => row.id));
  document.assets.forEach((asset, index) => {
    if (asset.files.some((name) => !names.has(name)) || new Set(asset.files).size !== asset.files.length)
      context.addIssue({ code: "custom", path: ["assets", index, "files"], message: "Asset files must reference distinct project files." });
    if (asset.origin.referenceIds.some((id) => id === asset.id || !assets.has(id)) || new Set(asset.origin.referenceIds).size !== asset.origin.referenceIds.length)
      context.addIssue({ code: "custom", path: ["assets", index, "origin", "referenceIds"], message: "Asset references must identify distinct other assets in this project." });
  });
  // Provenance must be acyclic. Use an iterative walk for large asset catalogs.
  const incoming = new Map(document.assets.map((asset) => [asset.id, asset.origin.referenceIds.length]));
  const dependents = new Map<string, string[]>();
  for (const asset of document.assets) for (const reference of asset.origin.referenceIds) {
    const children = dependents.get(reference) ?? [];
    children.push(asset.id); dependents.set(reference, children);
  }
  const ready = document.assets.filter((asset) => !asset.origin.referenceIds.length).map((asset) => asset.id);
  for (let i = 0; i < ready.length; i++) for (const child of dependents.get(ready[i]!) ?? []) {
    incoming.set(child, incoming.get(child)! - 1);
    if (incoming.get(child) === 0) ready.push(child);
  }
  if (ready.length !== document.assets.length)
    context.addIssue({ code: "custom", path: ["assets"], message: "Asset provenance cannot contain cycles or missing references." });
}); }
export const gameDocument = createGameDocumentSchema(z.literal(2), gameDesignV2);
export type GameDocument = z.infer<typeof gameDocument>;
export type LegacyGameDesignConversion = { design: GameDesignV2; legacy: NonNullable<GameDocument["legacy"]> };

export const gameProjectCreate = z.object({ requestId: identifier, document: gameDocument }).strict();
export const gameProjectRead = z.object({ id: identifier }).strict();
export const gameProjectList = z.object({ cursor: z.number().int().nonnegative().default(0), limit: z.number().int().min(1).max(100).default(30) }).strict();
export const gameRevisionRead = z.object({ projectId: identifier, revision: z.number().int().positive().optional() }).strict();
export const gameRevisionsList = z.object({ projectId: identifier, cursor: z.number().int().nonnegative().default(0), limit: z.number().int().min(1).max(100).default(30), order:z.enum(["asc","desc"]).default("asc") }).strict();
export const gameFileRead = gameRevisionRead.extend({ path: gameFilePath }).strict();
export const gameRevisionCommit = z.object({ projectId: identifier, requestId: identifier,
  expectedRevision: z.number().int().positive(), document: gameDocument, message: short,
}).strict();
export const gameEventsRead = z.object({ projectId: identifier, cursor: z.number().int().nonnegative().default(0), limit: z.number().int().min(1).max(500).default(100) }).strict();
export type GameProject = { id: string; title: string; engine: z.infer<typeof gameEngine>; dimension: z.infer<typeof gameDimension>;
  revision: number; contentHash: string; createdAt: number; updatedAt: number };
/** Read-only domain receipt lookup. Absence is not proof that an in-flight request cannot commit. */
export const gameMutationInspect = z.object({ projectId: identifier, requestId: identifier }).strict();
export const gameMutationInspection = z.discriminatedUnion("state", [
  gameMutationInspect.extend({ state: z.literal("missing") }).strict(),
  gameMutationInspect.extend({ state: z.literal("acknowledged"), bindingHash: hash, revision: z.number().int().positive(), contentHash: hash }).strict(),
]);
export type GameMutationInspection = z.infer<typeof gameMutationInspection>;
export type GameRevision = { projectId: string; revision: number; contentHash: string; parentHash: string | null;
  document: GameDocument; message: string; createdAt: number; origin: "created" | "edited" | "imported" };
export type GameProjectEvent = { sequence: number; projectId: string; type: "project.created" | "project.revised" | "project.imported";
  revision: number; contentHash: string; createdAt: number };
export type GameProjectSnapshot = { project: GameProject; revision: GameRevision; cursor: number };
export const gameProjectArchive = z.object({ schemaVersion: z.literal(2),
  kind: z.literal("companion-game-project"),
  revisions: z.array(z.object({ revision: z.number().int().positive(),
    contentHash: hash, parentHash: hash.nullable(), document: gameDocument,
    message: short, createdAt: z.number().int().nonnegative(),
    origin: z.enum(["created", "edited", "imported"]),
  }).strict()).min(1).max(100000),
}).strict();
export type GameProjectArchive = z.infer<typeof gameProjectArchive>;
export const gameProjectImport = z.object({ requestId: identifier, transferId: identifier,
  blobs: z.array(z.object({ sha256: hash, transferId: identifier }).strict()).max(20000),
}).strict();
