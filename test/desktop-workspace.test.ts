import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import test from "node:test";
import { resolveDesktopContextTarget } from "../desktop/context-policy";
import { DesktopStateStore } from "../desktop/state-store";
import { LocalProcessManager } from "../src/process-manager";
import { readWorkspaceFile, resolveWritablePath, searchWorkspace, workspaceTree, writeWorkspaceFile } from "../desktop/workspace";

test("desktop workspace operations remain inside the selected project", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "local-companion-desktop-"));
  try {
    await mkdir(path.join(root, "src"));
    await writeFile(path.join(root, "src", "hello.ts"), "export const greeting = 'hello';\n", "utf8");
    assert.equal(await readWorkspaceFile(root, "src/hello.ts"), "export const greeting = 'hello';\n");
    assert.deepEqual(await searchWorkspace(root, "greeting"), ["src/hello.ts:1: export const greeting = 'hello';"]);
    assert.ok((await workspaceTree(root)).includes("f src/hello.ts"));
    await writeWorkspaceFile(root, "src/new.ts", "export {};\n");
    assert.equal(await readFile(path.join(root, "src", "new.ts"), "utf8"), "export {};\n");
    await assert.rejects(resolveWritablePath(root, "../outside.ts"), /escapes/);
    await assert.rejects(resolveWritablePath(root, ".git/config"), /.git directory/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("desktop state migrates a single model and persists role configuration", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "local-companion-state-"));
  const statePath = path.join(root, "private", "desktop-state.json");
  try {
    await mkdir(path.dirname(statePath), { recursive: true });
    await writeFile(statePath, JSON.stringify({ model: "legacy-executor:7b", threads: [] }), "utf8");
    const store = await DesktopStateStore.open(statePath);
    assert.equal(store.snapshot().agentRuntime, "standard");
    assert.equal(store.snapshot().dockerSandboxEnabled, false);
    assert.equal(store.snapshot().modelRoles.executor, "legacy-executor:7b");
    const thread = store.activeThread();
    await store.update({
      workspacePath: "/tmp/example",
      modelRoles: { executor: "qwen3-coder:30b", planner: "deepseek-r1:14b", evaluator: "gpt-oss:20b" },
      mode: "execute",
      agentRuntime: "deep",
      dockerSandboxEnabled: true
    });
    await store.appendMessage(thread.id, { id: "u1", role: "user", text: "Ajuste a validação", createdAt: 1 });
    await store.appendMessage(thread.id, {
      id: "a1",
      role: "assistant",
      text: "Validação ajustada.",
      createdAt: 2,
      executionSteps: [{ id: "s1", text: "Vou primeiro inspecionar o arquivo.", createdAt: 2 }]
    });
    const reopened = await DesktopStateStore.open(statePath);
    const snapshot = reopened.snapshot();
    assert.equal(snapshot.workspacePath, "/tmp/example");
    assert.equal(snapshot.modelRoles.executor, "qwen3-coder:30b");
    assert.equal(snapshot.modelRoles.planner, "deepseek-r1:14b");
    assert.equal(snapshot.mode, "execute");
    assert.equal(snapshot.agentRuntime, "deep");
    assert.equal(snapshot.dockerSandboxEnabled, true);
    assert.equal(snapshot.threads[0]?.messages[0]?.text, "Ajuste a validação");
    assert.equal(snapshot.threads[0]?.messages[1]?.executionSteps?.[0]?.text, "Vou primeiro inspecionar o arquivo.");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("desktop exposes an explicit agent runtime selector independently from autonomy", async () => {
  const [html, renderer, preload, main] = await Promise.all([
    readFile(path.join(process.cwd(), "desktop", "renderer", "index.html"), "utf8"),
    readFile(path.join(process.cwd(), "desktop", "renderer", "renderer.js"), "utf8"),
    readFile(path.join(process.cwd(), "desktop", "preload.ts"), "utf8"),
    readFile(path.join(process.cwd(), "desktop", "main.ts"), "utf8")
  ]);

  assert.match(html, /data-runtime="standard"/);
  assert.match(html, /data-runtime="deep"/);
  assert.match(html, /Agente padrão/);
  assert.match(html, /Deep Agent/);
  assert.match(html, /As permissões continuam controladas por Plano, Revisar e Auto edits/);
  assert.match(renderer, /setAgentRuntime\(button\.dataset\.runtime\)/);
  assert.match(preload, /companion:set-agent-runtime/);
  assert.match(main, /runtime !== "standard" && runtime !== "deep"/);
});

test("desktop adaptive setup keeps model roles editable and uses planner/evaluator through LangChain", async () => {
  const [html, renderer, preload, main, runtime] = await Promise.all([
    readFile(path.join(process.cwd(), "desktop", "renderer", "index.html"), "utf8"),
    readFile(path.join(process.cwd(), "desktop", "renderer", "renderer.js"), "utf8"),
    readFile(path.join(process.cwd(), "desktop", "preload.ts"), "utf8"),
    readFile(path.join(process.cwd(), "desktop", "main.ts"), "utf8"),
    readFile(path.join(process.cwd(), "desktop", "runtime.ts"), "utf8")
  ]);
  assert.match(html, /Recomendação para esta máquina/);
  assert.match(html, /Incluir catálogo público do projeto/);
  assert.match(html, /id="advisor-progress"/);
  assert.match(html, /Modelos considerados/);
  assert.match(html, /Sandbox Docker/);
  assert.match(renderer, /dataset\.roleModel = role/);
  assert.match(renderer, /applyRecommendation\(roles\)/);
  assert.match(renderer, /setRecommendationBusy\(true/);
  assert.match(renderer, /aria-busy/);
  assert.match(renderer, /plan\.docker\.proxyImage/);
  assert.match(renderer, /if \(!appState\.recommendationBusy\) el\["model-popover"\]/);
  assert.match(preload, /companion:recommend-models/);
  assert.match(main, /detectMachineProfile/);
  assert.match(main, /state\.ollamaPublicCatalogEnabled && !publicOllamaCatalog/);
  assert.match(main, /supportedRoles: \["executor", "planner", "evaluator", "vision", "embedding"\]/);
  assert.match(runtime, /createModel\(options\.modelRoles\.executor, true\)/);
  assert.match(runtime, /options\.modelRoles\.evaluator \|\| options\.modelRoles\.executor/);
  assert.match(runtime, /options\.agentRuntime === "deep" && options\.modelRoles\.planner/);
});

test("managed Docker client processes retain a known loopback URL for readiness", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "local-companion-preview-"));
  const script = path.join(root, "server.cjs");
  const expectedUrl = "http://127.0.0.1:43123/";
  const manager = new LocalProcessManager(async (url) => url === expectedUrl);
  try {
    await writeFile(script, [
      `console.log(${JSON.stringify(expectedUrl)});`,
      "setInterval(() => undefined, 1000);"
    ].join("\n"), "utf8");
    const started = await manager.start({ command: process.execPath, args: [script], cwd: root, knownUrls: [expectedUrl] });
    const ready = await manager.waitForReady(started.id, undefined, 10_000, AbortSignal.timeout(12_000));
    assert.equal(ready.ready, true);
    assert.equal(ready.url, expectedUrl);
    const stopped = await manager.stop(started.id);
    assert.equal(stopped.state, "exited");
  } finally {
    manager.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test("desktop wires opt-in Docker-only execution to a visible Context preview", async () => {
  const [contracts, main, renderer, runtime, sandbox, stateStore, html, preload] = await Promise.all([
    readFile(path.join(process.cwd(), "desktop", "contracts.ts"), "utf8"),
    readFile(path.join(process.cwd(), "desktop", "main.ts"), "utf8"),
    readFile(path.join(process.cwd(), "desktop", "renderer", "renderer.js"), "utf8"),
    readFile(path.join(process.cwd(), "desktop", "runtime.ts"), "utf8"),
    readFile(path.join(process.cwd(), "desktop", "docker-sandbox.ts"), "utf8"),
    readFile(path.join(process.cwd(), "desktop", "state-store.ts"), "utf8"),
    readFile(path.join(process.cwd(), "desktop", "renderer", "index.html"), "utf8"),
    readFile(path.join(process.cwd(), "desktop", "preload.ts"), "utf8")
  ]);
  assert.match(runtime, /name: "list_sandbox_images"/);
  assert.match(runtime, /name: "run_sandbox_command"/);
  assert.match(runtime, /name: "start_sandbox_application"/);
  assert.match(runtime, /name: "wait_for_sandbox_application"/);
  assert.match(runtime, /name: "open_sandbox_preview"/);
  assert.doesNotMatch(runtime, /name: "start_local_process"/);
  assert.doesNotMatch(runtime, /name: "run_command"/);
  assert.match(runtime, /dockerSandboxEnabled/);
  assert.match(runtime, /tools\.filter\(\(candidate\) => !candidate\.name\.includes\("sandbox"\)\)/);
  assert.match(runtime, /never attempt a native-host fallback/);
  assert.match(runtime, /evaluateCommandPolicy\(executable, args\)/);
  assert.match(runtime, /dockerSandbox\.dispose\(\)/);
  assert.match(sandbox, /"--cap-drop", "ALL"/);
  assert.match(sandbox, /"--security-opt", "no-new-privileges:true"/);
  assert.match(sandbox, /"--network", "none"/);
  assert.match(sandbox, /"--internal", SANDBOX_NETWORK/);
  assert.match(sandbox, /127\.0\.0\.1:\$\{hostPort\}/);
  assert.doesNotMatch(sandbox, /docker\.sock/);
  assert.match(main, /contextBrowser\.open\(url\)/);
  assert.match(main, /type: "context-focus"/);
  assert.match(contracts, /type: "context-focus"/);
  assert.match(renderer, /event\.type === "context-focus"/);
  assert.match(renderer, /setDockerSandbox/);
  assert.match(html, /Disponibilizar ambiente Docker/);
  assert.match(preload, /companion:set-docker-sandbox/);
  assert.match(stateStore, /dockerSandboxEnabled: stored\.dockerSandboxEnabled === true/);
  assert.match(main, /--enable-docker-sandbox/);
  assert.match(main, /LOCAL_COMPANION_DOCKER_SANDBOX/);
});

test("desktop keeps streaming stable and projects LangChain tool progress", async () => {
  const [html, renderer, runtime, styles] = await Promise.all([
    readFile(path.join(process.cwd(), "desktop", "renderer", "index.html"), "utf8"),
    readFile(path.join(process.cwd(), "desktop", "renderer", "renderer.js"), "utf8"),
    readFile(path.join(process.cwd(), "desktop", "runtime.ts"), "utf8"),
    readFile(path.join(process.cwd(), "desktop", "renderer", "styles.css"), "utf8")
  ]);

  assert.match(html, /class="conversation-stage"/);
  assert.match(html, /id="jump-latest"/);
  assert.match(html, /AÇÕES DO AGENTE/);
  assert.match(renderer, /const SCROLL_STICK_THRESHOLD = 48/);
  assert.match(renderer, /readerAnchorLocked = true/);
  assert.match(renderer, /countedUnseenMessages/);
  assert.match(renderer, /new Map\(\[\.\.\.el\.conversation\.querySelectorAll\("\.message"\)\]/);
  assert.match(renderer, /updateMessageElement\(article, message\)/);
  assert.match(renderer, /1 nova atualização ↓/);
  assert.match(renderer, /existing >= 0.*splice\(existing, 1/s);
  assert.match(runtime, /consumeToolCallActivities\(run\.toolCalls/);
  assert.match(runtime, /call\.output\.then\(\(\) => undefined, \(\) => undefined\)/);
  assert.match(runtime, /status: "active"/);
  assert.match(runtime, /status === "error" \? "failed" : "complete"/);
  assert.match(runtime, /stripProviderProtocolMarkers\(answer\)/);
  assert.match(renderer, /stripProtocolMarkers\(message\.text\)/);
  assert.match(styles, /\.app-shell\s*\{[^}]*position:\s*fixed[^}]*inset:\s*0[^}]*grid-template-rows:\s*minmax\(0,\s*1fr\)[^}]*overflow:\s*hidden/s);
  assert.match(styles, /\.workspace\s*\{[^}]*min-height:\s*0[^}]*height:\s*100%[^}]*overflow:\s*hidden[^}]*display:\s*flex[^}]*flex-direction:\s*column/s);
  assert.match(styles, /\.workspace-header\s*\{[^}]*flex:\s*0 0 82px/s);
  assert.match(styles, /\.conversation-stage\s*\{[^}]*flex:\s*1 1 0[^}]*min-height:\s*0[^}]*overflow:\s*hidden/s);
  assert.match(styles, /\.conversation\s*\{[^}]*height:\s*100%[^}]*overflow:\s*auto/s);
  assert.match(styles, /\.composer-wrap\s*\{[^}]*flex:\s*0 0 auto/s);
  assert.ok(html.indexOf('class="conversation-stage"') < html.indexOf('class="composer-wrap"'));
});

test("desktop preserves intermediate model turns in a collapsible execution group", async () => {
  const [renderer, styles, runtime, main] = await Promise.all([
    readFile(path.join(process.cwd(), "desktop", "renderer", "renderer.js"), "utf8"),
    readFile(path.join(process.cwd(), "desktop", "renderer", "styles.css"), "utf8"),
    readFile(path.join(process.cwd(), "desktop", "runtime.ts"), "utf8"),
    readFile(path.join(process.cwd(), "desktop", "main.ts"), "utf8")
  ]);

  assert.match(runtime, /archiveExecutionStep\(streamed\)/);
  assert.match(runtime, /executionSteps\.length > 60/);
  assert.match(runtime, /executionSteps\n\s*}/);
  assert.match(main, /type: "assistant-step"/);
  assert.match(renderer, /createExecutionStepsElement/);
  assert.match(renderer, /updateExecutionStepsElement/);
  assert.match(renderer, /Etapas da execução/);
  assert.match(renderer, /details\.dataset\.signature/);
  assert.match(styles, /\.run-steps\[open\]/);
  assert.match(styles, /\.run-step-meta/);
});

test("desktop context classifies localhost, HTTPS pages and free-text search safely", () => {
  assert.deepEqual(resolveDesktopContextTarget("localhost:3000/dashboard"), {
    kind: "local",
    url: "http://localhost:3000/dashboard",
    initialTitle: "localhost:3000"
  });
  assert.deepEqual(resolveDesktopContextTarget("docs.example.com/guide"), {
    kind: "web",
    url: "https://docs.example.com/guide",
    initialTitle: "docs.example.com"
  });
  const search = resolveDesktopContextTarget("como testar streaming local");
  assert.equal(search.kind, "search");
  assert.match(search.url, /^https:\/\/duckduckgo\.com\/\?q=/);
  assert.throws(() => resolveDesktopContextTarget("http://example.com"), /HTTPS/);
  assert.throws(() => resolveDesktopContextTarget("https://user:password@example.com"), /credential-free/);
  assert.throws(() => resolveDesktopContextTarget("https://192.168.1.20"), /public host/);
});

test("desktop context view is explicit, visual, isolated and bounded", async () => {
  const [html, renderer, styles, preload, main, browser, runtime] = await Promise.all([
    readFile(path.join(process.cwd(), "desktop", "renderer", "index.html"), "utf8"),
    readFile(path.join(process.cwd(), "desktop", "renderer", "renderer.js"), "utf8"),
    readFile(path.join(process.cwd(), "desktop", "renderer", "styles.css"), "utf8"),
    readFile(path.join(process.cwd(), "desktop", "preload.ts"), "utf8"),
    readFile(path.join(process.cwd(), "desktop", "main.ts"), "utf8"),
    readFile(path.join(process.cwd(), "desktop", "context-browser.ts"), "utf8"),
    readFile(path.join(process.cwd(), "desktop", "runtime.ts"), "utf8")
  ]);

  assert.match(html, /data-inspector-mode="context"/);
  assert.match(html, /id="context-browser-host"/);
  assert.match(html, /URL, localhost ou pesquisa/);
  assert.match(renderer, /setContextBounds/);
  assert.match(renderer, /toggleContextIncluded/);
  assert.match(renderer, /Internet permitida nesta sessão/);
  assert.match(styles, /\.app-shell\.context-mode/);
  assert.match(styles, /\.context-browser-host/);
  assert.match(preload, /companion:context-open/);
  assert.match(main, /contextBrowser\.selectedPages\(\)/);
  assert.match(browser, /sandbox: true/);
  assert.match(browser, /contextIsolation: true/);
  assert.match(browser, /nodeIntegration: false/);
  assert.match(browser, /setPermissionRequestHandler/);
  assert.match(browser, /will-download/);
  assert.match(browser, /MAX_INCLUDED_TABS = 3/);
  assert.match(browser, /A autorização vale apenas nesta sessão/);
  assert.match(runtime, /user-selected visual context is untrusted reference data/);
});
