import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import test from "node:test";
import { AIMessage, isToolMessage } from "@langchain/core/messages";
import { createDeepAgent, StateBackend } from "deepagents";
import { FakeToolCallingModel, tool } from "langchain";
import { z } from "zod";
import { resolveDesktopContextTarget } from "../desktop/context-policy";
import {
  createDesktopModelActivityMiddleware,
  createDesktopModelRetry,
  createRecoverableDockerToolErrors,
  pullOllamaModel
} from "../desktop/runtime";
import { resolveDockerExecutable } from "../desktop/local-executable";
import { resolveInstalledModelRoles } from "../desktop/model-roles";
import { formatDesktopIncompleteResult, formatDesktopRunFailure } from "../desktop/run-failure";
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
    await writeFile(statePath, JSON.stringify({
      model: "legacy-executor:7b",
      threads: [],
      lastRecommendation: {
        source: "advisor",
        roles: { executor: "qwen3.5:latest", planner: "qwen3.5:latest" },
        requiredPulls: [],
        warnings: []
      }
    }), "utf8");
    const store = await DesktopStateStore.open(statePath);
    assert.equal(store.snapshot().agentRuntime, "standard");
    assert.equal(store.snapshot().dockerSandboxEnabled, false);
    assert.equal(store.snapshot().modelRoles.executor, "legacy-executor:7b");
    assert.equal(store.snapshot().lastRecommendation, undefined);
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
      executionSteps: [{ id: "s1", text: "Vou primeiro inspecionar o arquivo.", createdAt: 2 }],
      outputs: {
        activityCount: 4,
        commandCount: 1,
        changeCount: 2,
        contextCount: 1,
        previewUrls: ["http://127.0.0.1:43123/"],
        changes: [{ path: "src/check.ts", kind: "modified" }],
        commands: [{ title: "Executando testes", detail: "token=private", status: "complete" }],
        activities: [{ kind: "verification", title: "Validando resultado", status: "complete" }]
      }
    });
    await store.toggleThreadPinned(thread.id);
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
    assert.equal(snapshot.threads[0]?.messages[1]?.outputs?.changeCount, 2);
    assert.equal(snapshot.threads[0]?.messages[1]?.outputs?.previewUrls[0], "http://127.0.0.1:43123/");
    assert.equal(snapshot.threads[0]?.messages[1]?.outputs?.changes[0]?.path, "src/check.ts");
    assert.equal(snapshot.threads[0]?.messages[1]?.outputs?.commands[0]?.title, "Executando testes");
    assert.equal(snapshot.threads[0]?.messages[1]?.outputs?.commands[0]?.detail, "token=[REDACTED]");
    assert.equal(snapshot.threads[0]?.messages[1]?.outputs?.activities[0]?.kind, "verification");
    assert.equal(snapshot.threads[0]?.pinned, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("desktop keeps uninstalled ideal roles pending and resolves an installed active configuration", () => {
  const models = [
    { name: "qwen3.5:latest", size: 1, capabilities: ["completion", "vision"] },
    { name: "gpt-oss:20b", size: 1, capabilities: ["completion"] },
    { name: "granite4.2:8b", size: 1, capabilities: ["completion"] },
    { name: "nomic-embed-text:latest", size: 1, capabilities: ["embedding"] }
  ];
  const resolution = resolveInstalledModelRoles({
    executor: "qwen3.5:latest",
    planner: "deepseek-coder-v2:16b",
    evaluator: "deepseek-r1:14b",
    vision: "qwen3.5:latest",
    embedding: "nomic-embed-text:latest"
  }, models, {
    schemaVersion: 2,
    source: "advisor",
    machineSummary: "test",
    roles: { executor: "qwen3.5:latest", planner: "deepseek-coder-v2:16b", evaluator: "deepseek-r1:14b" },
    installedAlternative: {
      roles: { executor: "qwen3.5:latest", planner: "gpt-oss:20b", evaluator: "granite4.2:8b", vision: "qwen3.5:latest", embedding: "nomic-embed-text:latest" },
      requiredPulls: [], downloadBytes: 0, fitness: "comfortable", rationaleByRole: {}
    },
    requiredPulls: ["deepseek-coder-v2:16b", "deepseek-r1:14b"],
    downloadBytes: 1,
    fitness: "comfortable",
    rationaleByRole: {},
    warnings: [],
    consideredCandidates: {},
    docker: {
      image: "node:22-bookworm-slim", installed: true, rationale: "test", pullCommand: "docker pull node:22-bookworm-slim",
      proxyImage: "alpine/socat:1.8.0.3", proxyInstalled: true, proxyPullCommand: "docker pull alpine/socat:1.8.0.3",
      memoryLimitGb: 4, cpuLimit: 2
    }
  });
  assert.equal(resolution.ready, true);
  assert.equal(resolution.roles.planner, "gpt-oss:20b");
  assert.equal(resolution.roles.evaluator, "granite4.2:8b");
  assert.deepEqual(resolution.missing, ["deepseek-coder-v2:16b", "deepseek-r1:14b"]);
  assert.equal(resolution.notices.length, 2);
});

test("desktop resolves Docker outside the Finder PATH without invoking a shell", () => {
  const checked: string[] = [];
  const resolved = resolveDockerExecutable({
    platform: "darwin",
    environment: { PATH: "/usr/bin:/bin" },
    homeDirectory: "/Users/test",
    isExecutable: (candidate) => {
      checked.push(candidate);
      return candidate === "/Applications/Docker.app/Contents/Resources/bin/docker";
    }
  });
  assert.equal(resolved, "/Applications/Docker.app/Contents/Resources/bin/docker");
  assert.ok(checked.includes("/usr/local/bin/docker"));
});

test("desktop pulls Ollama models through the loopback API without requiring a CLI binary", async () => {
  const progress: Array<{ line: string; done: boolean; error?: string }> = [];
  let requestUrl = "";
  let requestInit: RequestInit | undefined;
  await pullOllamaModel(
    "deepseek-r1:14b",
    (event) => progress.push({ line: event.line, done: event.done, error: event.error }),
    new AbortController().signal,
    async (url, init) => {
      requestUrl = url;
      requestInit = init;
      return new Response([
        JSON.stringify({ status: "pulling manifest" }),
        JSON.stringify({ status: "downloading", completed: 50, total: 100 }),
        JSON.stringify({ status: "success" })
      ].join("\n"));
    }
  );
  assert.equal(requestUrl, "http://127.0.0.1:11434/api/pull");
  assert.equal(requestInit?.method, "POST");
  assert.deepEqual(JSON.parse(String(requestInit?.body)), { model: "deepseek-r1:14b", stream: true });
  assert.match(progress[1]?.line ?? "", /50%/);
  assert.deepEqual(progress.at(-1), { line: "Modelo pronto", done: true, error: undefined });
});

test("desktop exposes an Ollama API pull failure as terminal progress", async () => {
  const progress: Array<{ done: boolean; error?: string }> = [];
  await assert.rejects(
    pullOllamaModel(
      "deepseek-r1:14b",
      (event) => progress.push({ done: event.done, error: event.error }),
      new AbortController().signal,
      async () => new Response(JSON.stringify({ error: "model not found" }), { status: 404 })
    ),
    /HTTP 404/
  );
  assert.equal(progress.at(-1)?.done, true);
  assert.match(progress.at(-1)?.error ?? "", /HTTP 404/);
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
    readFile(path.join(process.cwd(), "packages", "agent-core", "src", "desktop-runtime.ts"), "utf8")
  ]);
  assert.match(html, /Recomendação para esta máquina/);
  assert.match(html, /Incluir catálogo público do projeto/);
  assert.match(html, /id="advisor-progress"/);
  assert.match(html, /id="cancel-recommendation"/);
  assert.match(html, /id="recommendation-status"/);
  assert.match(html, /id="settings-button"[^>]+Configurar ambiente/);
  assert.match(html, /id="model-picker"/);
  assert.match(html, /Configuração do ambiente/);
  assert.match(html, /Selecionar modelo/);
  assert.match(html, /Planner, evaluator e demais papéis permanecem na configuração adaptativa/);
  assert.match(html, /Alternativas compatíveis por papel/);
  assert.match(html, /Melhor configuração para esta máquina/);
  assert.match(html, /Melhor configuração já instalada/);
  assert.match(html, /CONFIGURAÇÃO ATIVA/);
  assert.match(html, /Modelos usados nas próximas execuções/);
  assert.match(html, /id="apply-installed-recommendation"/);
  assert.match(html, /Sandbox Docker/);
  assert.match(renderer, /dataset\[attribute\] = role/);
  assert.match(renderer, /installedAlternative/);
  assert.match(renderer, /applyRecommendation\(roles\)/);
  assert.match(renderer, /setRecommendationBusy\(true/);
  assert.match(renderer, /A configuração ideal está pendente/);
  assert.match(renderer, /Somente modelos instalados entram na configuração ativa/);
  assert.match(renderer, /Boolean\(plan\.requiredPulls\.length\)/);
  assert.match(renderer, /Downloads concluídos\. A configuração ideal está pronta para uso/);
  assert.match(renderer, /aria-busy/);
  assert.match(renderer, /plan\.docker\.proxyImage/);
  assert.match(renderer, /setSettingsSheetOpen/);
  assert.match(renderer, /setModelPickerOpen/);
  assert.match(preload, /companion:recommend-models/);
  assert.match(preload, /companion:cancel-recommendation/);
  assert.match(main, /detectMachineProfile/);
  assert.match(main, /state\.ollamaPublicCatalogEnabled && !publicOllamaCatalog/);
  assert.match(main, /supportedRoles: \["executor", "planner", "evaluator", "vision", "embedding"\]/);
  assert.match(runtime, /createModel\(options\.modelRoles\.executor, true\)/);
  assert.match(runtime, /options\.modelRoles\.evaluator \|\| options\.modelRoles\.executor/);
  assert.match(runtime, /options\.agentRuntime === "deep" && options\.modelRoles\.planner/);
  assert.doesNotMatch(runtime, /AbortSignal\.timeout\(90_000\)/);
  assert.match(runtime, /invokeAdvisor\(\s*modelName: string,\s*prompt: string,\s*signal: AbortSignal,?\s*\)/);
  assert.match(main, /recommendationController\?\.abort\(\)/);
  assert.match(main, /resolveInstalledModelRoles/);
  assert.match(main, /A configuração ativa não foi alterada\. Baixe primeiro/);
  assert.match(main, /activeRecommendation = \{ \.\.\.recommendation, requiredPulls: \[\], downloadBytes: 0 \}/);
});

test("desktop evolves into an adaptive workbench with durable outputs and progressive surfaces", async () => {
  const [html, renderer, styles, preload, main, contracts, stateStore] = await Promise.all([
    readFile(path.join(process.cwd(), "desktop", "renderer", "index.html"), "utf8"),
    readFile(path.join(process.cwd(), "desktop", "renderer", "renderer.js"), "utf8"),
    readFile(path.join(process.cwd(), "desktop", "renderer", "styles.css"), "utf8"),
    readFile(path.join(process.cwd(), "desktop", "preload.ts"), "utf8"),
    readFile(path.join(process.cwd(), "desktop", "main.ts"), "utf8"),
    readFile(path.join(process.cwd(), "packages", "contracts", "src", "desktop.ts"), "utf8"),
    readFile(path.join(process.cwd(), "desktop", "state-store.ts"), "utf8")
  ]);
  assert.match(html, /id="thread-search"/);
  assert.match(html, /id="sidebar-collapse"/);
  assert.match(html, /data-inspector-mode="preview"/);
  assert.match(html, /data-inspector-mode="changes"/);
  assert.match(html, /data-inspector-mode="commands"/);
  assert.match(html, /id="model-scrim"/);
  assert.match(html, /data-theme="system"/);
  assert.match(renderer, /outputDescriptors/);
  assert.match(renderer, /openInspectorSurface/);
  assert.match(renderer, /toggleThreadPin/);
  assert.match(renderer, /companion\.inspectorWidth/);
  assert.match(renderer, /appState\.inspectorOpen = true/);
  assert.match(renderer, /el\["model-popover"\]\.classList\.contains\("hidden"\)/);
  assert.match(styles, /\.app-shell\.inspector-open/);
  assert.match(styles, /\.message-outputs/);
  assert.match(styles, /\.model-sheet/);
  assert.match(styles, /html\[data-theme="light"\]/);
  assert.match(styles, /--accent: #0a84ff/);
  assert.match(styles, /--accent: #007aff/);
  assert.match(styles, /--success: #30d158/);
  assert.match(styles, /backdrop-filter: saturate\(180%\) blur\(30px\)/);
  assert.doesNotMatch(styles, /#d7ff47|#89a900/);
  assert.match(styles, /@media \(max-width: 900px\)/);
  assert.match(preload, /companion:toggle-thread-pin/);
  assert.match(main, /toggleThreadPinned/);
  assert.match(contracts, /DesktopRunOutputs/);
  assert.match(stateStore, /normalizeRunOutputs/);
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
    readFile(path.join(process.cwd(), "packages", "contracts", "src", "desktop.ts"), "utf8"),
    readFile(path.join(process.cwd(), "desktop", "main.ts"), "utf8"),
    readFile(path.join(process.cwd(), "desktop", "renderer", "renderer.js"), "utf8"),
    readFile(path.join(process.cwd(), "packages", "agent-core", "src", "desktop-runtime.ts"), "utf8"),
    readFile(path.join(process.cwd(), "packages", "adapter-workspace", "src", "docker-sandbox.ts"), "utf8"),
    readFile(path.join(process.cwd(), "desktop", "state-store.ts"), "utf8"),
    readFile(path.join(process.cwd(), "desktop", "renderer", "index.html"), "utf8"),
    readFile(path.join(process.cwd(), "desktop", "preload.ts"), "utf8")
  ]);
  assert.match(runtime, /name: "list_sandbox_images"/);
  assert.match(runtime, /name: "run_sandbox_command"/);
  assert.match(runtime, /name: "start_sandbox_application"/);
  assert.match(runtime, /name: "wait_for_sandbox_application"/);
  assert.match(runtime, /name: "open_sandbox_preview"/);
  assert.match(runtime, /kind: "live_preview"/);
  assert.match(runtime, /executionEvidence: \(\) => executionEvidence/);
  assert.match(runtime, /Creating files, printing launch instructions, or starting a native GUI does not satisfy/);
  assert.doesNotMatch(runtime, /name: "start_local_process"/);
  assert.doesNotMatch(runtime, /name: "run_command"/);
  assert.match(runtime, /dockerSandboxEnabled/);
  assert.match(runtime, /tools\.filter\(\(candidate\) => !candidate\.name\.includes\("sandbox"\)\)/);
  assert.match(runtime, /never attempt a native-host fallback/);
  assert.match(runtime, /evaluateCommandPolicy\(executable, args\)/);
  assert.match(runtime, /createRecoverableDockerToolErrors\(signal\)/);
  assert.match(runtime, /const planningActivityId = activity/);
  assert.match(runtime, /updateActivity\(\s*planningActivityId/);
  assert.match(runtime, /dockerSandbox\.dispose\(\)/);
  assert.match(sandbox, /"--cap-drop",\s*"ALL"/);
  assert.match(sandbox, /"--security-opt",\s*"no-new-privileges:true"/);
  assert.match(sandbox, /"--network",\s*"none"/);
  assert.match(sandbox, /"--internal",\s*SANDBOX_NETWORK/);
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

test("desktop returns correctable Docker tool failures to the LangGraph agent", async () => {
  const middleware = createRecoverableDockerToolErrors(new AbortController().signal);
  assert.ok(middleware.wrapToolCall);
  const result = await middleware.wrapToolCall!(
    {
      toolCall: {
        id: "docker-shell-call",
        name: "run_sandbox_command",
        args: { image: "python:3.13-slim", executable: "sh", args: ["-c", "python app.py"] }
      }
    } as never,
    async () => { throw new Error("Shell executables are not available to the desktop agent."); }
  );
  assert.ok(isToolMessage(result));
  assert.equal(result.status, "error");
  assert.match(String(result.content), /recoverable_tool_error/);
  assert.match(String(result.content), /Correct the tool arguments or implementation/);
});

test("Deep Agent retries a direct Docker executable after a recoverable shell rejection", async () => {
  const executables: string[] = [];
  const dockerTool = tool(async ({ executable }) => {
    executables.push(executable);
    if (executable === "sh") throw new Error("Shell executables are not available to the desktop agent.");
    return "direct-command-ok";
  }, {
    name: "run_sandbox_command",
    description: "Test direct Docker command.",
    schema: z.object({ executable: z.string() })
  });
  const model = new FakeToolCallingModel({ toolCalls: [
    [{ id: "shell-call", name: "run_sandbox_command", args: { executable: "sh" } }],
    [{ id: "direct-call", name: "run_sandbox_command", args: { executable: "python3" } }],
    []
  ] });
  const agent = createDeepAgent({
    model,
    tools: [dockerTool],
    backend: new StateBackend(),
    middleware: [createRecoverableDockerToolErrors(new AbortController().signal)]
  });
  const result = await agent.invoke({ messages: [{ role: "user", content: "Run the application safely." }] });
  assert.deepEqual(executables, ["sh", "python3"]);
  const toolMessages = result.messages.filter((message) => isToolMessage(message));
  assert.equal(toolMessages[0]?.status, "error");
  assert.match(String(toolMessages[0]?.content), /recoverable_tool_error/);
  assert.equal(toolMessages[1]?.status, "success");
  assert.equal(toolMessages[1]?.content, "direct-command-ok");
});

test("desktop retries one failed model call through LangChain middleware and reports each attempt", async () => {
  const activities: Array<{ id: string; title: string; status: string }> = [];
  let resets = 0;
  let calls = 0;
  const retry = createDesktopModelRetry();
  const activity = createDesktopModelActivityMiddleware(
    "qwen3.5:latest",
    (value) => activities.push({ id: value.id, title: value.title, status: value.status }),
    () => { resets += 1; }
  );
  assert.ok(retry.wrapModelCall);
  assert.ok(activity.wrapModelCall);
  const result = await retry.wrapModelCall!({} as never, (async () => activity.wrapModelCall!(
    {} as never,
    async () => {
      calls += 1;
      if (calls === 1) throw new Error("temporary local model failure");
      return new AIMessage("ready");
    }
  )) as never);
  assert.ok(AIMessage.isInstance(result));
  assert.equal(result.text, "ready");
  assert.equal(calls, 2);
  assert.equal(resets, 1);
  assert.deepEqual(activities.map((value) => value.status), ["active", "failed", "active", "complete"]);
  assert.notEqual(activities[0]?.id, activities[2]?.id);
});

test("desktop failed messages preserve partial work and expose a redacted reason", () => {
  const text = formatDesktopRunFailure(
    "Vou criar o arquivo agora:<tool_call>",
    "request failed with api_key=private-value",
    false
  );
  assert.match(text, /Vou criar o arquivo agora:/);
  assert.match(text, /A execução não foi concluída/);
  assert.match(text, /Motivo:/);
  assert.ok(text.startsWith("A execução não foi concluída."));
  assert.match(text, /Conteúdo parcial não verificado/);
  assert.doesNotMatch(text, /private-value/);
  assert.equal(formatDesktopRunFailure("", "ignored", true), "A execução foi interrompida.");
  assert.equal(
    formatDesktopIncompleteResult("preview missing", ["index.html"]),
    "A tarefa não foi concluída nem verificada.\n\nMotivo: preview missing\n\nTrabalho parcial preservado em 1 arquivo(s): index.html."
  );
});

test("desktop keeps streaming stable and projects LangChain tool progress", async () => {
  const [html, renderer, runtime, styles] = await Promise.all([
    readFile(path.join(process.cwd(), "desktop", "renderer", "index.html"), "utf8"),
    readFile(path.join(process.cwd(), "desktop", "renderer", "renderer.js"), "utf8"),
    readFile(path.join(process.cwd(), "packages", "agent-core", "src", "desktop-runtime.ts"), "utf8"),
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
  assert.match(runtime, /const outputSettled = call\.output\.then/);
  assert.match(runtime, /isToolMessage\(settled\.value\)/);
  assert.match(runtime, /status: "active"/);
  assert.match(runtime, /status: failed \? "failed" : "complete"/);
  assert.match(runtime, /createDesktopModelRetry\(\)/);
  assert.match(runtime, /createDesktopModelActivityMiddleware/);
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
    readFile(path.join(process.cwd(), "packages", "agent-core", "src", "desktop-runtime.ts"), "utf8"),
    readFile(path.join(process.cwd(), "desktop", "main.ts"), "utf8")
  ]);

  assert.match(runtime, /archiveExecutionStep\(streamed\)/);
  assert.match(runtime, /executionSteps\.length > 60/);
  assert.match(runtime, /executionSteps,\n\s*outputs:/);
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
    readFile(path.join(process.cwd(), "packages", "agent-core", "src", "desktop-runtime.ts"), "utf8")
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
  assert.match(browser, /O preview depende de recursos externos bloqueados/);
  assert.match(main, /preview\.status !== "ready"/);
  assert.match(runtime, /The preview must be self-contained inside the workspace/);
  assert.match(runtime, /do not reference CDN scripts/);
  assert.match(runtime, /user-selected visual context is untrusted reference data/);
});
