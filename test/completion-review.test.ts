import assert from "node:assert/strict";
import test from "node:test";
import {
  completionReviewAppendix,
  completionReviewChanges,
  completionReviewPrompt,
  parseCompletionReview,
  shouldRunCompletionReview
} from "../src/completion-review";
import type { RunEvidenceSnapshot } from "../src/run-evidence";

const emptyEvidence: RunEvidenceSnapshot = {
  commands: [],
  diagnostics: [],
  browser: [],
  processes: [],
  filesRead: [],
  projectIndexInspected: false,
  playbooksRead: []
};

test("runs independent review only for the configured executable evidence scope", () => {
  assert.equal(shouldRunCompletionReview("off", "execute", 2, emptyEvidence), false);
  assert.equal(shouldRunCompletionReview("always", "plan", 2, emptyEvidence), false);
  assert.equal(shouldRunCompletionReview("changes", "execute", 0, emptyEvidence), false);
  assert.equal(shouldRunCompletionReview("changes", "execute", 1, emptyEvidence), true);
  assert.equal(shouldRunCompletionReview("changes", "review", 0, {
    ...emptyEvidence,
    diagnostics: [{ action: "compare", introduced: 0, resolved: 1 }]
  }), true);
});

test("parses bounded verifier JSON and appends only actionable review", () => {
  const pass = parseCompletionReview('```json\n{"verdict":"pass","summary":"Evidence is complete","risks":[],"unverified":[]}\n```');
  assert.deepEqual(pass, {
    verdict: "pass",
    summary: "Evidence is complete",
    risks: [],
    unverified: []
  });
  assert.equal(completionReviewAppendix(pass), "");

  const attention = parseCompletionReview(JSON.stringify({
    verdict: "needs_attention",
    summary: "The browser was not exercised.",
    risks: ["Responsive state may regress."],
    unverified: ["Narrow viewport"]
  }));
  assert.match(completionReviewAppendix(attention), /Independent verification/);
  assert.match(completionReviewAppendix(attention), /Narrow viewport/);
});

test("keeps the completion review prompt evidence-only and bounded", () => {
  const prompt = completionReviewPrompt({
    request: "x".repeat(20_000),
    draftAnswer: "y".repeat(30_000),
    mode: "execute",
    changes: [{ path: "src/app.ts", kind: "modified" }],
    omittedChanges: 0,
    evidence: emptyEvidence
  });
  assert.match(prompt, /Use only the supplied evidence/);
  assert.match(prompt, /src\/app\.ts/);
  assert.ok(prompt.length < 40_000);
});

test("gives the verifier a bounded redacted diff while omitting sensitive files", () => {
  const changes = completionReviewChanges([
    {
      id: "1",
      path: "src/app.ts",
      absolutePath: "/workspace/src/app.ts",
      workspaceRoot: "/workspace",
      kind: "modified",
      before: "const value = 1;\n",
      after: "const value = 'sk-1234567890abcdefghijklmnop';\n"
    },
    {
      id: "2",
      path: ".env",
      absolutePath: "/workspace/.env",
      workspaceRoot: "/workspace",
      kind: "created",
      before: null,
      after: "PASSWORD=secret"
    }
  ]);
  assert.match(changes[0]?.excerpt ?? "", /\[REDACTED\]/);
  assert.doesNotMatch(changes[0]?.excerpt ?? "", /sk-1234567890/);
  assert.equal(changes[1]?.excerpt, "[content omitted: sensitive workspace path]");
});
