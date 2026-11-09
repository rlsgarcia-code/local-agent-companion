import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as vm from "node:vm";

test("streaming status updates one run indicator and retains tool events and the assistant", async () => {
  const source = await readFile("src/webview.ts", "utf8");
  const start = source.indexOf("function appendExecutionTimelineEvent(");
  const end = source.indexOf("\nfunction runSummaryStats(", start);
  assert.ok(start > 0 && end > start);
  const children: { isConnected: boolean; innerHTML: string; className: string }[] = [];
  const context = vm.createContext({
    document: { getElementById: () => null, createElement: () => ({ isConnected: false, innerHTML: "", className: "" }) },
    timeline: {
      appendChild: (element: typeof children[number]) => { element.isConnected = true; children.push(element); },
      insertBefore: (element: typeof children[number], before: typeof children[number]) => { element.isConnected = true; children.splice(children.indexOf(before), 0, element); },
    },
    runActivityState: { events: [] }, assistantStreamStates: new Map(),
    escapeHtml: String, localLinkify: String, executionEventIcon: () => "", scrollConversationToBottom: () => {},
  });
  vm.runInContext(source.slice(start, end), context);
  for (let index = 0; index < 1000; index++) vm.runInContext("appendExecutionTimelineEvent('status', 'Agent is thinking')", context);
  assert.equal(children.length, 1);
  const indicator = children[0];
  vm.runInContext("appendExecutionTimelineEvent('tool', 'Read approved fixture')", context);
  const assistant = { isConnected: true, innerHTML: "partial answer", className: "assistant" };
  children.push(assistant);
  (context.assistantStreamStates as Map<string, unknown>).set("answer", { element: assistant });
  vm.runInContext("appendExecutionTimelineEvent('status', 'Waiting for approval'); appendExecutionTimelineEvent('status', 'Agent is thinking'); appendExecutionTimelineEvent('tool', 'Second actual tool event')", context);
  assert.equal(children.length, 4);
  assert.equal(children[0], indicator);
  assert.match(indicator!.innerHTML, /Agent is thinking/);
  assert.equal(children[3], assistant);
  assert.equal(assistant.innerHTML, "partial answer");
  context.runActivityState = { events: [] };
  vm.runInContext("appendExecutionTimelineEvent('status', 'Another run')", context);
  assert.equal(children.length, 5);
  assert.notEqual(children[3], indicator);
});
