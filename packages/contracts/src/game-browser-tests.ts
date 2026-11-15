import { z } from "zod";
import { identifier } from "./schema";
import { gameFilePath } from "./games";

export const gameTestSuitePath = gameFilePath.refine((name) => /^data\/(?:playtests\.json|playtests\/[a-zA-Z0-9_./-]+\.json)$/.test(name), "A browser test suite must be a packaged data/playtests JSON file.");
const selector = z.string().min(1).max(256).refine((value) => !/[\x00-\x1f]/.test(value));
const size = { width: z.number().int().min(320).max(1920), height: z.number().int().min(240).max(1080) };
const capture = { selector: selector.default("canvas"), name: identifier };
const key=z.string().regex(/^(?:[a-zA-Z0-9]|Space|Enter|Escape|ArrowUp|ArrowDown|ArrowLeft|ArrowRight)$/);
export const gameBrowserTestStep = z.discriminatedUnion("action", [
  z.object({ action: z.literal("press"), key }).strict(),
  z.object({ action: z.literal("key-down"), key }).strict(),
  z.object({ action: z.literal("key-up"), key }).strict(),
  z.object({ action: z.literal("click"), x: z.number().min(0).max(1), y: z.number().min(0).max(1), button: z.enum(["left", "right"]).default("left") }).strict(),
  z.object({ action: z.literal("tap"), x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).strict(),
  z.object({ action: z.literal("wait"), ms: z.number().int().min(1).max(2000) }).strict(),
  z.object({ action: z.literal("resize"), ...size }).strict(),
  z.object({ action: z.literal("reload") }).strict(),
  z.object({ action: z.literal("expect-text"), selector, value: z.string().min(1).max(1000), match: z.enum(["exact", "contains"]).default("exact") }).strict(),
  z.object({ action: z.literal("expect-visible"), selector }).strict(),
  z.object({ action: z.literal("capture"), ...capture }).strict(),
  z.object({ action: z.literal("expect-image"), selector: selector.default("canvas"), baseline: identifier,
    comparison: z.enum(["changed", "unchanged"]), threshold: z.number().min(0).max(1).default(0.001) }).strict(),
]);
export const gameBrowserTestSuite = z.object({ schemaVersion: z.literal(1), viewport: z.object(size).strict().default({ width: 960, height: 540 }),
  scenarios: z.array(z.object({ id: identifier, designScenarioId: identifier.optional(), steps: z.array(gameBrowserTestStep).min(1).max(30) }).strict()).min(1).max(50),
}).strict().superRefine((suite, context) => {
  if (new Set(suite.scenarios.map((scenario) => scenario.id)).size !== suite.scenarios.length)
    context.addIssue({ code: "custom", path: ["scenarios"], message: "Test case identities must be unique." });
  for (const [i, scenario] of suite.scenarios.entries()) {
    const captures = new Set<string>();
    const held=new Set<string>();
    for (const [j, step] of scenario.steps.entries()) {
      if(step.action==="key-down"){if(held.has(step.key))context.addIssue({code:"custom",path:["scenarios",i,"steps",j],message:"Key is already held."});held.add(step.key);}
      if(step.action==="key-up"){if(!held.delete(step.key))context.addIssue({code:"custom",path:["scenarios",i,"steps",j],message:"Release only a held key."});}
      if(step.action==="press"&&held.has(step.key)||step.action==="reload"&&held.size)context.addIssue({code:"custom",path:["scenarios",i,"steps",j],message:"Release held keys before pressing that key or reloading."});
      if (step.action === "capture") {
        if (captures.has(step.name)) context.addIssue({ code: "custom", path: ["scenarios", i, "steps", j], message: "Capture names must be unique within a case." });
        captures.add(step.name);
      }
      if (step.action === "expect-image" && !captures.has(step.baseline)) context.addIssue({ code: "custom", path: ["scenarios", i, "steps", j], message: "Image comparison requires an earlier captured baseline." });
    }
    if(held.size)context.addIssue({code:"custom",path:["scenarios",i,"steps"],message:"Release every held key before ending a scenario."});
  }
});
export type GameBrowserTestSuite = z.infer<typeof gameBrowserTestSuite>;

export type GameBrowserRecipeIssue = { path: (string | number)[]; code: string; message: string };
export type GameBrowserRecipeFailure = { valid: false; issues: GameBrowserRecipeIssue[]; omittedIssues: number };
export function gameBrowserRecipeSizeCheck(size: number): GameBrowserRecipeFailure | undefined {
  if (size > 1024 * 1024) return { valid: false, issues: [{ path: [], code: "too_big",
    message: "Browser test suite exceeds 1 MiB. Split it into named suites." }], omittedIssues: 0 };
}
/** The same bounded, non-executing decoder for source inspection, admission and collection. */
export function checkGameBrowserRecipe(bytes: Uint8Array, designScenarios: readonly { id: string; category: string }[]):
  GameBrowserRecipeFailure | { valid: true; suite: GameBrowserTestSuite; issues: []; omittedIssues: 0 } {
  const oversized = gameBrowserRecipeSizeCheck(bytes.byteLength);
  if (oversized) return oversized;
  let input: unknown;
  try { input = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { return { valid: false, issues: [{ path: [], code: "invalid_json",
    message: "A test recipe must be a UTF-8 JSON object, not executable code." }], omittedIssues: 0 }; }
  const parsed = gameBrowserTestSuite.safeParse(input);
  if (!parsed.success) return { valid: false, issues: parsed.error.issues.slice(0, 20).map(issue => ({
    path: issue.path.slice(0, 12) as (string | number)[], code: issue.code,
    // Strict-object errors otherwise disclose arbitrary submitted property names.
    message: issue.code === "unrecognized_keys" ? "Unexpected fields are not allowed in this test format." : issue.message.slice(0, 240),
  })), omittedIssues: Math.max(0, parsed.error.issues.length - 20) };
  const issues = parsed.data.scenarios.flatMap((scenario, index): GameBrowserRecipeIssue[] => {
    if (!scenario.designScenarioId) return [];
    const design = designScenarios.find(test => test.id === scenario.designScenarioId);
    return design && ["gameplay", "technical", "accessibility"].includes(design.category) ? [] : [{
      path: ["scenarios", index, "designScenarioId"], code: "invalid_reference",
      message: "Reference an existing gameplay, technical or accessibility design playtest in this revision.",
    }];
  });
  if (issues.length) return { valid: false, issues: issues.slice(0, 20), omittedIssues: Math.max(0, issues.length - 20) };
  return { valid: true, suite: parsed.data, issues: [], omittedIssues: 0 };
}
export function gameBrowserRecipeFailureMessage(result: GameBrowserRecipeFailure): string {
  return `Invalid saved browser test suite: ${result.issues.map(issue => `${issue.path.join(".") || "root"}: ${issue.message}`).join("; ")}${result.omittedIssues ? `; ${result.omittedIssues} additional issues omitted.` : ""}`;
}

/** Static installed format reference, not a generated test or acceptance result. */
export const gameBrowserTestGuide = `Package test suites at data/playtests.json or named data/playtests/*.json and build that exact revision before validation. JSON root: {schemaVersion:1,viewport?:{width,height},scenarios:[{id,designScenarioId?,steps:[...]}]}. Viewport defaults to 960x540; width 320..1920, height 240..1080. Use 1..50 unique scenarios and 1..30 steps per scenario. Map designScenarioId to the actual design playtest being exercised; a label alone is not evidence.
Steps are strict JSON objects with action and only its listed fields:
press, key-down, key-up: {key}; key is one ASCII letter/digit, Space, Enter, Escape, ArrowUp, ArrowDown, ArrowLeft or ArrowRight. Release every held key before scenario end; do not press an already held key or reload while holding keys.
click: {x,y,button?:"left"|"right"}; tap: {x,y}; coordinates are normalized 0..1.
wait: {ms:1..2000}; resize: {width,height} in viewport bounds; reload: no fields.
expect-text: {selector,value,match?:"exact"|"contains"}; expect-visible: {selector}.
capture: {name,selector?:string}; expect-image: {baseline,comparison:"changed"|"unchanged",threshold?:0..1,selector?:string}. Selector defaults to canvas; threshold defaults to 0.001. Baseline names must be unique captures earlier in that scenario.
Example: {"schemaVersion":1,"scenarios":[{"id":"input-example","steps":[{"action":"capture","name":"before"},{"action":"key-down","key":"ArrowRight"},{"action":"wait","ms":150},{"action":"key-up","key":"ArrowRight"},{"action":"expect-image","baseline":"before","comparison":"changed"}]}]}
Use meaningful controls, pause/restart/focus/save cases for the actual game. No JavaScript, evaluate, arbitrary URL, network or host command is accepted. Expected-image failure remains failed even when game code declares success. These observations do not certify semantic completion, physical performance, audio quality or human enjoyment.`;
