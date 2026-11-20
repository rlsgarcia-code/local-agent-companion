import test from "node:test";
import assert from "node:assert/strict";
import { generationApproval, type GenerationApprovalScope } from "./game-generation-policy";

const scope: GenerationApprovalScope = { runId: "run", engine: "phaser", projects: [{ id: "game", revision: 3, engine: "phaser" }], jobs: [{ id: "build", projectId: "game", revision: 3, kind: "build", state: "completed" }] };
const request = (tool: string, input: unknown) => ({ runId: "run", kind: "approval", payload: { risk: "standard", tool, input } });
const media = { projectId: "game", revision: 3, spec: { processorId: "local-media-v1", target: { id: "tone", role: "Game sound", placeholder: false }, operation: { type: "audio.render", output: "assets/tone.wav", durationMs: 100, notes: [{waveform:"sine",frequency:440,startMs:0,durationMs:100,gain:0.2}] } } };
test("generation harness approves only exact temporary source builds and bounded media", () => {
  assert.equal(generationApproval(request("game_build", { projectId: "game", revision: 3 }), scope), true);
  assert.equal(generationApproval(request("game_process_assets", media), scope), true);
  for (const input of [{ projectId: "other", revision: 3 }, { projectId: "game", revision: 2 }, { projectId: "game", revision: "3" }])
    assert.equal(generationApproval(request("game_build", input), scope), false);
  assert.equal(generationApproval(request("game_process_assets", { projectId: "game", revision: 3, spec: { processorId: "unapproved-provider" } }), scope), false);
  assert.equal(generationApproval(request("game_build", { projectId: "game", revision: 3, command: "unapproved" }), scope), false);
  assert.equal(generationApproval(request("game_process_assets", { ...media, spec: { ...media.spec, processorId: "unapproved-provider" } }), scope), false);
});
test("generation harness validates only a completed current build through the installed browser", () => {
  const validate = request("game_validate", { buildId: "build", collectorId: "web-browser-runtime-v1" });
  assert.equal(generationApproval(validate, scope), true);
  assert.equal(generationApproval(validate, { ...scope, jobs: [{ ...scope.jobs[0]!, state: "running" }] }), false);
  assert.equal(generationApproval(validate, { ...scope, projects: [{ id: "game", revision: 4, engine: "phaser" }] }), false);
  assert.equal(generationApproval(validate, { ...scope, engine: "unity" }), false);
  assert.equal(generationApproval(request("game_validate", { buildId: "build", collectorId: "fake" }), scope), false);
  assert.equal(generationApproval(request("game_validate", { buildId: "build", collectorId: "web-browser-runtime-v1", testSuite: "../escape.json" }), scope), false);
});
test("generation harness never accepts host execution, credentials, renewal or another run", () => {
  for (const tool of ["command_run", "game_advance_stage", "inference_budget", "credentials", "write_file"])
    assert.equal(generationApproval(request(tool, { projectId: "game", revision: 3 }), scope), false);
  const build = request("game_build", { projectId: "game", revision: 3 });
  assert.equal(generationApproval({ ...build, runId: "other" }, scope), false);
  assert.equal(generationApproval({ ...build, kind: "tool" }, scope), false);
  assert.equal(generationApproval({ ...build, payload: { ...build.payload, risk: "sensitive" } }, scope), false);
  for (const payload of [null, "game_build", {}, { tool: "game_build", input: null }])
    assert.equal(generationApproval({ ...build, payload }, scope), false);
});
