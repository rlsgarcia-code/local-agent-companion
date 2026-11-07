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
import { OllamaDesktopRuntime } from "./runtime";
import { formatDesktopRunFailure } from "./run-failure";
import { DesktopStateStore } from "./state-store";
import { OLLAMA_CATALOG } from "../src/ollama-catalog";
import { fetchPublicOllamaCatalog, type PublicOllamaCatalog } from "../src/ollama-public-catalog";
import {
  detectMachineProfile,
  mergeOllamaCandidates,
  OllamaRecommendationEngine,
  type OllamaRecommendationPlan
} from "../src/ollama-recommendation";

let window: BrowserWindow | undefined;
let store: DesktopStateStore;
const runtime = new OllamaDesktopRuntime();
let contextBrowser: DesktopContextBrowser;
const approvals = new Map<string, (approved: boolean) => void>();
let cachedOllama: { connected: boolean; version?: string; models: OllamaModel[]; error?: string } = {
  connected: false,
  models: []
};
let hasCheckedOllama = false;
let cancellationRequested = false;
let publicOllamaCatalog: PublicOllamaCatalog | undefined;
let activeRecommendation: OllamaRecommendationPlan | undefined;
let recommendationController: AbortController | undefined;

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
  recommendationController?.abort();
  runtime.dispose();
  contextBrowser?.close();
  for (const resolve of approvals.values()) resolve(false);
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
    await store.update({ modelRoles: { ...store.snapshot().modelRoles, executor: model.trim() } });
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
    runtime.configureDockerSandbox(enabled);
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
    await store.update({ modelRoles: { ...store.snapshot().modelRoles, executor: model } });
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
    approvals.get(id)?.(approved);
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
  const state = store.snapshot();
  if (!state.workspacePath) throw new Error("Choose a workspace before starting.");
  if (!state.modelRoles.executor) throw new Error("Choose an installed Ollama executor model.");
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
      openPreview: async (url) => {
        await contextBrowser.open(url);
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
          executionSteps.push(step);
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
  const candidates = mergeOllamaCandidates({
    bundled: OLLAMA_CATALOG,
    ...(state.ollamaPublicCatalogEnabled && publicOllamaCatalog ? { publicCatalog: publicOllamaCatalog } : {}),
    installed: cachedOllama.models.map((model) => ({
      name: model.name,
      size: model.size,
      capabilities: model.capabilities,
      contextLength: model.contextLength
    }))
  });
  const machine = await detectMachineProfile(app.getPath("userData"), cachedOllama.version);
  const docker = state.dockerSandboxEnabled
    ? await runtime.dockerStatus()
    : { available: false as const, images: [], error: "Docker sandbox disabled by installation/setup preference." };
  const advisor = cachedOllama.models.some((model) => model.name.toLowerCase() === state.modelRoles.executor.toLowerCase())
    ? state.modelRoles.executor
    : undefined;
  activeRecommendation = await new OllamaRecommendationEngine().recommend({
    machine,
    candidates,
    supportedRoles: ["executor", "planner", "evaluator", "vision", "embedding"],
    installedDockerImages: docker.images.map((image) => image.alias),
    advisorModel: advisor,
    ...(advisor ? { invokeAdvisor: (prompt: string) => runtime.invokeAdvisor(advisor, prompt, controller.signal) } : {})
  });
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
  if (!window || window.isDestroyed()) return false;
  return new Promise<boolean>((resolve) => {
    approvals.set(request.id, resolve);
    window!.webContents.send("companion:approval-request", request);
  });
}

async function snapshot(refreshOllama = false): Promise<DesktopSnapshot> {
  if (refreshOllama || !hasCheckedOllama) {
    cachedOllama = await runtime.ollamaStatus();
    hasCheckedOllama = true;
  }
  return {
    ...store.snapshot(),
    ollama: cachedOllama,
    context: contextBrowser.snapshot(),
    ollamaPublicCatalogLoaded: Boolean(publicOllamaCatalog),
    running: runtime.running
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
