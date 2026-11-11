import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const agent = readFileSync("src/agent.ts", "utf8");
const webview = readFileSync("src/webview.ts", "utf8");

test("checks local run prerequisites before accepting or persisting a request", () => {
  assert.match(agent, /public async preflightRun/);
  assert.match(agent, /vscode\.workspace\.isTrusted/);
  assert.match(agent, /await this\.externalRunActive\(\)/);
  assert.match(agent, /validateModelConnection/);
  assert.match(agent, /validateLiteLlmModelProfile/);
  assert.match(agent, /await this\.certificateAuthorities\(workspace\.uri\.fsPath\)/);
  assert.match(webview, /preflight = await this\.agent\.preflightRun\(\{ resumeExisting: replacePending \}\)/);
  assert.ok(
    webview.indexOf("preflight = await this.agent.preflightRun({ resumeExisting: replacePending })") <
      webview.indexOf('this.post({ type: "busy", value: true })')
  );
});

test("translates a workspace lease race into conversation recovery guidance", () => {
  assert.match(agent, /Workspace is in use by another run/);
  assert.match(agent, /resume or cancel it before sending a new request/);
});

test("keeps the draft and opens the relevant local remediation surface", () => {
  assert.match(webview, /type: "preflightFailed"/);
  assert.match(webview, /case 'preflightFailed'/);
  assert.match(webview, /prompt\.value = data\.text \|\| pendingRequestText/);
  assert.match(webview, /openConnectionSettings/);
  assert.match(webview, /Request not started/);
  assert.match(webview, /pendingUserReplaced/);
});

test("revalidates critical prerequisites before staging the thread", () => {
  const runStart = agent.indexOf("public async run(");
  const runSource = agent.slice(runStart, agent.indexOf("public cancel()", runStart));
  assert.ok(runSource.indexOf("validateModelConnection") < runSource.indexOf("stageThreadRequest"));
  assert.ok(runSource.indexOf("validateLiteLlmModelProfile") < runSource.indexOf("stageThreadRequest"));
  assert.ok(runSource.indexOf("certificateAuthorities") < runSource.indexOf("stageThreadRequest"));
});
