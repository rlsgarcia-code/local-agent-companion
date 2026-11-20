import assert from "node:assert/strict";
import test from "node:test";
import { applyGameTextEdits, GameTextEditError } from "../packages/game-production/src/text-edits";
import { gameTextEdits, MAX_GAME_EDIT_TEXT_BYTES } from "../packages/contracts/src/game-text-edits";
import { gameAgentSchemas } from "../packages/contracts/src/game-agent";

test("directed edits preserve BOM, CRLF, Unicode and literal regex/replacement characters", () => {
  const source = "\ufeffconst title = 'Maré 🛶';\r\nconst expression = '.*$&';\r\n";
  const changed = applyGameTextEdits(source, [
    { before: "Maré 🛶", after: "Aurora 🌄" },
    { before: "'.*$&'", after: "'$`[$&]$\u0027'" },
    { before: "Aurora 🌄", after: "Aurora 🌄 · nova" },
  ]);
  assert.equal(changed, "\ufeffconst title = 'Aurora 🌄 · nova';\r\nconst expression = '$`[$&]$\u0027';\r\n");
  assert.equal(applyGameTextEdits("prefix\nremove\nsuffix", [{ before: "remove\n", after: "" }]), "prefix\nsuffix");
  assert.equal(source, "\ufeffconst title = 'Maré 🛶';\r\nconst expression = '.*$&';\r\n");
});

test("directed edits reject ambiguous/overlapping matches, missing context, no-ops and invalid Unicode without echoing source", () => {
  for (const [source, edits, pattern] of [
    ["aaaa", [{ before: "aaa", after: "b" }], /ambiguous/],
    ["PRIVATE_SOURCE", [{ before: "PRIVATE_MISSING", after: "x" }], /no exact match/],
    ["abc", [{ before: "a", after: "A" }, { before: "z", after: "Z" }], /Edit 2/],
    ["a", [{ before: "a", after: "a" }], /does not change/],
    ["a", [{ before: "a", after: "b" }, { before: "b", after: "a" }], /cancel/],
    ["\ud800", [{ before: "x", after: "y" }], /not supported text/],
    ["a\0b", [{ before: "a", after: "A" }], /not supported text/],
  ] as const) assert.throws(() => applyGameTextEdits(source, edits), error => error instanceof GameTextEditError && pattern.test(error.message) && !error.message.includes("PRIVATE_"));
  for (const edits of [[], [{ before: "", after: "x" }], [{ before: "x", after: "\ud800" }], [{ before: "x", after: "\0" }], [{ before: "a", after: "b", regex: true }], Array(33).fill({ before: "x", after: "y" }), [{ before: "a".repeat(65537), after: "b" }], Array(4).fill({ before: "é".repeat(20000), after: "é".repeat(20000) })]) assert.equal(gameTextEdits.safeParse(edits).success, false);
  const request = { projectId: "game", expectedRevision: 3, path: "src/main.js", baseSha256: "a".repeat(64), edits: [{ before: "a", after: "b" }] };
  assert.ok(gameAgentSchemas.game_edit_file.safeParse(request).success);
  for (const value of [{ ...request, path: "../outside" }, { ...request, path: "/home/child/file" }, { ...request, baseSha256: "guessed" }, { ...request, regex: true }]) assert.equal(gameAgentSchemas.game_edit_file.safeParse(value).success, false);
});

test("source and intermediate/result byte limits reject expansion without truncation", () => {
  const source = "x".repeat(MAX_GAME_EDIT_TEXT_BYTES - 1) + "z";
  assert.throws(() => applyGameTextEdits(source + "z", [{ before: "zz", after: "q" }]), /8 MiB editing limit/);
  assert.throws(() => applyGameTextEdits(source, [{ before: "z", after: "zz" }]), /8 MiB result limit/);
  const result = applyGameTextEdits(source, [{ before: "z", after: "q" }]);
  assert.equal(result.length, MAX_GAME_EDIT_TEXT_BYTES);assert.ok(result.endsWith("q"));assert.ok(source.endsWith("z"));
});
