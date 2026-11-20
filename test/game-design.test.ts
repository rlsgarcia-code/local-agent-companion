import assert from "node:assert/strict";
import test from "node:test";
import { assessGameProduction, gameDesignModule, prepareGameDesign, type GameCapability } from "../packages/game-design/src/index";

test("a named engine or partial capabilities do not promise production", () => {
  const operations = ["project", "edit", "build", "run", "test"] as const;
  const capabilities: GameCapability[] = operations.map((operation) =>
    ({ engine: "unity", operation, availability: "verified", authorized: true }));
  assert.equal(assessGameProduction("unity", [], "execute").canProduce, false);
  assert.equal(assessGameProduction("godot", capabilities, "execute").canProduce, false);
  assert.equal(assessGameProduction("unity", capabilities, "plan").canProduce, false);
  assert.equal(assessGameProduction("unity", capabilities, "review").requiresOperationApproval, true);
  assert.equal(assessGameProduction("unity", capabilities, "execute").canProduce, true);
  for (const operation of operations) {
    const denied = capabilities.map((row) => row.operation === operation ? { ...row, authorized: false } : row);
    assert.deepEqual(assessGameProduction("unity", denied, "execute").missing, [operation]);
    const unknown = capabilities.map((row) => row.operation === operation ? { ...row, availability: "unknown" as const } : row);
    assert.deepEqual(assessGameProduction("unity", unknown, "execute").missing, [operation]);
  }
  assert.equal(assessGameProduction("unity", [...capabilities, capabilities[0]!], "execute").canProduce, false);
});

test("specialists use only explicit read tools and preserve caller isolation", () => {
  const profile = prepareGameDesign({ readTools: [{ name: "project_read", effect: "read" }] });
  assert.deepEqual(profile.specialists.map((row) => [row.name, row.modelRole]),
    [["game-designer", "planner"], ["game-reviewer", "evaluator"]]);
  assert.deepEqual(profile.specialists[0]!.tools, ["project_read"]);
  profile.specialists[0]!.tools.push("other");
  assert.deepEqual(profile.specialists[1]!.tools, ["project_read"]);
  assert.deepEqual(prepareGameDesign({ readTools: [] }).specialists[0]!.tools, []);
  assert.throws(() => prepareGameDesign({ readTools: [{ name: "shell", effect: "external" }] }), /read-only/);
  assert.throws(() => prepareGameDesign({ readTools: [{ name: "read", effect: "read" }, { name: "read", effect: "read" }] }), /unique/);
  assert.equal(Object.isFrozen(gameDesignModule.specialists), true);
});
