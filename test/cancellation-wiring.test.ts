import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { combinedAbortSignal } from "../src/gateway";

const agent = readFileSync("src/agent.ts", "utf8");
const semanticMemory = readFileSync("packages/agent-core/src/semantic-memory.ts", "utf8");
const browser = readFileSync("src/browser.ts", "utf8");
const webview = readFileSync("src/webview.ts", "utf8");

test("combines provider timeouts with a user cancellation signal", () => {
  const request = new AbortController();
  const run = new AbortController();
  const combined = combinedAbortSignal(request.signal, run.signal);

  assert.equal(combined?.aborted, false);
  run.abort(new Error("user cancelled"));
  assert.equal(combined?.aborted, true);
  assert.equal(combined?.reason instanceof Error, true);
});

test("keeps the single signal unchanged and allows an absent signal", () => {
  const controller = new AbortController();
  assert.equal(combinedAbortSignal(controller.signal), controller.signal);
  assert.equal(combinedAbortSignal(undefined, controller.signal), controller.signal);
  assert.equal(combinedAbortSignal(), undefined);
});

test("propagates cancellation through context, embeddings, tools, and model execution", () => {
  assert.match(agent, /controller\.signal\.throwIfAborted\(\)/);
  const providers = readFileSync("packages/agent-core/src/provider-models.ts","utf8");
  assert.match(providers,/gatewayFetch\([\s\S]*this\.dispatcher,this\.signal/);
  assert.match(agent, /signal: controller\.signal/);
  assert.match(agent, /this\.serviceRuntime\.cancel\(\)/);
  assert.match(semanticMemory, /options\.signal\?\.throwIfAborted\(\)/);
  assert.match(browser, /signal\.addEventListener\("abort", \(\) => void this\.close\(\), \{ once: true \}\)/);
});

test("distinguishes a requested stop from an acknowledged cancelled outcome", () => {
  assert.match(agent, /"requested" \| "already-requested" \| "idle"/);
  assert.match(webview, /type: "cancelState", state: cancellation/);
  assert.match(webview, /Stop requested/);
  assert.match(webview, /let cancellationPending = false/);
  assert.match(webview, /cancel\.disabled = cancellationPending/);
  assert.doesNotMatch(
    webview,
    /cancel\.addEventListener\('click',[\s\S]{0,180}currentRunSummary\.cancelled = true/
  );
  assert.match(webview, /currentRunSummary\.cancelled = data\.outcome === 'cancelled'/);
});
