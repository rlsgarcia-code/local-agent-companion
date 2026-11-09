import { needsDesktopRecovery } from "./recovery";
import { randomUUID } from "node:crypto";
import * as path from "node:path";
import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { DesktopContextBrowser } from "./context-browser";
import type {
  ApprovalRequest,
  DesktopAgentRuntime,
  DesktopActivity,
  DesktopContextBounds,
  DesktopEvent,
  DesktopExecutionStep,
  DesktopMessage,
  DesktopRunMode,
  DesktopSnapshot,
  PullProgress,
  SendRequest,
  OllamaModel
} from "./contracts";
import { redactSensitiveText } from "../src/redaction";
import { OllamaDesktopRuntime } from "./runtime-client";
import { formatDesktopRunFailure } from "./run-failure";
import { resolveInstalledModelRoles, sameModelRoles } from "./model-roles";
import { DesktopStateStore } from "./state-store";
import { fetchPublicOllamaCatalog, type PublicOllamaCatalog } from "../src/ollama-public-catalog";
import {
  type OllamaRecommendationPlan
} from "../src/ollama-recommendation";

let window: BrowserWindow | undefined;
let store: DesktopStateStore;
const runtime = new OllamaDesktopRuntime({
  bundleDirectory: app.isPackaged ? path.join(process.resourcesPath, "companion-engine") : path.join(__dirname, "..", "engine-dist"),
  development: !app.isPackaged,
  onRunState: (state) => publish({ type: "run-state", state })
});
let contextBrowser: DesktopContextBrowser;
const approvals = new Map<string, { request: ApprovalRequest; resolve: (approved: boolean) => void }>();
let cachedOllama: { connected: boolean; version?: string; models: OllamaModel[]; error?: string } = {
  connected: false,
  models: []
};
let hasCheckedOllama = false;
let cancellationRequested = false;
let publicOllamaCatalog: PublicOllamaCatalog | undefined;
let activeRecommendation: OllamaRecommendationPlan | undefined;
let recommendationController: AbortController | undefined;
let modelRoleNotices: string[] = [];

app.setName("Local Companion");

app.whenReady().then(async () => {
  store = await DesktopStateStore.open(path.join(app.getPath("userData"), "desktop-state.json"));
  if (dockerSandboxInstallParameter()) await store.update({ dockerSandboxEnabled: true });
  createWindow();
  contextBrowser = new DesktopContextBrowser(
    () => window,
    (context) => publish({ type: "context-snapshot", snapshot: context })
  );
  registerIpc();
  void runtime.modelRoles(store.snapshot().modelRoles).then(async (roles) => {
    if (roles) await store.update({ modelRoles: roles });
  }).catch((error) => dialog.showErrorBox("Motor local", String(error)));
  void runtime.recoverModelJobs(
    (progress) => window?.webContents.send("companion:pull-progress", progress),
    async (recommendation) => {
      activeRecommendation = recommendation;
      await store.update({ lastRecommendation: recommendation });
      await publishSnapshot();
    }
  ).catch((error) => publish({ type: "run-error", threadId: store.snapshot().activeThreadId, message: String(error) }));
  void runtime.recover(store.snapshot().workspacePath, (description) => {
    const thread = store.snapshot().threads.find((item) => item.id === description.threadId);
    if (!thread || !needsDesktopRecovery(thread.messages.find((message) => message.id === description.assistantMessageId))) return;
    let text = "";
    const steps: DesktopExecutionStep[] = [];
    const savePartial = () => store.replaceMessage(thread.id, {
      id: description.assistantMessageId, role: "assistant", text,
      createdAt: description.run.createdAt, status: "streaming", executionSteps: [...steps],
    });
    return {
      callbacks: {
        approval: requestApproval,
        activity: (activity) => publish({ type: "activity", activity }),
        delta: (messageId, delta) => {
          text += delta;
          publish({ type: "assistant-delta", threadId: thread.id, messageId, delta });
          void savePartial();
        },
        step: (messageId, step) => {
          if (!steps.some((item) => item.id === step.id)) steps.push(step);
          publish({ type: "assistant-step", threadId: thread.id, messageId, step });
        },
        reset: (messageId) => {
          text = "";
          publish({ type: "assistant-reset", threadId: thread.id, messageId });
        },
      },
      openPreview: async (url) => {
        if (!window || window.isDestroyed()) throw new Error("Abra a janela para visualizar o preview.");
        await contextBrowser.open(url);
        publish({ type: "context-focus", url });
      },
      complete: async ({ message, changes }) => {
        await store.replaceMessage(thread.id, message);
        publish({ type: "assistant-complete", threadId: thread.id, message, changes });
        await publishSnapshot();
      },
    };
  }).catch((error) => {
    publish({ type: "run-error", threadId: store.snapshot().activeThreadId,
      message: error instanceof Error ? error.message : "Não foi possível recuperar a execução. Abra o aplicativo novamente para tentar reconectar." });
  });
}).catch((error) => {
  dialog.showErrorBox("Local Companion", error instanceof Error ? error.message : "Unable to start the application.");
  app.quit();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (!window) createWindow();
});

app.on("before-quit", () => {
  runtime.dispose();
  contextBrowser?.close();
  // Pending approvals remain with the service when this interface closes.
  approvals.clear();
});

function createWindow(): void {
  window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 980,
    minHeight: 680,
    backgroundColor: "#171914",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 18, y: 18 },
    vibrancy: "under-window",
    visualEffectState: "active",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  window.webContents.on("did-finish-load", () => {
    for (const pending of approvals.values())
      window?.webContents.send("companion:approval-request", pending.request);
  });
  window.loadFile(path.join(__dirname, "renderer", "index.html"));
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://ollama.com/")) void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.on("closed", () => {
    contextBrowser?.close();
    window = undefined;
  });
}

function registerIpc(): void {
  ipcMain.handle("companion:snapshot", async () => snapshot(true));
  ipcMain.handle("companion:choose-workspace", async () => {
    const result = await dialog.showOpenDialog(window!, {
      title: "Escolha o projeto para o Local Companion",
      properties: ["openDirectory", "createDirectory"]
    });
    if (result.canceled || !result.filePaths[0]) return snapshot();
    await store.update({ workspacePath: result.filePaths[0] });
    return publishSnapshot();
  });
  ipcMain.handle("companion:set-model", async (_event, model: unknown) => {
    if (typeof model !== "string" || !model.trim()) throw new Error("Choose an Ollama model.");
    const roles = { ...store.snapshot().modelRoles, executor: model.trim() };
    await runtime.configureModelRoles(roles);
    await store.update({ modelRoles: roles });
    return publishSnapshot();
  });
  ipcMain.handle("companion:set-mode", async (_event, mode: unknown) => {
    if (mode !== "review" && mode !== "execute" && mode !== "plan") throw new Error("Invalid autonomy mode.");
    await store.update({ mode: mode as DesktopRunMode });
    return publishSnapshot();
  });
  ipcMain.handle("companion:set-agent-runtime", async (_event, runtime: unknown) => {
    if (runtime !== "standard" && runtime !== "deep") throw new Error("Invalid agent runtime.");
    await store.update({ agentRuntime: runtime as DesktopAgentRuntime });
    return publishSnapshot();
  });
  ipcMain.handle("companion:select-thread", async (_event, threadId: unknown) => {
    if (typeof threadId !== "string") throw new Error("Invalid conversation.");
    store.thread(threadId);
    await store.update({ activeThreadId: threadId });
    return publishSnapshot();
  });
  ipcMain.handle("companion:new-thread", async () => {
    await store.createThread();
    return publishSnapshot();
  });
  ipcMain.handle("companion:toggle-thread-pin", async (_event, threadId: unknown) => {
    if (typeof threadId !== "string") throw new Error("Invalid conversation.");
    await store.toggleThreadPinned(threadId);
    return publishSnapshot();
  });
  ipcMain.handle("companion:refresh-ollama", async () => publishSnapshot(true));
  ipcMain.handle("companion:recommend-models", async () => recommendModels());
  ipcMain.handle("companion:cancel-recommendation", () => {
    recommendationController?.abort();
    void runtime.cancelRecommendation();
  });
  ipcMain.handle("companion:set-public-ollama-catalog", async (_event, enabled: unknown) => {
    if (typeof enabled !== "boolean") throw new Error("Invalid public catalog preference.");
    await store.update({ ollamaPublicCatalogEnabled: enabled });
    if (!enabled) publicOllamaCatalog = undefined;
    return publishSnapshot();
  });
  ipcMain.handle("companion:set-docker-sandbox", async (_event, enabled: unknown) => {
    if (typeof enabled !== "boolean") throw new Error("Invalid Docker sandbox preference.");
    if (runtime.running) throw new Error("Wait for or cancel the current run before changing the Docker sandbox.");
    await runtime.configureDockerSandbox(enabled);
    await store.update({ dockerSandboxEnabled: enabled, lastRecommendation: undefined });
    activeRecommendation = undefined;
    return publishSnapshot();
  });
  ipcMain.handle("companion:refresh-public-ollama-catalog", async () => {
    if (!store.snapshot().ollamaPublicCatalogEnabled) throw new Error("Enable the public Ollama catalog before refreshing it.");
    publicOllamaCatalog = await fetchPublicOllamaCatalog();
    return recommendModels();
  });
  ipcMain.handle("companion:apply-recommendation", async (_event, roleInput: unknown) => {
    const recommendation = activeRecommendation ?? store.snapshot().lastRecommendation;
    if (!recommendation) throw new Error("Analyze this machine before applying a recommendation.");
    const roles = parseModelRoles(roleInput);
    cachedOllama = await runtime.ollamaStatus();
    hasCheckedOllama = true;
    if (!cachedOllama.connected) throw new Error(cachedOllama.error || "Inicie o Ollama antes de aplicar uma configuração.");
    const installed = new Set(cachedOllama.models.map((model) => model.name.toLowerCase()));
    const missing = [...new Set(Object.values(roles).filter((model): model is string => Boolean(model) && !installed.has(model.toLowerCase())))];
    if (missing.length) {
      throw new Error(`A configuração ativa não foi alterada. Baixe primeiro: ${missing.join(", ")}.`);
    }
    modelRoleNotices = [];
    await runtime.configureModelRoles(roles);
    await store.update({ modelRoles: roles, lastRecommendation: recommendation });
    return publishSnapshot();
  });
  ipcMain.handle("companion:pull-recommended", async () => {
    const recommendation = activeRecommendation ?? store.snapshot().lastRecommendation;
    if (!recommendation) throw new Error("Analyze this machine before downloading models.");
    for (const model of recommendation.requiredPulls) {
      await runtime.pullModel(model, (progress) => window?.webContents.send("companion:pull-progress", progress));
    }
    activeRecommendation = { ...recommendation, requiredPulls: [], downloadBytes: 0 };
    await store.update({ lastRecommendation: activeRecommendation });
    return publishSnapshot(true);
  });
  ipcMain.handle("companion:pull-model", async (_event, model: unknown) => {
    if (typeof model !== "string") throw new Error("Invalid Ollama model.");
    await runtime.pullModel(model, (progress) => window?.webContents.send("companion:pull-progress", progress));
    const roles = { ...store.snapshot().modelRoles, executor: model };
    await runtime.configureModelRoles(roles);
    await store.update({ modelRoles: roles });
    return publishSnapshot(true);
  });
  ipcMain.handle("companion:send", async (_event, request: SendRequest) => {
    await send(request);
  });
  ipcMain.handle("companion:cancel", async () => {
    cancellationRequested = true;
    runtime.cancel();
  });
  ipcMain.handle("companion:context-open", async (_event, value: unknown) => {
    if (typeof value !== "string") throw new Error("Informe uma URL, localhost ou pesquisa.");
    return contextBrowser.open(value);
  });
  ipcMain.handle("companion:context-select", async (_event, id: unknown) => {
    if (typeof id !== "string") throw new Error("Aba de contexto inválida.");
    return contextBrowser.selectTab(id);
  });
  ipcMain.handle("companion:context-close", async (_event, id: unknown) => {
    if (typeof id !== "string") throw new Error("Aba de contexto inválida.");
    return contextBrowser.closeTab(id);
  });
  ipcMain.handle("companion:context-toggle-included", async (_event, id: unknown) => {
    if (typeof id !== "string") throw new Error("Aba de contexto inválida.");
    return contextBrowser.toggleIncluded(id);
  });
  ipcMain.handle("companion:context-navigate", async (_event, action: unknown) => {
    if (action !== "back" && action !== "forward" && action !== "reload") throw new Error("Ação de navegação inválida.");
    return contextBrowser.navigate(action);
  });
  ipcMain.handle("companion:context-external", async (_event, enabled: unknown) => {
    if (typeof enabled !== "boolean") throw new Error("Permissão de internet inválida.");
    return contextBrowser.setExternalAccess(enabled);
  });
  ipcMain.handle("companion:context-bounds", async (_event, bounds: DesktopContextBounds) => {
    if (!bounds || typeof bounds !== "object") throw new Error("Área de contexto inválida.");
    return contextBrowser.setBounds(bounds);
  });
  ipcMain.handle("companion:approval", async (_event, id: unknown, approved: unknown) => {
    if (typeof id !== "string" || typeof approved !== "boolean") return;
    approvals.get(id)?.resolve(approved);
    approvals.delete(id);
  });
}

function parseModelRoles(value: unknown): OllamaRecommendationPlan["roles"] {
  if (!value || typeof value !== "object") throw new Error("Invalid Ollama role configuration.");
  const record = value as Record<string, unknown>;
  const parse = (role: string, required = false): string | undefined => {
    const model = typeof record[role] === "string" ? record[role].trim() : "";
    if (!model) {
      if (required) throw new Error("Choose an executor model.");
      return undefined;
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(model)) throw new Error(`Invalid ${role} model alias.`);
    return model;
  };
  return {
    executor: parse("executor", true)!,
    ...(parse("planner") ? { planner: parse("planner") } : {}),
    ...(parse("evaluator") ? { evaluator: parse("evaluator") } : {}),
    ...(parse("vision") ? { vision: parse("vision") } : {}),
    ...(parse("embedding") ? { embedding: parse("embedding") } : {})
  };
}

async function send(request: SendRequest): Promise<void> {
  const text = typeof request?.text === "string" ? request.text.trim() : "";
  if (!text) throw new Error("Write a request first.");
  if (runtime.running) throw new Error("Wait for or cancel the current run.");
  await snapshot(true);
  const state = store.snapshot();
  if (!state.workspacePath) throw new Error("Choose a workspace before starting.");
  if (!state.modelRoles.executor) throw new Error("Choose an installed Ollama executor model.");
  if (!cachedOllama.models.some((model) => model.name.toLowerCase() === state.modelRoles.executor.toLowerCase())) {
    throw new Error(`O executor ${state.modelRoles.executor} não está instalado. Abra Modelos e execução para baixar o modelo ou aplicar a configuração instalada.`);
  }
  const priorThread = structuredClone(store.thread(request.threadId));
  const userMessage: DesktopMessage = { id: randomUUID(), role: "user", text, createdAt: Date.now(), status: "complete" };
  const assistantMessageId = randomUUID();
  let partialAssistantText = "";
  const executionSteps: DesktopExecutionStep[] = [];
  const runActivities = new Map<string, DesktopActivity>();
  const commandOutputs = () => [...runActivities.values()]
    .filter((activity) => activity.kind === "command")
    .map((activity) => ({
      title: redactSensitiveText(activity.title).slice(0, 300),
      ...(activity.detail ? { detail: redactSensitiveText(activity.detail).slice(0, 2_000) } : {}),
      status: activity.status === "complete" ? "complete" as const : "failed" as const
    }))
    .slice(-100);
  const activityOutputs = () => [...runActivities.values()]
    .map((activity) => ({
      kind: activity.kind,
      title: redactSensitiveText(activity.title).slice(0, 300),
      ...(activity.detail ? { detail: redactSensitiveText(activity.detail).slice(0, 2_000) } : {}),
      status: activity.status === "complete" ? "complete" as const : "failed" as const
    }))
    .slice(-200);
  const visualContext = await contextBrowser.selectedPages();
  cancellationRequested = false;
  await store.appendMessage(request.threadId, userMessage);
  publish({ type: "run-start", threadId: request.threadId, message: userMessage, assistantMessageId });
  for (const notice of modelRoleNotices) {
    const activity: DesktopActivity = {
      id: randomUUID(),
      kind: "verification",
      title: "Configuração local protegida",
      detail: notice,
      status: "complete",
      createdAt: Date.now()
    };
    runActivities.set(activity.id, activity);
    publish({ type: "activity", activity });
  }
  try {
    const result = await runtime.run({
      thread: priorThread,
      request: text,
      workspacePath: state.workspacePath,
      modelRoles: state.modelRoles,
      dockerSandboxEnabled: state.dockerSandboxEnabled,
      mode: state.mode,
      agentRuntime: state.agentRuntime,
      assistantMessageId,
      userMessageId: userMessage.id,
      openPreview: async (url) => {
        const context = await contextBrowser.open(url);
        const preview = context.tabs.find((tab) => tab.id === context.activeTabId && tab.url === url)
          ?? context.tabs.find((tab) => tab.url === url);
        if (!preview || preview.status !== "ready") {
          throw new Error(preview?.error || "O preview local não terminou de carregar corretamente.");
        }
        publish({ type: "context-focus", url });
      },
      callbacks: {
        approval: requestApproval,
        activity: (activity) => {
          runActivities.set(activity.id, { ...runActivities.get(activity.id), ...activity });
          publish({ type: "activity", activity });
        },
        delta: (messageId, delta) => {
          partialAssistantText += delta;
          publish({ type: "assistant-delta", threadId: request.threadId, messageId, delta });
        },
        step: (messageId, step) => {
          if (!executionSteps.some((item) => item.id === step.id)) executionSteps.push(step);
          publish({ type: "assistant-step", threadId: request.threadId, messageId, step });
        },
        reset: (messageId) => {
          partialAssistantText = "";
          publish({ type: "assistant-reset", threadId: request.threadId, messageId });
        }
      },
      contextPages: visualContext
    });
    const contextSnapshot = contextBrowser.snapshot();
    const completedMessage: DesktopMessage = {
      ...result.message,
      outputs: {
        activityCount: result.message.outputs?.activityCount ?? 0,
        commandCount: result.message.outputs?.commandCount ?? 0,
        changeCount: result.changes.length,
        contextCount: visualContext.length,
        previewUrls: contextSnapshot.tabs.filter((tab) => tab.kind === "local" && tab.status === "ready").map((tab) => tab.url).slice(0, 8),
        changes: result.changes,
        commands: commandOutputs(),
        activities: activityOutputs()
      }
    };
    await store.appendMessage(request.threadId, completedMessage);
    publish({ type: "assistant-complete", threadId: request.threadId, message: completedMessage, changes: result.changes });
  } catch (error) {
    const message = cancellationRequested ? "A execução foi interrompida." : error instanceof Error ? error.message : "A execução falhou.";
    const failedMessage: DesktopMessage = {
      id: assistantMessageId,
      role: "assistant",
      text: formatDesktopRunFailure(partialAssistantText, message, cancellationRequested),
      createdAt: Date.now(),
      status: "failed",
      executionSteps,
      outputs: {
        activityCount: runActivities.size,
        commandCount: commandOutputs().length,
        changeCount: 0,
        contextCount: visualContext.length,
        previewUrls: contextBrowser.snapshot().tabs.filter((tab) => tab.kind === "local" && tab.status === "ready").map((tab) => tab.url).slice(0, 8),
        changes: [],
        commands: commandOutputs(),
        activities: activityOutputs()
      }
    };
    await store.appendMessage(request.threadId, failedMessage);
    publish({ type: "assistant-complete", threadId: request.threadId, message: failedMessage, changes: [] });
    publish({ type: "run-error", threadId: request.threadId, message });
  } finally {
    publish({ type: "run-done", threadId: request.threadId });
    cancellationRequested = false;
    await publishSnapshot();
  }
}

async function recommendModels(): Promise<DesktopSnapshot> {
  if (recommendationController) throw new Error("A model recommendation is already running.");
  const controller = new AbortController();
  recommendationController = controller;
  try {
  cachedOllama = await runtime.ollamaStatus();
  hasCheckedOllama = true;
  if (!cachedOllama.connected) throw new Error(cachedOllama.error || "Start Ollama before analyzing this machine.");
  const state = store.snapshot();
  let publicCatalogWarning = "";
  if (state.ollamaPublicCatalogEnabled && !publicOllamaCatalog) {
    try {
      publicOllamaCatalog = await fetchPublicOllamaCatalog();
    } catch (error) {
      publicCatalogWarning = `O catálogo público não pôde ser carregado; a análise usou o catálogo incorporado (${error instanceof Error ? error.message : String(error)}).`;
    }
  }
  const docker = state.dockerSandboxEnabled
    ? await runtime.dockerStatus()
    : { available: false as const, images: [], error: "Docker sandbox disabled by installation/setup preference." };
  const advisor = cachedOllama.models.some((model) => model.name.toLowerCase() === state.modelRoles.executor.toLowerCase())
    ? state.modelRoles.executor
    : undefined;
  activeRecommendation = await runtime.recommendModels({
    advisorModel: advisor,
    installedDockerImages: docker.images.map((image) => image.alias),
    ...(state.ollamaPublicCatalogEnabled && publicOllamaCatalog ? { publicCatalog: publicOllamaCatalog } : {})
  }, controller.signal);
  if (publicCatalogWarning) {
    activeRecommendation = {
      ...activeRecommendation,
      warnings: [publicCatalogWarning, ...activeRecommendation.warnings].slice(0, 10)
    };
  }
  if (!docker.available) {
    activeRecommendation = {
      ...activeRecommendation,
      warnings: [`O ambiente Docker não está habilitado ou disponível; o Companion seguirá sem ferramentas de comando e preview executável (${docker.error ?? "daemon indisponível"}).`, ...activeRecommendation.warnings].slice(0, 10)
    };
  }
  await store.update({ lastRecommendation: activeRecommendation });
  return publishSnapshot();
  } finally {
    if (recommendationController === controller) recommendationController = undefined;
  }
}

async function requestApproval(request: ApprovalRequest): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    approvals.set(request.id, { request, resolve });
    if (window && !window.isDestroyed()) window.webContents.send("companion:approval-request", request);
  });
}

async function snapshot(refreshOllama = false): Promise<DesktopSnapshot> {
  if (refreshOllama || !hasCheckedOllama) {
    cachedOllama = await runtime.ollamaStatus();
    hasCheckedOllama = true;
  }
  if (cachedOllama.connected) {
    let state = store.snapshot();
    if (state.lastRecommendation) {
      const installed = new Set(cachedOllama.models.map((model) => model.name.toLowerCase()));
      const requiredPulls = state.lastRecommendation.requiredPulls.filter((model) => !installed.has(model.toLowerCase()));
      if (requiredPulls.length !== state.lastRecommendation.requiredPulls.length) {
        const lastRecommendation = {
          ...state.lastRecommendation,
          requiredPulls,
          ...(requiredPulls.length ? {} : { downloadBytes: 0 })
        };
        activeRecommendation = lastRecommendation;
        await store.update({ lastRecommendation });
        state = store.snapshot();
      }
    }
    const resolution = resolveInstalledModelRoles(state.modelRoles, cachedOllama.models, state.lastRecommendation);
    modelRoleNotices = resolution.notices;
    if (resolution.ready && !sameModelRoles(state.modelRoles, resolution.roles)) {
      await runtime.configureModelRoles(resolution.roles);
      await store.update({ modelRoles: resolution.roles });
    }
  } else {
    modelRoleNotices = [];
  }
  return {
    ...store.snapshot(),
    ollama: cachedOllama,
    context: contextBrowser.snapshot(),
    ollamaPublicCatalogLoaded: Boolean(publicOllamaCatalog),
    modelRoleNotices,
    running: runtime.running,
    runState: runtime.state
  };
}

async function publishSnapshot(refreshOllama = false): Promise<DesktopSnapshot> {
  const value = await snapshot(refreshOllama);
  publish({ type: "snapshot", snapshot: value });
  return value;
}

function publish(event: DesktopEvent): void {
  window?.webContents.send("companion:event", event);
}

function dockerSandboxInstallParameter(): boolean {
  return process.argv.includes("--enable-docker-sandbox")
    || process.env.LOCAL_COMPANION_DOCKER_SANDBOX === "1";
}
