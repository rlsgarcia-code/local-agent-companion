import assert from "node:assert/strict";
import test from "node:test";
import { installedCoreGameValidationSchemas as schemas } from "../packages/contracts/src/kidos-game-validation";
import { installedGameProductionAPI as api } from "../packages/agent-core/src/installed-production";

const hash = "a".repeat(64), toolchain = { id: "core-browser", version: "1+playwright.1.58.2", sha256: hash };
const receipt = { build_id: "a".repeat(32), request_id: "validation", input_binding: hash, state: "prepared",
  created: 1, updated: 1, cancel_requested: false, error: null, historical: true, production_kind: "validate", admitted: true,
  production: { ref: "b".repeat(32), project_id: "game", stage: "design" } };
const report = { path: "report.json", mime: "application/json", size: 1200000, sha256: hash };
const page = { schemaVersion: 1, requestId: "validation", requestSha256: hash, sourceHash: hash, artifactHash: hash, toolchain,
  collector_id: "kidos-core-browser-v1", observation_count: 3, report, files: [report], cursor: 1, has_more: true };

test("protected validation has a distinct queued receipt and a bounded page for a large chunked report", () => {
  assert.deepEqual(schemas.receipt.parse(receipt), receipt);
  assert.deepEqual(schemas.page.parse(page), page);
  assert.equal(schemas.receipt.safeParse({ ...receipt, production_kind: "assets" }).success, false);
  const { admitted: _admitted, ...notQueued } = receipt;
  assert.equal(schemas.receipt.safeParse(notQueued).success, false);
  for (const extra of [{ observations: [{ scope: "physical" }] }, { command: "/bin/sh" }, { passed: true }])
    assert.equal(schemas.page.safeParse({ ...page, ...extra }).success, false);
  assert.equal(schemas.page.safeParse({ ...page, report: { ...report, size: 4194305 } }).success, false);
  assert.equal(schemas.page.safeParse({ ...page, files: Array(101).fill(report) }).success, false);
  assert.equal(schemas.page.safeParse({ ...page, observation_count: 52 }).success, false);
});

test("Core browser capability pins queue and limits without advertising Unity or human QA", () => {
  const caps = { available: true, validation_abi: 1, queue_budget_abi: 1, collector_id: "kidos-core-browser-v1",
    engines: ["phaser", "babylon", "godot"], categories: ["runtime"], toolchain,
    admission: { day: "2026-11-11", starts: 0, reserved_bytes: 0, daily_starts: 64, daily_reserved_bytes: 17179869184,
      allowed: true, require_project: true, require_queue: true, production_kinds: ["build", "assets", "validate"] },
    chunk_bytes: 262144, request_bytes: 16777216, source_bytes: 268435456, result_bytes: 71303168 };
  assert.deepEqual(schemas.capabilities.parse(caps), caps);
  for (const modified of [{ ...caps, validation_abi: true }, { ...caps, queue_budget_abi: 0 },
    { ...caps, engines: ["unity"] }, { ...caps, categories: ["human"] }, { ...caps, command: "/bin/sh" }])
    assert.equal(schemas.capabilities.safeParse(modified).success, false);
  assert.equal(schemas.capabilities.safeParse({ available: false, reason: "Provisioning required" }).success, true);
});

test("the process-owner kit exposes the fixed candidate and Core schemas without a second executor", () => {
  assert.equal(api.installedCoreGameValidationVersion, 1);
  assert.equal(api.coreValidationSchemas, schemas);
  assert.equal(api.gameBrowserProcessRequest.safeParse({ command: "sh" }).success, false);
  assert.equal(api.gameBrowserProcessResult.safeParse({ passed: true }).success, false);
  assert.equal(api.gameBrowserCandidateToolchain(hash, "b".repeat(64)).id, "core-browser");
  assert.equal(api.installedCoreGameBrowserComponentVersion, 1);
  const component = "c".repeat(64);
  assert.notEqual(api.gameBrowserCandidateToolchain(hash, "b".repeat(64), component).sha256,
    api.gameBrowserCandidateToolchain(hash, "b".repeat(64)).sha256);
  assert.notEqual(api.gameBrowserCandidateToolchain(hash, "b".repeat(64), component).sha256,
    api.gameBrowserCandidateToolchain(hash, "b".repeat(64), "d".repeat(64)).sha256);
  assert.throws(() => api.gameBrowserCandidateToolchain(hash, "b".repeat(64), "mutable-component"));
  assert.throws(() => api.gameBrowserCandidateToolchain("branch", "b".repeat(64)));
});
