import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const bootstrap = readFileSync("packages/client-ts/src/bootstrap.ts", "utf8");
const service = readFileSync("packages/agent-service/src/service.ts", "utf8");
const vscodeRuntime = readFileSync("src/service-runtime.ts", "utf8");
const desktopMain = readFileSync("desktop/main.ts", "utf8");
const desktopHtml = readFileSync("desktop/renderer/index.html", "utf8");
const desktopRenderer = readFileSync("desktop/renderer/renderer.js", "utf8");

test("engine updates expose blockers and require an explicit local-resource action", () => {
  assert.match(service, /engine\.updateStatus/);
  assert.match(service, /engine\.stopManagedResourcesForUpdate/);
  assert.match(service, /activeRuns/);
  assert.match(service, /managedProcesses/);
  assert.match(bootstrap, /PreparedEngineUpdateError/);
  assert.match(bootstrap, /activation\?: "idle" \| "stop-managed"/);
  assert.match(vscodeRuntime, /Stop local resources and update/);
  assert.match(vscodeRuntime, /Restart the Companion engine/);
});

test("desktop settings expose engine state and a controlled restart", () => {
  assert.match(desktopHtml, /id="engine-status"/);
  assert.match(desktopHtml, /id="restart-engine"/);
  assert.match(desktopMain, /Atualização do motor pronta/);
  assert.match(desktopMain, /companion:restart-engine/);
  assert.match(desktopMain, /Encerrar recursos e atualizar/);
});

test("legacy activation uses exact per-user service controls without a shell", () => {
  assert.match(bootstrap, /execFile\(file, args/);
  assert.match(bootstrap, /dev\.localagent\.engine/);
  assert.match(bootstrap, /companion-engine\.service/);
  assert.match(bootstrap, /"taskkill"/);
  assert.doesNotMatch(bootstrap, /exec\(/);
});

test("desktop also guards new conversations with the authoritative workspace lease", () => {
  assert.match(desktopMain, /runtime\.workspaceStatus\(state\.workspacePath\)/);
  assert.match(desktopMain, /Retome ou cancele essa execução/);
  assert.match(desktopRenderer, /snapshot\.workspaceRun\?\.busy/);
  assert.match(desktopRenderer, /Execução preservada em outra conversa/);
});
