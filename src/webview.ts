import * as vscode from "vscode";
import { DevelopmentAgent } from "./agent";
import { ChangeReviewManager } from "./change-review";
import {
  clearImportedGatewayCa,
  hasImportedGatewayCa,
  importGatewayCa
} from "./certificate";
import { connectionDiagnosticFixes } from "./connection-remediation";
import {
  completionNotification,
  parseCompletionNotificationMode
} from "./completion-notification";
import type { RunOutcome } from "./completion-notification";
import type { ImageAttachment } from "./types";
import {
  createConnectionProfile,
  parseConnectionProfile,
  serializeConnectionProfile
} from "./connection-profile";
import {
  LITELLM_MODEL_CAPABILITIES,
  liteLlmModelProfile,
  normalizeLiteLlmEndpoint,
  normalizeLiteLlmModelsEndpoint,
  parseLiteLlmAuthHeader,
  parseLiteLlmModelPreset,
  parseLiteLlmModelProfiles,
  parseLiteLlmReasoningEffort,
  parseOptionalTemperature,
  parseOptionalTopP,
  resolveLiteLlmModelPreset,
  updateLiteLlmModelProfile,
  validateLiteLlmModelProfile
} from "./litellm";
import type {
  LiteLlmAuthHeader,
  LiteLlmModelCapabilities,
  LiteLlmModelPreset,
  LiteLlmModelProfiles,
  LiteLlmReasoningEffort
} from "./litellm";
import {
  AVAILABLE_MODEL_PROVIDERS,
  configuredModelProvider,
  modelProviderAuthHeader,
  modelProviderDefaultEndpoint,
  modelProviderLabel,
  modelProviderRequiresKey,
  modelProviderSecret,
  modelProviderSettingIsExplicit,
  modelProviderSupportsCatalog,
  modelProviderSupportsCorporateCa,
  parseModelProvider,
  PROVIDER_VARIANT,
  validateModelConnection,
  type ModelProvider
} from "./model-provider";
import { parseRunMode, runModeLabel } from "./autonomy";
import { ContextCollector } from "./context";
import { estimateContextTokens } from "./context-budget";
import { ProjectMemory } from "./memory";
import { memoryChunks } from "./memory-chunks";
import type { SaveMcpConnectionInput } from "./mcp-manager";
import {
  isSecretMcpEnvironment,
  isSecretMcpHeader,
  mcpConnectionDescription,
  mcpTemplatePlaceholders,
  normalizeMcpCommand,
  normalizeMcpEndpoint,
  normalizeMcpEnvironment,
  parseMcpTemplate,
  stripSecretHeaderPrefix,
  validateMcpArgument
} from "./mcp-config";
import type { McpConnectionSnapshot } from "./mcp-config";
import { redactSensitiveText, safeErrorMessage } from "./redaction";
import { agentRuntimeLabel, parseAgentRuntime } from "./runtime";
import { parseResponseLanguage } from "./response-language";
import { renderSafeMarkdown } from "./safe-markdown";
import { isSensitiveWorkspacePath } from "./sensitive-files";
import { createSupportBundle, serializeSupportBundle } from "./support-bundle";
import type { ThreadSnapshot } from "./thread-state";
import type {
  AgentRuntime,
  AgentUiEvent,
  ChatMessage,
  ConnectionDiagnostic,
  RunMode
} from "./types";
import { parseIncomingMessage } from "./webview-protocol";
import type { IncomingMessage } from "./webview-protocol";

const LEGACY_HISTORY_KEY = "localAgentCompanion.history";
const DRAFTS_KEY = "localAgentCompanion.threadDrafts";
const MAX_DRAFT_CHARACTERS = 50_000;

function parseFinalReviewMode(value: unknown): "off" | "changes" | "always" {
  return value === "off" || value === "always" ? value : "changes";
}

function mcpConnectionState(connections: readonly McpConnectionSnapshot[]) {
  return {
    count: connections.length,
    enabled: connections.filter((connection) => connection.enabled).length,
    needsAttention: connections.filter((connection) => connection.missingSecrets.length > 0).length
  };
}

type LiteLlmFormFields = {
  provider: ModelProvider;
  endpoint: string;
  model: string;
  profileModel: string;
  apiKey: string;
  authHeader: LiteLlmAuthHeader;
  modelsEndpoint: string;
  preset: string;
  reasoningEffort: string;
  temperature: string;
  topP: string;
  semanticMemoryEnabled: boolean;
  embeddingModel: string;
  embeddingEndpoint: string;
  visionModel: string;
};

type LiteLlmSettingsSnapshot = {
  provider: ModelProvider;
  providerVariant: string;
  availableProviders: readonly ModelProvider[];
  providerKeyStates: Record<ModelProvider, boolean>;
  providerLabel: string;
  requiresKey: boolean;
  supportsCatalog: boolean;
  supportsCorporateCa: boolean;
  endpoint: string;
  modelsEndpoint: string;
  model: string;
  hasApiKey: boolean;
  caCertificatePath: string;
  runtime: AgentRuntime;
  authHeader: LiteLlmAuthHeader;
  modelProfiles: LiteLlmModelProfiles;
  preset: LiteLlmModelPreset;
  resolvedPreset: Exclude<LiteLlmModelPreset, "auto">;
  capabilities: LiteLlmModelCapabilities;
  reasoningEffort?: LiteLlmReasoningEffort;
  temperature?: number;
  topP?: number;
  semanticMemoryEnabled: boolean;
  embeddingModel: string;
  embeddingEndpoint: string;
  visionModel: string;
  finalReviewMode: "off" | "changes" | "always";
};

export class AgentViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private view: vscode.WebviewView | undefined;
  private draftCache: Record<string, string> | undefined;
  private connectionSettingsRequested = false;
  private sendPending = false;
  private readonly resumedGoals = new Set<string>();
  private readonly disposables: vscode.Disposable[] = [];

  public constructor(
    private readonly extensionContext: vscode.ExtensionContext,
    private readonly agent: DevelopmentAgent,
    private readonly collector: ContextCollector,
    private readonly memory: ProjectMemory,
    private readonly changeReview: ChangeReviewManager
  ) {
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(() => this.postContextState()),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration("localAgentCompanion.autoContext")) this.postContextState();
        if (event.affectsConfiguration("localAgentCompanion.autonomyMode")) {
          const mode = this.autonomyMode();
          this.post({ type: "autonomyChanged", mode, message: `${runModeLabel(mode)} selected` });
        }
        if (event.affectsConfiguration("localAgentCompanion.localBrowserToolsEnabled")) {
          this.postBrowserControlState();
        }
        if (event.affectsConfiguration("localAgentCompanion.localBrowserLiveMode")) {
          this.postBrowserControlState();
        }
        if (event.affectsConfiguration("localAgentCompanion.finalReviewMode")) {
          this.post({
            type: "finalReviewChanged",
            mode: parseFinalReviewMode(vscode.workspace.getConfiguration("localAgentCompanion").get("finalReviewMode"))
          });
        }
      })
    );
  }

  public resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.html = this.html(view.webview);
    this.disposables.push(
      view.webview.onDidReceiveMessage((message: unknown) => void this.receiveMessage(message)),
      view.onDidChangeVisibility(() => {
        if (view.visible) view.badge = undefined;
      }),
      view.onDidDispose(() => {
        if (this.view === view) this.view = undefined;
      })
    );
  }

  public reveal(): void {
    if (this.view) this.view.badge = undefined;
    this.view?.show?.(true);
  }

  public async openConnectionSettings(): Promise<void> {
    this.connectionSettingsRequested = true;
    await vscode.commands.executeCommand("workbench.view.extension.localAgentCompanion");
    this.reveal();
    await this.postConnectionSettings();
  }

  public async addSelection(): Promise<void> {
    try {
      const pinned = this.collector.pinSelection();
      if (!pinned) {
        void vscode.window.showInformationMessage("Select code before adding it to the local agent context.");
        return;
      }
      this.postContextState();
      this.post({ type: "toast", message: `Pinned ${pinned.filename}:${pinned.range}` });
      this.reveal();
    } catch (error) {
      void vscode.window.showErrorMessage(await this.safeError(error));
    }
  }

  public async addFileContext(): Promise<void> {
    try {
      const files = await this.collector.workspaceFiles();
      if (!files.length) {
        void vscode.window.showInformationMessage("No workspace files are available to add as context.");
        return;
      }
      const items = files
        .map((uri) => {
          const folder = vscode.workspace.getWorkspaceFolder(uri);
          return {
            label: vscode.workspace.asRelativePath(uri, false),
            description: folder && (vscode.workspace.workspaceFolders?.length ?? 0) > 1 ? folder.name : undefined,
            uri
          };
        })
        .sort((left, right) => left.label.localeCompare(right.label));
      const selected = await vscode.window.showQuickPick(items, {
        title: "Add file to message context",
        placeHolder: "Search workspace files",
        matchOnDescription: true,
        ignoreFocusOut: true
      });
      if (!selected) return;
      const pinned = await this.collector.pinFile(selected.uri);
      this.postContextState();
      this.post({ type: "toast", message: `Pinned ${pinned.filename}` });
      this.reveal();
    } catch (error) {
      void vscode.window.showErrorMessage(await this.safeError(error));
    }
  }

  public async newThread(): Promise<void> {
    await this.agent.newThread();
    const [context, payload] = await Promise.all([this.contextState(), this.threadPayload()]);
    this.post({ type: "reset", context, ...payload });
  }

  private async selectThread(threadId: string): Promise<void> {
    try {
      await this.agent.selectThread(threadId);
      const [context, payload] = await Promise.all([this.contextState(), this.threadPayload()]);
      this.post({ type: "reset", context, ...payload });
    } catch (error) {
      this.post({ type: "threadError", message: await this.safeError(error) });
    }
  }

  private async renameThread(threadId: string): Promise<void> {
    try {
      await this.assertThreadEditable();
      const snapshot = await this.agent.threadSnapshot();
      const thread = snapshot.threads.find((candidate) => candidate.id === threadId);
      if (!thread) throw new Error("The selected local thread no longer exists.");
      const title = await vscode.window.showInputBox({
        title: "Rename local thread",
        value: thread.title,
        prompt: "Thread titles stay only in this VS Code workspace.",
        validateInput: (value) => value.trim() ? undefined : "Thread title cannot be empty."
      });
      if (title === undefined) return;
      await this.assertThreadEditable();
      await this.agent.renameThread(threadId, title);
      this.post({ type: "threadsUpdated", ...await this.threadPayload() });
    } catch (error) {
      this.post({ type: "threadError", message: await this.safeError(error) });
    }
  }

  private async toggleThreadPinned(threadId: string): Promise<void> {
    try {
      await this.assertThreadEditable();
      await this.agent.toggleThreadPinned(threadId);
      this.post({ type: "threadsUpdated", ...await this.threadPayload() });
    } catch (error) {
      this.post({ type: "threadError", message: await this.safeError(error) });
    }
  }

  private async deleteThread(threadId: string): Promise<void> {
    try {
      await this.assertThreadEditable();
      const snapshot = await this.agent.threadSnapshot();
      const thread = snapshot.threads.find((candidate) => candidate.id === threadId);
      if (!thread) throw new Error("The selected local thread no longer exists.");
      const confirmation = await vscode.window.showWarningMessage(
        `Delete the local thread “${thread.title}”?`,
        { modal: true, detail: "This removes its local conversation history. Project memory is not changed." },
        "Delete thread"
      );
      if (confirmation !== "Delete thread") return;
      await this.assertThreadEditable();
      await this.agent.deleteThread(threadId);
      await this.discardDraft(threadId);
      const [context, payload] = await Promise.all([this.contextState(), this.threadPayload()]);
      this.post({ type: "reset", context, ...payload });
    } catch (error) {
      this.post({ type: "threadError", message: await this.safeError(error) });
    }
  }

  public dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  private async receiveMessage(value: unknown): Promise<void> {
    const message = parseIncomingMessage(value);
    if (!message) {
      this.post({
        type: "protocolError",
        message: "The sidebar sent an invalid or oversized local request. No action was performed.",
        active: this.agent.running || this.sendPending
      });
      return;
    }
    try {
      await this.handleMessage(message);
    } catch (error) {
      const active = this.agent.running;
      if (!active) this.sendPending = false;
      this.post({
        type: "protocolError",
        message: await this.safeError(error),
        active
      });
    }
  }

  private async handleMessage(message: IncomingMessage): Promise<void> {
    switch (message.type) {
      case "ready":
        await this.migrateLegacyHistory();
        const [payload, context, liteLlm, mcpConnections] = await Promise.all([
          this.threadPayload(),
          this.contextState(),
          this.liteLlmSettingsSnapshot(),
          this.agent.mcpSnapshots()
        ]);
        this.post({
          type: "hydrate",
          ...payload,
          workspace: vscode.workspace.name ?? "No workspace",
          context,
          liteLlm,
          browserControlEnabled: this.localBrowserToolsEnabled(),
          browserLiveMode: this.localBrowserLiveMode(),
          mcpConnections: mcpConnectionState(mcpConnections)
        });
        if (this.connectionSettingsRequested) await this.postConnectionSettings();
        void this.resumePendingGoals();
        break;
      case "environmentCheck":
        await this.checkEnvironment();
        break;
      case "send":
        await this.send(message.text, parseRunMode(message.mode), Boolean(message.replacePending), undefined, message.images);
        break;
      case "createGoal":
        await this.createGoal(message.text, parseRunMode(message.mode), message.runtime, message.finalReview);
        break;
      case "createGoalAndRun":
        await this.createGoalAndRun(message.text, parseRunMode(message.mode), message.runtime, message.finalReview);
        break;
      case "activateGoal":
        await this.resumeGoal(message.id);
        break;
      case "resumeGoal":
        await this.resumeGoal(message.id);
        break;
      case "pauseGoal":
        await this.updateGoal(message.id, "paused");
        break;
      case "cancelGoal":
        await this.updateGoal(message.id, "cancelled");
        break;
      case "openGoal":
        await this.agent.openGoal(message.id);
        break;
      case "editGoal":
        await this.editGoal(message.id);
        break;
      case "saveGoalCriteria":
        await this.saveGoalCriteria(message.id, message.criteria);
        break;
      case "retry":
        await this.retry(parseRunMode(message.mode));
        break;
      case "discardRecovery":
        await this.discardRecovery(message.threadId, message.messageId);
        break;
      case "refreshRunState":
        const [refreshedContext, refreshedPayload] = await Promise.all([
          this.contextState(),
          this.threadPayload()
        ]);
        this.post({ type: "reset", context: refreshedContext, ...refreshedPayload });
        break;
      case "draftChanged":
        await this.saveDraft(message.threadId, message.text);
        break;
      case "copyMessage":
        try {
          const text = String(message.text).slice(0, 200_000);
          if (!text.trim()) throw new Error("There is no response text to copy.");
          await vscode.env.clipboard.writeText(text);
          this.post({ type: "messageCopied", id: String(message.id).slice(0, 128) });
        } catch (error) {
          this.post({
            type: "messageCopyError",
            id: String(message.id).slice(0, 128),
            message: await this.safeError(error)
          });
        }
        break;
      case "cancel":
        const cancellation = this.agent.cancel();
        this.post({ type: "cancelState", state: cancellation });
        if (cancellation === "requested") {
          this.post({ type: "status", label: "Stopping current operation" });
          this.post({
            type: "activity",
            kind: "cancellation",
            title: "Stop requested",
            detail: "Waiting for the active model request or local tool to acknowledge cancellation."
          });
        }
        break;
      case "newThread":
        try {
          await this.newThread();
        } catch (error) {
          this.post({
            type: "newThreadError",
            message: await this.safeError(error)
          });
        }
        break;
      case "selectThread":
        await this.selectThread(message.id);
        break;
      case "markThreadRead":
        await this.agent.markThreadRead(message.id);
        this.post({ type: "threadsUpdated", ...await this.threadPayload() });
        break;
      case "toggleThreadPinned":
        await this.toggleThreadPinned(message.id);
        break;
      case "renameThread":
        await this.renameThread(message.id);
        break;
      case "deleteThread":
        await this.deleteThread(message.id);
        break;
      case "openMemoryCenter":
        await this.postMemoryState();
        break;
      case "openMemoryFile":
        try {
          await this.memory.open();
        } catch (error) {
          this.post({ type: "memoryActionError", message: await this.safeError(error) });
        }
        break;
      case "addMemoryEntry":
        await this.addMemoryEntry();
        break;
      case "editMemoryEntry":
        await this.editMemoryEntry(message.id);
        break;
      case "deleteMemoryEntry":
        await this.deleteMemoryEntry(message.id);
        break;
      case "openChanges":
        await vscode.commands.executeCommand("workbench.view.scm");
        break;
      case "openProblems":
        await vscode.commands.executeCommand("workbench.actions.view.problems");
        break;
      case "openTerminalCommand": {
        const terminal = vscode.window.createTerminal({ name: "Local Agent verification" });
        terminal.show(true);
        terminal.sendText(message.command, false);
        break;
      }
      case "openChangeDiff":
        await this.openChangeDiff(message.id);
        break;
      case "restoreChange":
        await this.restoreChange(message.id);
        break;
      case "restoreRunChanges":
        await this.restoreRunChanges(message.runId, message.changeIds);
        break;
      case "addFileContext":
        await this.addFileContext();
        break;
      case "removePinnedContext":
        this.collector.removePinned(message.id);
        this.postContextState();
        break;
      case "clearPinnedContext":
        this.collector.clearPinned();
        this.postContextState();
        break;
      case "connectionSettingsOpened":
        this.connectionSettingsRequested = false;
        break;
      case "openMcpConnections":
        await this.configureMcpConnections();
        break;
      case "configureGatewayCa":
        await this.configureGatewayCa();
        break;
      case "exportConnectionProfile":
        await this.exportConnectionProfile();
        break;
      case "importConnectionProfile":
        await this.importConnectionProfile();
        break;
      case "exportSupportBundle":
        await this.exportSupportBundle(message.diagnostics);
        break;
      case "listModels":
        await this.listModels(message.endpoint, message.apiKey);
        break;
      case "selectRuntime":
        await this.selectRuntime(message.runtime);
        break;
      case "selectAutonomy":
        await this.selectAutonomy(message.mode);
        break;
      case "selectFinalReview":
        await this.selectFinalReview(message.mode);
        break;
      case "selectResponseLanguage":
        await this.selectResponseLanguage(message.language);
        break;
      case "setLocalBrowserToolsEnabled":
        await this.setLocalBrowserToolsEnabled(message.enabled);
        break;
      case "setLocalBrowserLiveMode":
        await this.setLocalBrowserLiveMode(message.enabled);
        break;
      case "setLocalBrowserManualControl":
        this.agent.setLocalBrowserManualControl(message.enabled);
        this.post({ type: "browserManualControlChanged", enabled: message.enabled });
        break;
      case "testLiteLlm":
        await this.testLiteLlmSettings(message);
        break;
      case "saveLiteLlm":
        await this.saveLiteLlmSettings(message);
        break;
    }
  }

  private async liteLlmSettingsSnapshot(): Promise<LiteLlmSettingsSnapshot> {
    const configuration = vscode.workspace.getConfiguration("localAgentCompanion");
    const provider = configuredModelProvider(configuration);
    const providerWasExplicitlySelected = modelProviderSettingIsExplicit(configuration);
    const model = providerWasExplicitlySelected ? configuration.get<string>("liteLlmModel", "") : "";
    const modelProfiles = parseLiteLlmModelProfiles(configuration.get("liteLlmModelProfiles"));
    const profile = liteLlmModelProfile(modelProfiles, model);
    const resolvedPreset = resolveLiteLlmModelPreset(model, profile.preset);
    const secretName = modelProviderSecret(provider);
    const [hasApiKey, hasGlobalCa, liteLlmKey, openAiKey] = await Promise.all([
      secretName ? this.extensionContext.secrets.get(secretName).then(Boolean) : Promise.resolve(false),
      hasImportedGatewayCa(this.extensionContext),
      this.extensionContext.secrets.get(modelProviderSecret("litellm")!).then(Boolean),
      this.extensionContext.secrets.get(modelProviderSecret("openai")!).then(Boolean)
    ]);
    return {
      provider,
      providerVariant: PROVIDER_VARIANT,
      availableProviders: AVAILABLE_MODEL_PROVIDERS,
      providerKeyStates: { litellm: liteLlmKey, ollama: false, openai: openAiKey },
      providerLabel: modelProviderLabel(provider),
      requiresKey: modelProviderRequiresKey(provider),
      supportsCatalog: modelProviderSupportsCatalog(provider),
      supportsCorporateCa: modelProviderSupportsCorporateCa(provider),
      endpoint: providerWasExplicitlySelected
        ? configuration.get<string>("liteLlmEndpoint", "") || modelProviderDefaultEndpoint(provider)
        : modelProviderDefaultEndpoint(provider),
      modelsEndpoint: providerWasExplicitlySelected ? configuration.get<string>("liteLlmModelsEndpoint", "") : "",
      model,
      hasApiKey,
      caCertificatePath: hasGlobalCa
        ? "imported globally"
        : configuration.get<string>("gatewayCaCertificatePath", ""),
      runtime: parseAgentRuntime(configuration.get("agentRuntime")),
      authHeader: parseLiteLlmAuthHeader(configuration.get("liteLlmAuthHeader")),
      modelProfiles,
      preset: parseLiteLlmModelPreset(profile.preset),
      resolvedPreset,
      capabilities: LITELLM_MODEL_CAPABILITIES[resolvedPreset],
      reasoningEffort: profile.reasoningEffort,
      temperature: profile.temperature,
      topP: profile.topP,
      semanticMemoryEnabled: configuration.get<boolean>("semanticMemoryEnabled", true),
      embeddingModel: configuration.get<string>("embeddingModel", ""),
      embeddingEndpoint: configuration.get<string>("embeddingEndpoint", ""),
      visionModel: configuration.get<string>("visionModel", ""),
      finalReviewMode: parseFinalReviewMode(configuration.get("finalReviewMode"))
    };
  }

  private async configureGatewayCa(): Promise<void> {
    try {
      await this.assertProviderConfigurationEditable();
      const provider = configuredModelProvider(vscode.workspace.getConfiguration("localAgentCompanion"));
      if (!modelProviderSupportsCorporateCa(provider)) {
        throw new Error("Corporate CA import is available only for the LiteLLM provider.");
      }
      const hasCertificate = await hasImportedGatewayCa(this.extensionContext);
      const choice = await vscode.window.showQuickPick(
        [
          {
            label: hasCertificate ? "Replace corporate CA PEM" : "Import corporate CA PEM",
            description: "Select a trusted PEM bundle and store one private local copy",
            value: "import" as const
          },
          ...(hasCertificate
            ? [{
                label: "Use operating system trust only",
                description: "Remove the imported CA from this VS Code profile and environment",
                value: "remove" as const
              }]
            : [])
        ],
        {
          title: "LiteLLM gateway certificate",
          placeHolder: hasCertificate
            ? "A corporate CA is currently imported"
            : "Import only when the gateway is not trusted by the operating system",
          ignoreFocusOut: true
        }
      );
      if (!choice) return;
      if (choice.value === "remove") {
        await clearImportedGatewayCa(this.extensionContext);
        await this.agent.reloadProviderConfiguration();
        this.post({
          type: "gatewayCaUpdated",
          message: "Imported corporate CA removed; system trust is active"
        });
        return;
      }
      const selected = await vscode.window.showOpenDialog({
        title: hasCertificate ? "Replace the LiteLLM gateway CA PEM" : "Import the LiteLLM gateway CA PEM",
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        filters: { "PEM certificate bundle": ["pem"] },
        openLabel: hasCertificate ? "Replace PEM" : "Import PEM"
      });
      if (!selected?.[0]) return;
      await importGatewayCa(this.extensionContext, selected[0]);
      await this.agent.reloadProviderConfiguration();
      this.post({
        type: "gatewayCaUpdated",
        message: hasCertificate ? "Corporate CA replaced" : "Corporate CA imported"
      });
    } catch (error) {
      this.post({ type: "gatewayCaError", message: await this.safeError(error) });
    }
  }

  private async configureMcpConnections(): Promise<void> {
    try {
      await this.assertProviderConfigurationEditable();
      const connections = await this.agent.mcpSnapshots();
      const selection = await vscode.window.showQuickPick([
        {
          label: "$(add) Add corporate MCP from clipboard",
          description: "Use the JSON template copied from the corporate catalog",
          value: "add-clipboard"
        },
        {
          label: "$(file-code) Add corporate MCP from JSON file",
          description: "Select a portable mcpServers or VS Code servers configuration",
          value: "add-file"
        },
        {
          label: "$(folder-library) Add MCP from workspace templates",
          description: "Choose .local-agent/mcp.json or a JSON file in .local-agent/mcp/",
          value: "add-workspace"
        },
        {
          label: "$(new-file) Create an editable workspace template",
          description: "Create .local-agent/mcp/example.json without credentials",
          value: "create-workspace"
        },
        ...connections.map((connection) => ({
          label: `${connection.enabled ? "$(plug)" : "$(circle-slash)"} ${connection.name}`,
          description: `${connection.enabled ? "Enabled" : "Disabled"} · ${connection.tools.length} tool${connection.tools.length === 1 ? "" : "s"}`,
          detail: connection.missingSecrets.length
            ? `Missing credentials: ${connection.missingSecrets.join(", ")}`
            : mcpConnectionDescription(connection),
          value: connection.id
        }))
      ], {
        title: "Corporate MCP connections",
        placeHolder: "Add or manage a connection. Credentials stay in VS Code Secret Storage.",
        ignoreFocusOut: true
      });
      if (!selection) return;
      if (selection.value === "create-workspace") {
        await this.createWorkspaceMcpTemplate();
      } else if (selection.value === "add-clipboard" || selection.value === "add-file" || selection.value === "add-workspace") {
        const source = selection.value === "add-clipboard"
          ? await vscode.env.clipboard.readText()
          : selection.value === "add-file"
            ? await this.readMcpTemplateFile()
            : await this.readWorkspaceMcpTemplate();
        if (source === undefined) return;
        await this.importMcpTemplate(source);
      } else {
        await this.manageMcpConnection(selection.value);
      }
    } catch (error) {
      const message = await this.safeError(error);
      this.post({ type: "mcpConnectionError", message });
      void vscode.window.showErrorMessage(message);
    } finally {
      await this.postMcpConnectionState();
    }
  }

  private async readMcpTemplateFile(): Promise<string | undefined> {
    const selected = await vscode.window.showOpenDialog({
      title: "Import corporate MCP JSON",
      openLabel: "Review MCP configuration",
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      filters: { "MCP configuration": ["json"] }
    });
    if (!selected?.[0]) return undefined;
    const stat = await vscode.workspace.fs.stat(selected[0]);
    if (stat.size > 64_000) throw new Error("MCP configuration exceeds the 64 KB safety limit.");
    return new TextDecoder().decode(await vscode.workspace.fs.readFile(selected[0]));
  }

  private async readWorkspaceMcpTemplate(): Promise<string | undefined> {
    const candidates: Array<{ uri: vscode.Uri; label: string; description: string }> = [];
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const single = vscode.Uri.joinPath(folder.uri, ".local-agent", "mcp.json");
      try {
        const stat = await vscode.workspace.fs.stat(single);
        if ((stat.type & vscode.FileType.File) && !(stat.type & vscode.FileType.SymbolicLink) && stat.size <= 64_000) {
          candidates.push({ uri: single, label: "mcp.json", description: folder.name });
        }
      } catch {
        // An absent optional template is expected.
      }

      const directory = vscode.Uri.joinPath(folder.uri, ".local-agent", "mcp");
      try {
        const entries = await vscode.workspace.fs.readDirectory(directory);
        for (const [entry, type] of entries.sort(([left], [right]) => left.localeCompare(right)).slice(0, 50)) {
          if (!(type & vscode.FileType.File) || type & vscode.FileType.SymbolicLink || !entry.toLowerCase().endsWith(".json")) continue;
          const uri = vscode.Uri.joinPath(directory, entry);
          const stat = await vscode.workspace.fs.stat(uri);
          if (stat.size <= 64_000) candidates.push({ uri, label: entry, description: `${folder.name}/.local-agent/mcp` });
        }
      } catch {
        // An absent optional template directory is expected.
      }
    }
    if (!candidates.length) {
      const create = await vscode.window.showInformationMessage(
        "No workspace MCP templates were found in .local-agent/mcp.json or .local-agent/mcp/.",
        "Create template"
      );
      if (create === "Create template") await this.createWorkspaceMcpTemplate();
      return undefined;
    }
    const selected = candidates.length === 1
      ? candidates[0]
      : await vscode.window.showQuickPick(candidates, {
          title: "Choose a workspace MCP template",
          placeHolder: "The file is reviewed and imported only after your approval",
          ignoreFocusOut: true
        });
    if (!selected) return undefined;
    return new TextDecoder().decode(await vscode.workspace.fs.readFile(selected.uri));
  }

  private async createWorkspaceMcpTemplate(): Promise<void> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (!folders.length) throw new Error("Open a workspace folder before creating an MCP template.");
    const folder = folders.length === 1
      ? folders[0]
      : (await vscode.window.showQuickPick(folders.map((candidate) => ({
          label: candidate.name,
          description: candidate.uri.fsPath,
          folder: candidate
        })), { title: "Choose the workspace for the MCP template", ignoreFocusOut: true }))?.folder;
    if (!folder) return;
    const directory = vscode.Uri.joinPath(folder.uri, ".local-agent", "mcp");
    const destination = vscode.Uri.joinPath(directory, "example.json");
    await vscode.workspace.fs.createDirectory(directory);
    try {
      await vscode.workspace.fs.stat(destination);
    } catch {
      const transport = await vscode.window.showQuickPick([
        { label: "$(globe) Corporate HTTPS", description: "Connect to an exact Streamable HTTP endpoint", value: "http" },
        { label: "$(terminal) Local stdio", description: "Start an exact catalog command without a shell", value: "stdio" }
      ], { title: "Choose the MCP template transport", ignoreFocusOut: true });
      if (!transport) return;
      const server = transport.value === "http"
        ? {
            type: "http",
            url: "https://<input:Corporate MCP host>/<input:Service route>/mcp",
            headers: {
              "api-key": "<secret:Subscription key>",
              Authorization: "Bearer <secret:Access token>"
            },
            tools: ["read_only_tool"]
          }
        : {
            type: "local",
            command: "npx",
            args: ["--yes", "<input:Pinned MCP package and version>"],
            env: {
              npm_config_registry: "<input:Corporate npm registry HTTPS URL>"
            },
            tools: ["*"]
          };
      const template = { mcpServers: { "corporate-service": server } };
      await vscode.workspace.fs.writeFile(destination, new TextEncoder().encode(`${JSON.stringify(template, null, 2)}\n`));
    }
    await vscode.window.showTextDocument(destination, { preview: false });
    void vscode.window.showInformationMessage(
      "Workspace MCP template ready. Keep placeholders in the file; credentials are requested only during import."
    );
  }

  private async importMcpTemplate(source: string): Promise<void> {
    const parsed = parseMcpTemplate(source);
    const server = parsed.length === 1
      ? parsed[0]!
      : (await vscode.window.showQuickPick(parsed.map((candidate) => ({
          label: candidate.name,
          description: candidate.transport === "http"
            ? candidate.url
            : [candidate.command, ...candidate.args].join(" "),
          value: candidate
        })), {
          title: "Choose the MCP server to import",
          ignoreFocusOut: true
        }))?.value;
    if (!server) return;

    const name = await vscode.window.showInputBox({
      title: "MCP connection name",
      value: server.name,
      prompt: "This label is stored only in the current workspace.",
      ignoreFocusOut: true,
      validateInput: (value) => value.trim() ? undefined : "Enter a connection name."
    });
    if (name === undefined) return;
    const resolvedValues = new Map<string, string>();
    let draft: SaveMcpConnectionInput;
    if (server.transport === "http") {
      const url = await this.resolveMcpEndpointTemplate(name, server.url);
      if (url === undefined) return;
      const headers: Record<string, string> = {};
      const secrets: Record<string, string> = {};
      for (const [header, templateValue] of Object.entries(server.headers)) {
        const resolved = await this.resolveMcpHeaderTemplate(name, header, templateValue, resolvedValues);
        if (resolved === undefined) return;
        if (!resolved.value) continue;
        if (resolved.secret) secrets[header] = resolved.value;
        else headers[header] = resolved.value;
      }
      draft = { transport: "http", name, url, enabled: true, headers, secrets, tools: [] };
    } else {
      const command = normalizeMcpCommand(server.command);
      const args: string[] = [];
      for (const [index, templateValue] of server.args.entries()) {
        const resolved = await this.resolveMcpArgumentTemplate(name, index, templateValue, resolvedValues);
        if (resolved === undefined) return;
        args.push(validateMcpArgument(resolved));
      }
      const env: Record<string, string> = {};
      const secrets: Record<string, string> = {};
      for (const [environmentName, templateValue] of Object.entries(server.env)) {
        const resolved = await this.resolveMcpEnvironmentTemplate(
          name,
          environmentName,
          templateValue,
          resolvedValues
        );
        if (resolved === undefined) return;
        if (resolved.secret) secrets[environmentName] = resolved.value;
        else env[environmentName] = resolved.value;
      }
      draft = {
        transport: "stdio",
        name,
        command,
        args,
        env: normalizeMcpEnvironment(env),
        enabled: true,
        secrets,
        tools: []
      };
    }

    const selection = await this.selectMcpTools(name, draft, server.tools);
    if (!selection) return;
    const tools = selection.tools;
    const approval = await vscode.window.showInformationMessage(
      `Add the corporate MCP connection “${name.trim()}”?`,
      {
        modal: true,
        detail: [
          ...this.mcpImportSummary(draft),
          `Tools: ${tools.join(", ")}`,
          "",
          "Every tool call requires approval. MCP results may be included in requests to your configured model provider. Credentials remain in VS Code Secret Storage."
        ].join("\n")
      },
      "Add connection"
    );
    if (approval !== "Add connection") return;
    const saved = await this.agent.saveMcpConnection({ ...draft, tools });
    this.post({ type: "mcpConnectionChanged", ...(await this.mcpConnectionState()), message: `${saved.name} added` });
    if (selection.tested) return;
    const test = await vscode.window.showInformationMessage(
      `${saved.name} was saved securely. Test its handshake and tool catalog now?`,
      "Test connection",
      "Later"
    );
    if (test === "Test connection") await this.testMcpConnection(saved.id);
  }

  private async selectMcpTools(
    name: string,
    draft: SaveMcpConnectionInput,
    configuredTools: string[]
  ): Promise<{ tools: string[]; tested: boolean } | undefined> {
    const discover = configuredTools.length === 0 || configuredTools.includes("*");
    let availableTools = configuredTools;
    if (discover) {
      const approval = await vscode.window.showInformationMessage(
        `Start “${name}” once to discover its tools?`,
        {
          modal: true,
          detail: [
            ...this.mcpImportSummary(draft),
            "",
            draft.transport === "stdio"
              ? "This starts the exact local command without a shell. npx may obtain the pinned package from the configured corporate registry and cache it for this user."
              : "This performs only the MCP handshake and tool-catalog request against the exact HTTPS endpoint.",
            "No MCP tool is executed during discovery."
          ].join("\n")
        },
        "Discover tools"
      );
      if (approval !== "Discover tools") return undefined;
      availableTools = await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `Discovering tools from ${name}`,
        cancellable: false
      }, () => this.agent.discoverMcpTools(draft));
      if (!availableTools.length) throw new Error(`MCP server “${name}” did not advertise any tools.`);
    }
    const selectedTools = await vscode.window.showQuickPick(availableTools.map((tool) => ({
      label: tool,
      picked: true
    })), {
      title: `${name} · tools available to the agent`,
      placeHolder: "Only selected tools will be exposed to LangChain",
      canPickMany: true,
      ignoreFocusOut: true
    });
    if (!selectedTools) return undefined;
    if (!selectedTools.length) throw new Error("Choose at least one MCP tool.");
    return { tools: selectedTools.map(({ label }) => label), tested: discover };
  }

  private mcpImportSummary(input: SaveMcpConnectionInput): string[] {
    if (input.transport === "http") return [`Endpoint: ${normalizeMcpEndpoint(input.url)}`];
    const environment = [
      ...Object.entries(input.env).map(([name, value]) => `${name}=${value}`),
      ...Object.keys(input.secrets).map((name) => `${name}=<stored securely>`)
    ];
    return [
      `Local command: ${[input.command, ...input.args].join(" ")}`,
      environment.length ? `Environment: ${environment.join(", ")}` : "Environment: default safe process variables only"
    ];
  }

  private async resolveMcpEndpointTemplate(name: string, template: string): Promise<string | undefined> {
    let resolved = template;
    const placeholders = mcpTemplatePlaceholders(template);
    for (const placeholder of placeholders) {
      if (placeholder.kind === "secret") {
        throw new Error(`Secret placeholder “${placeholder.title}” cannot be used in an MCP URL. Put credentials in headers.`);
      }
      const value = await vscode.window.showInputBox({
        title: `${name} · ${placeholder.title}`,
        prompt: `This value replaces ${placeholder.raw} in the MCP URL.`,
        ignoreFocusOut: true,
        validateInput: (candidate) => candidate.trim() ? undefined : "Enter the value supplied by the corporate catalog."
      });
      if (value === undefined) return undefined;
      resolved = resolved.replaceAll(placeholder.raw, value.trim());
    }
    const url = await vscode.window.showInputBox({
      title: `${name} · HTTPS endpoint`,
      value: resolved,
      prompt: placeholders.length
        ? "Review the resolved endpoint. Credentials are not allowed in the URL."
        : "Review the endpoint supplied by the corporate catalog.",
      ignoreFocusOut: true,
      validateInput: (value) => {
        try {
          normalizeMcpEndpoint(value);
          return undefined;
        } catch (error) {
          return error instanceof Error ? error.message : "Enter a valid HTTPS MCP URL.";
        }
      }
    });
    return url === undefined ? undefined : normalizeMcpEndpoint(url);
  }

  private async resolveMcpHeaderTemplate(
    connectionName: string,
    header: string,
    template: string,
    resolvedValues: Map<string, string>
  ): Promise<{ value: string; secret: boolean } | undefined> {
    const placeholders = mcpTemplatePlaceholders(template);
    if (!placeholders.length) {
      if (!isSecretMcpHeader(header)) return { value: template.trim(), secret: false };
      const { prefix } = stripSecretHeaderPrefix(header, template);
      const entered = await vscode.window.showInputBox({
        title: `${connectionName} · ${header}`,
        password: true,
        prompt: "Enter this credential again. Values copied inside JSON are never trusted or persisted.",
        placeHolder: prefix ? `${prefix.trim()} credential` : "Secret credential",
        ignoreFocusOut: true,
        validateInput: (value) => value.trim() ? undefined : `Enter the credential for ${header}.`
      });
      return entered === undefined ? undefined : { value: `${prefix}${entered.trim()}`, secret: true };
    }

    let resolved = template;
    let containsSecret = false;
    for (const placeholder of placeholders) {
      const kind = placeholder.kind ?? (isSecretMcpHeader(header) ? "secret" : "input");
      containsSecret ||= kind === "secret";
      const cacheKey = `${kind}:${placeholder.title.toLowerCase()}`;
      let value = resolvedValues.get(cacheKey);
      if (value === undefined) {
        const entered = await vscode.window.showInputBox({
          title: `${connectionName} · ${placeholder.title}`,
          password: kind === "secret",
          prompt: kind === "secret"
            ? "Stored only in VS Code Secret Storage. It is never written to the template, settings, logs, prompts, or memory."
            : `This value replaces ${placeholder.raw}.`,
          placeHolder: kind === "secret" ? placeholder.title : undefined,
          ignoreFocusOut: true,
          validateInput: (candidate) => candidate.trim()
            ? undefined
            : kind === "secret" ? `Enter ${placeholder.title}.` : undefined
        });
        if (entered === undefined) return undefined;
        value = entered.trim();
        if (value) resolvedValues.set(cacheKey, value);
      }
      resolved = resolved.replaceAll(placeholder.raw, value);
    }
    return { value: resolved.trim(), secret: containsSecret };
  }

  private async resolveMcpArgumentTemplate(
    connectionName: string,
    index: number,
    template: string,
    resolvedValues: Map<string, string>
  ): Promise<string | undefined> {
    let resolved = template;
    for (const placeholder of mcpTemplatePlaceholders(template)) {
      if (placeholder.kind === "secret") {
        throw new Error(`Secret placeholder “${placeholder.title}” cannot be used in MCP process arguments. Put credentials in env.`);
      }
      const cacheKey = `input:${placeholder.title.toLowerCase()}`;
      let value = resolvedValues.get(cacheKey);
      if (value === undefined) {
        const entered = await vscode.window.showInputBox({
          title: `${connectionName} · ${placeholder.title}`,
          prompt: `This value replaces ${placeholder.raw} in local argument ${index + 1}.`,
          ignoreFocusOut: true,
          validateInput: (candidate) => candidate.trim() ? undefined : `Enter ${placeholder.title}.`
        });
        if (entered === undefined) return undefined;
        value = entered.trim();
        resolvedValues.set(cacheKey, value);
      }
      resolved = resolved.replaceAll(placeholder.raw, value);
    }
    return resolved;
  }

  private async resolveMcpEnvironmentTemplate(
    connectionName: string,
    environmentName: string,
    template: string,
    resolvedValues: Map<string, string>
  ): Promise<{ value: string; secret: boolean } | undefined> {
    const placeholders = mcpTemplatePlaceholders(template);
    const inferredSecret = isSecretMcpEnvironment(environmentName);
    if (!placeholders.length) {
      if (!inferredSecret) return { value: template.trim(), secret: false };
      const entered = await vscode.window.showInputBox({
        title: `${connectionName} · ${environmentName}`,
        password: true,
        prompt: "Enter this credential again. Values copied inside JSON are never trusted or persisted.",
        placeHolder: environmentName,
        ignoreFocusOut: true,
        validateInput: (value) => value.trim() ? undefined : `Enter the credential for ${environmentName}.`
      });
      return entered === undefined ? undefined : { value: entered.trim(), secret: true };
    }

    let resolved = template;
    let containsSecret = false;
    for (const placeholder of placeholders) {
      const kind = placeholder.kind ?? (inferredSecret ? "secret" : "input");
      containsSecret ||= kind === "secret";
      const cacheKey = `${kind}:${placeholder.title.toLowerCase()}`;
      let value = resolvedValues.get(cacheKey);
      if (value === undefined) {
        const entered = await vscode.window.showInputBox({
          title: `${connectionName} · ${placeholder.title}`,
          password: kind === "secret",
          prompt: kind === "secret"
            ? "Stored only in VS Code Secret Storage. It is never written to the template, settings, logs, prompts, or memory."
            : `This value replaces ${placeholder.raw} in ${environmentName}.`,
          placeHolder: kind === "secret" ? placeholder.title : undefined,
          ignoreFocusOut: true,
          validateInput: (candidate) => candidate.trim()
            ? undefined
            : kind === "secret" ? `Enter ${placeholder.title}.` : undefined
        });
        if (entered === undefined) return undefined;
        value = entered.trim();
        if (value) resolvedValues.set(cacheKey, value);
      }
      resolved = resolved.replaceAll(placeholder.raw, value);
    }
    return { value: resolved.trim(), secret: containsSecret };
  }

  private async manageMcpConnection(id: string): Promise<void> {
    const connection = (await this.agent.mcpSnapshots()).find((candidate) => candidate.id === id);
    if (!connection) throw new Error("The MCP connection no longer exists.");
    const action = await vscode.window.showQuickPick([
      { label: "$(pulse) Test connection", description: "Handshake and list tools without executing one", value: "test" },
      {
        label: connection.transport === "http"
          ? "$(key) Update endpoint or credentials"
          : "$(key) Update environment or credentials",
        description: connection.transport === "http"
          ? "Replace routing values or rotated secrets securely"
          : "Keep the approved command and update its environment securely",
        value: "update"
      },
      {
        label: connection.enabled ? "$(circle-slash) Disable for the agent" : "$(plug) Enable for the agent",
        description: connection.enabled ? "Keep the configuration but hide its tools" : "Expose its selected tools on the next run",
        value: "toggle"
      },
      { label: "$(trash) Remove connection", description: "Also delete its credentials from Secret Storage", value: "remove" }
    ], { title: connection.name, placeHolder: mcpConnectionDescription(connection), ignoreFocusOut: true });
    if (!action) return;
    if (action.value === "test") {
      await this.testMcpConnection(id);
      return;
    }
    if (action.value === "update") {
      await this.updateMcpConnection(connection);
      return;
    }
    if (action.value === "toggle") {
      await this.agent.setMcpConnectionEnabled(id, !connection.enabled);
      this.post({
        type: "mcpConnectionChanged",
        ...(await this.mcpConnectionState()),
        message: `${connection.name} ${connection.enabled ? "disabled" : "enabled"}`
      });
      return;
    }
    const confirmation = await vscode.window.showWarningMessage(
      `Remove the MCP connection “${connection.name}”?`,
      { modal: true, detail: "Its credentials will also be deleted from VS Code Secret Storage." },
      "Remove connection"
    );
    if (confirmation !== "Remove connection") return;
    await this.agent.removeMcpConnection(id);
    this.post({ type: "mcpConnectionChanged", ...(await this.mcpConnectionState()), message: `${connection.name} removed` });
  }

  private async updateMcpConnection(connection: McpConnectionSnapshot): Promise<void> {
    if (connection.transport === "stdio") {
      const env: Record<string, string> = {};
      for (const [environmentName, current] of Object.entries(connection.env)) {
        const value = await vscode.window.showInputBox({
          title: `${connection.name} · ${environmentName}`,
          value: current,
          prompt: "Leave blank to omit this non-secret process variable.",
          ignoreFocusOut: true
        });
        if (value === undefined) return;
        if (value.trim()) env[environmentName] = value.trim();
      }
      const secrets: Record<string, string> = {};
      for (const environmentName of connection.secretEnvironment) {
        const value = await vscode.window.showInputBox({
          title: `${connection.name} · ${environmentName}`,
          password: true,
          prompt: "Leave blank to preserve the credential already stored in VS Code Secret Storage.",
          ignoreFocusOut: true
        });
        if (value === undefined) return;
        secrets[environmentName] = value.trim();
      }
      await this.agent.saveMcpConnection({
        id: connection.id,
        transport: "stdio",
        name: connection.name,
        command: connection.command,
        args: connection.args,
        env,
        enabled: connection.enabled,
        secrets,
        tools: connection.tools
      });
      this.post({
        type: "mcpConnectionChanged",
        ...(await this.mcpConnectionState()),
        message: `${connection.name} updated`
      });
      return;
    }
    const url = await vscode.window.showInputBox({
      title: `${connection.name} · HTTPS endpoint`,
      value: connection.url,
      ignoreFocusOut: true,
      validateInput: (value) => {
        try {
          normalizeMcpEndpoint(value);
          return undefined;
        } catch (error) {
          return error instanceof Error ? error.message : "Enter a valid HTTPS MCP URL.";
        }
      }
    });
    if (url === undefined) return;
    const headers: Record<string, string> = {};
    for (const [header, current] of Object.entries(connection.headers)) {
      const value = await vscode.window.showInputBox({
        title: `${connection.name} · ${header}`,
        value: current,
        prompt: "Leave blank to omit this non-secret routing header.",
        ignoreFocusOut: true
      });
      if (value === undefined) return;
      if (value.trim()) headers[header] = value.trim();
    }
    const secrets: Record<string, string> = {};
    for (const header of connection.secretHeaders) {
      const value = await vscode.window.showInputBox({
        title: `${connection.name} · ${header}`,
        password: true,
        prompt: "Leave blank to preserve the credential already stored in VS Code Secret Storage.",
        ignoreFocusOut: true
      });
      if (value === undefined) return;
      secrets[header] = value.trim();
    }
    await this.agent.saveMcpConnection({
      id: connection.id,
      transport: "http",
      name: connection.name,
      url,
      enabled: connection.enabled,
      headers,
      secrets,
      tools: connection.tools
    });
    this.post({
      type: "mcpConnectionChanged",
      ...(await this.mcpConnectionState()),
      message: `${connection.name} updated`
    });
  }

  private async testMcpConnection(id: string): Promise<void> {
    const result = await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: "Testing corporate MCP connection",
      cancellable: false
    }, () => this.agent.testMcpConnection(id));
    const missing = result.profile.tools.filter((tool) => !result.discoveredTools.includes(tool));
    if (missing.length) {
      throw new Error(`MCP connected, but the server did not advertise the selected tools: ${missing.join(", ")}.`);
    }
    void vscode.window.showInformationMessage(
      `${result.profile.name} connected · ${result.enabledTools.length} approved tool${result.enabledTools.length === 1 ? "" : "s"} found.`
    );
    this.post({ type: "mcpConnectionChanged", ...(await this.mcpConnectionState()), message: `${result.profile.name} verified` });
  }

  private async mcpConnectionState() {
    return mcpConnectionState(await this.agent.mcpSnapshots());
  }

  private async postMcpConnectionState(): Promise<void> {
    this.post({ type: "mcpConnectionChanged", ...(await this.mcpConnectionState()) });
  }

  private async exportConnectionProfile(): Promise<void> {
    try {
      const provider = configuredModelProvider(vscode.workspace.getConfiguration("localAgentCompanion"));
      if (provider !== "litellm") throw new Error("Portable connection profiles are currently available only for LiteLLM.");
      const configuration = vscode.workspace.getConfiguration("localAgentCompanion");
      const requiresCorporateCa = await hasImportedGatewayCa(this.extensionContext)
        || Boolean(configuration.get<string>("gatewayCaCertificatePath", "").trim());
      const profile = createConnectionProfile({
        gateway: {
          endpoint: configuration.get<string>("liteLlmEndpoint", ""),
          modelsEndpoint: configuration.get<string>("liteLlmModelsEndpoint", ""),
          authHeader: parseLiteLlmAuthHeader(configuration.get("liteLlmAuthHeader")),
          requiresKey: true,
          requiresCorporateCa
        },
        models: {
          chat: configuration.get<string>("liteLlmModel", ""),
          embedding: configuration.get<string>("embeddingModel", ""),
          semanticMemoryEnabled: configuration.get<boolean>("semanticMemoryEnabled", true),
          profiles: parseLiteLlmModelProfiles(configuration.get("liteLlmModelProfiles"))
        },
        workspace: {
          runtime: parseAgentRuntime(configuration.get("agentRuntime")),
          autonomyMode: this.autonomyMode()
        }
      });
      const destination = await vscode.window.showSaveDialog({
        title: "Export Local Agent Companion connection profile",
        saveLabel: "Export profile",
        filters: { "Local Agent Companion profile": ["json"] }
      });
      if (!destination) return;
      await vscode.workspace.fs.writeFile(
        destination,
        new TextEncoder().encode(serializeConnectionProfile(profile))
      );
      this.post({
        type: "profileExported",
        message: "Connection profile exported without the gateway key or corporate CA"
      });
    } catch (error) {
      this.post({ type: "profileActionError", message: await this.safeError(error) });
    }
  }

  private async importConnectionProfile(): Promise<void> {
    try {
      await this.assertProviderConfigurationEditable();
      const selected = await vscode.window.showOpenDialog({
        title: "Import Local Agent Companion connection profile",
        openLabel: "Review profile",
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        filters: { "Local Agent Companion profile": ["json"] }
      });
      if (!selected?.[0]) return;
      const stat = await vscode.workspace.fs.stat(selected[0]);
      if (stat.size > 256_000) throw new Error("Connection profile exceeds the 256 KB safety limit.");
      const source = new TextDecoder().decode(await vscode.workspace.fs.readFile(selected[0]));
      const profile = parseConnectionProfile(JSON.parse(source) as unknown);
      const confirmation = await vscode.window.showInformationMessage(
        "Import this Local Agent Companion connection profile?",
        {
          modal: true,
          detail: [
            `Gateway: ${profile.gateway.endpoint}`,
            `Chat model: ${profile.models.chat}`,
            `Runtime: ${agentRuntimeLabel(profile.workspace.runtime)}`,
            "",
            "The gateway key and corporate CA are never imported. Existing Secret Storage credentials remain unchanged."
          ].join("\n")
        },
        "Import profile"
      );
      if (confirmation !== "Import profile") return;
      await this.assertProviderConfigurationEditable();

      const configuration = vscode.workspace.getConfiguration("localAgentCompanion");
      await Promise.all([
        configuration.update("modelProvider", "litellm", vscode.ConfigurationTarget.Global),
        configuration.update("liteLlmEndpoint", profile.gateway.endpoint, vscode.ConfigurationTarget.Global),
        configuration.update("liteLlmModelsEndpoint", profile.gateway.modelsEndpoint, vscode.ConfigurationTarget.Global),
        configuration.update("liteLlmAuthHeader", profile.gateway.authHeader, vscode.ConfigurationTarget.Global),
        configuration.update("liteLlmModel", profile.models.chat, vscode.ConfigurationTarget.Global),
        configuration.update("liteLlmModelProfiles", profile.models.profiles, vscode.ConfigurationTarget.Global),
        configuration.update("semanticMemoryEnabled", profile.models.semanticMemoryEnabled, vscode.ConfigurationTarget.Global),
        configuration.update("embeddingModel", profile.models.embedding, vscode.ConfigurationTarget.Global),
        configuration.update("agentRuntime", profile.workspace.runtime, vscode.ConfigurationTarget.Workspace),
        configuration.update("autonomyMode", profile.workspace.autonomyMode, vscode.ConfigurationTarget.Workspace)
      ]);
      await this.agent.reloadProviderConfiguration();
      const [liteLlm, hasApiKey, hasCorporateCa] = await Promise.all([
        this.liteLlmSettingsSnapshot(),
        this.extensionContext.secrets.get(modelProviderSecret("litellm")!).then(Boolean),
        hasImportedGatewayCa(this.extensionContext)
      ]);
      this.post({
        type: "profileImported",
        liteLlm,
        autonomyMode: profile.workspace.autonomyMode,
        needsKey: !hasApiKey,
        needsCorporateCa: profile.gateway.requiresCorporateCa && !hasCorporateCa,
        message: "Connection profile imported. Test the connection before use."
      });
      this.postContextState();
    } catch (error) {
      this.post({ type: "profileActionError", message: await this.safeError(error) });
    }
  }

  private async exportSupportBundle(diagnostics: unknown): Promise<void> {
    try {
      const configuration = vscode.workspace.getConfiguration("localAgentCompanion");
      const model = configuration.get<string>("liteLlmModel", "");
      const modelProfiles = parseLiteLlmModelProfiles(configuration.get("liteLlmModelProfiles"));
      const profile = liteLlmModelProfile(modelProfiles, model);
      const provider = configuredModelProvider(configuration);
      const secretName = modelProviderSecret(provider);
      const [threadSnapshot, memorySnapshot, keyPresent, corporateCaPresent] = await Promise.all([
        this.agent.threadSnapshot(),
        this.memory.snapshot().catch(() => undefined),
        secretName ? this.extensionContext.secrets.get(secretName).then(Boolean) : Promise.resolve(false),
        hasImportedGatewayCa(this.extensionContext)
      ]);
      const recoveryStates = threadSnapshot.threads.reduce<Record<string, number>>((counts, thread) => {
        if (thread.recoveryStatus) counts[thread.recoveryStatus] = (counts[thread.recoveryStatus] ?? 0) + 1;
        return counts;
      }, {});
      const extensionVersion = String(
        (this.extensionContext.extension.packageJSON as { version?: unknown }).version ?? "unknown"
      );
      const bundle = createSupportBundle({
        application: {
          extensionVersion,
          vscodeVersion: vscode.version,
          nodeVersion: process.version,
          platform: process.platform,
          architecture: process.arch,
          remote: Boolean(vscode.env.remoteName)
        },
        workspace: {
          folderCount: vscode.workspace.workspaceFolders?.length ?? 0,
          trusted: vscode.workspace.isTrusted
        },
        agent: {
          runtime: parseAgentRuntime(configuration.get("agentRuntime")),
          autonomyMode: this.autonomyMode(),
          autoContext: configuration.get<boolean>("autoContext", true),
          maxContextCharacters: configuration.get<number>("maxContextCharacters", 24_000),
          maxConversationCharacters: configuration.get<number>("maxConversationCharacters", 48_000),
          standardRecursionLimit: configuration.get<number>("standardRecursionLimit", 200)
        },
        connection: {
          provider,
          endpoint: configuration.get<string>("liteLlmEndpoint", ""),
          modelsEndpoint: configuration.get<string>("liteLlmModelsEndpoint", ""),
          authHeader: parseLiteLlmAuthHeader(configuration.get("liteLlmAuthHeader")),
          keyPresent,
          corporateCaPresent: corporateCaPresent
            || Boolean(configuration.get<string>("gatewayCaCertificatePath", "").trim()),
          chatModel: model,
          embeddingModel: configuration.get<string>("embeddingModel", ""),
          semanticMemoryEnabled: configuration.get<boolean>("semanticMemoryEnabled", true),
          modelProfileCount: Object.keys(modelProfiles).length,
          selectedPreset: parseLiteLlmModelPreset(profile.preset),
          resolvedPreset: resolveLiteLlmModelPreset(model, profile.preset),
          reasoningEffort: profile.reasoningEffort,
          temperatureConfigured: profile.temperature !== undefined,
          topPConfigured: profile.topP !== undefined
        },
        memory: {
          readable: Boolean(memorySnapshot),
          entryCount: memorySnapshot?.total ?? 0,
          projectedEntries: memorySnapshot?.entries.length ?? 0,
          omittedEntries: memorySnapshot?.omitted ?? 0
        },
        conversations: {
          threadCount: threadSnapshot.threads.length,
          activeMessageCount: threadSnapshot.messages.length,
          recoveryStates
        },
        diagnostics
      });
      const destination = await vscode.window.showSaveDialog({
        title: "Export sanitized Local Agent Companion support bundle",
        saveLabel: "Export support bundle",
        filters: { "Sanitized support bundle": ["json"] }
      });
      if (!destination) return;
      await vscode.workspace.fs.writeFile(
        destination,
        new TextEncoder().encode(serializeSupportBundle(bundle))
      );
      this.post({
        type: "supportBundleExported",
        message: "Sanitized support bundle exported without user content or connection identifiers"
      });
    } catch (error) {
      this.post({ type: "profileActionError", message: await this.safeError(error) });
    }
  }

  private async listModels(endpointInput: string, transientApiKey: string): Promise<void> {
    try {
      const provider = configuredModelProvider(vscode.workspace.getConfiguration("localAgentCompanion"));
      if (provider === "ollama") {
        const catalog = await this.agent.listModels(endpointInput, "");
        this.post({
          type: "modelsLoaded",
          models: catalog.models,
          embeddingModels: catalog.embeddingModels,
          endpoint: endpointInput,
          message: `${catalog.models.length} local Ollama models loaded`
        });
        return;
      }
      const endpoint = normalizeLiteLlmModelsEndpoint(endpointInput);
      const catalog = await this.agent.listModels(endpoint, transientApiKey);
      const configuration = vscode.workspace.getConfiguration("localAgentCompanion");
      await configuration.update("liteLlmModelsEndpoint", endpoint, vscode.ConfigurationTarget.Global);
      this.post({ type: "modelsLoaded", models: catalog.models, endpoint, message: `${catalog.models.length} models loaded` });
    } catch (error) {
      this.post({
        type: "modelsLoadError",
        message: await this.safeError(error, transientApiKey)
      });
    }
  }

  private async postConnectionSettings(): Promise<void> {
    if (!this.connectionSettingsRequested || !this.view) return;
    this.post({
      type: "openConnectionSettings",
      liteLlm: await this.liteLlmSettingsSnapshot()
    });
  }

  private async selectRuntime(value: unknown): Promise<void> {
    try {
      await this.assertProviderConfigurationEditable();
      const runtime = parseAgentRuntime(value);
      const configuration = vscode.workspace.getConfiguration("localAgentCompanion");
      await configuration.update("agentRuntime", runtime, vscode.ConfigurationTarget.Workspace);
      this.agent.reloadRuntimeConfiguration();
      this.post({
        type: "runtimeChanged",
        runtime,
        message: `${agentRuntimeLabel(runtime)} selected for this workspace`
      });
    } catch (error) {
      this.post({
        type: "runtimeChangeError",
        liteLlm: await this.liteLlmSettingsSnapshot(),
        message: await this.safeError(error)
      });
    }
  }

  private async selectFinalReview(value: unknown): Promise<void> {
    try {
      await this.assertProviderConfigurationEditable();
      const mode = parseFinalReviewMode(value);
      const configuration = vscode.workspace.getConfiguration("localAgentCompanion");
      await configuration.update("finalReviewMode", mode, vscode.ConfigurationTarget.Workspace);
      this.post({
        type: "finalReviewChanged",
        mode,
        message: mode === "off"
          ? "Independent final review disabled"
          : mode === "always"
            ? "Every executable run will receive an independent final review"
            : "Runs with changes or execution evidence will receive an independent final review"
      });
    } catch (error) {
      this.post({
        type: "finalReviewChangeError",
        mode: parseFinalReviewMode(vscode.workspace.getConfiguration("localAgentCompanion").get("finalReviewMode")),
        message: await this.safeError(error)
      });
    }
  }

  private async setLocalBrowserToolsEnabled(enabled: boolean): Promise<void> {
    try {
      await this.assertProviderConfigurationEditable();
      const configuration = vscode.workspace.getConfiguration("localAgentCompanion");
      await this.agent.setLocalBrowserToolsEnabled(enabled);
      await configuration.update("localBrowserToolsEnabled", enabled, vscode.ConfigurationTarget.Workspace);
      this.post({
        type: "browserControlChanged",
        enabled,
        liveMode: this.localBrowserLiveMode(),
        message: enabled
          ? "Local browser control enabled for this workspace"
          : "Local browser control disabled and its session closed"
      });
    } catch (error) {
      this.post({
        type: "browserControlError",
        enabled: this.localBrowserToolsEnabled(),
        message: await this.safeError(error)
      });
    }
  }

  private localBrowserToolsEnabled(): boolean {
    return vscode.workspace
      .getConfiguration("localAgentCompanion")
      .get<boolean>("localBrowserToolsEnabled", false);
  }

  private localBrowserLiveMode(): boolean {
    return vscode.workspace
      .getConfiguration("localAgentCompanion")
      .get<boolean>("localBrowserLiveMode", false);
  }

  private async setLocalBrowserLiveMode(enabled: boolean): Promise<void> {
    try {
      await this.assertProviderConfigurationEditable();
      const configuration = vscode.workspace.getConfiguration("localAgentCompanion");
      await configuration.update("localBrowserLiveMode", enabled, vscode.ConfigurationTarget.Workspace);
      await this.agent.setLocalBrowserLiveMode(enabled);
      this.post({
        type: "browserControlChanged",
        enabled: this.localBrowserToolsEnabled(),
        liveMode: enabled,
        message: enabled
          ? "Live browser enabled · the next local browser run opens visibly"
          : "Live browser disabled · local validation returns to headless mode"
      });
    } catch (error) {
      this.post({
        type: "browserControlError",
        enabled: this.localBrowserToolsEnabled(),
        liveMode: this.localBrowserLiveMode(),
        message: await this.safeError(error)
      });
    }
  }

  private postBrowserControlState(): void {
    const enabled = this.localBrowserToolsEnabled();
    if (!enabled) void this.agent.setLocalBrowserToolsEnabled(false);
    this.post({ type: "browserControlChanged", enabled, liveMode: this.localBrowserLiveMode() });
  }

  private async saveLiteLlmSettings(message: Extract<IncomingMessage, { type: "saveLiteLlm" }>): Promise<void> {
    try {
      await this.assertProviderConfigurationEditable();
      const configuration = vscode.workspace.getConfiguration("localAgentCompanion");
      const { connection, modelsEndpoint, modelProfiles } = await this.parseLiteLlmForm(message);
      const secretName = modelProviderSecret(connection.provider);
      await Promise.all([
        configuration.update("modelProvider", connection.provider, vscode.ConfigurationTarget.Global),
        configuration.update("liteLlmEndpoint", connection.endpoint, vscode.ConfigurationTarget.Global),
        configuration.update("liteLlmModel", connection.model, vscode.ConfigurationTarget.Global),
        configuration.update("liteLlmModelsEndpoint", modelsEndpoint, vscode.ConfigurationTarget.Global),
        configuration.update("liteLlmAuthHeader", connection.authHeader, vscode.ConfigurationTarget.Global),
        configuration.update("liteLlmModelProfiles", modelProfiles, vscode.ConfigurationTarget.Global),
        configuration.update("semanticMemoryEnabled", message.semanticMemoryEnabled, vscode.ConfigurationTarget.Global),
        configuration.update("embeddingModel", message.embeddingModel.trim(), vscode.ConfigurationTarget.Global),
        configuration.update("embeddingEndpoint", message.embeddingEndpoint.trim(), vscode.ConfigurationTarget.Global),
        configuration.update("visionModel", message.visionModel.trim(), vscode.ConfigurationTarget.Global),
        ...(secretName && message.apiKey.trim()
          ? [this.extensionContext.secrets.store(secretName, message.apiKey.trim())]
          : [])
      ]);
      await this.agent.reloadProviderConfiguration();
      this.post({
        type: "liteLlmSaved",
        liteLlm: await this.liteLlmSettingsSnapshot(),
        message: `${modelProviderLabel(connection.provider)} updated · ${connection.model}`
      });
    } catch (error) {
      this.post({
        type: "liteLlmSaveError",
        message: await this.safeError(error, message.apiKey)
      });
    }
  }

  private async testLiteLlmSettings(message: Extract<IncomingMessage, { type: "testLiteLlm" }>): Promise<void> {
    this.post({ type: "connectionTestStarted" });
    let parsed: Awaited<ReturnType<AgentViewProvider["parseLiteLlmForm"]>>;
    try {
      parsed = await this.parseLiteLlmForm(message);
    } catch (error) {
      const detail = await this.safeError(error, message.apiKey);
      const fixes = connectionDiagnosticFixes(detail, {
        authHeader: modelProviderAuthHeader(parseModelProvider(message.provider), message.authHeader),
        surface: "configuration"
      });
      this.post({
        type: "connectionTested",
        diagnostics: [{
          id: "configuration",
          label: "Configuration",
          status: "failed",
          detail,
          ...(fixes.length ? { fixes } : {})
        } satisfies ConnectionDiagnostic]
      });
      return;
    }

    const diagnostics: ConnectionDiagnostic[] = [{
        id: "configuration",
        label: "Configuration",
        status: "passed",
        detail: "Endpoint, credentials, model alias and parameters are valid"
    }];
    try {
      diagnostics.push(...await this.agent.diagnoseConnection({
        connection: parsed.connection,
        profile: liteLlmModelProfile(parsed.modelProfiles, parsed.connection.model),
        modelsEndpoint: parsed.modelsEndpoint,
        embeddingModel: message.semanticMemoryEnabled ? message.embeddingModel : "",
        embeddingEndpoint: message.semanticMemoryEnabled ? parsed.embeddingEndpoint : ""
      }));
    } catch (error) {
      const detail = await this.safeError(error, parsed.connection.apiKey);
      const fixes = connectionDiagnosticFixes(detail, {
        authHeader: parsed.connection.authHeader,
        surface: "chat"
      });
      diagnostics.push({
        id: "chat",
        label: "Gateway connection",
        status: "failed",
        detail,
        ...(fixes.length ? { fixes } : {})
      });
    }
    this.post({ type: "connectionTested", diagnostics });
  }

  private async parseLiteLlmForm(message: LiteLlmFormFields) {
    const configuration = vscode.workspace.getConfiguration("localAgentCompanion");
    const provider = parseModelProvider(message.provider);
    const secretName = modelProviderSecret(provider);
    const existingApiKey = secretName ? await this.extensionContext.secrets.get(secretName) : undefined;
    const apiKey = message.apiKey.trim() || existingApiKey || "";
    const connection = validateModelConnection({
      provider,
      endpoint: message.endpoint,
      model: message.model,
      apiKey,
      authHeader: modelProviderAuthHeader(provider, message.authHeader)
    });
    const modelsEndpoint = modelProviderSupportsCatalog(provider) && message.modelsEndpoint.trim()
      ? normalizeLiteLlmModelsEndpoint(message.modelsEndpoint)
      : "";
    const embeddingEndpoint = message.embeddingEndpoint.trim()
      ? normalizeLiteLlmEndpoint(message.embeddingEndpoint)
      : "";
    const preset = parseLiteLlmModelPreset(message.preset);
    const reasoningEffort = message.reasoningEffort === "omit"
      ? undefined
      : parseLiteLlmReasoningEffort(message.reasoningEffort);
    if (message.reasoningEffort !== "omit" && !reasoningEffort) {
      throw new Error("Choose a supported reasoning effort or omit the parameter.");
    }
    const temperature = parseOptionalTemperature(message.temperature);
    const topP = parseOptionalTopP(message.topP);
    const profileModel = message.profileModel.trim() || connection.model;
    const modelProfiles = updateLiteLlmModelProfile(
      configuration.get("liteLlmModelProfiles"),
      profileModel,
      { preset, reasoningEffort, temperature, topP }
    );
    validateLiteLlmModelProfile(profileModel, liteLlmModelProfile(modelProfiles, profileModel));
    if (message.visionModel.trim() && message.visionModel.trim() !== profileModel) {
      validateLiteLlmModelProfile(message.visionModel.trim(), liteLlmModelProfile(modelProfiles, message.visionModel.trim()));
    }
    return { connection, modelsEndpoint, embeddingEndpoint, modelProfiles };
  }

  private async send(text: string, mode: RunMode, replacePending = false, goalId?: string, images: ImageAttachment[] = []): Promise<void> {
    const clean = text.trim();
    if (!clean) {
      return;
    }
    if (this.sendPending) {
      this.post({
        type: "sendRejected",
        text: clean,
        replacePending,
        reason: "A request is already being checked or executed."
      });
      return;
    }
    this.sendPending = true;
    let preflight;
    try {
      preflight = await this.agent.preflightRun();
    } catch (error) {
      this.post({
        type: "preflightFailed",
        kind: "workspace",
        message: await this.safeError(error),
        text: clean,
        replacePending,
        openConnectionSettings: false
      });
      this.sendPending = false;
      return;
    }
    if (!preflight.ready) {
      this.post({
        type: "preflightFailed",
        kind: preflight.kind,
        message: preflight.message,
        text: clean,
        replacePending,
        openConnectionSettings: preflight.openConnectionSettings
      });
      this.sendPending = false;
      return;
    }
    this.post({ type: "busy", value: true });
    let requestAccepted = false;
    let outcome: RunOutcome | undefined;
    try {
      const snapshot = await this.agent.threadSnapshot();
      await this.saveDraft(snapshot.activeThreadId, "").catch(() => undefined);
      await this.agent.run(
        clean,
        mode,
        (event) => {
          if (event.type === "thread" && !requestAccepted) {
            requestAccepted = true;
            if (replacePending) {
              this.post({
                type: "pendingUserReplaced",
                id: event.userMessage.id,
                text: event.userMessage.text,
                html: renderSafeMarkdown(event.userMessage.text),
                createdAt: event.userMessage.createdAt
              });
            } else {
              const userMessage: ChatMessage = {
                id: event.userMessage.id,
                role: "user",
                text: event.userMessage.text,
                html: renderSafeMarkdown(event.userMessage.text),
                createdAt: event.userMessage.createdAt,
                status: "complete"
              };
              this.post({ type: "user", message: userMessage });
            }
          }
          if (event.type === "done") outcome = event.outcome;
          void this.forwardAgentEvent(event);
        },
        { replacePendingUser: replacePending, ...(goalId ? { goalId } : {}), ...(images.length ? { images } : {}) }
      );
      if (requestAccepted && outcome) void this.notifyRunCompletion(outcome);
      if (goalId && requestAccepted && outcome === "completed" && mode !== "plan") {
        const latestGoal = await this.agent.getGoal(goalId);
        if (latestGoal?.status === "active" && latestGoal.nextAction) {
          this.post({
            type: "activity",
            kind: "goal",
            title: "Goal follow-up queued",
            detail: latestGoal.nextAction
          });
          setTimeout(() => {
            void this.resumeGoal(goalId).catch((error) => {
              this.post({ type: "error", message: `Goal continuation failed: ${error instanceof Error ? error.message : String(error)}`, recoverable: true });
            });
          }, 50);
        }
      }
    } catch (error) {
      this.post({
        type: "error",
        message: await this.safeError(error),
        recoverable: false
      });
      this.post({ type: "busy", value: false });
    } finally {
      try {
        if (!requestAccepted) this.post({ type: "sendRejected", text: clean, replacePending });
        this.post({ type: "threadsUpdated", ...await this.threadPayload() });
        this.postContextState();
        await this.postMemoryState();
      } finally {
        this.sendPending = false;
      }
    }
  }

  private async createGoal(text: string, mode: RunMode, runtime: AgentRuntime, finalReview: "off" | "changes" | "always"): Promise<void> {
    const snapshot = await this.agent.threadSnapshot();
    const goal = await this.agent.createGoal({ objective: text.trim(), threadId: snapshot.activeThreadId, runtime, autonomyMode: mode, finalReview });
    this.post({ type: "goal", goal });
    this.post({ type: "toast", message: "Goal draft created. Review the criteria in .local-agent/goals and activate it when ready." });
    this.post({ type: "threadsUpdated", ...await this.threadPayload() });
  }

  private async createGoalAndRun(text: string, mode: RunMode, runtime: AgentRuntime, finalReview: "off" | "changes" | "always"): Promise<void> {
    const snapshot = await this.agent.threadSnapshot();
    const existing = (await this.agent.listGoals()).find((item) =>
      item.threadId === snapshot.activeThreadId && (item.status === "active" || item.status === "awaiting-criteria")
    );
    const goal = existing
      ? (existing.status === "awaiting-criteria" ? await this.agent.activateGoal(existing.id) : existing)
      : await this.agent.activateGoal((await this.agent.createGoal({ objective: text.trim(), threadId: snapshot.activeThreadId, runtime, autonomyMode: mode, finalReview })).id);
    this.post({ type: "goal", goal });
    this.post({ type: "activity", kind: "goal", title: "Goal started", detail: "The message was saved as a persistent goal and its first iteration is starting." });
    await this.send(text, mode, false, goal.id);
  }

  private async checkEnvironment(): Promise<void> {
    try {
      const result = await this.agent.preflightRun();
      this.post({ type: "toast", message: result.ready ? "Environment ready: workspace, provider, model, and certificate checks passed." : `Environment needs attention (${result.kind}): ${result.message}` });
      if (!result.ready && result.openConnectionSettings) await this.openConnectionSettings();
    } catch (error) {
      this.post({ type: "toast", message: `Environment check failed: ${await this.safeError(error)}` });
    }
  }

  private async updateGoal(id: string, status: "active" | "paused" | "cancelled"): Promise<void> {
    const goal = await this.agent.setGoalStatus(id, status);
    this.post({ type: "goal", goal });
    this.post({ type: "threadsUpdated", ...await this.threadPayload() });
  }

  private async editGoal(id: string): Promise<void> {
    const goal = await this.agent.getGoal(id);
    if (!goal) throw new Error("Goal not found.");
    const value = await vscode.window.showInputBox({
      title: "Edit goal acceptance criteria",
      prompt: "Enter one criterion per line. Evidence is required before completion.",
      value: goal.criteria.map((criterion) => criterion.text).join("\n"),
      ignoreFocusOut: true,
      validateInput: (input) => {
        const count = input.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).length;
        return count > 0 && count <= 20 ? undefined : "Provide between 1 and 20 criteria, one per line.";
      }
    });
    if (value === undefined) return;
    const texts = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 20);
    const criteria = texts.map((text, index) => {
      const existing = goal.criteria[index];
      return {
        id: existing?.id ?? `${goal.id}-criterion-${index + 1}`,
        text: text.slice(0, 4_000),
        status: existing?.status === "verified" && existing.text === text ? "verified" as const : "pending" as const,
        evidence: existing?.text === text ? existing.evidence : [],
        ...(existing?.text === text && existing.evidenceRefs?.length ? { evidenceRefs: existing.evidenceRefs } : {})
      };
    });
    const milestones = goal.milestones.map((milestone) => ({
      ...milestone,
      criteriaIds: criteria.map((criterion) => criterion.id),
      status: milestone.status === "completed" ? "active" as const : milestone.status
    }));
    const updated = await this.agent.updateGoal({ ...goal, criteria, milestones, status: "awaiting-criteria", nextAction: "Review the updated criteria and activate the next iteration.", updatedAt: Date.now() });
    this.post({ type: "goal", goal: updated });
    this.post({ type: "threadsUpdated", ...await this.threadPayload() });
  }

  private async saveGoalCriteria(id: string, texts: string[]): Promise<void> {
    const goal = await this.agent.getGoal(id);
    if (!goal) throw new Error("Goal not found.");
    const normalized = texts.map((text) => text.trim()).filter(Boolean).slice(0, 20);
    if (!normalized.length) throw new Error("Provide at least one acceptance criterion.");
    const criteria = normalized.map((text, index) => {
      const existing = goal.criteria[index];
      return {
        id: existing?.id ?? `${goal.id}-criterion-${index + 1}`,
        text: text.slice(0, 4_000),
        status: existing?.status === "verified" && existing.text === text ? "verified" as const : "pending" as const,
        evidence: existing?.text === text ? existing.evidence : [],
        ...(existing?.text === text && existing.evidenceRefs?.length ? { evidenceRefs: existing.evidenceRefs } : {})
      };
    });
    const milestones = goal.milestones.map((milestone) => ({
      ...milestone,
      criteriaIds: criteria.map((criterion) => criterion.id),
      status: milestone.status === "completed" ? "active" as const : milestone.status
    }));
    const updated = await this.agent.updateGoal({ ...goal, criteria, milestones, status: "awaiting-criteria", nextAction: "Review the updated criteria and activate the next iteration.", updatedAt: Date.now() });
    this.post({ type: "goal", goal: updated });
    this.post({ type: "threadsUpdated", ...await this.threadPayload() });
  }

  private async resumeGoal(id: string): Promise<void> {
    const goal = await this.agent.activateGoal(id);
    this.post({ type: "goal", goal });
    const mode = goal.policy.autonomyMode;
    await this.send(goal.nextAction?.trim() || `Continue the persistent goal: ${goal.objective}`, mode, false, id);
  }

  private async resumePendingGoals(): Promise<void> {
    if (this.sendPending || this.agent.running) return;
    let snapshot = await this.agent.threadSnapshot();
    const goals = await this.agent.listGoals();
    const goal = goals.find((item) => item.status === "active" && item.policy.autoResume);
    if (!goal || this.resumedGoals.has(goal.id)) return;
    if (goal.threadId !== snapshot.activeThreadId) {
      await this.agent.selectThread(goal.threadId);
      snapshot = await this.agent.threadSnapshot();
      this.post({ type: "threadsUpdated", ...await this.threadPayload() });
    }
    this.resumedGoals.add(goal.id);
    this.post({ type: "activity", kind: "goal", title: `Resuming goal · iteration ${goal.iteration + 1}` });
    try { await this.resumeGoal(goal.id); } catch (error) { this.post({ type: "error", message: await this.safeError(error), recoverable: true }); }
    finally { setTimeout(() => void this.resumePendingGoals(), 250); }
  }

  private async notifyRunCompletion(outcome: RunOutcome): Promise<void> {
    const configuration = vscode.workspace.getConfiguration("localAgentCompanion");
    const mode = parseCompletionNotificationMode(configuration.get("completionNotifications"));
    const notification = completionNotification(mode, Boolean(this.view?.visible), outcome);
    if (!notification) return;
    if (this.view) {
      this.view.badge = { value: 1, tooltip: notification.message };
    }
    const selection = notification.level === "warning"
      ? await vscode.window.showWarningMessage(notification.message, notification.action)
      : await vscode.window.showInformationMessage(notification.message, notification.action);
    if (selection !== notification.action) return;
    await vscode.commands.executeCommand("workbench.view.extension.localAgentCompanion");
    this.reveal();
  }

  private async retry(mode: RunMode): Promise<void> {
    try {
      const snapshot = await this.agent.threadSnapshot();
      const pending = snapshot.messages.at(-1);
      if (!pending || pending.role !== "user") {
        this.post({ type: "threadError", message: "There is no unfinished request to retry in this thread." });
        this.post({ type: "busy", value: false });
        return;
      }
      await this.send(pending.content, mode, true);
    } catch (error) {
      this.post({
        type: "error",
        message: await this.safeError(error),
        recoverable: false
      });
      this.post({ type: "busy", value: false });
    }
  }

  private async discardRecovery(threadId: string, messageId: string): Promise<void> {
    try {
      await this.assertThreadEditable();
      const snapshot = await this.agent.threadSnapshot();
      const pending = snapshot.messages.at(-1);
      if (snapshot.activeThreadId !== threadId || !pending || pending.role !== "user" || pending.id !== messageId) {
        throw new Error("There is no unfinished request to discard in this thread.");
      }
      const confirmation = await vscode.window.showWarningMessage(
        "Discard this unfinished request from the conversation?",
        {
          modal: true,
          detail: "Completed earlier messages stay in the thread. Files, commands, or memory updates already made by the interrupted run are not reverted; review that run separately if needed."
        },
        "Discard request"
      );
      if (confirmation !== "Discard request") {
        this.post({ type: "recoveryDiscardCancelled" });
        return;
      }
      await this.agent.discardRecovery(threadId, messageId);
      const [context, payload] = await Promise.all([this.contextState(), this.threadPayload()]);
      this.post({ type: "reset", context, ...payload });
      this.post({ type: "recoveryDiscarded", message: "Unfinished request discarded" });
    } catch (error) {
      this.post({ type: "recoveryDiscardError", message: await this.safeError(error) });
    }
  }

  private async forwardAgentEvent(event: AgentUiEvent): Promise<void> {
    if (event.type === "assistant") {
      const assistantMessage: ChatMessage = {
        id: event.id,
        role: "assistant",
        text: event.text,
        html: renderSafeMarkdown(event.text),
        createdAt: event.createdAt,
        completedAt: event.completedAt,
        runId: event.runId,
        status: "complete"
      };
      this.post({ type: "assistant", message: assistantMessage });
      return;
    }
    if (event.type === "error") {
      this.post({ ...event, message: redactSensitiveText(event.message) });
      return;
    }
    if (event.type === "activity") {
      this.post({
        ...event,
        title: redactSensitiveText(event.title),
        ...(event.detail ? { detail: redactSensitiveText(event.detail) } : {})
      });
      return;
    }
    if (event.type === "contextReceipt") {
      const sensitiveValues = await this.storedModelSecrets();
      this.post({
        ...event,
        receipt: {
          ...event.receipt,
          ...(event.receipt.activeFile
            ? { activeFile: redactSensitiveText(event.receipt.activeFile, sensitiveValues) }
            : {}),
          guidanceFiles: event.receipt.guidanceFiles.map((file) => redactSensitiveText(file, sensitiveValues)),
          pinnedSources: event.receipt.pinnedSources.map((source) => ({
            ...source,
            filename: redactSensitiveText(source.filename, sensitiveValues)
          }))
        }
      });
      return;
    }
    if (event.type === "done") {
      this.post({ type: "busy", value: false });
    }
    this.post(event);
  }

  private async memoryPayload() {
    const configuration = vscode.workspace.getConfiguration("localAgentCompanion");
    const [snapshot, storedSecrets] = await Promise.all([
      this.memory.snapshot(),
      this.storedModelSecrets()
    ]);
    const embeddingModel = configuration.get<string>("embeddingModel", "").trim();
    const semantic = configuration.get<boolean>("semanticMemoryEnabled", true) && Boolean(embeddingModel);
    return {
      entries: snapshot.entries.map((entry) => {
        const text = redactSensitiveText(entry.text, storedSecrets);
        return { ...entry, text, redacted: text !== entry.text };
      }),
      total: snapshot.total,
      omitted: snapshot.omitted,
      semantic,
      embeddingModel: semantic ? embeddingModel : ""
    };
  }

  private async postMemoryState(message = ""): Promise<void> {
    try {
      this.post({ type: "memoryState", memory: await this.memoryPayload(), message });
    } catch (error) {
      this.post({ type: "memoryActionError", message: await this.safeError(error) });
    }
  }

  private async addMemoryEntry(): Promise<void> {
    try {
      await this.assertMemoryEditable();
      const storedSecrets = await this.storedModelSecrets();
      const note = await vscode.window.showInputBox({
        title: "Add durable project memory",
        prompt: "Save only a confirmed decision, fact, or convention. This writes to .local-agent/memory.md.",
        ignoreFocusOut: true,
        validateInput: (value) => this.validateMemoryEntry(value, storedSecrets)
      });
      if (note === undefined) return;
      await this.assertMemoryEditable();
      await this.memory.append(note);
      await this.postMemoryState("Memory entry added");
      this.postContextState();
      this.post({ type: "toast", message: "Durable project memory updated" });
    } catch (error) {
      this.post({ type: "memoryActionError", message: await this.safeError(error) });
    }
  }

  private async editMemoryEntry(id: string): Promise<void> {
    try {
      await this.assertMemoryEditable();
      const [snapshot, storedSecrets] = await Promise.all([
        this.memory.snapshot(),
        this.storedModelSecrets()
      ]);
      const entry = snapshot.entries.find((candidate) => candidate.id === id);
      if (!entry) throw new Error("This memory entry changed or no longer exists. Refresh and try again.");
      const redacted = redactSensitiveText(entry.text, storedSecrets) !== entry.text;
      const note = await vscode.window.showInputBox({
        title: "Edit durable project memory",
        prompt: redacted
          ? "The existing entry contains redacted credential-like text. Enter a complete safe replacement."
          : "Keep the entry concise, durable, and verifiable.",
        value: redacted ? "" : entry.text,
        ignoreFocusOut: true,
        validateInput: (value) => this.validateMemoryEntry(value, storedSecrets)
      });
      if (note === undefined) return;
      await this.assertMemoryEditable();
      await this.memory.replaceEntry(id, note);
      await this.postMemoryState("Memory entry updated");
      this.postContextState();
    } catch (error) {
      this.post({ type: "memoryActionError", message: await this.safeError(error) });
    }
  }

  private async deleteMemoryEntry(id: string): Promise<void> {
    try {
      await this.assertMemoryEditable();
      const snapshot = await this.memory.snapshot();
      const entry = snapshot.entries.find((candidate) => candidate.id === id);
      if (!entry) throw new Error("This memory entry changed or no longer exists. Refresh and try again.");
      const confirmation = await vscode.window.showWarningMessage(
        "Delete this durable project-memory entry?",
        {
          modal: true,
          detail: `${entry.date ? `Saved ${entry.date}. ` : ""}This updates .local-agent/memory.md and cannot be undone by the memory center.`
        },
        "Delete memory"
      );
      if (confirmation !== "Delete memory") return;
      await this.assertMemoryEditable();
      await this.memory.deleteEntry(id);
      await this.postMemoryState("Memory entry deleted");
      this.postContextState();
    } catch (error) {
      this.post({ type: "memoryActionError", message: await this.safeError(error) });
    }
  }

  private validateMemoryEntry(value: string, storedSecrets: string[]): string | undefined {
    if (!value.trim()) return "Enter a durable decision, fact, or convention.";
    if (value.length > 4_000) return "Keep one memory entry under 4,000 characters.";
    if (redactSensitiveText(value, storedSecrets) !== value) {
      return "Remove credentials, tokens, passwords, or private-key material before saving.";
    }
    return undefined;
  }

  private async assertMemoryEditable(): Promise<void> {
    if (this.agent.running || await this.agent.externalRunActive()) {
      throw new Error("Wait for the active agent run to finish before changing project memory.");
    }
  }

  private async assertProviderConfigurationEditable(): Promise<void> {
    if (this.agent.running || await this.agent.externalRunActive()) {
      throw new Error("Wait for the active agent run to finish before changing provider configuration.");
    }
  }

  private async assertThreadEditable(): Promise<void> {
    if (this.agent.running || await this.agent.externalRunActive()) {
      throw new Error("Wait for the active agent run to finish before changing conversations.");
    }
  }

  private async openChangeDiff(changeId: string): Promise<void> {
    try {
      await this.changeReview.openDiff(changeId);
    } catch (error) {
      this.post({
        type: "changeActionError",
        id: changeId,
        message: await this.safeError(error)
      });
    }
  }

  private async restoreChange(changeId: string): Promise<void> {
    try {
      await this.assertChangeReviewEditable();
      const change = this.changeReview.change(changeId);
      const action = change.kind === "created"
        ? "Remove the file created by this run"
        : change.kind === "deleted"
          ? "Recreate the file deleted by this run"
          : "Restore the file to its content before this run";
      const confirmation = await vscode.window.showWarningMessage(
        `${action}?`,
        {
          modal: true,
          detail: `${change.path}\n\nThe operation is refused if the file changed after the run.`
        },
        "Restore file"
      );
      if (confirmation !== "Restore file") return;
      const restored = await this.changeReview.restore(changeId);
      this.post({
        type: "changeRestored",
        change: restored.item,
        warning: this.restoreSaveWarning(restored.unsavedPaths)
      });
    } catch (error) {
      this.post({
        type: "changeActionError",
        id: changeId,
        message: await this.safeError(error)
      });
    }
  }

  private async restoreRunChanges(runId: string, changeIds: string[]): Promise<void> {
    try {
      await this.assertChangeReviewEditable();
      const changes = changeIds.map((id) => this.changeReview.change(id));
      const pending = changes.filter((change) => !change.restored);
      if (!pending.length) {
        this.post({ type: "runChangesRestored", runId, changes });
        return;
      }
      const visiblePaths = pending.slice(0, 10).map((change) => `• ${change.path}`).join("\n");
      const remaining = pending.length > 10 ? `\n• …and ${pending.length - 10} more` : "";
      const confirmation = await vscode.window.showWarningMessage(
        `Undo all ${pending.length} tracked file change${pending.length === 1 ? "" : "s"} from this run?`,
        {
          modal: true,
          detail: `${visiblePaths}${remaining}\n\nThis restores file contents only; commands and memory updates are not reversed. The operation is refused if any file changed after the run.`
        },
        "Undo file changes"
      );
      if (confirmation !== "Undo file changes") {
        this.post({ type: "runRestoreCancelled", runId });
        return;
      }
      const restored = await this.changeReview.restoreRun(changeIds);
      this.post({
        type: "runChangesRestored",
        runId,
        changes: restored.items,
        warning: this.restoreSaveWarning(restored.unsavedPaths)
      });
    } catch (error) {
      this.post({
        type: "runChangeActionError",
        runId,
        message: await this.safeError(error)
      });
    }
  }

  private async assertChangeReviewEditable(): Promise<void> {
    if (this.agent.running || await this.agent.externalRunActive()) {
      throw new Error("Wait for the active agent run to finish before restoring files.");
    }
  }

  private restoreSaveWarning(paths: string[]): string | undefined {
    if (!paths.length) return undefined;
    const visible = paths.slice(0, 3).join(", ");
    const remaining = paths.length > 3 ? `, and ${paths.length - 3} more` : "";
    return `The content was restored in the editor, but ${paths.length} file${paths.length === 1 ? "" : "s"} could not be saved (${visible}${remaining}). Save the open document${paths.length === 1 ? "" : "s"} manually before closing VS Code.`;
  }

  private async safeError(error: unknown, transientSecret = ""): Promise<string> {
    return safeErrorMessage(error, [...await this.storedModelSecrets(), transientSecret]);
  }

  private async storedModelSecrets(): Promise<string[]> {
    const names = [modelProviderSecret("litellm"), modelProviderSecret("openai")]
      .filter((name): name is string => Boolean(name));
    const values = await Promise.all(names.map((name) => this.extensionContext.secrets.get(name)));
    return values.filter((value): value is string => Boolean(value));
  }

  private async threadPayload() {
    const [snapshot, externalRunActive, goals] = await Promise.all([
      this.agent.threadSnapshot(),
      this.agent.externalRunActive(),
      this.agent.listGoals()
    ]);
    const validThreadIds = new Set(snapshot.threads.map((thread) => thread.id));
    const drafts = this.drafts();
    let pruned = false;
    for (const threadId of Object.keys(drafts)) {
      if (validThreadIds.has(threadId)) continue;
      delete drafts[threadId];
      pruned = true;
    }
    if (pruned) await this.extensionContext.workspaceState.update(DRAFTS_KEY, drafts);
    return {
      activeThreadId: snapshot.activeThreadId,
      threads: snapshot.threads,
      history: this.threadMessages(snapshot),
      draft: drafts[snapshot.activeThreadId] ?? "",
      autonomyMode: this.autonomyMode(),
      responseLanguage: parseResponseLanguage(vscode.workspace.getConfiguration("localAgentCompanion").get("responseLanguage")),
      recovery: snapshot.recovery,
      remoteRunActive: externalRunActive || (
        !this.agent.running && snapshot.threads.some((thread) => thread.recoveryStatus === "running")
      ),
      goals
    };
  }

  private autonomyMode(): RunMode {
    return parseRunMode(
      vscode.workspace.getConfiguration("localAgentCompanion").get("autonomyMode")
    );
  }

  private async selectAutonomy(value: RunMode): Promise<void> {
    const mode = parseRunMode(value);
    await vscode.workspace
      .getConfiguration("localAgentCompanion")
      .update("autonomyMode", mode, vscode.ConfigurationTarget.Workspace);
  }

  private async selectResponseLanguage(value: unknown): Promise<void> {
    try {
      await this.assertProviderConfigurationEditable();
      const language = parseResponseLanguage(value);
      await vscode.workspace.getConfiguration("localAgentCompanion").update("responseLanguage", language, vscode.ConfigurationTarget.Workspace);
      this.post({ type: "responseLanguageChanged", language, message: language === "en" ? "Agent language set to English" : "Idioma do agente definido como português do Brasil" });
    } catch (error) {
      this.post({ type: "responseLanguageChangeError", language: parseResponseLanguage(vscode.workspace.getConfiguration("localAgentCompanion").get("responseLanguage")), message: await this.safeError(error) });
    }
  }

  private drafts(): Record<string, string> {
    if (this.draftCache) return this.draftCache;
    const stored = this.extensionContext.workspaceState.get<unknown>(DRAFTS_KEY);
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
      this.draftCache = {};
      return this.draftCache;
    }
    this.draftCache = Object.fromEntries(
      Object.entries(stored)
        .filter((entry): entry is [string, string] => typeof entry[1] === "string")
        .map(([threadId, draft]) => [threadId, draft.slice(0, MAX_DRAFT_CHARACTERS)])
    );
    return this.draftCache;
  }

  private async saveDraft(threadId: string, text: string): Promise<void> {
    const snapshot = await this.agent.threadSnapshot();
    if (!snapshot.threads.some((thread) => thread.id === threadId)) return;
    const drafts = this.drafts();
    const bounded = text.slice(0, MAX_DRAFT_CHARACTERS);
    if (bounded) drafts[threadId] = bounded;
    else delete drafts[threadId];
    await this.extensionContext.workspaceState.update(DRAFTS_KEY, drafts);
  }

  private async discardDraft(threadId: string): Promise<void> {
    const drafts = this.drafts();
    if (!(threadId in drafts)) return;
    delete drafts[threadId];
    await this.extensionContext.workspaceState.update(DRAFTS_KEY, drafts);
  }

  private async migrateLegacyHistory(): Promise<void> {
    const legacy = this.extensionContext.workspaceState.get<unknown>(LEGACY_HISTORY_KEY);
    if (legacy === undefined) return;
    await this.agent.migrateLegacyHistory(legacy);
    await this.extensionContext.workspaceState.update(LEGACY_HISTORY_KEY, undefined);
  }

  private threadMessages(snapshot: ThreadSnapshot): ChatMessage[] {
    return snapshot.messages.map((message) => ({
      id: message.id,
      role: message.role,
      text: message.content,
      html: renderSafeMarkdown(message.content),
      createdAt: message.createdAt,
      ...(message.runId ? { runId: message.runId } : {}),
      status: message.status ?? "complete",
      ...(message.completedAt !== undefined ? { completedAt: message.completedAt } : {})
    }));
  }

  private activeFileLabel(): string | undefined {
    const editor = vscode.window.activeTextEditor;
    return editor ? vscode.workspace.asRelativePath(editor.document.uri) : undefined;
  }

  private async contextState() {
    const configuration = vscode.workspace.getConfiguration("localAgentCompanion");
    const autoContext = configuration.get<boolean>("autoContext", true);
    const maximumCharacters = configuration.get<number>("maxContextCharacters", 24_000);
    const semanticMemoryEnabled = configuration.get<boolean>("semanticMemoryEnabled", true);
    const embeddingModel = configuration.get<string>("embeddingModel", "").trim();
    const [budget, memoryText] = await Promise.all([
      this.collector.preview(maximumCharacters, autoContext).catch(() => ({
        maximumCharacters,
        usedCharacters: 0,
        estimatedTokens: 0,
        utilizationPercent: 0,
        automaticCharacters: 0,
        guidanceCharacters: 0,
        guidanceFiles: 0,
        guidancePaths: [],
        pinnedCharacters: 0,
        truncated: false
      })),
      this.memory.read(200_000).catch(() => "")
    ]);
    const durableMemory = memoryChunks(memoryText).join("\n");
    const activeFile = this.activeFileLabel();
    return {
      activeFile,
      activeFileSensitive: Boolean(activeFile && isSensitiveWorkspacePath(activeFile)),
      autoContext,
      pinned: this.collector.pinnedContext(),
      budget,
      memory: {
        characters: durableMemory.length,
        estimatedTokens: estimateContextTokens(durableMemory.length),
        mode: semanticMemoryEnabled && embeddingModel ? "semantic" : "recent",
        maximumResults: configuration.get<number>("semanticMemoryResults", 5),
        configured: Boolean(durableMemory)
      }
    };
  }

  private postContextState(): void {
    void this.contextState().then((context) => this.post({ type: "contextState", context }));
  }

  private post(message: unknown): void {
    void this.view?.webview.postMessage(message);
  }

  private html(webview: vscode.Webview): string {
    const nonce = crypto.randomUUID().replaceAll("-", "");
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';" />
  <style nonce="${nonce}">${styles}</style>
</head>
<body>
  <main class="shell">
    <header class="topbar">
      <div>
        <div class="eyebrow">LOCAL / DEVELOPMENT</div>
        <h1>Companion</h1>
      </div>
      <div class="topbar-actions">
        <button class="icon-button mcp-control" id="mcp-connections" type="button" title="Corporate MCP connections" aria-label="Manage corporate MCP connections" aria-pressed="false">
          <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M7 3.25v4M13 3.25v4M5.25 7.25h9.5v1.25A4.75 4.75 0 0 1 10 13.25v3.5M7.25 16.75h5.5"></path></svg>
        </button>
        <button class="icon-button browser-control" id="browser-control" type="button" title="Browser control off — click to enable access to localhost apps" aria-label="Enable local browser control" aria-pressed="false">
          <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><rect x="2.75" y="3.75" width="14.5" height="12.5" rx="2"></rect><path d="M3 7.25h14"></path><circle cx="5.25" cy="5.55" r=".65"></circle><circle cx="7.35" cy="5.55" r=".65"></circle></svg>
        </button>
        <button class="icon-button browser-live-control" id="browser-live-control" type="button" title="Live browser off" aria-label="Enable live browser" aria-pressed="false">◉</button>
        <button class="icon-button" id="threads-toggle" title="Local threads" aria-label="Local threads" aria-expanded="false" aria-controls="thread-panel">☷</button>
        <button class="icon-button" id="new-thread" title="New thread" aria-label="New thread">＋</button>
      </div>
    </header>

    <div class="top-drawers" id="top-drawers">
      <section class="thread-panel hidden" id="thread-panel" role="region" aria-labelledby="thread-panel-title" aria-hidden="true">
        <div class="settings-heading">
          <div>
            <div class="section-label">LOCAL THREADS</div>
            <h2 id="thread-panel-title" tabindex="-1">Conversations</h2>
          </div>
          <button class="icon-button settings-close" id="threads-close" title="Close threads" aria-label="Close threads">×</button>
        </div>
        <label class="thread-search">
          <span class="sr-only">Search conversations</span>
          <input id="thread-search" type="search" autocomplete="off" placeholder="Search conversations" />
        </label>
        <div class="thread-list" id="thread-list"></div>
        <p class="thread-note" id="thread-note">Stored only in this VS Code workspace.</p>
      </section>

      <section class="memory-panel hidden" id="memory-panel" role="region" aria-labelledby="memory-panel-title" aria-hidden="true">
        <div class="settings-heading">
          <div>
            <div class="section-label">PROJECT MEMORY</div>
            <h2 id="memory-panel-title" tabindex="-1">Durable knowledge</h2>
          </div>
          <button class="icon-button settings-close" id="memory-close" title="Close memory center" aria-label="Close memory center">×</button>
        </div>
        <div class="memory-overview" id="memory-overview" role="status" aria-live="polite">Loading local memory…</div>
        <div class="memory-list" id="memory-list"></div>
        <div class="memory-actions">
          <button class="primary-action" id="memory-add" type="button">Add memory</button>
          <button class="secondary-action" id="memory-open-file" type="button">Open memory.md</button>
        </div>
        <p class="thread-note">Entries stay in <code>.local-agent/memory.md</code>. Semantic vectors refresh automatically on the next retrieval.</p>
      </section>

      <section class="brief-panel hidden" id="brief-panel" role="region" aria-labelledby="brief-panel-title" aria-hidden="true">
        <div class="settings-heading">
          <div>
            <div class="section-label">TASK BRIEF</div>
            <h2 id="brief-panel-title" tabindex="-1">Structure your request</h2>
          </div>
          <button class="icon-button settings-close" id="brief-close" title="Close task brief" aria-label="Close task brief">×</button>
        </div>
        <p class="brief-intro">Add only what you know. The result becomes an editable local draft and is never sent automatically.</p>
        <label class="brief-field">
          <span>Objective <small>required</small></span>
          <textarea id="brief-objective" rows="2" maxlength="4000" placeholder="What should be different when the work is finished?"></textarea>
        </label>
        <label class="brief-field">
          <span>Scope <small>optional</small></span>
          <textarea id="brief-scope" rows="2" maxlength="2000" placeholder="Relevant feature, folder, screen, or behavior"></textarea>
        </label>
        <label class="brief-field">
          <span>Done when <small>optional</small></span>
          <textarea id="brief-done" rows="2" maxlength="2000" placeholder="Observable acceptance criteria or checks"></textarea>
        </label>
        <label class="brief-field">
          <span>Constraints <small>optional</small></span>
          <textarea id="brief-constraints" rows="2" maxlength="2000" placeholder="Compatibility, security, files to avoid, or other limits"></textarea>
        </label>
        <p class="settings-error hidden" id="brief-error" role="alert"></p>
        <div class="brief-actions">
          <button class="secondary-action" id="brief-clear" type="button">Clear</button>
          <button class="primary-action" id="brief-use" type="button">Use in message</button>
        </div>
      </section>

      <section class="run-review-panel hidden" id="run-review-panel" role="region" aria-labelledby="run-review-title" aria-hidden="true">
        <div class="settings-heading">
          <div>
            <div class="section-label">RUN REVIEW</div>
            <h2 id="run-review-title" tabindex="-1">Execution evidence</h2>
          </div>
          <button class="icon-button settings-close" id="run-review-close" title="Close run review" aria-label="Close run review">×</button>
        </div>
        <div id="run-review-content"></div>
      </section>

      <section class="settings-panel hidden" id="litellm-settings" role="region" aria-labelledby="litellm-settings-title" aria-hidden="true">
      <div class="settings-heading">
        <div>
          <div class="section-label" id="provider-section-label">MODEL PROVIDER</div>
          <h2 id="litellm-settings-title" tabindex="-1">Connection</h2>
        </div>
        <button class="icon-button settings-close" id="litellm-close" title="Close settings" aria-label="Close settings">×</button>
      </div>
      <div class="connection-readiness" id="connection-readiness" role="status" aria-live="polite" aria-atomic="true">
        <span class="readiness-signal" id="readiness-signal" aria-hidden="true"></span>
        <span>
          <strong id="readiness-title">Setup required</strong>
          <small id="readiness-detail">Add the gateway, model alias and key.</small>
        </span>
      </div>
      <nav class="setup-progress" aria-label="Connection setup steps">
        <button type="button" data-setup-step-target="1" aria-current="step"><span>1</span>Gateway</button>
        <button type="button" data-setup-step-target="2"><span>2</span>Models</button>
        <button type="button" data-setup-step-target="3"><span>3</span>Verify</button>
      </nav>
      <section class="setup-step" data-setup-step="1" aria-labelledby="setup-step-gateway-title">
        <div class="setup-step-heading">
          <div class="section-label">STEP 1 OF 3</div>
          <h3 id="setup-step-gateway-title" tabindex="-1">Connect the provider</h3>
          <p id="provider-setup-note">Use the approved route and keep credentials in VS Code Secret Storage.</p>
        </div>
        <label class="field" id="model-provider-field">
          <span>Provider</span>
          <select id="model-provider"></select>
          <small id="provider-variant-note"></small>
        </label>
        <label class="field">
          <span id="provider-endpoint-label">Gateway Base URL</span>
          <input id="litellm-endpoint" type="url" autocomplete="off" spellcheck="false" placeholder="https://gateway.example.com/v1 or …/chat/completions" />
        </label>
        <label class="field" id="auth-header-field">
          <span>Key Header</span>
          <select id="litellm-auth-header">
            <option value="authorization">Authorization: Bearer</option>
            <option value="api-key">api-key</option>
            <option value="ocp-apim-subscription-key">Ocp-Apim-Subscription-Key</option>
          </select>
        </label>
        <label class="field" id="provider-key-field">
          <span id="provider-key-label">Provider Key <small id="litellm-key-state"></small></span>
          <input id="litellm-api-key" type="password" autocomplete="new-password" placeholder="Leave blank to keep the stored key" />
        </label>
      </section>
      <section class="setup-step" data-setup-step="2" aria-labelledby="setup-step-models-title" hidden>
        <div class="setup-step-heading">
          <div class="section-label">STEP 2 OF 3</div>
          <h3 id="setup-step-models-title" tabindex="-1">Choose the models</h3>
          <p>Load the optional catalog or enter the exact aliases supplied by your gateway administrator.</p>
        </div>
        <div class="field" id="model-catalog-field">
          <label for="litellm-models-endpoint">Models URL <small>optional</small></label>
          <div class="input-action">
            <input id="litellm-models-endpoint" type="url" autocomplete="off" spellcheck="false" placeholder="https://gateway.example.com/models" />
            <button class="secondary-action" id="litellm-load-models">Load</button>
          </div>
        </div>
        <div class="field hidden" id="ollama-model-discovery">
          <span>Local Ollama Models</span>
          <div class="input-action">
            <button class="secondary-action" id="ollama-load-models">List local models</button>
            <small>Equivalent to <code>ollama list</code>; only this machine is queried.</small>
          </div>
        </div>
        <label class="field">
          <span>Chat Model Alias</span>
          <input id="litellm-model" type="text" list="litellm-model-aliases" autocomplete="off" spellcheck="false" placeholder="company-coding-model" />
          <datalist id="litellm-model-aliases"></datalist>
        </label>
        <label class="field">
          <span>Vision / OCR Model <small>optional</small></span>
          <input id="vision-model" type="text" list="litellm-model-aliases" autocomplete="off" spellcheck="false" placeholder="Use chat model for images" />
          <small>Use an alias with Chat Completions image/OCR support for pasted images and browser screenshots.</small>
        </label>
        <div class="model-compatibility hidden" id="model-compatibility" role="status" aria-live="polite" aria-atomic="true">
          <span class="model-compatibility-signal" aria-hidden="true"></span>
          <span class="model-compatibility-copy"><strong id="model-compatibility-title"></strong><small id="model-compatibility-detail"></small></span>
        </div>
        <details class="advanced-settings" id="advanced-settings">
          <summary>Advanced model settings</summary>
          <label class="field">
            <span>Compatibility profile</span>
            <select id="litellm-model-preset">
              <option value="auto">Auto-detect from alias</option>
              <option value="gpt-6-chat-tools">GPT-6 Sol / Luna · Chat tools</option>
              <option value="gpt-6-responses-tools">GPT-6 Astra / 6.1 Sol</option>
              <option value="gpt-5.6">GPT-5.6 family</option>
              <option value="gpt-5-reasoning">GPT-5.2–5.5 reasoning</option>
              <option value="gpt-standard">GPT-4 / 4o standard</option>
              <option value="claude-modern">Claude 4.7+ / Claude 5</option>
              <option value="claude-4.6">Claude 4.6 adaptive thinking</option>
              <option value="claude-legacy">Claude 4.5 or earlier</option>
              <option value="custom">Custom / gateway-defined</option>
            </select>
          </label>
          <label class="field">
            <span>Reasoning effort</span>
            <select id="litellm-reasoning-effort">
              <option value="omit">Omit from request</option>
              <option value="none">none · function tools compatibility</option>
              <option value="minimal">minimal</option>
              <option value="low">low</option>
              <option value="medium">medium</option>
              <option value="high">high</option>
              <option value="xhigh">xhigh</option>
              <option value="max">max</option>
            </select>
          </label>
          <div class="field-grid">
            <label class="field">
              <span>Temperature <small>optional</small></span>
              <input id="litellm-temperature" type="number" step="any" inputmode="decimal" placeholder="Omit" />
            </label>
            <label class="field">
              <span>Top P <small>optional</small></span>
              <input id="litellm-top-p" type="number" min="0" max="1" step="any" inputmode="decimal" placeholder="Omit" />
            </label>
          </div>
          <p class="settings-note" id="litellm-capabilities"></p>
        </details>
        <div class="section-label settings-subheading">SEMANTIC MEMORY · LOCAL CHROMADB</div>
        <label class="toggle-field">
          <input id="semantic-memory-enabled" type="checkbox" />
          <span>Retrieve relevant project memory with embeddings</span>
        </label>
        <label class="field">
          <span>Embedding Model <small>optional</small></span>
          <input id="embedding-model" type="text" list="embedding-model-aliases" autocomplete="off" spellcheck="false" placeholder="Disabled · use memory.md only" />
          <datalist id="embedding-model-aliases"></datalist>
        </label>
        <label class="field">
          <span>Embeddings base URL <small>optional</small></span>
          <input id="embedding-endpoint" type="url" autocomplete="off" spellcheck="false" placeholder="https://gateway/.../litellm/something" />
          <small>Informe somente o prefixo antes de <code>/model/embeddings</code>. O alias selecionado será inserido automaticamente no caminho e no corpo.</small>
        </label>
        <p class="settings-note" id="embedding-provider-note">The selected provider is used for chat and embeddings. Vectors and Chroma data stay on this machine.</p>
      </section>
      <section class="setup-step" data-setup-step="3" aria-labelledby="setup-step-verify-title" hidden>
        <div class="setup-step-heading">
          <div class="section-label">STEP 3 OF 3</div>
          <h3 id="setup-step-verify-title" tabindex="-1">Verify and save</h3>
          <p>Run a read-only check before keeping these settings.</p>
        </div>
        <p class="settings-note" id="litellm-details"></p>
        <div class="connection-diagnostics hidden" id="connection-diagnostics" role="status" aria-live="polite" aria-atomic="true"></div>
      </section>
      <p class="settings-error hidden" id="litellm-settings-error" role="alert"></p>
      <div class="profile-actions" id="profile-actions">
        <button class="secondary-action" id="profile-import" type="button">Import profile</button>
        <button class="secondary-action" id="profile-export" type="button">Export profile</button>
        <button class="secondary-action" id="support-export" type="button">Export support</button>
        <small>Keys and CA certificates are never included in profile files. Support bundles also omit endpoints, aliases, chats, paths, commands and filenames.</small>
      </div>
      <div class="settings-actions">
        <button class="secondary-action" id="litellm-advanced">Corporate CA…</button>
        <button class="secondary-action hidden" id="setup-back">Back</button>
        <span class="setup-step-count" id="setup-step-count">Step 1 of 3</span>
        <button class="primary-action" id="setup-next">Next</button>
        <button class="secondary-action hidden" id="litellm-test">Test connection</button>
        <button class="primary-action hidden" id="litellm-save">Save connection</button>
      </div>
      </section>
      <section class="setup-callout hidden" id="setup-callout" role="region" aria-labelledby="setup-callout-title">
        <span class="setup-callout-signal" aria-hidden="true"></span>
        <span class="setup-callout-copy">
          <strong id="setup-callout-title">Connect your LiteLLM gateway</strong>
          <small>Add the approved base URL, chat model alias and key before starting.</small>
        </span>
        <button type="button" id="setup-callout-action">Set up</button>
      </section>
    </div>

    <div class="conversation-stage">
      <section class="goal-strip hidden" id="goal-strip" aria-live="polite">
        <span class="signal" aria-hidden="true"></span><span id="goal-strip-text"></span>
        <button type="button" id="goal-details">Details</button>
        <button type="button" id="goal-edit">Edit</button>
        <button type="button" id="goal-open">Open</button>
        <button type="button" id="goal-resume" class="hidden">Resume</button>
      </section>
      <section class="goal-panel hidden" id="goal-panel" aria-labelledby="goal-panel-title">
        <div class="goal-panel-heading"><strong id="goal-panel-title">Persistent goal</strong><button type="button" id="goal-panel-close">Close</button></div>
        <p id="goal-objective"></p>
        <div class="goal-progress" id="goal-progress"></div>
        <div class="goal-criteria" id="goal-criteria"></div>
        <div class="goal-editor hidden" id="goal-editor">
          <label for="goal-criteria-input">Acceptance criteria (one per line)</label>
          <textarea id="goal-criteria-input" rows="5" maxlength="80000"></textarea>
          <div class="goal-editor-actions"><button type="button" id="goal-save-criteria">Save criteria</button><button type="button" id="goal-cancel-criteria">Cancel</button></div>
        </div>
        <p class="goal-next" id="goal-next"></p>
        <div class="goal-panel-actions"><button type="button" id="goal-pause">Pause</button><button type="button" id="goal-cancel">Cancel</button></div>
      </section>
      <section class="goal-workspace" id="goal-workspace" aria-labelledby="goal-workspace-title">
        <div class="goal-panel-heading"><strong id="goal-workspace-title">Goals do workspace</strong><span id="goal-workspace-count"></span></div>
        <div class="goal-list" id="goal-list"></div>
      </section>
      <section class="timeline" id="timeline" aria-label="Conversation">
        <div class="welcome" id="welcome">
          <div class="monogram">C</div>
          <h2>What would you like<br/>to accomplish?</h2>
          <p>Choose a starting point or write your own request. Suggested tasks only prepare an editable draft.</p>
          <div class="starters" aria-label="Suggested development tasks">
            <button type="button" data-prompt="Explain this project in plain language. Inspect the repository structure and the most relevant documentation, then describe what it does, its main parts, how they connect, and the safest place to start. Do not change files.">
              <span><strong>Understand this project</strong><small>Map the architecture in plain language</small></span><span class="starter-arrow" aria-hidden="true">→</span>
            </button>
            <button type="button" data-prompt="Investigate the current editor diagnostics and failing checks. Explain the likely cause, then propose the smallest safe correction and the checks that would prove it works.">
              <span><strong>Fix a problem</strong><small>Investigate diagnostics and failing checks</small></span><span class="starter-arrow" aria-hidden="true">→</span>
            </button>
            <button type="button" data-prompt="I want to implement this change: [describe the expected behavior]. Start by identifying any missing acceptance criteria, inspect the relevant code, and present a short plan before editing.">
              <span><strong>Implement a change</strong><small>Turn expected behavior into a safe plan</small></span><span class="starter-arrow" aria-hidden="true">→</span>
            </button>
            <button type="button" data-prompt="Review the current workspace changes for correctness, security, regressions, and missing tests. Do not modify files. Report findings by severity with precise file references.">
              <span><strong>Review current changes</strong><small>Find risks before committing</small></span><span class="starter-arrow" aria-hidden="true">→</span>
            </button>
          </div>
          <small class="starter-note">Nothing runs until you review the draft and press Send.</small>
        </div>
      </section>
      <button class="jump-latest hidden" id="jump-latest" type="button" aria-label="Jump to the latest conversation activity">Latest activity ↓</button>
    </div>

    <section class="activity-dock" id="activity-dock">
      <button class="presence" id="activity-toggle" type="button" aria-expanded="false" aria-controls="plan-panel" aria-disabled="true" title="Agent activity">
        <span class="signal" id="signal" aria-hidden="true"></span>
        <span class="presence-copy">
          <strong id="status" role="status" aria-live="polite" aria-atomic="true">Ready</strong>
          <small class="workspace" id="workspace"></small>
        </span>
        <span class="activity-meta" id="activity-meta"></span>
        <span class="activity-chevron" aria-hidden="true">⌃</span>
      </button>
      <button class="activity-cancel hidden" id="activity-cancel" type="button">Cancel run</button>
      <button class="browser-take-control hidden" id="browser-take-control" type="button" aria-pressed="false">Take control</button>
      <div class="plan" id="plan-panel" role="region" aria-labelledby="plan-title" aria-hidden="true">
        <div class="plan-heading">
          <div class="section-label" id="plan-title">RUN PROGRESS</div>
          <span id="plan-summary" aria-live="polite">Waiting for plan updates</span>
        </div>
        <ol id="plan-items"></ol>
        <div class="plan-latest hidden" id="plan-latest">
          <div class="section-label">LATEST ACTIVITY</div>
          <ol id="plan-activity-items"></ol>
        </div>
      </div>
    </section>

    <footer class="composer-wrap">
      <div class="context-inspector hidden" id="context-inspector" role="region" aria-labelledby="context-inspector-title" aria-hidden="true">
        <div class="context-inspector-heading">
          <span class="section-label" id="context-inspector-title">MESSAGE CONTEXT</span>
          <button class="context-clear" id="context-clear" type="button">Clear pinned</button>
        </div>
        <div class="context-budget-card">
          <div class="context-budget-copy">
            <strong id="context-budget-label">Calculating context…</strong>
            <small id="context-budget-detail">Only local estimates are shown.</small>
          </div>
          <div class="context-budget-track" id="context-budget-track" role="progressbar" aria-label="Workspace context budget" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
            <span id="context-budget-fill"></span>
          </div>
          <small id="prompt-token-estimate">Prompt · ~0 tokens</small>
        </div>
        <div class="context-entry" id="context-active-entry"></div>
        <div class="context-entry" id="context-guidance-entry"></div>
        <div class="pinned-context" id="pinned-context"></div>
        <div class="context-entry" id="context-memory-entry"></div>
        <p>Estimates use four characters per token. The provider reports exact usage after the run.</p>
      </div>
      <div class="context-row">
        <span class="context-actions">
          <button class="context-chip" id="context-toggle" type="button" aria-expanded="false" aria-controls="context-inspector">
            <span id="active-file">No active file</span>
            <span class="context-budget-chip" id="context-budget-chip"></span>
            <span class="context-count hidden" id="context-count"></span>
          </button>
          <button class="context-add" id="context-add-file" type="button" title="Add a workspace file to message context" aria-label="Add a workspace file to message context">＋ File</button>
        </span>
        <span class="utility-links"><button class="memory-link" id="brief" type="button" aria-expanded="false" aria-controls="brief-panel">Brief</button><button class="memory-link" id="litellm" type="button" aria-expanded="false" aria-controls="litellm-settings">LiteLLM</button><button class="memory-link" id="memory" type="button" aria-expanded="false" aria-controls="memory-panel">Memory</button></span>
      </div>
      <div class="composer">
        <div class="image-attachments hidden" id="image-attachments" aria-label="Attached images"></div>
        <textarea id="prompt" rows="3" aria-label="Message to the workspace agent" aria-describedby="composer-hint" placeholder="Ask about the code, request a change, or explore an idea…"></textarea>
        <div class="composer-actions">
          <details class="run-controls" id="run-controls">
            <summary aria-label="Configure how this request runs"><span id="run-controls-label">Ask first · Standard</span></summary>
            <div class="run-controls-panel" role="group" aria-label="Run setup">
              <div class="run-controls-heading"><strong>Run setup</strong><small>Saved for this workspace</small></div>
              <label class="run-control-field" for="runtime">
                <span>Agent</span>
                <select id="runtime" aria-describedby="runtime-help">
                  <option value="standard">Standard</option>
                  <option value="deep">Deep Agent</option>
                </select>
                <small id="runtime-help">Predictable for most development work.</small>
              </label>
              <label class="run-control-field" for="mode">
                <span>Changes</span>
                <select id="mode" aria-describedby="mode-help">
                  <option value="review">Ask first</option>
                  <option value="execute">Auto edits</option>
                  <option value="plan">Plan only</option>
                </select>
                <small id="mode-help">Confirm every workspace change and command.</small>
              </label>
              <label class="run-control-field" for="final-review-mode">
                <span>Final review</span>
                <select id="final-review-mode" aria-describedby="final-review-help">
                  <option value="changes">When work is performed</option>
                  <option value="always">Every executable run</option>
                  <option value="off">Off</option>
                </select>
                <small id="final-review-help">A separate model call reviews local evidence.</small>
              </label>
              <label class="run-control-field" for="response-language">
                <span>Language</span>
                <select id="response-language" aria-describedby="response-language-help">
                  <option value="pt-BR">Português</option>
                  <option value="en">English</option>
                </select>
                <small id="response-language-help">Keep agent explanations and goal updates in one language.</small>
              </label>
            </div>
          </details>
          <button class="cancel hidden" id="cancel" type="button">Cancel run</button>
          <button class="goal-button" id="goal" type="button" aria-label="Send the next message as a persistent goal" aria-pressed="false">Goal</button>
          <button class="send" id="send" type="button" aria-label="Send message">↑</button>
        </div>
      </div>
      <div class="hint" id="composer-hint">Enter to send · Shift+Enter for newline</div>
    </footer>
    <div class="sr-only" id="announcer" role="status" aria-live="polite" aria-atomic="true"></div>
  </main>
  <script nonce="${nonce}">${script}</script>
</body>
</html>`;
  }
}

const styles = String.raw`
:root { color-scheme: light dark; --accent: #d6ff45; --muted: var(--vscode-descriptionForeground); --line: color-mix(in srgb, var(--vscode-foreground) 14%, transparent); }
* { box-sizing: border-box; }
body { height: 100vh; margin: 0; overflow: hidden; color: var(--vscode-foreground); background: var(--vscode-sideBar-background); font: 13px/1.5 var(--vscode-font-family); }
button, textarea, select { font: inherit; }
button { color: inherit; }
.shell { height: 100vh; min-height: 0; overflow: hidden; display: grid; grid-template-rows: auto auto minmax(0, 1fr) auto auto; }
.topbar { display: flex; align-items: flex-start; justify-content: space-between; padding: 20px 18px 13px; border-bottom: 1px solid var(--line); }
.topbar-actions { display: flex; align-items: center; gap: 2px; }
.eyebrow, .section-label { color: var(--muted); font: 600 9px/1.2 var(--vscode-editor-font-family); letter-spacing: .16em; }
h1 { margin: 2px 0 0; font-size: 24px; line-height: 1; letter-spacing: -.045em; }
.icon-button { border: 0; background: transparent; width: 28px; height: 28px; border-radius: 50%; cursor: pointer; font-size: 18px; opacity: .7; transition: opacity .15s, background .15s; }
.icon-button:hover { opacity: 1; background: var(--vscode-toolbar-hoverBackground); }
.icon-button:disabled { cursor: default; opacity: .3; }
.browser-control { position: relative; display: grid; place-items: center; }
.browser-control svg, .mcp-control svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.35; stroke-linecap: round; stroke-linejoin: round; }
.mcp-control { position: relative; display: grid; place-items: center; }
.mcp-control[aria-pressed="true"] { color: var(--accent); opacity: 1; background: color-mix(in srgb, var(--accent) 11%, transparent); }
.mcp-control[aria-pressed="true"]::after { content: ''; position: absolute; right: 4px; bottom: 4px; width: 4px; height: 4px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 0 1px var(--vscode-sideBar-background); }
.mcp-control.attention::after { background: var(--vscode-editorWarning-foreground); }
.browser-control[aria-pressed="true"] { color: var(--accent); opacity: 1; background: color-mix(in srgb, var(--accent) 11%, transparent); }
.browser-live-control[aria-pressed="true"] { color: var(--accent); opacity: 1; background: color-mix(in srgb, var(--accent) 11%, transparent); }
.browser-live-control { font-size: 13px; }
.browser-control[aria-pressed="true"]::after { content: ''; position: absolute; right: 4px; bottom: 4px; width: 4px; height: 4px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 0 1px var(--vscode-sideBar-background); }
.browser-control.pending { opacity: .45; }
.activity-dock { min-height: 43px; border-top: 1px solid var(--line); background: var(--vscode-sideBar-background); position: relative; }
.presence { display: grid; grid-template-columns: 8px minmax(0, 1fr) auto 12px; align-items: center; gap: 9px; width: 100%; min-height: 42px; padding: 7px 18px; border: 0; color: var(--muted); background: transparent; text-align: left; font-size: 11px; }
.activity-dock.has-plan .presence { cursor: pointer; }
.activity-dock.has-plan .presence:hover { color: var(--vscode-foreground); background: var(--vscode-toolbar-hoverBackground); }
.presence:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: -2px; }
.presence-copy { display: grid; min-width: 0; gap: 1px; }
.presence-copy strong, .presence-copy small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.presence-copy strong { color: var(--vscode-foreground); font-size: 10px; font-weight: 650; }
.presence-copy small { color: var(--muted); font: 9px/1.35 var(--vscode-editor-font-family); }
.signal { width: 7px; height: 7px; border-radius: 50%; background: #6ddc72; box-shadow: 0 0 0 3px color-mix(in srgb, #6ddc72 16%, transparent); }
.signal.busy { background: var(--accent); animation: pulse 1.2s infinite; }
.activity-meta { color: var(--muted); font: 9px var(--vscode-editor-font-family); white-space: nowrap; }
.activity-chevron { width: 12px; opacity: 0; transform: rotate(0); transition: transform .16s, opacity .16s; }
.activity-dock.has-plan .activity-chevron { opacity: .7; }
.activity-dock.expanded .activity-chevron { transform: rotate(180deg); }
.plan { max-height: 0; overflow: hidden; padding: 0 18px; opacity: 0; background: color-mix(in srgb, var(--vscode-sideBar-background) 90%, var(--accent)); transition: max-height .2s ease, padding .2s ease, opacity .14s ease; }
.activity-dock.expanded .plan { max-height: min(38vh, 360px); overflow-y: auto; padding: 11px 18px 12px; opacity: 1; border-top: 1px solid var(--line); }
.activity-cancel { position: absolute; right: 34px; top: 8px; z-index: 2; border: 1px solid var(--vscode-editorWarning-foreground); border-radius: 4px; padding: 3px 7px; color: var(--vscode-editorWarning-foreground); background: transparent; cursor: pointer; font-size: 10px; }.activity-cancel:hover { background: color-mix(in srgb, var(--vscode-editorWarning-foreground) 12%, transparent); }.activity-cancel:disabled { opacity: .55; cursor: progress; }
.browser-take-control { position: absolute; right: 112px; top: 8px; z-index: 2; border: 1px solid var(--vscode-textLink-foreground); border-radius: 4px; padding: 3px 7px; color: var(--vscode-textLink-foreground); background: transparent; cursor: pointer; font-size: 10px; }.browser-take-control:hover { background: color-mix(in srgb, var(--vscode-textLink-foreground) 12%, transparent); }
.plan-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.plan-heading > span { overflow: hidden; color: var(--muted); font: 9px var(--vscode-editor-font-family); text-overflow: ellipsis; white-space: nowrap; }
.plan ol { list-style: none; margin: 9px 0 0; padding: 0; display: grid; gap: 7px; }
.plan li { position: relative; padding-left: 18px; color: var(--muted); font-size: 11px; }
.plan li::before { content: ''; position: absolute; left: 0; top: .45em; width: 7px; height: 7px; border: 1px solid currentColor; border-radius: 50%; }
.plan li.done { color: var(--vscode-foreground); text-decoration: line-through; opacity: .66; }
.plan li.done::before { background: var(--accent); border-color: var(--accent); }
.plan-latest { margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--line); }
.plan-latest ol { gap: 0; margin-top: 5px; }
.plan-latest li { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 7px; padding: 5px 0; border-bottom: 1px solid color-mix(in srgb, var(--line) 62%, transparent); font: 9px/1.4 var(--vscode-editor-font-family); }
.plan-latest li::before { display: none; }
.plan-latest li.approval { border-left: 2px solid var(--vscode-editorWarning-foreground); padding-left: 7px; }.plan-latest li.approval strong { color: var(--vscode-editorWarning-foreground); }
.plan-latest strong { color: var(--vscode-foreground); font: 650 8px/1.55 var(--vscode-font-family); letter-spacing: .07em; }
.plan-latest span { min-width: 0; overflow-wrap: anywhere; }
.execution-event { display: grid; grid-template-columns: 17px minmax(0, 1fr); gap: 5px; margin: 5px 14px; padding: 5px 8px; border-left: 2px solid var(--line); color: var(--muted); font-size: 10px; animation: reveal .14s ease-out; }.execution-event-heading { display: flex; align-items: baseline; grid-column: 2; gap: 6px; min-width: 0; }.execution-event-heading strong { color: var(--vscode-descriptionForeground); font: 650 8px var(--vscode-font-family); letter-spacing: .06em; }.execution-event-heading span { overflow-wrap: anywhere; }.execution-event-icon { display: grid; place-items: center; width: 16px; height: 16px; color: var(--vscode-descriptionForeground); font: 600 12px/1 var(--vscode-font-family); }.execution-event-signal { display: none; }.execution-event-detail { grid-column: 2; margin: 1px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; }.execution-event-detail a { color: var(--vscode-textLink-foreground); text-decoration: underline; }.execution-event-browser { border-left-color: var(--accent); }.execution-event-browser .execution-event-icon { color: var(--accent); }.execution-event-tool, .execution-event-command { border-left-color: var(--vscode-descriptionForeground); }.execution-event-approval { border-left-color: var(--vscode-editorWarning-foreground); }.execution-event-approval .execution-event-icon { color: var(--vscode-editorWarning-foreground); }.execution-event-memory .execution-event-icon { color: var(--vscode-charts-purple, var(--accent)); }
.thinking-event { margin: 7px 14px; padding: 0 8px; border-left: 2px solid color-mix(in srgb, var(--accent) 55%, var(--line)); color: var(--muted); font-size: 10px; animation: reveal .14s ease-out; }.thinking-event details { min-width: 0; }.thinking-event summary { display: flex; align-items: center; gap: 7px; padding: 5px 0; color: var(--vscode-descriptionForeground); cursor: pointer; list-style: none; }.thinking-event summary::-webkit-details-marker { display: none; }.thinking-event summary::before { content: '◇'; color: var(--accent); font-size: 13px; }.thinking-event summary::after { content: '⌄'; margin-left: auto; color: var(--muted); font-size: 10px; }.thinking-event details:not([open]) summary::after { content: '›'; }.thinking-event summary strong { font-weight: 600; }.thinking-event summary small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.thinking-event-body { display: grid; gap: 5px; padding: 1px 0 8px 20px; line-height: 1.45; }.thinking-event-body span { display: list-item; margin-left: 14px; }
.top-drawers { min-height: 0; }
.top-drawers.panel-open > .setup-callout { display: none; }
.setup-callout { display: grid; grid-template-columns: 8px minmax(0, 1fr) auto; align-items: center; gap: 9px; padding: 10px 18px; border-bottom: 1px solid var(--line); background: color-mix(in srgb, var(--vscode-sideBar-background) 96%, var(--accent)); }
.setup-callout-signal { width: 7px; height: 7px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 12%, transparent); }
.setup-callout-copy { display: grid; min-width: 0; gap: 1px; }
.setup-callout-copy strong { font-size: 10px; font-weight: 650; }
.setup-callout-copy small { color: var(--muted); font-size: 9px; line-height: 1.35; }
.setup-callout button { border: 0; border-radius: 4px; padding: 5px 7px; color: #111; background: var(--accent); cursor: pointer; font-size: 9px; font-weight: 650; }
.thread-panel { max-height: 48vh; overflow-y: auto; padding: 14px 18px 12px; border-bottom: 1px solid var(--line); background: color-mix(in srgb, var(--vscode-sideBar-background) 96%, var(--accent)); animation: reveal .16s ease-out; }
.thread-search { display: block; margin: 1px 0 9px; }
.thread-search input { width: 100%; border: 1px solid var(--line); border-radius: 4px; padding: 6px 8px; color: var(--vscode-input-foreground); background: var(--vscode-input-background); font-size: 10px; }
.thread-search input::placeholder { color: var(--vscode-input-placeholderForeground); }
.thread-list { display: grid; border-top: 1px solid var(--line); }
.thread-item { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; border-bottom: 1px solid var(--line); }
.thread-select { min-width: 0; padding: 9px 4px 9px 0; border: 0; color: var(--muted); background: transparent; cursor: pointer; text-align: left; }
.thread-select strong, .thread-select small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.thread-select strong { color: var(--vscode-foreground); font-size: 11px; font-weight: 500; }
.thread-unread-dot { display: inline-block; width: 6px; height: 6px; margin: 0 5px 1px 0; border-radius: 50%; background: var(--accent); box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 14%, transparent); }
.thread-select small { margin-top: 2px; font-size: 9px; }
.thread-item.active .thread-select { box-shadow: inset 2px 0 0 var(--accent); padding-left: 8px; }
.thread-actions { display: flex; align-items: center; opacity: .45; }
.thread-item:hover .thread-actions, .thread-item:focus-within .thread-actions, .thread-item.active .thread-actions { opacity: 1; }
.thread-actions button { display: grid; place-items: center; width: 22px; height: 22px; border: 0; border-radius: 4px; color: var(--muted); background: transparent; cursor: pointer; font-size: 12px; }
.thread-actions button:hover { color: var(--vscode-foreground); background: var(--vscode-toolbar-hoverBackground); }
.thread-actions button.pinned { color: var(--accent); opacity: 1; }
.thread-empty { padding: 18px 4px; border-bottom: 1px solid var(--line); color: var(--muted); text-align: center; font-size: 10px; }
.thread-note { margin: 9px 0 0; color: var(--muted); font-size: 9px; }
.memory-panel { max-height: 68vh; overflow-y: auto; padding: 14px 18px 14px; border-bottom: 1px solid var(--line); background: color-mix(in srgb, var(--vscode-sideBar-background) 96%, var(--accent)); animation: reveal .16s ease-out; }
.memory-overview { margin: 1px 0 9px; padding: 8px 0; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); color: var(--muted); font-size: 9px; }
.memory-list { display: grid; }
.memory-item { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; padding: 9px 0; border-bottom: 1px solid var(--line); }
.memory-item-copy { min-width: 0; }
.memory-item-copy p { margin: 0; color: var(--vscode-foreground); font-size: 10px; line-height: 1.45; white-space: pre-wrap; overflow-wrap: anywhere; }
.memory-item-copy small { display: block; margin-top: 3px; color: var(--muted); font-size: 9px; }
.memory-item-actions { display: flex; align-items: flex-start; gap: 2px; }
.memory-item-actions button { border: 0; border-radius: 4px; padding: 3px 5px; color: var(--muted); background: transparent; cursor: pointer; font-size: 9px; }
.memory-item-actions button:hover { color: var(--vscode-foreground); background: var(--vscode-toolbar-hoverBackground); }
.memory-empty { padding: 16px 0; color: var(--muted); text-align: center; font-size: 10px; }
.memory-actions { display: flex; align-items: center; gap: 6px; margin-top: 10px; }
.memory-actions button { font-size: 9px; }
.brief-panel { max-height: 72vh; overflow-y: auto; padding: 14px 18px 16px; border-bottom: 1px solid var(--line); background: color-mix(in srgb, var(--vscode-sideBar-background) 96%, var(--accent)); animation: reveal .16s ease-out; }
.brief-intro { margin: 0 0 9px; color: var(--muted); font-size: 10px; line-height: 1.45; }
.brief-field { display: grid; gap: 4px; margin-top: 9px; color: var(--vscode-foreground); font-size: 10px; }
.brief-field > span { font-weight: 600; }
.brief-field small { color: var(--muted); font-weight: 400; }
.brief-field textarea { min-height: 42px; max-height: 110px; padding: 7px 8px; border: 1px solid var(--line); border-radius: 4px; outline: 0; background: var(--vscode-input-background); font: 10px/1.4 var(--vscode-font-family); }
.brief-field textarea:focus { border-color: color-mix(in srgb, var(--accent) 62%, transparent); }
.brief-actions { display: flex; align-items: center; gap: 6px; margin-top: 12px; }
.run-review-panel { max-height: 68vh; overflow-y: auto; padding: 14px 18px 16px; border-bottom: 1px solid var(--line); background: color-mix(in srgb, var(--vscode-sideBar-background) 96%, var(--accent)); animation: reveal .18s ease-out; }
.run-review-overview { display: grid; grid-template-columns: 8px minmax(0, 1fr); align-items: start; gap: 9px; padding: 9px 0 11px; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
.run-review-signal { width: 7px; height: 7px; margin-top: 5px; border-radius: 50%; background: #6ddc72; }
.run-review-overview.failed .run-review-signal { background: var(--vscode-errorForeground); }
.run-review-overview.cancelled .run-review-signal { background: var(--vscode-disabledForeground); }
.run-review-copy { display: grid; min-width: 0; gap: 2px; }
.run-review-copy strong { font-size: 11px; font-weight: 650; }
.run-review-copy small, .run-review-stats { color: var(--muted); font-size: 9px; }
.run-review-stats { margin-top: 2px; font-family: var(--vscode-editor-font-family); }
.run-review-section { padding: 11px 0 3px; border-bottom: 1px solid var(--line); }
.run-review-section:last-child { border-bottom: 0; }
.run-review-section > .section-label { margin-bottom: 5px; }
.run-review-list { list-style: none; margin: 0; padding: 0; }
.run-review-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 7px; padding: 5px 0; color: var(--muted); font-size: 9px; }
.run-review-row + .run-review-row { border-top: 1px solid color-mix(in srgb, var(--line) 62%, transparent); }
.run-review-row-copy { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--vscode-editor-font-family); }
.run-review-row-copy strong { color: var(--vscode-foreground); font: 650 8px var(--vscode-font-family); letter-spacing: .07em; }
.run-review-row.done { color: var(--vscode-foreground); opacity: .65; }
.run-review-row.failed { color: var(--vscode-errorForeground); }
.run-review-output { grid-column: 1 / -1; width: 100%; }
.run-review-output summary { cursor: pointer; color: var(--muted); font-size: 9px; }
.run-review-output pre { max-height: 180px; overflow: auto; margin: 5px 0 0; padding: 7px; background: var(--vscode-textCodeBlock-background); white-space: pre-wrap; font: 9px/1.45 var(--vscode-editor-font-family); }
.run-review-actions { display: flex; align-items: center; gap: 5px; }
.run-review-actions button, .run-review-footer button { border: 0; border-radius: 4px; padding: 3px 5px; color: var(--muted); background: var(--vscode-button-secondaryBackground); cursor: pointer; font-size: 8px; }
.run-review-actions button:hover, .run-review-footer button:hover { color: var(--vscode-foreground); }
.run-review-actions button:disabled, .run-review-footer button:disabled { cursor: default; opacity: .55; }
.run-review-footer { display: flex; justify-content: flex-end; gap: 6px; padding-top: 10px; }
.run-review-footer .undo-run { margin-right: auto; color: var(--vscode-errorForeground); }
.settings-panel { max-height: 68vh; overflow-y: auto; padding: 14px 18px 16px; border-bottom: 1px solid var(--line); background: color-mix(in srgb, var(--vscode-sideBar-background) 96%, var(--accent)); animation: reveal .2s ease-out; }
.settings-heading { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 12px; }
.settings-heading h2 { margin: 3px 0 0; font-size: 16px; line-height: 1.1; letter-spacing: -.025em; }
.settings-close { margin-top: -5px; }
.connection-readiness { display: grid; grid-template-columns: 9px minmax(0, 1fr); align-items: start; gap: 9px; padding: 10px 0 11px; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
.connection-readiness > span:last-child { display: grid; gap: 1px; min-width: 0; }
.connection-readiness strong { font-size: 11px; font-weight: 650; }
.connection-readiness small { overflow: hidden; color: var(--muted); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
.readiness-signal { width: 7px; height: 7px; margin-top: 5px; border-radius: 50%; background: var(--vscode-disabledForeground); box-shadow: 0 0 0 3px color-mix(in srgb, var(--vscode-disabledForeground) 12%, transparent); }
.connection-readiness.configured .readiness-signal { background: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 12%, transparent); }
.connection-readiness.verified .readiness-signal { background: #6ddc72; box-shadow: 0 0 0 3px color-mix(in srgb, #6ddc72 16%, transparent); }
.connection-readiness.failed .readiness-signal { background: var(--vscode-errorForeground); box-shadow: 0 0 0 3px color-mix(in srgb, var(--vscode-errorForeground) 12%, transparent); }
.setup-progress { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 4px; margin: 11px 0 13px; }
.setup-progress button { display: flex; align-items: center; justify-content: center; gap: 5px; min-width: 0; padding: 5px 3px; border: 0; border-bottom: 1px solid var(--line); color: var(--muted); background: transparent; cursor: pointer; font-size: 9px; }
.setup-progress button span { display: grid; place-items: center; width: 15px; height: 15px; border: 1px solid currentColor; border-radius: 50%; font: 600 8px var(--vscode-editor-font-family); }
.setup-progress button[aria-current="step"] { border-bottom-color: var(--accent); color: var(--vscode-foreground); }
.setup-progress button[aria-current="step"] span { border-color: var(--accent); background: var(--accent); color: #111; }
.setup-progress button.complete span { border-color: var(--accent); color: var(--accent); }
.setup-step-heading { margin-bottom: 9px; }
.setup-step-heading h3 { margin: 3px 0 2px; font-size: 13px; line-height: 1.2; }
.setup-step-heading p { margin: 0; color: var(--muted); font-size: 9px; line-height: 1.45; }
.setup-step[hidden] { display: none !important; }
.field { display: grid; gap: 4px; margin-top: 9px; color: var(--muted); font-size: 10px; }
.field span, .field > label, .local-setting > div > span { font-weight: 600; letter-spacing: .02em; }
.field small, .local-setting small { font-weight: 400; opacity: .75; }
.field input, .field select { width: 100%; min-width: 0; padding: 7px 8px; border: 1px solid var(--line); border-radius: 4px; outline: 0; color: var(--vscode-input-foreground); background: var(--vscode-input-background); font: 11px/1.3 var(--vscode-editor-font-family); }
.field input:focus, .field select:focus { border-color: color-mix(in srgb, var(--accent) 62%, transparent); }
.input-action { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 6px; }
.field-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 8px; }
.advanced-settings { margin-top: 13px; padding-top: 10px; border-top: 1px solid var(--line); }
.advanced-settings summary { color: var(--muted); cursor: pointer; font-size: 10px; font-weight: 600; list-style-position: outside; }
.advanced-settings[open] summary { color: var(--vscode-foreground); }
.settings-subheading { margin-top: 15px; padding-top: 13px; border-top: 1px solid var(--line); }
.toggle-field { display: flex; align-items: center; gap: 8px; margin: 10px 0; color: var(--vscode-foreground); font-size: 11px; }
.toggle-field input { accent-color: var(--accent); }
.local-setting { display: flex; align-items: end; justify-content: space-between; gap: 8px; margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--line); color: var(--muted); font-size: 10px; }
.local-setting > div:first-child { min-width: 0; display: grid; gap: 3px; }
.local-setting code { overflow: hidden; color: var(--vscode-foreground); text-overflow: ellipsis; white-space: nowrap; font-size: 10px; }
.inline-actions, .settings-actions { display: flex; align-items: center; gap: 6px; }
.inline-actions button, .secondary-action, .primary-action { border: 0; border-radius: 4px; padding: 5px 7px; cursor: pointer; font-size: 10px; }
.inline-actions button, .secondary-action { color: var(--muted); background: var(--vscode-button-secondaryBackground); }
.primary-action { margin-left: auto; color: #111; background: var(--accent); font-weight: 650; }
.settings-actions .primary-action { margin-left: 0; }
.setup-step-count { margin-left: auto; color: var(--muted); font-size: 9px; white-space: nowrap; }
.settings-note { min-height: 1.4em; margin: 8px 0 0; color: var(--muted); font-size: 10px; }
.settings-error { margin: 8px 0 0; color: var(--vscode-errorForeground); font-size: 10px; white-space: pre-wrap; }
.connection-diagnostics { display: grid; margin-top: 10px; border-top: 1px solid var(--line); }
.diagnostic { display: grid; grid-template-columns: 8px minmax(0, 1fr) auto; gap: 7px; align-items: start; padding: 7px 0; border-bottom: 1px solid var(--line); }
.diagnostic-dot { width: 6px; height: 6px; margin-top: 5px; border-radius: 50%; background: var(--vscode-disabledForeground); }
.diagnostic.passed .diagnostic-dot { background: #6ddc72; }
.diagnostic.failed .diagnostic-dot { background: var(--vscode-errorForeground); }
.diagnostic-copy { display: grid; min-width: 0; }
.diagnostic-copy strong { font-size: 10px; font-weight: 600; }
.diagnostic-copy small { color: var(--muted); font-size: 9px; white-space: normal; }
.diagnostic-fixes { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 6px; }
.diagnostic-fixes button { border: 1px solid color-mix(in srgb, var(--accent) 40%, var(--line)); border-radius: 4px; padding: 4px 6px; color: var(--vscode-foreground); background: color-mix(in srgb, var(--vscode-button-secondaryBackground) 88%, var(--accent)); cursor: pointer; font-size: 9px; text-align: left; }
.diagnostic-fixes button:hover { border-color: var(--accent); }
.diagnostic-time { color: var(--muted); font: 9px var(--vscode-editor-font-family); }
.settings-actions { flex-wrap: wrap; margin-top: 12px; }
.profile-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 11px; padding-top: 10px; border-top: 1px solid var(--line); }
.profile-actions small { flex-basis: 100%; color: var(--muted); font-size: 9px; }
.model-compatibility { display: grid; grid-template-columns: 8px minmax(0, 1fr); align-items: start; gap: 8px; margin: -2px 0 10px; padding: 8px; border: 1px solid var(--line); border-radius: 5px; background: color-mix(in srgb, var(--vscode-sideBar-background) 94%, var(--accent)); }
.model-compatibility-signal { width: 7px; height: 7px; margin-top: 4px; border-radius: 50%; background: var(--accent); }
.model-compatibility.ready .model-compatibility-signal { background: #6ddc72; }
.model-compatibility.warning .model-compatibility-signal { background: var(--vscode-editorWarning-foreground); }
.model-compatibility.failed .model-compatibility-signal { background: var(--vscode-errorForeground); }
.model-compatibility-copy { display: grid; min-width: 0; gap: 2px; }
.model-compatibility-copy strong { font-size: 10px; font-weight: 600; }
.model-compatibility-copy small { color: var(--muted); font-size: 9px; line-height: 1.4; }
.conversation-stage { position: relative; min-height: 0; overflow: hidden; }
.timeline { height: 100%; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 0 18px 20px; }
.jump-latest { position: absolute; right: 14px; bottom: 10px; z-index: 2; border: 1px solid color-mix(in srgb, var(--accent) 48%, var(--line)); border-radius: 999px; padding: 5px 9px; color: var(--vscode-foreground); background: color-mix(in srgb, var(--vscode-sideBar-background) 90%, var(--accent)); box-shadow: 0 5px 18px color-mix(in srgb, #000 24%, transparent); cursor: pointer; font-size: 9px; font-weight: 650; animation: reveal .16s ease-out; }
.jump-latest:hover { border-color: var(--accent); background: color-mix(in srgb, var(--vscode-sideBar-background) 82%, var(--accent)); }
.welcome { padding: 48px 0 24px; animation: reveal .35s ease-out; }
.monogram { display: grid; place-items: center; width: 38px; height: 38px; margin-bottom: 24px; border-radius: 10px; background: var(--accent); color: #111; font-weight: 800; font-size: 18px; transform: rotate(-3deg); }
.welcome h2 { margin: 0; font-size: 22px; line-height: 1.12; letter-spacing: -.035em; }
.welcome p { max-width: 310px; margin: 13px 0 23px; color: var(--muted); }
.starters { display: grid; border-top: 1px solid var(--line); }
.starters button { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 12px; width: 100%; padding: 11px 2px; border: 0; border-bottom: 1px solid var(--line); color: var(--vscode-foreground); background: transparent; cursor: pointer; text-align: left; transition: padding-left .15s, color .15s; }
.starters button:hover { padding-left: 6px; color: var(--accent); }
.starters button span:first-child { display: grid; gap: 3px; min-width: 0; }
.starters button strong { font-size: 11px; font-weight: 600; }
.starters button small, .starter-note { color: var(--muted); font-size: 9px; }
.starter-arrow { color: var(--muted); transition: transform .15s, color .15s; }
.starters button:hover .starter-arrow { color: var(--accent); transform: translateX(2px); }
.starter-note { display: block; margin-top: 11px; }
.message { padding: 18px 0; border-bottom: 1px solid var(--line); animation: reveal .2s ease-out; }
.message-role { display: flex; align-items: center; gap: 7px; margin-bottom: 7px; color: var(--muted); font: 600 9px/1 var(--vscode-editor-font-family); letter-spacing: .14em; }
.message-state { color: var(--muted); font-size: 8px; font-weight: 500; letter-spacing: .02em; text-transform: none; }
.message.user .message-body { font-size: 14px; }
.message.assistant .message-body { line-height: 1.62; }
.message.assistant.streaming .message-body { min-height: 1.62em; white-space: pre-wrap; overflow-wrap: anywhere; }
.message.assistant.streaming.tool-turn .message-body { color: var(--muted); }
.message.assistant.streaming.tool-turn { margin: 2px 0; padding: 10px 11px; border: 1px solid color-mix(in srgb, var(--line) 78%, var(--accent)); border-left: 3px solid var(--accent); border-radius: 6px; background: color-mix(in srgb, var(--vscode-sideBar-background) 88%, var(--accent)); }
.message.assistant.streaming.tool-turn .message-role { margin-bottom: 5px; color: var(--accent); letter-spacing: .1em; }
.message.assistant.streaming.tool-turn .message-role::after { content: ' · ACTIVITY'; color: var(--muted); font-size: 8px; letter-spacing: .08em; }
.message.assistant.streaming.tool-turn .message-body { font-size: 11px; line-height: 1.48; }
.message.assistant.streaming .message-body::after { display: inline-block; width: 2px; height: 1em; margin-left: 3px; background: var(--accent); content: ""; vertical-align: -.12em; animation: stream-cursor .85s steps(1, end) infinite; }
.message.assistant.interrupted, .message.assistant.failed, .message.assistant.cancelled { padding-left: 10px; border-left: 2px solid var(--line); }
.message-body p { margin: 0 0 9px; }
.message-body p:last-child { margin-bottom: 0; }
.message-body h3, .message-body h4, .message-body h5 { margin: 14px 0 7px; line-height: 1.3; }
.message-body h3:first-child, .message-body h4:first-child, .message-body h5:first-child { margin-top: 0; }
.message-body ul, .message-body ol { margin: 7px 0; padding-left: 21px; }
.message-body li { margin: 3px 0; }
.message-body blockquote { margin: 8px 0; padding-left: 10px; border-left: 2px solid var(--line); color: var(--muted); }
.message-body pre { overflow-x: auto; padding: 11px; background: var(--vscode-textCodeBlock-background); border-left: 2px solid var(--accent); font: 11px/1.55 var(--vscode-editor-font-family); }
.message-body code { font-family: var(--vscode-editor-font-family); color: var(--vscode-textPreformat-foreground); }
.message-actions { display: flex; align-items: center; gap: 3px; margin-top: 8px; }
.message-actions button { border: 0; border-radius: 4px; padding: 3px 6px; color: var(--muted); background: transparent; cursor: pointer; font-size: 9px; }
.message-actions button:hover { color: var(--vscode-foreground); background: var(--vscode-toolbar-hoverBackground); }
.message-actions button:disabled { cursor: default; opacity: .5; }
.history-fold { padding: 9px 0; border-bottom: 1px solid var(--line); text-align: center; }
.history-fold button { border: 0; border-radius: 5px; padding: 5px 8px; color: var(--muted); background: transparent; cursor: pointer; font-size: 9px; }
.history-fold button:hover { color: var(--vscode-foreground); background: var(--vscode-toolbar-hoverBackground); }
.run-summary { padding: 13px 0; border-bottom: 1px solid var(--line); animation: reveal .2s ease-out; }
.run-summary-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.run-summary-heading strong { font-size: 11px; font-weight: 650; }
.run-summary-heading button { border: 0; border-radius: 4px; padding: 4px 6px; color: var(--muted); background: var(--vscode-button-secondaryBackground); cursor: pointer; font-size: 9px; }
.run-summary-stats { margin-top: 4px; color: var(--muted); font-size: 10px; }
.run-summary details { margin-top: 7px; color: var(--muted); font-size: 9px; }
.run-summary ul { margin: 6px 0 0; padding-left: 17px; }
.run-summary li { margin-top: 3px; overflow-wrap: anywhere; font-family: var(--vscode-editor-font-family); }
.run-change { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 7px; padding: 5px 0; }
.run-change-copy { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.run-change-copy strong { color: var(--vscode-foreground); font-size: 8px; font-weight: 650; letter-spacing: .08em; }
.run-change-actions { display: flex; gap: 4px; }
.run-change-actions button { border: 0; border-radius: 4px; padding: 3px 5px; color: var(--muted); background: var(--vscode-button-secondaryBackground); cursor: pointer; font-size: 8px; }
.run-change-actions button:hover { color: var(--vscode-foreground); }
.run-change-actions button:disabled { cursor: default; opacity: .55; }
.review-note { margin-top: 7px; color: var(--muted); font-size: 9px; }
.run-summary.failed { border-left: 2px solid var(--vscode-errorForeground); padding-left: 10px; }
.error { margin: 12px 0; padding: 10px 0 10px 12px; border-left: 2px solid var(--vscode-errorForeground); color: var(--vscode-errorForeground); white-space: pre-wrap; }
.recovery { margin: 10px 0; padding: 10px 0 10px 12px; border-left: 2px solid var(--accent); color: var(--muted); }
.error .recovery-copy, .recovery-copy { color: inherit; white-space: pre-wrap; }
.recovery-actions { display: flex; align-items: center; gap: 6px; margin-top: 9px; }
.recovery-actions button { border: 0; border-radius: 4px; padding: 5px 7px; color: var(--vscode-foreground); background: var(--vscode-button-secondaryBackground); cursor: pointer; font-size: 10px; }
.recovery-actions button:first-child { color: #111; background: var(--accent); font-weight: 650; }
.recovery-actions button:disabled { cursor: default; opacity: .45; }
.composer-wrap { padding: 5px 12px 12px; background: var(--vscode-sideBar-background); }
.context-row { display: flex; align-items: center; justify-content: space-between; min-height: 25px; padding: 0 5px; }
.context-actions { display: flex; min-width: 0; max-width: 74%; align-items: center; gap: 7px; }
.context-chip { display: flex; min-width: 0; align-items: center; gap: 5px; overflow: hidden; padding: 3px 0; border: 0; color: var(--muted); background: transparent; cursor: pointer; font: 10px var(--vscode-editor-font-family); }
.context-chip > span:first-child { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.context-chip:hover, .context-chip[aria-expanded="true"] { color: var(--vscode-foreground); }
.context-add { flex: none; padding: 2px 4px; border: 0; border-radius: 4px; color: var(--muted); background: transparent; cursor: pointer; font-size: 9px; }
.context-add:hover { color: var(--accent); background: var(--vscode-toolbar-hoverBackground); }
.context-add:disabled { cursor: default; opacity: .4; }
.context-count { flex: none; min-width: 16px; padding: 0 4px; border-radius: 8px; color: #111; background: var(--accent); text-align: center; font: 600 9px/16px var(--vscode-font-family); }
.context-inspector { max-height: min(34vh, 260px); overflow-y: auto; margin: 0 -12px 3px; padding: 10px 17px 9px; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); background: color-mix(in srgb, var(--vscode-sideBar-background) 94%, var(--accent)); animation: reveal .14s ease-out; }
.context-inspector-heading { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
.context-clear { border: 0; color: var(--muted); background: transparent; cursor: pointer; font-size: 9px; }
.context-clear:hover { color: var(--vscode-foreground); }
.context-clear:disabled { cursor: default; opacity: .4; }
.context-budget-card { display: grid; gap: 5px; margin-bottom: 4px; padding: 7px 0 8px; border-bottom: 1px solid var(--line); }
.context-budget-copy { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.context-budget-copy strong { font-size: 10px; font-weight: 600; }
.context-budget-copy small, #prompt-token-estimate { color: var(--muted); font-size: 9px; }
.context-budget-track { height: 3px; overflow: hidden; border-radius: 2px; background: color-mix(in srgb, var(--vscode-foreground) 12%, transparent); }
.context-budget-track > span { display: block; width: 0; height: 100%; background: var(--accent); transition: width .15s ease-out; }
.context-budget-chip { flex: none; color: var(--muted); font-size: 9px; }
.context-entry { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 8px; padding: 6px 0; border-bottom: 1px solid var(--line); }
.context-entry-copy { display: grid; min-width: 0; }
.context-entry-copy strong { overflow: hidden; font: 500 10px var(--vscode-editor-font-family); text-overflow: ellipsis; white-space: nowrap; }
.context-entry-copy small { color: var(--muted); font-size: 9px; }
.context-source-list { margin-top: 3px; color: var(--muted); font-size: 9px; }
.context-source-list summary { cursor: pointer; }
.context-source-list ul { display: grid; gap: 2px; margin: 4px 0 0; padding-left: 16px; }
.context-source-list li { overflow-wrap: anywhere; font-family: var(--vscode-editor-font-family); }
.context-entry button { display: grid; place-items: center; width: 20px; height: 20px; border: 0; border-radius: 4px; color: var(--muted); background: transparent; cursor: pointer; }
.context-entry button:hover { color: var(--vscode-foreground); background: var(--vscode-toolbar-hoverBackground); }
.context-inspector > p { margin: 8px 0 0; color: var(--muted); font-size: 9px; }
.memory-link { border: 0; background: transparent; color: var(--muted); font-size: 10px; cursor: pointer; }
.memory-link:hover { color: var(--accent); }
.utility-links { display: flex; align-items: center; gap: 2px; }
.composer { border: 1px solid color-mix(in srgb, var(--vscode-foreground) 22%, transparent); border-radius: 9px; background: var(--vscode-input-background); box-shadow: 0 10px 30px color-mix(in srgb, #000 18%, transparent); transition: border-color .15s, transform .15s; }
.composer:focus-within { border-color: color-mix(in srgb, var(--accent) 62%, transparent); transform: translateY(-1px); }
.image-attachments { display: flex; flex-wrap: wrap; gap: 6px; padding: 7px 9px 0; }
.image-attachment { display: inline-flex; align-items: center; gap: 5px; max-width: 170px; padding: 3px 5px; border: 1px solid var(--line); border-radius: 5px; color: var(--muted); font-size: 9px; }
.image-attachment img { width: 26px; height: 26px; object-fit: cover; border-radius: 3px; }
.image-attachment span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.image-attachment button { border: 0; padding: 0 2px; color: var(--muted); background: transparent; cursor: pointer; font-size: 14px; line-height: 1; }
.image-attachment button:hover { color: var(--vscode-errorForeground); }
textarea { display: block; width: 100%; min-height: 58px; max-height: 180px; resize: none; overflow-y: auto; padding: 11px 12px 2px; color: var(--vscode-input-foreground); background: transparent; border: 0; outline: 0; }
.composer-actions { display: flex; align-items: center; justify-content: flex-end; gap: 7px; padding: 5px 7px 7px; }
.run-controls { position: relative; margin-right: auto; }
.run-controls > summary { max-width: 170px; overflow: hidden; border: 0; border-radius: 5px; padding: 4px 6px; color: var(--muted); cursor: pointer; font-size: 10px; text-overflow: ellipsis; white-space: nowrap; list-style: none; }
.run-controls > summary::-webkit-details-marker { display: none; }
.run-controls > summary::after { content: '⌃'; margin-left: 5px; font-size: 8px; }
.run-controls[open] > summary { color: var(--vscode-foreground); background: var(--vscode-toolbar-hoverBackground); }
.run-controls[open] > summary::after { content: '⌄'; }
.run-controls.locked > summary { pointer-events: none; opacity: .5; }
.run-controls-panel { position: absolute; z-index: 8; bottom: calc(100% + 7px); left: -1px; display: grid; gap: 9px; width: min(270px, calc(100vw - 30px)); padding: 11px; border: 1px solid var(--line); border-radius: 7px; background: var(--vscode-editorWidget-background, var(--vscode-sideBar-background)); box-shadow: 0 10px 28px color-mix(in srgb, #000 28%, transparent); }
.run-controls-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; padding-bottom: 7px; border-bottom: 1px solid var(--line); }
.run-controls-heading strong { font-size: 11px; }
.run-controls-heading small, .run-control-field small { color: var(--muted); font-size: 9px; }
.run-control-field { display: grid; grid-template-columns: 56px minmax(0, 1fr); align-items: center; gap: 3px 7px; color: var(--vscode-foreground); font-size: 10px; }
.run-control-field > span { font-weight: 600; }
.run-control-field select { min-width: 0; padding: 5px 6px; border: 1px solid var(--line); border-radius: 4px; color: var(--vscode-input-foreground); background: var(--vscode-dropdown-background); font-size: 10px; }
.run-control-field small { grid-column: 2; line-height: 1.35; }
.cancel { border: 0; border-radius: 5px; color: var(--muted); background: transparent; padding: 4px 6px; font-size: 10px; }
.cancel { cursor: pointer; }
.cancel:disabled { cursor: progress; opacity: .62; }
.send { display: grid; place-items: center; width: 27px; height: 27px; border: 0; border-radius: 7px; background: var(--accent); color: #111; cursor: pointer; font-size: 17px; font-weight: 700; transition: transform .12s, opacity .12s; }
.goal-button { border: 1px solid var(--line); border-radius: 7px; padding: 4px 8px; color: var(--vscode-descriptionForeground); background: transparent; cursor: pointer; }
.goal-button:hover { color: var(--vscode-foreground); background: var(--vscode-toolbar-hoverBackground); }
.goal-button.selected { color: var(--vscode-editor-background); border-color: var(--accent); background: var(--accent); }
.goal-strip, .goal-workspace { display: none !important; }
.goal-strip { align-items: center; gap: 8px; padding: 6px 18px; border-bottom: 1px solid var(--line); color: var(--vscode-descriptionForeground); font-size: 11px; }
.goal-strip .signal { width: 7px; height: 7px; border-radius: 50%; background: var(--accent); }
.goal-strip button { margin-left: auto; border: 1px solid var(--line); background: transparent; color: inherit; border-radius: 5px; padding: 2px 7px; cursor: pointer; }
.goal-strip button + button { margin-left: 0; }
.goal-panel { position: absolute; z-index: 4; left: 12px; right: 12px; bottom: 8px; max-height: 65%; overflow: auto; margin: 0; padding: 10px; border: 1px solid var(--line); border-radius: 6px; background: color-mix(in srgb, var(--vscode-sideBar-background) 96%, var(--accent)); box-shadow: 0 8px 24px color-mix(in srgb, #000 22%, transparent); }
.goal-panel-heading, .goal-panel-actions { display: flex; align-items: center; gap: 6px; }
.goal-panel-heading button { margin-left: auto; border: 0; background: transparent; color: var(--muted); cursor: pointer; font-size: 10px; }
.goal-panel p { margin: 7px 0; font-size: 10px; color: var(--muted); white-space: pre-wrap; }
.goal-progress { margin: 7px 0; font: 10px var(--vscode-editor-font-family); }
.goal-criteria { display: grid; gap: 4px; }
.goal-criterion { display: grid; grid-template-columns: 8px minmax(0, 1fr); gap: 6px; align-items: start; font-size: 10px; }
.goal-criterion-dot { width: 6px; height: 6px; margin-top: 4px; border-radius: 50%; background: var(--vscode-disabledForeground); }
.goal-criterion-dot.verified { background: #6ddc72; }.goal-criterion-dot.failed { background: var(--vscode-errorForeground); }
.goal-panel-actions { margin-top: 8px; }.goal-panel-actions button { border: 1px solid var(--line); border-radius: 4px; padding: 4px 7px; background: transparent; color: inherit; cursor: pointer; font-size: 10px; }
.goal-event { margin: 8px 14px; padding: 9px 10px; border-left: 2px solid var(--accent); border-radius: 4px; background: color-mix(in srgb, var(--vscode-editor-background) 72%, var(--accent)); animation: reveal .18s ease-out; }
.goal-event-heading { display: flex; align-items: center; gap: 6px; font-size: 11px; }.goal-event-heading small { margin-left: auto; color: var(--muted); font-size: 10px; }.goal-event-signal { width: 6px; height: 6px; border-radius: 50%; background: var(--accent); }.goal-event-objective { margin-top: 4px; font-size: 11px; white-space: pre-wrap; }.goal-event-progress, .goal-event-detail, .goal-event-next { margin-top: 3px; color: var(--muted); font-size: 10px; }.goal-event-next { color: var(--vscode-descriptionForeground); }
.goal-editor { margin-top: 8px; }.goal-editor label { display: block; margin-bottom: 4px; color: var(--muted); font-size: 10px; }.goal-editor textarea { width: 100%; box-sizing: border-box; resize: vertical; min-height: 72px; padding: 6px; border: 1px solid var(--line); border-radius: 4px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); font: 11px var(--vscode-font-family); }.goal-editor-actions { display: flex; gap: 6px; margin-top: 5px; }.goal-editor-actions button { border: 1px solid var(--line); border-radius: 4px; padding: 4px 7px; background: transparent; color: inherit; cursor: pointer; font-size: 10px; }
.goal-workspace { margin: 0 18px 8px; padding: 8px 10px; border-bottom: 1px solid var(--line); }.goal-workspace .goal-panel-heading { color: var(--muted); font-size: 10px; }.goal-workspace .goal-panel-heading span { margin-left: auto; font-size: 9px; }.goal-list { display: grid; gap: 4px; margin-top: 6px; }.goal-list-empty { color: var(--muted); font-size: 10px; }.goal-list-item { display: grid; grid-template-columns: 7px minmax(0, 1fr) auto; gap: 6px; align-items: center; width: 100%; padding: 5px 6px; border: 1px solid transparent; border-radius: 4px; background: transparent; color: inherit; text-align: left; cursor: pointer; }.goal-list-item:hover, .goal-list-item.active { border-color: var(--line); background: var(--vscode-list-hoverBackground); }.goal-list-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--vscode-disabledForeground); }.goal-list-dot.active { background: var(--accent); }.goal-list-dot.completed { background: #6ddc72; }.goal-list-dot.blocked, .goal-list-dot.paused { background: var(--vscode-editorWarning-foreground); }.goal-list-copy { min-width: 0; }.goal-list-title, .goal-list-meta { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.goal-list-title { font-size: 10px; }.goal-list-meta { color: var(--muted); font-size: 9px; }.goal-list-action { color: var(--muted); font-size: 9px; }
.evidence-filter-label { display: inline-flex; align-items: center; gap: 6px; margin: 4px 0 7px; color: var(--muted); font-size: 10px; }.evidence-filter-label select { border: 1px solid var(--line); border-radius: 4px; padding: 3px 5px; background: var(--vscode-dropdown-background); color: var(--vscode-dropdown-foreground); font-size: 10px; }
.send:hover { transform: translateY(-1px); }
.send:disabled { opacity: .35; cursor: default; transform: none; }
.hint { padding: 5px 5px 0; color: var(--muted); text-align: center; font-size: 9px; }
.sr-only { position: fixed; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
[tabindex="-1"]:focus { outline: none; }
button:focus-visible, select:focus-visible, input:focus-visible, textarea:focus-visible, summary:focus-visible, [tabindex="0"]:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }
.hidden { display: none !important; }
@keyframes pulse { 0%,100% { opacity: .55; box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 12%, transparent); } 50% { opacity: 1; box-shadow: 0 0 0 6px color-mix(in srgb, var(--accent) 5%, transparent); } }
@keyframes stream-cursor { 0%,48% { opacity: 1; } 49%,100% { opacity: .18; } }
@keyframes reveal { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important; } }
@media (forced-colors: active) { .signal, .readiness-signal, .model-compatibility-signal, .run-review-signal { border: 1px solid currentColor; } }
`;

const script = String.raw`
const vscode = acquireVsCodeApi();
const restoredWebviewState = vscode.getState() || {};
const modelCapabilityCatalog = ${JSON.stringify(LITELLM_MODEL_CAPABILITIES)};
const timeline = document.getElementById('timeline');
const jumpLatest = document.getElementById('jump-latest');
const topDrawers = document.getElementById('top-drawers');
const welcomeMarkup = timeline.innerHTML;
const prompt = document.getElementById('prompt');
const imageAttachments = document.getElementById('image-attachments');
const composerHint = document.getElementById('composer-hint');
const send = document.getElementById('send');
const goalButton = document.getElementById('goal');
const goalStrip = document.getElementById('goal-strip');
const goalStripText = document.getElementById('goal-strip-text');
const goalDetails = document.getElementById('goal-details');
const goalPanel = document.getElementById('goal-panel');
const goalPanelClose = document.getElementById('goal-panel-close');
const goalObjective = document.getElementById('goal-objective');
const goalProgress = document.getElementById('goal-progress');
const goalCriteria = document.getElementById('goal-criteria');
const goalEditor = document.getElementById('goal-editor');
const goalCriteriaInput = document.getElementById('goal-criteria-input');
const goalSaveCriteria = document.getElementById('goal-save-criteria');
const goalCancelCriteria = document.getElementById('goal-cancel-criteria');
const goalWorkspace = document.getElementById('goal-workspace');
const goalWorkspaceCount = document.getElementById('goal-workspace-count');
const goalList = document.getElementById('goal-list');
const goalNext = document.getElementById('goal-next');
const goalPause = document.getElementById('goal-pause');
const goalCancel = document.getElementById('goal-cancel');
const goalResume = document.getElementById('goal-resume');
const goalOpen = document.getElementById('goal-open');
const goalEdit = document.getElementById('goal-edit');
const cancel = document.getElementById('cancel');
const status = document.getElementById('status');
const signal = document.getElementById('signal');
const activityDock = document.getElementById('activity-dock');
const activityToggle = document.getElementById('activity-toggle');
const activityMeta = document.getElementById('activity-meta');
const activityCancel = document.getElementById('activity-cancel');
const browserTakeControl = document.getElementById('browser-take-control');
const planItems = document.getElementById('plan-items');
const planSummary = document.getElementById('plan-summary');
const planLatest = document.getElementById('plan-latest');
const planActivityItems = document.getElementById('plan-activity-items');
const threadPanel = document.getElementById('thread-panel');
const threadsToggle = document.getElementById('threads-toggle');
const threadList = document.getElementById('thread-list');
const threadSearch = document.getElementById('thread-search');
const memoryPanel = document.getElementById('memory-panel');
const memoryToggle = document.getElementById('memory');
const memoryPanelTitle = document.getElementById('memory-panel-title');
const memoryOverview = document.getElementById('memory-overview');
const memoryList = document.getElementById('memory-list');
const briefPanel = document.getElementById('brief-panel');
const briefToggle = document.getElementById('brief');
const briefObjective = document.getElementById('brief-objective');
const briefScope = document.getElementById('brief-scope');
const briefDone = document.getElementById('brief-done');
const briefConstraints = document.getElementById('brief-constraints');
const briefError = document.getElementById('brief-error');
const runReviewPanel = document.getElementById('run-review-panel');
const runReviewTitle = document.getElementById('run-review-title');
const runReviewContent = document.getElementById('run-review-content');
const liteLlmSettings = document.getElementById('litellm-settings');
const liteLlmToggle = document.getElementById('litellm');
const modelProvider = document.getElementById('model-provider');
const modelProviderField = document.getElementById('model-provider-field');
const providerVariantNote = document.getElementById('provider-variant-note');
const providerSetupNote = document.getElementById('provider-setup-note');
const providerEndpointLabel = document.getElementById('provider-endpoint-label');
const providerKeyField = document.getElementById('provider-key-field');
const providerKeyLabel = document.getElementById('provider-key-label');
const authHeaderField = document.getElementById('auth-header-field');
const modelCatalogField = document.getElementById('model-catalog-field');
const ollamaModelDiscovery = document.getElementById('ollama-model-discovery');
const ollamaLoadModels = document.getElementById('ollama-load-models');
const profileActions = document.getElementById('profile-actions');
const embeddingProviderNote = document.getElementById('embedding-provider-note');
const liteLlmEndpoint = document.getElementById('litellm-endpoint');
const liteLlmModelsEndpoint = document.getElementById('litellm-models-endpoint');
const liteLlmModel = document.getElementById('litellm-model');
const visionModel = document.getElementById('vision-model');
const liteLlmModelAliases = document.getElementById('litellm-model-aliases');
const modelCompatibility = document.getElementById('model-compatibility');
const modelCompatibilityTitle = document.getElementById('model-compatibility-title');
const modelCompatibilityDetail = document.getElementById('model-compatibility-detail');
const liteLlmReasoningEffort = document.getElementById('litellm-reasoning-effort');
const liteLlmModelPreset = document.getElementById('litellm-model-preset');
const liteLlmTemperature = document.getElementById('litellm-temperature');
const liteLlmTopP = document.getElementById('litellm-top-p');
const liteLlmCapabilities = document.getElementById('litellm-capabilities');
const liteLlmAuthHeader = document.getElementById('litellm-auth-header');
const liteLlmApiKey = document.getElementById('litellm-api-key');
const liteLlmSettingsError = document.getElementById('litellm-settings-error');
const connectionReadiness = document.getElementById('connection-readiness');
const readinessTitle = document.getElementById('readiness-title');
const readinessDetail = document.getElementById('readiness-detail');
const connectionDiagnostics = document.getElementById('connection-diagnostics');
const connectionTestButton = document.getElementById('litellm-test');
const connectionSaveButton = document.getElementById('litellm-save');
const setupSteps = [...document.querySelectorAll('[data-setup-step]')];
const setupStepButtons = [...document.querySelectorAll('[data-setup-step-target]')];
const setupBackButton = document.getElementById('setup-back');
const setupNextButton = document.getElementById('setup-next');
const setupStepCount = document.getElementById('setup-step-count');
const advancedSetupButton = document.getElementById('litellm-advanced');
const contextToggle = document.getElementById('context-toggle');
const contextInspector = document.getElementById('context-inspector');
const contextActiveEntry = document.getElementById('context-active-entry');
const pinnedContext = document.getElementById('pinned-context');
const contextClear = document.getElementById('context-clear');
const contextAddFile = document.getElementById('context-add-file');
const contextCount = document.getElementById('context-count');
const contextBudgetLabel = document.getElementById('context-budget-label');
const contextBudgetDetail = document.getElementById('context-budget-detail');
const contextBudgetTrack = document.getElementById('context-budget-track');
const contextBudgetFill = document.getElementById('context-budget-fill');
const contextBudgetChip = document.getElementById('context-budget-chip');
const contextGuidanceEntry = document.getElementById('context-guidance-entry');
const contextMemoryEntry = document.getElementById('context-memory-entry');
const promptTokenEstimate = document.getElementById('prompt-token-estimate');
const semanticMemoryEnabled = document.getElementById('semantic-memory-enabled');
const embeddingModel = document.getElementById('embedding-model');
const embeddingEndpoint = document.getElementById('embedding-endpoint');
const embeddingModelAliases = document.getElementById('embedding-model-aliases');
const newThreadButton = document.getElementById('new-thread');
const mcpConnections = document.getElementById('mcp-connections');
const browserControl = document.getElementById('browser-control');
const browserLiveControl = document.getElementById('browser-live-control');
const agentRuntime = document.getElementById('runtime');
const autonomyMode = document.getElementById('mode');
const finalReviewMode = document.getElementById('final-review-mode');
const responseLanguage = document.getElementById('response-language');
const runControls = document.getElementById('run-controls');
const runControlsLabel = document.getElementById('run-controls-label');
const runtimeHelp = document.getElementById('runtime-help');
const modeHelp = document.getElementById('mode-help');
const finalReviewHelp = document.getElementById('final-review-help');
const announcer = document.getElementById('announcer');
const setupCallout = document.getElementById('setup-callout');
const setupCalloutAction = document.getElementById('setup-callout-action');
const topPanels = [threadPanel, memoryPanel, briefPanel, runReviewPanel, liteLlmSettings];
let busy = false;
let cancellationPending = false;
let remoteRunActive = false;
let liteLlmModelProfiles = {};
let loadedModelCatalog = [];
let lastConnectionDiagnostics = [];
let diagnosticFixApplied = false;
let connectionSetupStep = 1;
let planManuallyCollapsed = false;
let hasStoredLiteLlmKey = false;
let activeProvider = 'litellm';
let profileTarget = 'chat';
let availableModelProviders = ['litellm'];
let providerKeyStates = { litellm: false, ollama: false, openai: false };
const providerDrafts = {};
let browserControlEnabled = false;
let browserControlPending = false;
let browserLiveMode = false;
let browserManualControl = false;
let mcpConnectionCount = 0;
let mcpConnectionsPending = false;
let currentContextState = { activeFile: '', autoContext: true, pinned: [] };
let currentRunSummary = createRunSummary();
let runActivityState = null;
let runActivityTimer;
const messageSources = new WeakMap();
const RECENT_HISTORY_MESSAGES = 14;
const HISTORY_REVEAL_BATCH = 20;
const SCROLL_STICK_THRESHOLD = 48;
let hiddenHistoryMessages = [];
let conversationPinnedToBottom = true;
let unseenConversationUpdates = 0;
const assistantStreamStates = new Map();
const runReviews = new Map();
let activeRunReviewId = '';
let activeThreadId = '';
let liveRunThreadId = '';
let suppressLiveRunEvents = false;
let currentThreadSummaries = [];
let pendingRequestText = '';
let imageAttachmentDrafts = [];
let pendingRequestId = '';
let replacePendingOnSubmit = false;
let activePanelTrigger = null;
let draftTimer;
let localDrafts = restoredWebviewState.drafts && typeof restoredWebviewState.drafts === 'object' && !Array.isArray(restoredWebviewState.drafts)
  ? Object.fromEntries(Object.entries(restoredWebviewState.drafts)
      .filter(([, value]) => typeof value === 'string')
      .map(([threadId, value]) => [threadId, value.slice(0, 50000)]))
  : {};
let briefState = normalizeBriefState(restoredWebviewState.brief);
briefObjective.value = briefState.objective;
briefScope.value = briefState.scope;
briefDone.value = briefState.done;
briefConstraints.value = briefState.constraints;

function createRunSummary() {
  return {
    id: crypto.randomUUID(),
    startedAt: Date.now(),
    finishedAt: undefined,
    files: new Map(),
    commands: [],
    plan: [],
    memoryUpdates: 0,
    contextReceipt: undefined,
    evidence: undefined,
    verification: undefined,
    usage: undefined,
    failed: false,
    cancelled: false,
    error: '',
    omittedChanges: 0
  };
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}

function normalizeBriefState(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    objective: typeof source.objective === 'string' ? source.objective.slice(0, 4000) : '',
    scope: typeof source.scope === 'string' ? source.scope.slice(0, 2000) : '',
    done: typeof source.done === 'string' ? source.done.slice(0, 2000) : '',
    constraints: typeof source.constraints === 'string' ? source.constraints.slice(0, 2000) : ''
  };
}

function persistWebviewState() {
  vscode.setState({ drafts: localDrafts, brief: briefState });
}

function announce(message) {
  if (!message) return;
  announcer.textContent = '';
  requestAnimationFrame(() => { announcer.textContent = message; });
}

function setPanelHidden(panel, hidden) {
  panel.classList.toggle('hidden', hidden);
  panel.setAttribute('aria-hidden', String(hidden));
}

function closeTopPanels(restoreFocus = true) {
  topPanels.forEach(panel => setPanelHidden(panel, true));
  topDrawers.classList.remove('panel-open');
  threadsToggle.setAttribute('aria-expanded', 'false');
  liteLlmToggle.setAttribute('aria-expanded', 'false');
  memoryToggle.setAttribute('aria-expanded', 'false');
  briefToggle.setAttribute('aria-expanded', 'false');
  if (activePanelTrigger) activePanelTrigger.setAttribute('aria-expanded', 'false');
  const trigger = activePanelTrigger;
  activePanelTrigger = null;
  if (restoreFocus && trigger?.isConnected && !trigger.disabled) trigger.focus();
}

function openTopPanel(panel, trigger, focusTarget) {
  closeTopPanels(false);
  setPanelHidden(panel, false);
  topDrawers.classList.add('panel-open');
  activePanelTrigger = trigger || null;
  if (activePanelTrigger) activePanelTrigger.setAttribute('aria-expanded', 'true');
  requestAnimationFrame(() => {
    const target = typeof focusTarget === 'function' ? focusTarget() : focusTarget;
    target?.focus();
  });
}

function renderText(value) {
  return '<p>' + escapeHtml(value).replace(/\n/g, '<br>') + '</p>';
}

function conversationIsNearBottom() {
  return timeline.scrollHeight - timeline.scrollTop - timeline.clientHeight <= SCROLL_STICK_THRESHOLD;
}

function renderJumpToLatest() {
  const visible = !conversationPinnedToBottom && unseenConversationUpdates > 0;
  jumpLatest.classList.toggle('hidden', !visible);
  if (!visible) return;
  const label = unseenConversationUpdates === 1
    ? '1 new update ↓'
    : Math.min(unseenConversationUpdates, 99) + (unseenConversationUpdates > 99 ? '+ new updates ↓' : ' new updates ↓');
  jumpLatest.textContent = label;
  jumpLatest.setAttribute('aria-label', label.replace(' ↓', '') + '. Jump to the latest conversation activity.');
}

function resetConversationScroll() {
  conversationPinnedToBottom = true;
  unseenConversationUpdates = 0;
  renderJumpToLatest();
}

function scrollConversationToBottom({ force = false, countUpdate = true } = {}) {
  if (!force && !conversationPinnedToBottom) {
    const firstUnseenUpdate = unseenConversationUpdates === 0;
    if (countUpdate) unseenConversationUpdates += 1;
    renderJumpToLatest();
    if (firstUnseenUpdate && countUpdate) announce('New conversation activity is available below.');
    return;
  }
  requestAnimationFrame(() => {
    timeline.scrollTop = timeline.scrollHeight;
    resetConversationScroll();
  });
}

function createMessageElement(message) {
  const element = document.createElement('article');
  const messageStatus = message.status || 'complete';
  element.className = 'message ' + message.role + (messageStatus === 'complete' ? '' : ' ' + messageStatus);
  element.dataset.messageRole = message.role;
  element.dataset.messageStatus = messageStatus;
  const messageId = message.id || crypto.randomUUID();
  element.dataset.messageId = messageId;
  if (message.runId) element.dataset.runId = message.runId;
  messageSources.set(element, String(message.text || ''));
  const actions = message.role === 'assistant' && messageStatus === 'complete'
    ? '<div class="message-actions"><button type="button" data-copy-message aria-label="Copy agent response">Copy</button>' +
      '<button type="button" data-add-memory-message aria-label="Add a confirmed project-memory entry from this response"' +
      ((busy || remoteRunActive) ? ' disabled' : '') + '>Add memory…</button></div>'
    : '';
  const statusLabels = {
    streaming: 'responding',
    interrupted: 'partial · interrupted',
    failed: 'partial · failed',
    cancelled: 'partial · cancelled'
  };
  const stateLabel = statusLabels[messageStatus] || '';
  element.innerHTML = '<div class="message-role"><span>' + (message.role === 'user' ? 'YOU' : 'AGENT') + '</span>' +
    (stateLabel ? '<span class="message-state">' + escapeHtml(stateLabel) + '</span>' : '') + '</div>' +
    '<div class="message-body">' + (message.html || renderText(message.text)) + '</div>' + actions;
  return element;
}

function appendMessage(message, announceResponse = true) {
  document.getElementById('welcome')?.remove();
  const element = createMessageElement(message);
  timeline.appendChild(element);
  scrollConversationToBottom({ force: message.role === 'user' });
  if (announceResponse && message.role === 'assistant') announce('Agent response added to the conversation.');
}

function assistantMessageElement(id) {
  return timeline.querySelector('.message.assistant[data-message-id="' + CSS.escape(id || '') + '"]');
}

function startAssistantStream(data) {
  if (!data?.id || !data?.runId) return;
  let state = assistantStreamStates.get(data.id);
  if (state && state.runId !== data.runId) {
    if (state.frame) cancelAnimationFrame(state.frame);
    state.element?.remove();
    assistantStreamStates.delete(data.id);
    state = undefined;
  }
  if (!state) {
    state = {
      runId: data.runId,
      sequence: 0,
      text: '',
      pending: '',
      frame: 0,
      element: null,
      countedUnseen: false
    };
    assistantStreamStates.set(data.id, state);
  }
  if (state.element?.isConnected) return;
  document.getElementById('welcome')?.remove();
  const element = createMessageElement({
    id: data.id,
    runId: data.runId,
    role: 'assistant',
    text: '',
    createdAt: data.createdAt || Date.now(),
    status: 'streaming'
  });
  const body = element.querySelector('.message-body');
  if (body) body.textContent = '';
  state.element = element;
  state.countedUnseen = !conversationPinnedToBottom;
  timeline.appendChild(element);
  scrollConversationToBottom();
  announce('Agent response started.');
}

function flushAssistantStream(id) {
  const state = assistantStreamStates.get(id);
  if (!state) return;
  state.frame = 0;
  if (!state.pending) return;
  state.text += state.pending;
  state.pending = '';
  const element = state.element?.isConnected ? state.element : assistantMessageElement(id);
  const body = element?.querySelector('.message-body');
  const visibleText = (state.transientText || '') + state.text;
  if (body) body.textContent = visibleText;
  if (element) messageSources.set(element, visibleText);
  scrollConversationToBottom({ countUpdate: false });
}

function appendAssistantDelta(data) {
  if (!data?.id || !data?.runId || typeof data.delta !== 'string') return;
  if (!assistantStreamStates.has(data.id)) {
    startAssistantStream({ id: data.id, runId: data.runId, createdAt: Date.now() });
  }
  const state = assistantStreamStates.get(data.id);
  if (!state || state.runId !== data.runId || Number(data.sequence) <= state.sequence) return;
  state.sequence = Number(data.sequence);
  state.pending += data.delta;
  if (!state.frame) state.frame = requestAnimationFrame(() => flushAssistantStream(data.id));
}

function resetAssistantStream(data) {
  const state = assistantStreamStates.get(data?.id);
  if (!state || state.runId !== data.runId || Number(data.sequence) <= state.sequence) return;
  state.sequence = Number(data.sequence);
  if (state.frame) cancelAnimationFrame(state.frame);
  state.frame = 0;
  state.pending = '';
  state.text = '';
  state.transientText = ((state.transientText || '') + (state.element?.querySelector('.message-body')?.textContent || '')).slice(-12_000);
  state.element?.classList.add('tool-turn');
  const body = state.element?.querySelector('.message-body');
  if (body) body.textContent = state.transientText;
}

function completeAssistantMessage(message) {
  const state = assistantStreamStates.get(message.id);
  if (state?.frame) cancelAnimationFrame(state.frame);
  const existing = state?.element?.isConnected ? state.element : assistantMessageElement(message.id);
  const completed = createMessageElement({ ...message, status: 'complete' });
  if (existing) {
    existing.replaceWith(completed);
    scrollConversationToBottom({ countUpdate: false });
  } else {
    document.getElementById('welcome')?.remove();
    timeline.appendChild(completed);
    scrollConversationToBottom();
  }
  assistantStreamStates.delete(message.id);
  messageSources.set(completed, String(message.text || ''));
  announce('Agent response completed.');
}

function markAssistantStreamsInterrupted(outcome) {
  const statusName = outcome === 'cancelled' ? 'cancelled' : 'failed';
  assistantStreamStates.forEach((state, id) => {
    if (state.frame) cancelAnimationFrame(state.frame);
    if (state.pending) {
      state.text += state.pending;
      state.pending = '';
    }
    const element = state.element?.isConnected ? state.element : assistantMessageElement(id);
    if (!element || !state.text) {
      element?.remove();
      return;
    }
    element.classList.remove('streaming');
    element.classList.add(statusName);
    element.dataset.messageStatus = statusName;
    const label = element.querySelector('.message-state');
    if (label) label.textContent = 'partial · ' + statusName;
    const body = element.querySelector('.message-body');
    if (body) body.textContent = state.text;
    messageSources.set(element, state.text);
  });
  assistantStreamStates.clear();
}

function clearAssistantStreams() {
  assistantStreamStates.forEach(state => {
    if (state.frame) cancelAnimationFrame(state.frame);
  });
  assistantStreamStates.clear();
}

function historyBatchStart(messages, preferredStart) {
  let start = Math.max(0, preferredStart);
  if (start > 0 && messages[start]?.role === 'assistant') start -= 1;
  return start;
}

function renderHistoryFold() {
  timeline.querySelector('[data-history-fold]')?.remove();
  if (!hiddenHistoryMessages.length) return;
  const fold = document.createElement('section');
  fold.className = 'history-fold';
  fold.dataset.historyFold = '';
  const amount = Math.min(HISTORY_REVEAL_BATCH, hiddenHistoryMessages.length);
  fold.innerHTML = '<button type="button" data-show-earlier aria-label="Show earlier conversation messages">Show ' +
    amount + ' earlier message' + (amount === 1 ? '' : 's') + '</button>';
  timeline.insertBefore(fold, timeline.firstChild);
}

function renderConversationHistory(history) {
  const messages = Array.isArray(history) ? history : [];
  hiddenHistoryMessages = [];
  if (!messages.length) return;
  document.getElementById('welcome')?.remove();
  const start = historyBatchStart(messages, messages.length - RECENT_HISTORY_MESSAGES);
  hiddenHistoryMessages = messages.slice(0, start);
  messages.slice(start).forEach(message => timeline.appendChild(createMessageElement(message)));
  renderHistoryFold();
  scrollConversationToBottom({ force: true, countUpdate: false });
}

function revealEarlierHistory() {
  if (!hiddenHistoryMessages.length) return;
  const previousHeight = timeline.scrollHeight;
  const start = historyBatchStart(
    hiddenHistoryMessages,
    hiddenHistoryMessages.length - HISTORY_REVEAL_BATCH
  );
  const batch = hiddenHistoryMessages.splice(start);
  const anchor = timeline.querySelector('.message');
  batch.forEach(message => timeline.insertBefore(createMessageElement(message), anchor));
  renderHistoryFold();
  requestAnimationFrame(() => {
    timeline.scrollTop += Math.max(0, timeline.scrollHeight - previousHeight);
  });
  announce(batch.length + ' earlier conversation messages shown.');
}

function elapsedRunTime(startedAt) {
  const seconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  if (seconds < 60) return seconds + 's';
  const minutes = Math.floor(seconds / 60);
  return minutes + 'm ' + String(seconds % 60).padStart(2, '0') + 's';
}

function renderActivityOverview() {
  const total = currentRunSummary.plan.length;
  const completed = currentRunSummary.plan.filter(item => item.completed).length;
  const events = runActivityState?.events.slice(-3) || [];
  const progress = total ? completed + '/' + total : '';
  activityMeta.textContent = [busy ? elapsedRunTime(currentRunSummary.startedAt) : '', progress]
    .filter(Boolean)
    .join(' · ');
  const stats = [
    total ? completed + '/' + total + ' complete' : '',
    currentRunSummary.files.size ? currentRunSummary.files.size + ' file' + (currentRunSummary.files.size === 1 ? '' : 's') : '',
    currentRunSummary.commands.length ? currentRunSummary.commands.length + ' command' + (currentRunSummary.commands.length === 1 ? '' : 's') : '',
    events.filter(event => event.kind === 'APPROVAL').length ? events.filter(event => event.kind === 'APPROVAL').length + ' approval' + (events.filter(event => event.kind === 'APPROVAL').length === 1 ? '' : 's') + ' shown' : ''
  ].filter(Boolean);
  planSummary.textContent = stats.length ? stats.join(' · ') : 'Waiting for plan updates';
  planLatest.classList.toggle('hidden', !events.length);
  planActivityItems.innerHTML = events.map(event =>
    '<li class="' + (event.kind === 'APPROVAL' ? 'approval' : '') + '"><strong>' + escapeHtml(event.kind) + '</strong><span>' + escapeHtml(event.title) + '</span></li>'
  ).join('');
  const canExpand = total > 0 || events.length > 0;
  activityDock.classList.toggle('has-plan', canExpand);
  if (!canExpand && activityDock.classList.contains('expanded')) setActivityExpanded(false);
}

function ensureRunActivity() {
  if (runActivityState) return runActivityState;
  runActivityState = { events: [], startedAt: currentRunSummary.startedAt };
  clearInterval(runActivityTimer);
  runActivityTimer = setInterval(renderActivityOverview, 1000);
  return runActivityState;
}

function updateRunActivityStatus(label) {
  if (!busy || !label || label === 'Ready') return;
  status.textContent = label;
  ensureRunActivity();
  renderActivityOverview();
}

function finishRunActivity() {
  clearInterval(runActivityTimer);
  runActivityTimer = undefined;
  runActivityState = null;
  renderActivityOverview();
}

function updatePendingMessage(text, html = '') {
  const userMessages = timeline.querySelectorAll('.message.user');
  const latest = userMessages[userMessages.length - 1];
  const body = latest?.querySelector('.message-body');
  if (body) body.innerHTML = html || renderText(text);
}

function recoveryActions(primaryLabel = 'Try again') {
  const disabled = busy || remoteRunActive || !pendingRequestId ? ' disabled' : '';
  return '<div class="recovery-actions">' +
    '<button type="button" data-retry-pending' + disabled + '>' + escapeHtml(primaryLabel) + '</button>' +
    '<button type="button" data-edit-pending' + disabled + '>Edit & resend</button>' +
    '<button type="button" data-discard-pending' + disabled + '>Discard request</button></div>';
}

function appendRecovery(message, isError = false, allowRecovery = true, primaryLabel = 'Try again', showRefresh = false) {
  if (!pendingRequestText && !isError && !showRefresh) return;
  const element = document.createElement('div');
  element.className = isError ? 'error' : 'recovery';
  element.setAttribute('role', isError ? 'alert' : 'status');
  element.setAttribute('aria-atomic', 'true');
  element.innerHTML = '<div class="recovery-copy">' + escapeHtml(message) + '</div>' +
    (pendingRequestText && allowRecovery ? recoveryActions(primaryLabel) :
      (showRefresh ? '<div class="recovery-actions"><button type="button" data-refresh-run>Refresh status</button></div>' : ''));
  timeline.appendChild(element);
  scrollConversationToBottom();
}

function resizePrompt() {
  prompt.style.height = 'auto';
  prompt.style.height = Math.min(prompt.scrollHeight, 180) + 'px';
}

function updateComposerHint() {
  composerHint.textContent = prompt.value
    ? 'Draft kept locally · Enter to send · Shift+Enter for newline'
    : 'Enter to send · Shift+Enter for newline';
}

function rememberDraftLocally() {
  if (!activeThreadId) return;
  const draft = prompt.value.slice(0, 50000);
  if (draft) localDrafts[activeThreadId] = draft;
  else delete localDrafts[activeThreadId];
  persistWebviewState();
}

function persistDraftNow() {
  if (!activeThreadId) return;
  clearTimeout(draftTimer);
  rememberDraftLocally();
  vscode.postMessage({ type: 'draftChanged', threadId: activeThreadId, text: prompt.value });
  updateComposerHint();
}

function scheduleDraftPersist() {
  clearTimeout(draftTimer);
  rememberDraftLocally();
  updateComposerHint();
  draftTimer = setTimeout(persistDraftNow, 300);
}

function appendActivity(kind, title, detail) {
  if (kind === 'files') {
    const fileMatch = /^(modified|created|deleted):\s+(.+)$/.exec(title);
    if (fileMatch && !currentRunSummary.files.has(fileMatch[2])) {
      currentRunSummary.files.set(fileMatch[2], {
        id: '',
        path: fileMatch[2],
        kind: fileMatch[1],
        restored: false
      });
    }
  } else if (kind === 'command') {
    const commandMatch = /^(.*) · exit (-?\d+)$/.exec(title);
    if (commandMatch) currentRunSummary.commands.push({
      title: commandMatch[1],
      exitCode: Number(commandMatch[2]),
      output: detail || '',
      verification: /(?:^|\s)(?:test|tests|check|lint|build|typecheck|pytest|vitest|jest|mocha)(?:\s|:|$)/i.test(commandMatch[1])
    });
  } else if (kind === 'memory') {
    currentRunSummary.memoryUpdates += 1;
  }
  const state = ensureRunActivity();
  state.events.push({ kind: String(kind).toUpperCase(), title, detail: detail || '' });
  if (state.events.length > 100) state.events.splice(0, state.events.length - 100);
  appendExecutionTimelineEvent(kind, title, detail);
  renderActivityOverview();
}

function localLinkify(value) {
  return escapeHtml(String(value || '')).replace(/(https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?[^\s<]*)/g, '<a class="local-activity-link" href="$1" target="_blank" rel="noreferrer">$1</a>');
}

function executionEventIcon(kind, title) {
  const normalizedKind = String(kind || '').toLowerCase();
  const normalizedTitle = String(title || '').toLowerCase();
  if (normalizedKind === 'approval' || normalizedTitle.includes('approval') || normalizedTitle.includes('confirmation')) return '⚠';
  if (normalizedKind === 'browser' || normalizedTitle.includes('browser') || normalizedTitle.includes('screenshot')) return '◉';
  if (normalizedKind === 'command' || normalizedTitle.includes('command') || normalizedTitle.includes('ran ')) return '⌘';
  if (normalizedKind === 'files' || normalizedTitle.includes('read ') || normalizedTitle.includes('file')) return '▣';
  if (normalizedKind === 'memory' || normalizedTitle.includes('memory')) return '◆';
  if (normalizedKind === 'tool' || normalizedTitle.includes('searched') || normalizedTitle.includes('inspected')) return '⌕';
  if (normalizedKind === 'goal' || normalizedTitle.includes('goal')) return '◇';
  if (normalizedKind === 'status') return '·';
  return '›';
}

function appendExecutionTimelineEvent(kind, title, detail = '') {
  document.getElementById('welcome')?.remove();
  const element = document.createElement('article');
  const normalizedKind = String(kind || 'activity').toLowerCase();
  if (normalizedKind === 'status' && String(title || '').toLowerCase() !== 'ready') {
    element.className = 'thinking-event';
    element.innerHTML = '<details open><summary><strong>Thinking</strong><small>' + escapeHtml(String(title || '')) + '</small></summary><div class="thinking-event-body"><span>' + escapeHtml(String(title || '')) + '</span>' + (detail ? '<span>' + localLinkify(detail) + '</span>' : '') + '</div></details>';
  } else {
    element.className = 'execution-event execution-event-' + escapeHtml(normalizedKind);
    element.innerHTML = '<span class="execution-event-icon" aria-hidden="true">' + executionEventIcon(kind, title) + '</span><div class="execution-event-heading"><span class="execution-event-signal" aria-hidden="true"></span><strong>' + escapeHtml(String(kind || 'activity').toUpperCase()) + '</strong><span>' + escapeHtml(String(title || '')) + '</span></div>' +
      (detail ? '<div class="execution-event-detail">' + localLinkify(detail) + '</div>' : '');
  }
  // Keep execution history before the in-flight assistant message. The assistant
  // stream is created as soon as its first delta arrives, while status/memory/tool
  // events can still arrive afterward; appending blindly would place history below
  // the final answer and force the reader to scroll upward.
  const activeAssistant = [...assistantStreamStates.values()]
    .map(state => state.element)
    .find(candidate => candidate?.isConnected);
  if (activeAssistant) timeline.insertBefore(element, activeAssistant);
  else timeline.appendChild(element);
  scrollConversationToBottom();
}

function runSummaryStats(summary) {
  const files = Array.isArray(summary.files) ? summary.files : [...summary.files.values()];
  const verifications = summary.commands.filter(command => command.verification);
  const stats = [
    files.length ? files.length + ' file' + (files.length === 1 ? '' : 's') + ' changed' : 'No direct file changes',
    summary.commands.length ? summary.commands.length + ' command' + (summary.commands.length === 1 ? '' : 's') + ' completed' : '',
    verifications.length ? verifications.filter(command => command.exitCode === 0).length + '/' + verifications.length + ' checks passed' : '',
    summary.memoryUpdates ? summary.memoryUpdates + ' memory update' + (summary.memoryUpdates === 1 ? '' : 's') : '',
    summary.contextReceipt ? '~' + formatTokenEstimate(summary.contextReceipt.estimatedTokens) + ' context tokens' : '',
    summary.verification ? (summary.verification.verdict === 'pass' ? 'Independent review passed' : 'Independent review needs attention') : '',
    summary.usage ? summary.usage.input + ' in / ' + summary.usage.output + ' out' : ''
  ].filter(Boolean);
  if (summary.omittedChanges) stats.push(summary.omittedChanges + ' change' + (summary.omittedChanges === 1 ? '' : 's') + ' not snapshotted');
  return stats;
}

function preserveRunReview(summary) {
  const review = {
    ...summary,
    files: [...summary.files.values()].map(file => ({ ...file })),
    commands: summary.commands.map(command => ({ ...command })),
    plan: summary.plan.map(item => ({ ...item })),
    verification: summary.verification ? {
      ...summary.verification,
      risks: [...summary.verification.risks],
      unverified: [...summary.verification.unverified]
    } : undefined,
    evidence: summary.evidence ? {
      ...summary.evidence,
      commands: summary.evidence.commands.map(item => ({ ...item })),
      diagnostics: summary.evidence.diagnostics.map(item => ({ ...item })),
      browser: summary.evidence.browser.map(item => ({ ...item })),
      processes: summary.evidence.processes.map(item => ({ ...item })),
      diffs: (summary.evidence.diffs || []).map(item => ({ ...item })),
      mcp: (summary.evidence.mcp || []).map(item => ({ ...item })),
      playbooksRead: [...summary.evidence.playbooksRead]
    } : undefined,
    contextReceipt: summary.contextReceipt ? {
      ...summary.contextReceipt,
      guidanceFiles: [...summary.contextReceipt.guidanceFiles],
      pinnedSources: summary.contextReceipt.pinnedSources.map(source => ({ ...source })),
      memory: { ...summary.contextReceipt.memory, references: [...summary.contextReceipt.memory.references] }
    } : undefined
  };
  runReviews.set(review.id, review);
  while (runReviews.size > 10) runReviews.delete(runReviews.keys().next().value);
  return review;
}

function renderRunSummary() {
  finishRunActivity();
  currentRunSummary.finishedAt = Date.now();
  renderActivityOverview();
  const summary = preserveRunReview(currentRunSummary);
  const stats = runSummaryStats(summary);
  const element = document.createElement('section');
  element.className = 'run-summary' + (summary.failed ? ' failed' : '');
  const title = summary.cancelled ? 'Run cancelled' : (summary.failed ? 'Run finished with an error' : 'Run complete');
  element.setAttribute('aria-label', title);
  element.innerHTML = '<div class="run-summary-heading"><strong>' + title + '</strong>' +
    '<button type="button" data-open-run-review="' + escapeHtml(summary.id) + '" aria-expanded="false" aria-controls="run-review-panel">Review run</button></div>' +
    '<div class="run-summary-stats">' + stats.map(escapeHtml).join(' · ') + '</div>' +
    (summary.cancelled && pendingRequestText ? recoveryActions() : '');
  timeline.appendChild(element);
  scrollConversationToBottom();
  announce(title + '. Review evidence is available.');
}

function renderRunReview(summary) {
  const title = summary.cancelled ? 'Run cancelled' : (summary.failed ? 'Run finished with an error' : 'Run complete');
  const outcomeClass = summary.cancelled ? ' cancelled' : (summary.failed ? ' failed' : '');
  const duration = summary.finishedAt && summary.startedAt
    ? Math.max(0, Math.round((summary.finishedAt - summary.startedAt) / 1000)) + 's'
    : '';
  const plan = summary.plan.length
    ? '<section class="run-review-section"><div class="section-label">PLAN</div><ol class="run-review-list">' +
      summary.plan.map(item => '<li class="run-review-row' + (item.completed ? ' done' : '') + '"><span class="run-review-row-copy">' +
        (item.completed ? '✓ ' : '○ ') + escapeHtml(item.text) + '</span></li>').join('') + '</ol></section>'
    : '';
  const files = summary.files.length
    ? '<section class="run-review-section"><div class="section-label">FILES</div><ul class="run-review-list">' +
      summary.files.map(file => {
      const label = String(file.kind || 'modified').toUpperCase();
      const safePath = escapeHtml(file.path);
      const actions = file.id
        ? '<span class="run-review-actions"><button type="button" data-review-change="' + escapeHtml(file.id) + '" aria-label="View diff for ' + safePath + '">Diff</button>' +
          '<button type="button" data-restore-change="' + escapeHtml(file.id) + '" aria-label="Restore ' + safePath + '"' + (file.restored ? ' disabled' : '') + '>' +
          (file.restored ? 'Restored' : 'Restore') + '</button></span>'
        : '';
        return '<li class="run-review-row" data-evidence-type="diff" data-change-item="' + escapeHtml(file.id || '') + '">' +
          '<span class="run-review-row-copy"><strong>' + escapeHtml(label) + '</strong> · ' + safePath + '</span>' + actions + '</li>';
      }).join('') + '</ul></section>'
    : '';
  const commands = summary.commands.length
    ? '<section class="run-review-section"><div class="section-label">COMMANDS & CHECKS</div><ul class="run-review-list">' +
      summary.commands.map(command => '<li class="run-review-row' + (command.exitCode === 0 ? '' : ' failed') + '" data-evidence-type="' + (command.verification ? 'test' : 'command') + '">' +
        '<span class="run-review-row-copy"><strong>' + (command.verification ? 'CHECK' : 'COMMAND') + '</strong> · ' +
        escapeHtml(command.title) + '</span><span>exit ' + command.exitCode + (command.verification ? ' <button type="button" data-open-terminal-command="' + escapeHtml(command.title) + '">Open in terminal</button>' : '') + '</span>' +
        (command.output ? '<details class="run-review-output"><summary>Output</summary><pre>' + escapeHtml(command.output) + '</pre></details>' : '') +
        '</li>').join('') + '</ul></section>'
    : '';
  const usage = summary.usage || summary.memoryUpdates
    ? '<section class="run-review-section"><div class="section-label">USAGE & MEMORY</div><ul class="run-review-list">' +
      (summary.usage ? '<li class="run-review-row"><span class="run-review-row-copy">Model tokens</span><span>' +
        summary.usage.input + ' in · ' + summary.usage.output + ' out</span></li>' : '') +
      (summary.memoryUpdates ? '<li class="run-review-row"><span class="run-review-row-copy">Durable memory updates</span><span>' +
        summary.memoryUpdates + '</span></li>' : '') + '</ul></section>'
    : '';
  const verification = summary.verification
    ? '<section class="run-review-section"><div class="section-label">INDEPENDENT VERIFICATION</div>' +
      '<div class="run-review-overview' + (summary.verification.verdict === 'pass' ? '' : ' failed') + '"><span class="run-review-signal" aria-hidden="true"></span>' +
      '<span class="run-review-copy"><strong>' + escapeHtml(summary.verification.verdict === 'pass' ? 'Evidence passed review' : 'Needs attention') + '</strong>' +
      '<small>' + escapeHtml(summary.verification.summary) + '</small></span></div>' +
      evidenceList('Risks', summary.verification.risks) + evidenceList('Not verified', summary.verification.unverified) + '</section>'
    : '';
  const browserObservations = summary.evidence
    ? summary.evidence.browser.filter(item => item.detail).map(item => String(item.action || 'visual check') + ': ' + item.detail)
    : [];
  const evidence = summary.evidence
    ? '<section class="run-review-section"><div class="section-label">LOCAL EVIDENCE</div><label class="evidence-filter-label">Filter <select data-evidence-filter aria-label="Filter evidence by type"><option value="all">All evidence</option><option value="test">Tests</option><option value="diagnostic">Diagnostics</option><option value="diff">Diffs</option><option value="visual">Visual/browser</option><option value="command">Commands</option><option value="mcp">MCP tools</option></select></label><ul class="run-review-list">' +
      '<li class="run-review-row" data-evidence-type="diagnostic"><span class="run-review-row-copy"><strong>PROBLEMS</strong> · ' + summary.evidence.diagnostics.length + ' inspection' + (summary.evidence.diagnostics.length === 1 ? '' : 's') + '</span><button type="button" data-open-problems>Open diagnostics</button></li>' +
      '<li class="run-review-row" data-evidence-type="visual"><span class="run-review-row-copy"><strong>BROWSER</strong> · ' + summary.evidence.browser.length + ' check' + (summary.evidence.browser.length === 1 ? '' : 's') +
      '<small>' + summary.evidence.browser.reduce((sum, item) => sum + item.pageErrors + item.consoleErrors, 0) + ' page/console errors observed · ' +
      summary.evidence.browser.filter(item => item.analyzed).length + ' visual analyses</small></span></li>' +
      '<li class="run-review-row" data-evidence-type="command"><span class="run-review-row-copy"><strong>LOCAL PROCESSES</strong> · ' + summary.evidence.processes.length + ' observed action' + (summary.evidence.processes.length === 1 ? '' : 's') + '</span></li>' +
      '<li class="run-review-row" data-evidence-type="mcp"><span class="run-review-row-copy"><strong>MCP TOOLS</strong> · ' + ((summary.evidence.mcp || []).length ? (summary.evidence.mcp || []).map(item => escapeHtml(item.tool)).join(', ') : 'none invoked') + '</span></li>' +
      '<li class="run-review-row" data-evidence-type="diff"><span class="run-review-row-copy"><strong>DIFFS</strong> · ' + ((summary.evidence.diffs || []).length || summary.files.length) + ' tracked file change' + (((summary.evidence.diffs || []).length || summary.files.length) === 1 ? '' : 's') + '</span></li>' +
      '<li class="run-review-row" data-evidence-type="command"><span class="run-review-row-copy"><strong>PROJECT MAP</strong> · ' + (summary.evidence.projectIndexInspected ? 'inspected' : 'not used') +
      '<small>' + summary.evidence.playbooksRead.length + ' playbook' + (summary.evidence.playbooksRead.length === 1 ? '' : 's') + ' used</small></span></li>' +
      '</ul>' + evidenceList('Visual observations', browserObservations) + '</section>'
    : '';
  const receipt = summary.contextReceipt;
  const contextEvidence = receipt
    ? '<section class="run-review-section"><div class="section-label">CONTEXT USED</div><ul class="run-review-list">' +
      '<li class="run-review-row"><span class="run-review-row-copy"><strong>EDITOR & WORKSPACE</strong> · ' +
      escapeHtml(receipt.automaticContextEnabled ? (receipt.activeFile || 'No active file') : 'Automatic context disabled') +
      '<small>' + receipt.diagnostics + ' diagnostics · ' + receipt.openFiles + ' open files · ' + receipt.projectFiles + ' sampled paths</small></span></li>' +
      '<li class="run-review-row"><span class="run-review-row-copy"><strong>PROJECT GUIDANCE</strong> · ' +
      receipt.guidanceFiles.length + ' included</span>' + contextSourceDetails(receipt.guidanceFiles) + '</li>' +
      '<li class="run-review-row"><span class="run-review-row-copy"><strong>PINNED BY USER</strong> · ' +
      receipt.pinnedSources.length + ' selected</span>' + contextSourceDetails(receipt.pinnedSources.map(source =>
        source.filename + ' · ' + (source.kind === 'file' ? 'file' : source.range)
      )) + '</li>' +
      '<li class="run-review-row"><span class="run-review-row-copy"><strong>PROJECT MEMORY</strong> · ' +
      escapeHtml(receipt.memory.mode === 'semantic'
        ? receipt.memory.recalledChunks + ' semantic chunk' + (receipt.memory.recalledChunks === 1 ? '' : 's')
        : 'recent durable memory') +
      (receipt.memory.fallback ? '<small>Semantic retrieval fell back to recent local memory.</small>' : '') + '</span>' +
      contextSourceDetails(receipt.memory.references || []) + '</li>' +
      '<li class="run-review-row"><span class="run-review-row-copy"><strong>BOUNDED CONTEXT</strong> · ~' +
      formatTokenEstimate(receipt.estimatedTokens) + ' tokens · ' + receipt.utilizationPercent + '%</span><span>' +
      (receipt.truncated ? 'truncated' : 'complete') + '</span></li></ul></section>'
    : '';
  const canUndoRun = !summary.omittedChanges && summary.files.length &&
    summary.files.every(file => file.id) && summary.files.some(file => !file.restored);
  const undoRun = canUndoRun
    ? '<button type="button" class="undo-run" data-restore-run="' + escapeHtml(summary.id) + '">Undo all file changes</button>'
    : '';
  runReviewTitle.textContent = title;
  runReviewContent.innerHTML = '<div class="run-review-overview' + outcomeClass + '"><span class="run-review-signal" aria-hidden="true"></span>' +
    '<span class="run-review-copy"><strong>' + escapeHtml(title) + '</strong><small>' +
    escapeHtml(summary.error || (summary.failed ? 'Review the failed step and retry when ready.' : 'Execution evidence collected locally.')) +
    '</small><span class="run-review-stats">' + escapeHtml([...runSummaryStats(summary), duration].filter(Boolean).join(' · ')) +
    '</span></span></div>' + contextEvidence + plan + files + commands + evidence + verification + usage +
    ((summary.files.length || summary.commands.length) ? '<div class="run-review-footer">' + undoRun + '<button type="button" data-open-changes>Open Source Control</button></div>' : '');
}

function evidenceList(label, items) {
  if (!items?.length) return '';
  return '<div class="run-review-output"><strong>' + escapeHtml(label) + '</strong><ul>' +
    items.map(item => '<li>' + escapeHtml(item) + '</li>').join('') + '</ul></div>';
}

function contextSourceDetails(sources) {
  if (!sources.length) return '';
  return '<details class="run-review-output"><summary>Files</summary><ul>' +
    sources.map(source => '<li>' + escapeHtml(source) + '</li>').join('') + '</ul></details>';
}

function openRunReview(id, trigger) {
  const summary = runReviews.get(id);
  if (!summary) return;
  activeRunReviewId = id;
  renderRunReview(summary);
  openTopPanel(runReviewPanel, trigger, runReviewTitle);
}

function setBusy(value) {
  const wasBusy = busy;
  busy = value;
  if (!value || (value && !wasBusy)) setCancellationPending(false);
  const locked = value || remoteRunActive;
  send.disabled = locked;
  cancel.classList.toggle('hidden', !value);
  activityCancel.classList.toggle('hidden', !value);
  activityCancel.disabled = !value || cancellationPending;
  signal.classList.toggle('busy', locked);
  agentRuntime.disabled = locked;
  autonomyMode.disabled = locked;
  finalReviewMode.disabled = locked;
  runControls.classList.toggle('locked', locked);
  runControls.querySelector('summary').setAttribute('aria-disabled', String(locked));
  runControls.querySelector('summary').tabIndex = locked ? -1 : 0;
  if (locked) runControls.open = false;
  newThreadButton.disabled = false;
  mcpConnections.disabled = locked || mcpConnectionsPending;
  browserControl.disabled = locked || browserControlPending;
  threadsToggle.disabled = false;
  briefToggle.disabled = locked;
  contextAddFile.disabled = locked;
  contextClear.disabled = locked || !(currentContextState.pinned || []).length;
  if (locked && !briefPanel.classList.contains('hidden')) closeTopPanels(false);
  document.getElementById('memory-add').disabled = locked;
  connectionSaveButton.disabled = locked;
  advancedSetupButton.disabled = locked;
  document.getElementById('profile-import').disabled = locked;
  memoryList.querySelectorAll('[data-edit-memory], [data-delete-memory]').forEach(button => { button.disabled = locked; });
  timeline.querySelectorAll('[data-add-memory-message]').forEach(button => { button.disabled = locked; });
  timeline.querySelectorAll('[data-retry-pending], [data-edit-pending]').forEach(button => {
    button.disabled = value;
  });
  timeline.querySelectorAll('[data-discard-pending]').forEach(button => { button.disabled = value; });
  timeline.querySelectorAll('[data-restore-change]').forEach(button => {
    button.disabled = value || button.textContent === 'Restored';
  });
  document.querySelectorAll('[data-restore-run]').forEach(button => { button.disabled = value; });
  renderThreadList();
  if (!value && remoteRunActive) status.textContent = 'Agent active in another VS Code window';
  else if (!value && status.textContent !== 'Ready') status.textContent = 'Ready';
  renderActivityOverview();
  if (value) scrollConversationToBottom({ force: true });
}

function setBrowserControl(enabled, pending = false) {
  browserControlEnabled = Boolean(enabled);
  browserControlPending = Boolean(pending);
  browserControl.setAttribute('aria-pressed', String(browserControlEnabled));
  browserControl.setAttribute('aria-label', browserControlEnabled
    ? 'Disable local browser control'
    : 'Enable local browser control');
  browserControl.title = browserControlEnabled
    ? 'Browser control on — click to revoke access and close the local session'
    : 'Browser control off — click to enable access to localhost apps';
  browserControl.classList.toggle('pending', browserControlPending);
  browserControl.disabled = busy || remoteRunActive || browserControlPending;
  browserLiveControl.disabled = busy || remoteRunActive || browserControlPending;
  browserTakeControl.classList.toggle('hidden', !browserLiveMode || !busy);
  browserTakeControl.setAttribute('aria-pressed', String(browserManualControl));
  browserTakeControl.textContent = browserManualControl ? 'Return control' : 'Take control';
  browserTakeControl.disabled = !browserLiveMode || !busy || browserControlPending;
  browserLiveControl.setAttribute('aria-pressed', String(browserLiveMode));
  browserLiveControl.setAttribute('aria-label', browserLiveMode ? 'Disable live browser' : 'Enable live browser');
  browserLiveControl.title = browserLiveMode
    ? 'Live browser on — next local validation is visible and interactive'
    : 'Live browser off — click to watch the agent in a visible browser window';
}

function setBrowserLiveMode(enabled) {
  browserLiveMode = Boolean(enabled);
  browserLiveControl.setAttribute('aria-pressed', String(browserLiveMode));
  browserLiveControl.setAttribute('aria-label', browserLiveMode ? 'Disable live browser' : 'Enable live browser');
  browserLiveControl.title = browserLiveMode
    ? 'Live browser on — next local validation is visible and interactive'
    : 'Live browser off — click to watch the agent in a visible browser window';
}

function setBrowserManualControl(enabled) {
  browserManualControl = Boolean(enabled);
  browserTakeControl.classList.toggle('hidden', !browserLiveMode || !busy);
  browserTakeControl.setAttribute('aria-pressed', String(browserManualControl));
  browserTakeControl.textContent = browserManualControl ? 'Return control' : 'Take control';
}

function setMcpConnectionState(state = {}, pending = false) {
  mcpConnectionCount = Number(state.count || 0);
  mcpConnectionsPending = Boolean(pending);
  const enabled = Number(state.enabled || 0);
  const needsAttention = Number(state.needsAttention || 0);
  mcpConnections.setAttribute('aria-pressed', String(enabled > 0));
  mcpConnections.classList.toggle('attention', needsAttention > 0);
  mcpConnections.title = mcpConnectionCount
    ? enabled + ' of ' + mcpConnectionCount + ' corporate MCP connection' + (mcpConnectionCount === 1 ? '' : 's') + ' enabled'
    : 'Add a corporate MCP connection';
  mcpConnections.setAttribute('aria-label', mcpConnections.title);
  mcpConnections.disabled = busy || remoteRunActive || mcpConnectionsPending;
}

function setCancellationPending(value) {
  cancellationPending = Boolean(value);
  cancel.disabled = cancellationPending;
  cancel.textContent = cancellationPending ? 'Stopping…' : 'Cancel run';
  cancel.setAttribute('aria-label', cancellationPending ? 'Stopping current run' : 'Cancel current run');
  cancel.setAttribute('aria-busy', String(cancellationPending));
  activityCancel.disabled = !busy || cancellationPending;
  activityCancel.textContent = cancellationPending ? 'Stopping…' : 'Cancel run';
}

function setRemoteRunActive(value) {
  remoteRunActive = Boolean(value);
  setBusy(busy);
}

function setAutonomyMode(value) {
  const next = ['review', 'execute', 'plan'].includes(value) ? value : 'review';
  autonomyMode.value = next;
  autonomyMode.title = {
    review: 'Ask before every workspace change and command',
    execute: 'Apply file and project-memory edits automatically; commands and deletions still ask',
    plan: 'Inspect and plan with read-only tools'
  }[next];
  updateRunControlsSummary();
}

function updateRunControlsSummary() {
  const runtimeLabels = { standard: 'Standard', deep: 'Deep Agent' };
  const runtimeDescriptions = {
    standard: 'Predictable for most development work.',
    deep: 'Best for long tasks that benefit from planning and context compaction.'
  };
  const modeLabels = { review: 'Ask first', execute: 'Auto edits', plan: 'Plan only' };
  const modeDescriptions = {
    review: 'Confirm every workspace change and command.',
    execute: 'Apply scoped file and memory edits automatically; commands and deletions still ask.',
    plan: 'Inspect the project and prepare a read-only implementation plan.'
  };
  const reviewLabels = { off: 'No review', changes: 'Review work', always: 'Review every run' };
  const reviewDescriptions = {
    off: 'Do not make a separate final-review model call.',
    changes: 'Review runs that changed files or collected execution evidence.',
    always: 'Review every executable run with a separate call through the same model provider.'
  };
  const runtime = agentRuntime.value === 'deep' ? 'deep' : 'standard';
  const mode = ['review', 'execute', 'plan'].includes(autonomyMode.value) ? autonomyMode.value : 'review';
  const review = ['off', 'changes', 'always'].includes(finalReviewMode.value) ? finalReviewMode.value : 'changes';
  runControlsLabel.textContent = modeLabels[mode] + ' · ' + runtimeLabels[runtime] + ' · ' + reviewLabels[review];
  runtimeHelp.textContent = runtimeDescriptions[runtime];
  modeHelp.textContent = modeDescriptions[mode];
  finalReviewHelp.textContent = reviewDescriptions[review];
  runControls.querySelector('summary').title = modeDescriptions[mode] + ' ' + runtimeDescriptions[runtime] + ' ' + reviewDescriptions[review];
}

function setActivityExpanded(expanded) {
  const canExpand = activityDock.classList.contains('has-plan');
  const next = Boolean(expanded && canExpand);
  activityDock.classList.toggle('expanded', next);
  activityToggle.setAttribute('aria-expanded', String(next));
  activityToggle.setAttribute('aria-disabled', String(!canExpand));
  document.getElementById('plan-panel').setAttribute('aria-hidden', String(!next));
  activityToggle.title = canExpand
    ? (next ? 'Collapse current plan' : 'Expand current plan')
    : 'Agent activity';
}

function setThreadPanelOpen(open, restoreFocus = true) {
  if (open) {
    openTopPanel(
      threadPanel,
      threadsToggle,
      threadSearch
    );
  } else if (!threadPanel.classList.contains('hidden')) {
    closeTopPanels(restoreFocus);
  }
}

function openMemoryCenter() {
  memoryOverview.textContent = 'Loading local memory…';
  memoryList.innerHTML = '';
  openTopPanel(memoryPanel, memoryToggle, memoryPanelTitle);
  vscode.postMessage({ type: 'openMemoryCenter' });
}

function captureBriefState() {
  briefState = normalizeBriefState({
    objective: briefObjective.value,
    scope: briefScope.value,
    done: briefDone.value,
    constraints: briefConstraints.value
  });
  persistWebviewState();
}

function openTaskBrief() {
  if (busy || remoteRunActive) return;
  briefError.classList.add('hidden');
  openTopPanel(briefPanel, briefToggle, briefObjective);
}

function taskBriefMessage() {
  const objective = briefObjective.value.trim();
  if (!objective) return '';
  const sections = [['Objective', objective]];
  if (briefScope.value.trim()) sections.push(['Scope', briefScope.value.trim()]);
  if (briefDone.value.trim()) sections.push(['Done when', briefDone.value.trim()]);
  if (briefConstraints.value.trim()) sections.push(['Constraints', briefConstraints.value.trim()]);
  sections.push([
    'Working agreement',
    '- Inspect the relevant code and present a concise plan before changing files.\n' +
    '- Ask only when a missing decision would materially change the result.\n' +
    '- After changes, run the relevant local checks and summarize the evidence.'
  ]);
  return sections.map(([label, value]) => label + ':\n' + value).join('\n\n');
}

function useTaskBrief() {
  captureBriefState();
  const message = taskBriefMessage();
  if (!message) {
    briefError.textContent = 'Describe the objective before creating the message.';
    briefError.classList.remove('hidden');
    briefObjective.focus();
    return;
  }
  briefError.classList.add('hidden');
  const existing = prompt.value.trim();
  if (!existing.includes(message)) {
    prompt.value = (existing ? existing + '\n\n' : '') + message;
  }
  prompt.value = prompt.value.slice(0, 50000);
  resizePrompt();
  updatePromptTokenEstimate();
  scheduleDraftPersist();
  closeTopPanels(false);
  prompt.focus();
  status.textContent = existing ? 'Task brief added to the draft' : 'Task brief prepared';
  announce(status.textContent + '. Nothing has been sent.');
}

function clearTaskBrief() {
  briefObjective.value = '';
  briefScope.value = '';
  briefDone.value = '';
  briefConstraints.value = '';
  briefError.classList.add('hidden');
  captureBriefState();
  briefObjective.focus();
  announce('Task brief fields cleared. The message draft was not changed.');
}

function renderMemoryState(memory, message = '') {
  const state = memory || { entries: [], total: 0, omitted: 0, semantic: false };
  const entries = state.entries || [];
  const retrieval = state.semantic
    ? 'Semantic retrieval with ' + (state.embeddingModel || 'the configured embedding model')
    : 'Recent memory is injected without vector retrieval';
  memoryOverview.setAttribute('role', 'status');
  memoryOverview.textContent = Number(state.total || 0) + ' durable entr' + (Number(state.total || 0) === 1 ? 'y' : 'ies') +
    ' · ' + retrieval + (state.omitted ? ' · ' + state.omitted + ' older entries hidden' : '') +
    (message ? ' · ' + message : '');
  memoryList.innerHTML = entries.length
    ? entries.map(entry =>
        '<div class="memory-item"><span class="memory-item-copy"><p>' + escapeHtml(entry.text) + '</p><small>' +
        (entry.date ? 'Saved ' + escapeHtml(entry.date) : 'Undated entry') +
        (entry.redacted ? ' · credential-like text hidden' : '') + '</small></span>' +
        '<span class="memory-item-actions"><button type="button" data-edit-memory="' + escapeHtml(entry.id) + '" aria-label="Edit memory entry">Edit</button>' +
        '<button type="button" data-delete-memory="' + escapeHtml(entry.id) + '" aria-label="Delete memory entry">Delete</button></span></div>'
      ).join('')
    : '<div class="memory-empty">No durable memories yet. Add a confirmed project decision or convention.</div>';
  const locked = busy || remoteRunActive;
  document.getElementById('memory-add').disabled = locked;
  memoryList.querySelectorAll('[data-edit-memory], [data-delete-memory]').forEach(button => { button.disabled = locked; });
}

function renderThreads(data) {
  activeThreadId = data.activeThreadId || '';
  currentThreadSummaries = data.threads || [];
  const validThreadIds = new Set(currentThreadSummaries.map(thread => thread.id));
  Object.keys(localDrafts).forEach(threadId => {
    if (!validThreadIds.has(threadId)) delete localDrafts[threadId];
  });
  persistWebviewState();
  renderThreadList();
  renderGoals(data.goals || []);
}

let activeGoalId = '';
let activeGoalStatus = '';
let activeGoalRecord = undefined;
let goalModeEnabled = false;

function setGoalMode(enabled) {
  goalModeEnabled = Boolean(enabled);
  goalButton.classList.toggle('selected', goalModeEnabled);
  goalButton.setAttribute('aria-pressed', String(goalModeEnabled));
  goalButton.textContent = goalModeEnabled ? 'Goal on' : 'Goal';
  goalButton.setAttribute('aria-label', goalModeEnabled
    ? 'Goal mode enabled; the next message will start a persistent goal'
    : 'Send the next message as a persistent goal');
  if (goalModeEnabled) {
    status.textContent = 'Goal mode · next message starts a persistent goal';
    announce(status.textContent);
  }
}

function appendGoalTimeline(goal, detail = '') {
  if (!goal) return;
  document.getElementById('welcome')?.remove();
  const verified = (goal.criteria || []).filter(item => item.status === 'verified').length;
  const total = (goal.criteria || []).length;
  const milestone = (goal.milestones || []).find(item => item.id === goal.currentMilestoneId);
  const element = document.createElement('article');
  element.className = 'goal-event';
  element.innerHTML = '<div class="goal-event-heading"><span class="goal-event-signal" aria-hidden="true"></span><strong>Goal · ' + escapeHtml(goal.status) + '</strong><small>iteration ' + Number(goal.iteration || 0) + '</small></div>' +
    '<div class="goal-event-objective">' + escapeHtml(goal.objective || goal.title || '') + '</div>' +
    '<div class="goal-event-progress">' + verified + '/' + total + ' criteria verified' + (milestone?.title ? ' · ' + escapeHtml(milestone.title) : '') + '</div>' +
    (detail ? '<div class="goal-event-detail">' + escapeHtml(detail) + '</div>' : '') +
    (goal.nextAction ? '<div class="goal-event-next">Next · ' + escapeHtml(goal.nextAction) + '</div>' : '');
  timeline.appendChild(element);
  scrollConversationToBottom();
}

function renderGoals(goals) {
  const allGoals = goals || [];
  goalWorkspaceCount.textContent = String(allGoals.length);
  goalList.innerHTML = allGoals.length ? allGoals.map(goal => {
    const verified = (goal.criteria || []).filter(item => item.status === 'verified').length;
    const title = escapeHtml(goal.title || goal.objective || 'Untitled goal');
    const status = escapeHtml(goal.status);
    const action = ['active', 'awaiting-criteria'].includes(goal.status) ? 'Open' : goal.status === 'paused' ? 'Resume' : goal.status === 'blocked' ? 'Review blocker' : 'View';
    return '<button type="button" class="goal-list-item ' + (goal.threadId === activeThreadId ? 'active' : '') + '" data-goal-thread="' + escapeHtml(goal.threadId) + '"><span class="goal-list-dot ' + status + '"></span><span class="goal-list-copy"><span class="goal-list-title">' + title + '</span><span class="goal-list-meta">' + status + ' · ' + verified + '/' + (goal.criteria || []).length + ' criteria · iteration ' + Number(goal.iteration || 0) + '</span></span><span class="goal-list-action">' + action + '</span></button>';
  }).join('') : '<div class="goal-list-empty">Nenhum goal persistente neste workspace.</div>';
  goalList.querySelectorAll('[data-goal-thread]').forEach(button => button.addEventListener('click', () => vscode.postMessage({ type: 'selectThread', id: button.getAttribute('data-goal-thread') || '' })));
  const goal = (goals || []).find(item => item.threadId === activeThreadId && ['active','awaiting-criteria','paused','blocked'].includes(item.status));
  if (!goal) { goalStrip.classList.add('hidden'); goalPanel.classList.add('hidden'); activeGoalId = ''; activeGoalStatus = ''; return; }
  renderGoal(goal);
}

function renderGoal(goal) {
  if (!goal || !['active','awaiting-criteria','paused','blocked'].includes(goal.status)) {
    goalStrip.classList.add('hidden');
    goalPanel.classList.add('hidden');
    activeGoalId = '';
    activeGoalStatus = '';
    activeGoalRecord = undefined;
    return;
  }
  activeGoalId = goal.id;
  activeGoalStatus = goal.status;
  activeGoalRecord = goal;
  goalStrip.classList.remove('hidden');
  const verified = (goal.criteria || []).filter(item => item.status === 'verified').length;
  goalStripText.textContent = goal.status + ' · ' + verified + '/' + (goal.criteria || []).length + ' criteria · ' + (goal.nextAction || goal.title);
  goalResume.classList.toggle('hidden', goal.status === 'completed' || goal.status === 'cancelled');
  goalResume.textContent = goal.status === 'awaiting-criteria' ? 'Activate' : 'Resume';
  const criteria = goal.criteria || [];
  goalObjective.textContent = goal.objective || goal.title || '';
  goalProgress.textContent = 'Status: ' + goal.status + ' · Iteration ' + Number(goal.iteration || 0) + ' · ' + verified + '/' + criteria.length + ' criteria verified';
  goalCriteria.innerHTML = criteria.map(item => '<div class="goal-criterion"><span class="goal-criterion-dot ' + escapeHtml(item.status) + '"></span><span>' + escapeHtml(item.text) + (item.evidence && item.evidence.length ? '<small> · ' + escapeHtml(item.evidence[0]) + '</small>' : '') + ((item.evidenceRefs || []).length ? '<small class="goal-evidence-kinds"> · ' + escapeHtml(item.evidenceRefs.map(ref => ref.kind).join(', ')) + '</small>' : '') + '</span></div>').join('');
  goalCriteriaInput.value = criteria.map(item => item.text).join('\\n');
  goalNext.textContent = goal.nextAction ? 'Next: ' + goal.nextAction : '';
  goalPause.disabled = goal.status !== 'active';
  goalCancel.disabled = ['completed', 'cancelled'].includes(goal.status);
}

function renderThreadList() {
  const query = threadSearch.value.trim().toLocaleLowerCase();
  const recoveryLabels = {
    running: 'running',
    interrupted: 'interrupted · restart available',
    failed: 'failed · retry available',
    cancelled: 'cancelled · review effects'
  };
  const threads = currentThreadSummaries.filter(thread => {
    if (!query) return true;
    const searchText = [
      thread.title,
      thread.pinned ? 'pinned favorite important' : '',
      recoveryLabels[thread.recoveryStatus] || ''
    ].join(' ').toLocaleLowerCase();
    return searchText.includes(query);
  });
  const locked = busy || remoteRunActive;
  threadList.innerHTML = threads.length ? threads.map(thread => {
    const active = thread.id === activeThreadId;
    const recoveryLabel = recoveryLabels[thread.recoveryStatus] || '';
    const stateLabel = thread.recoveryStatus
      ? recoveryLabels[thread.recoveryStatus]
      : thread.unread ? 'finished · unseen' : thread.messageCount ? 'finished · seen' : 'ready';
    const metadata = stateLabel + ' · ' + relativeThreadTime(thread.updatedAt) + ' · ' + thread.messageCount + ' message' +
      (thread.messageCount === 1 ? '' : 's') + (thread.pinned ? ' · pinned' : '') +
      (recoveryLabel && recoveryLabel !== stateLabel ? ' · ' + recoveryLabel : '');
    const selectDisabled = '';
    const actionDisabled = locked ? ' disabled' : '';
    return '<div class="thread-item' + (active ? ' active' : '') + '">' +
      '<button class="thread-select" type="button" data-select-thread="' + escapeHtml(thread.id) + '"' + (active ? ' aria-current="true"' : '') + selectDisabled + '>' +
      '<strong>' + (thread.unread ? '<span class="thread-unread-dot" aria-label="Unseen finished thread"></span>' : '') + escapeHtml(thread.title) + '</strong><small>' + escapeHtml(metadata) + '</small></button>' +
      '<span class="thread-actions">' +
      '<button type="button" class="' + (thread.pinned ? 'pinned' : '') + '" data-pin-thread="' + escapeHtml(thread.id) + '" aria-pressed="' + String(Boolean(thread.pinned)) + '" aria-label="' + (thread.pinned ? 'Unpin ' : 'Pin ') + escapeHtml(thread.title) + '"' + actionDisabled + '>' + (thread.pinned ? '★' : '☆') + '</button>' +
      '<button type="button" data-rename-thread="' + escapeHtml(thread.id) + '" aria-label="Rename ' + escapeHtml(thread.title) + '"' + actionDisabled + '>✎</button>' +
      '<button type="button" data-delete-thread="' + escapeHtml(thread.id) + '" aria-label="Delete ' + escapeHtml(thread.title) + '"' + actionDisabled + '>×</button>' +
      '</span></div>';
  }).join('') : '<div class="thread-empty" role="status">No conversations match this search.</div>';
  const total = currentThreadSummaries.length;
  const visible = threads.length;
  document.getElementById('thread-note').textContent = (query ? visible + ' of ' : '') + total + ' local thread' +
    (total === 1 ? '' : 's') + ' · stored only in this workspace.';
}

function relativeThreadTime(value) {
  const elapsed = Math.max(0, Date.now() - Number(value || 0));
  if (elapsed < 60_000) return 'now';
  if (elapsed < 3_600_000) return Math.floor(elapsed / 60_000) + 'm ago';
  if (elapsed < 86_400_000) return Math.floor(elapsed / 3_600_000) + 'h ago';
  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function clearCurrentPlan() {
  currentRunSummary.plan = [];
  planItems.innerHTML = '';
  planActivityItems.innerHTML = '';
  planLatest.classList.add('hidden');
  planManuallyCollapsed = false;
  renderActivityOverview();
  setActivityExpanded(false);
}

function setContextExpanded(expanded) {
  contextInspector.classList.toggle('hidden', !expanded);
  contextToggle.setAttribute('aria-expanded', String(expanded));
  contextInspector.setAttribute('aria-hidden', String(!expanded));
}

function approximateTokens(characters) {
  return Math.ceil(Math.max(0, Number(characters) || 0) / 4);
}

function formatTokenEstimate(tokens) {
  const value = Math.max(0, Number(tokens) || 0);
  if (value < 1000) return String(value);
  return (value / 1000).toFixed(value < 10000 ? 1 : 0).replace(/\.0$/, '') + 'k';
}

function updatePromptTokenEstimate() {
  promptTokenEstimate.textContent = 'Prompt · ~' + formatTokenEstimate(approximateTokens(prompt.value.length)) + ' tokens';
}

function renderContextState(context) {
  currentContextState = context || { activeFile: '', autoContext: true, pinned: [], budget: {}, memory: {} };
  const activeFile = currentContextState.activeFile || 'No active file';
  const pinned = currentContextState.pinned || [];
  const budget = currentContextState.budget || {};
  const memory = currentContextState.memory || {};
  const estimatedTokens = Number(budget.estimatedTokens || 0);
  const utilization = Math.max(0, Math.min(100, Number(budget.utilizationPercent || 0)));
  document.getElementById('active-file').textContent = activeFile;
  contextBudgetChip.textContent = estimatedTokens ? '~' + formatTokenEstimate(estimatedTokens) + ' tok' : '';
  contextToggle.setAttribute('aria-label', 'Message context: ' + activeFile + ', ' + pinned.length + ' pinned, approximately ' + estimatedTokens + ' tokens');
  contextCount.textContent = String(pinned.length);
  contextCount.classList.toggle('hidden', pinned.length === 0);
  contextClear.disabled = busy || remoteRunActive || pinned.length === 0;
  contextBudgetLabel.textContent = '~' + formatTokenEstimate(estimatedTokens) + ' tokens · ' + utilization + '% of workspace context';
  contextBudgetDetail.textContent = budget.truncated
    ? 'Some project guidance, automatic, or pinned context will be truncated at the configured limit.'
    : Number(budget.maximumCharacters || 0).toLocaleString() + ' character limit';
  contextBudgetFill.style.width = utilization + '%';
  contextBudgetTrack.setAttribute('aria-valuenow', String(utilization));
  contextActiveEntry.innerHTML =
    '<span class="context-entry-copy"><strong>' + escapeHtml(activeFile) + '</strong><small>' +
    (currentContextState.activeFileSensitive
      ? 'Sensitive file · excluded from automatic and pinned context'
      : currentContextState.autoContext
      ? 'Automatic editor and workspace signals · ~' + formatTokenEstimate(approximateTokens(budget.automaticCharacters)) + ' tokens'
      : 'Automatic editor context disabled · pinned items still included') +
    '</small></span>';
  const guidanceFiles = Number(budget.guidanceFiles || 0);
  const guidancePaths = Array.isArray(budget.guidancePaths) ? budget.guidancePaths : [];
  const guidanceTokens = approximateTokens(budget.guidanceCharacters);
  contextGuidanceEntry.innerHTML = '<span class="context-entry-copy"><strong>Project guidance</strong><small>' +
    (currentContextState.autoContext
      ? guidanceFiles
        ? guidanceFiles + ' local guidance file' + (guidanceFiles === 1 ? '' : 's') + ' · ~' + formatTokenEstimate(guidanceTokens) + ' tokens'
        : 'No AGENTS.md or standard repository guidance detected'
      : 'Disabled with automatic context') +
    '</small>' + (guidancePaths.length
      ? '<details class="context-source-list"><summary>Show included files</summary><ul>' +
        guidancePaths.map(file => '<li>' + escapeHtml(file) + '</li>').join('') + '</ul></details>'
      : '') + '</span>';
  pinnedContext.innerHTML = pinned.length
    ? pinned.map(item =>
        '<div class="context-entry"><span class="context-entry-copy"><strong>' + escapeHtml(item.filename) +
        '</strong><small>' + (item.kind === 'file' ? 'File · ' : 'Selection · ') + escapeHtml(item.range) +
        ' · ~' + formatTokenEstimate(item.estimatedTokens) + ' tokens</small></span>' +
        '<button type="button" data-remove-context="' + escapeHtml(item.id) + '" aria-label="Remove ' + escapeHtml(item.filename) + ' from message context">×</button></div>'
      ).join('')
    : '<div class="context-entry"><span class="context-entry-copy"><strong>No pinned context</strong><small>Add a file here or pin an editor selection.</small></span></div>';
  const memoryDetail = memory.configured
    ? (memory.mode === 'semantic'
      ? 'Semantic retrieval after send · up to ' + Number(memory.maximumResults || 0) + ' relevant chunks from local memory'
      : 'Recent durable project memory · ~' + formatTokenEstimate(memory.estimatedTokens) + ' tokens available')
    : 'No durable project-memory entries yet';
  contextMemoryEntry.innerHTML = '<span class="context-entry-copy"><strong>Project memory</strong><small>' + escapeHtml(memoryDetail) + '</small></span>';
  updatePromptTokenEstimate();
}

function renderImageAttachments() {
  imageAttachments.classList.toggle('hidden', imageAttachmentDrafts.length === 0);
  imageAttachments.innerHTML = imageAttachmentDrafts.map((image, index) => '<span class="image-attachment"><img src="data:' + image.mimeType + ';base64,' + image.data + '" alt="' + escapeHtml(image.name || 'Attached image') + '" /><span>' + escapeHtml(image.name || 'Image') + '</span><button type="button" data-remove-image="' + index + '" aria-label="Remove image">×</button></span>').join('');
}

function addImageAttachment(file) {
  if (!file || !/^image\/(png|jpeg|webp|gif)$/.test(file.type) || imageAttachmentDrafts.length >= 4 || file.size > 6_000_000) return;
  const reader = new FileReader();
  reader.onload = () => {
    const match = String(reader.result || '').match(/^data:(image\/(?:png|jpeg|webp|gif));base64,(.+)$/);
    if (!match) return;
    imageAttachmentDrafts.push({ mimeType: match[1], data: match[2], name: file.name || 'pasted-image' });
    renderImageAttachments();
    announce('Image attached. It will be sent to the selected vision model.');
  };
  reader.readAsDataURL(file);
}

imageAttachments.addEventListener('click', event => {
  const button = event.target instanceof Element ? event.target.closest('[data-remove-image]') : null;
  if (!button) return;
  imageAttachmentDrafts.splice(Number(button.dataset.removeImage), 1);
  renderImageAttachments();
});
prompt.addEventListener('paste', event => {
  const items = [...(event.clipboardData?.items || [])];
  const image = items.find(item => item.kind === 'file' && item.type.startsWith('image/'));
  if (!image) return;
  const file = image.getAsFile();
  if (file) { event.preventDefault(); addImageAttachment(file); }
});

function submit() {
  const typedText = prompt.value.trim();
  if ((!typedText && imageAttachmentDrafts.length === 0) || busy) return;
  const text = typedText || 'Analyze the attached image(s) and describe the relevant details.';
  if (typedText && handleQuickCommand(typedText)) {
    prompt.value = '';
    resizePrompt();
    updatePromptTokenEstimate();
    return;
  }
  const replacePending = replacePendingOnSubmit;
  setBusy(true);
  status.textContent = 'Checking local readiness';
  currentRunSummary = createRunSummary();
  closeTopPanels(false);
  clearCurrentPlan();
  ensureRunActivity();
  updateRunActivityStatus('Preparing plan before the first action');
  setActivityExpanded(true);
  pendingRequestText = text;
  liveRunThreadId = activeThreadId;
  suppressLiveRunEvents = false;
  replacePendingOnSubmit = false;
  vscode.postMessage({
    type: goalModeEnabled && imageAttachmentDrafts.length === 0 ? 'createGoalAndRun' : 'send',
    text,
    mode: autonomyMode.value,
    replacePending,
    ...(goalModeEnabled && imageAttachmentDrafts.length === 0 ? { runtime: agentRuntime.value, finalReview: finalReviewMode.value } : {}),
    ...(imageAttachmentDrafts.length ? { images: imageAttachmentDrafts } : {})
  });
  setGoalMode(false);
  imageAttachmentDrafts = [];
  renderImageAttachments();
  prompt.value = '';
  resizePrompt();
  updatePromptTokenEstimate();
  persistDraftNow();
}

function handleQuickCommand(text) {
  const command = text.trim().toLowerCase();
  if (!['/status', '/resume', '/pause', '/evidence', '/env'].includes(command)) return false;
  if (command === '/env') {
    vscode.postMessage({ type: 'environmentCheck' });
    status.textContent = 'Checking local environment';
    announce(status.textContent);
    return true;
  }
  if (command === '/status') {
    const goal = activeGoalRecord;
    const message = goal
      ? 'Goal ' + goal.status + ' · iteration ' + Number(goal.iteration || 0) + ' · ' + (goal.criteria || []).filter(item => item.status === 'verified').length + '/' + (goal.criteria || []).length + ' criteria verified'
      : 'No persistent goal is selected for this thread.';
    status.textContent = message;
    announce(message);
    goalPanel.classList.toggle('hidden', !goal);
    return true;
  }
  if (command === '/resume' || command === '/pause') {
    if (!activeGoalId) { status.textContent = 'No goal is selected for this thread.'; announce(status.textContent); return true; }
    vscode.postMessage({ type: command === '/resume' ? 'resumeGoal' : 'pauseGoal', id: activeGoalId });
    return true;
  }
  if (command === '/evidence') {
    if (activeRunReviewId && runReviews.has(activeRunReviewId)) {
      openRunReview(activeRunReviewId, null);
    } else {
      status.textContent = 'No run evidence is available yet.';
      announce(status.textContent);
    }
    return true;
  }
  return false;
}

function setAsGoal() {
  if (busy) return;
  setGoalMode(!goalModeEnabled);
}

function setupStepComplete(step) {
  if (step === 1) {
    const keyReady = modelProvider.value === 'ollama' || liteLlmApiKey.value.trim() || hasStoredLiteLlmKey;
    return Boolean(liteLlmEndpoint.value.trim() && keyReady);
  }
  if (step === 2) return Boolean(liteLlmModel.value.trim());
  return false;
}

function showConnectionSetupStep(step, focus = false) {
  connectionSetupStep = Math.max(1, Math.min(3, Number(step) || 1));
  setupSteps.forEach(section => { section.hidden = Number(section.dataset.setupStep) !== connectionSetupStep; });
  setupStepButtons.forEach(button => {
    const value = Number(button.dataset.setupStepTarget);
    if (value === connectionSetupStep) button.setAttribute('aria-current', 'step');
    else button.removeAttribute('aria-current');
    button.classList.toggle('complete', value < connectionSetupStep && setupStepComplete(value));
  });
  setupBackButton.classList.toggle('hidden', connectionSetupStep === 1);
  setupNextButton.classList.toggle('hidden', connectionSetupStep === 3);
  advancedSetupButton.classList.toggle('hidden', connectionSetupStep !== 1 || modelProvider.value !== 'litellm');
  connectionTestButton.classList.toggle('hidden', connectionSetupStep !== 3);
  connectionSaveButton.classList.toggle('hidden', connectionSetupStep !== 3);
  setupStepCount.textContent = 'Step ' + connectionSetupStep + ' of 3';
  setupNextButton.textContent = connectionSetupStep === 1 ? 'Choose models' : 'Review & test';
  if (focus) {
    const heading = setupSteps.find(section => !section.hidden)?.querySelector('h3');
    requestAnimationFrame(() => heading?.focus());
  }
}

function moveToConnectionSetupStep(target) {
  const next = Math.max(1, Math.min(3, Number(target) || 1));
  liteLlmSettingsError.classList.add('hidden');
  if (next > 1 && !setupStepComplete(1)) {
    showConnectionSetupStep(1, true);
    liteLlmSettingsError.textContent = liteLlmEndpoint.value.trim()
      ? 'Add the provider key before choosing models.'
      : 'Add the provider endpoint before choosing models.';
    liteLlmSettingsError.classList.remove('hidden');
    (liteLlmEndpoint.value.trim() ? liteLlmApiKey : liteLlmEndpoint).focus();
    return;
  }
  if (next > 2 && !setupStepComplete(2)) {
    showConnectionSetupStep(2, true);
    liteLlmSettingsError.textContent = 'Choose or enter the chat model alias before testing the connection.';
    liteLlmSettingsError.classList.remove('hidden');
    liteLlmModel.focus();
    return;
  }
  showConnectionSetupStep(next, true);
}

function fillLiteLlmSettings(liteLlm) {
  diagnosticFixApplied = false;
  activeProvider = liteLlm.provider || 'litellm';
  availableModelProviders = liteLlm.availableProviders || ['litellm'];
  providerKeyStates = liteLlm.providerKeyStates || providerKeyStates;
  modelProvider.innerHTML = availableModelProviders.map(provider => {
    const label = provider === 'ollama' ? 'Ollama local' : provider === 'openai' ? 'OpenAI API' : 'LiteLLM';
    return '<option value="' + provider + '">' + label + '</option>';
  }).join('');
  modelProvider.value = activeProvider;
  liteLlmToggle.textContent = liteLlm.providerLabel || 'LiteLLM';
  document.getElementById('setup-callout-title').textContent = 'Connect ' + (liteLlm.providerLabel || 'LiteLLM');
  modelProviderField.classList.toggle('hidden', availableModelProviders.length < 2);
  providerVariantNote.textContent = liteLlm.providerVariant === 'litellm'
    ? 'Standard package · LiteLLM only'
    : 'Optional ' + liteLlm.providerVariant + ' package installed';
  liteLlmModelProfiles = liteLlm.modelProfiles || {};
  liteLlmEndpoint.value = liteLlm.endpoint || '';
  liteLlmModelsEndpoint.value = liteLlm.modelsEndpoint || '';
  liteLlmModel.value = liteLlm.model || '';
  visionModel.value = liteLlm.visionModel || '';
  profileTarget = 'chat';
  const knownModels = [...new Set([...loadedModelCatalog, ...Object.keys(liteLlmModelProfiles)])].sort();
  const chatModels = knownModels.filter(model => !isEmbeddingModel(model));
  liteLlmModelAliases.innerHTML = chatModels
    .map(model => '<option value="' + escapeHtml(model) + '"></option>')
    .join('');
  fillModelProfile(
    liteLlm.model || '',
    liteLlm,
    !liteLlmModelProfiles[String(liteLlm.model || '').trim()]
  );
  liteLlmAuthHeader.value = liteLlm.authHeader || 'authorization';
  liteLlmApiKey.value = '';
  semanticMemoryEnabled.checked = liteLlm.semanticMemoryEnabled !== false;
  embeddingEndpoint.value = liteLlm.embeddingEndpoint || '';
  fillEmbeddingModelOptions(
    knownModels.filter(isEmbeddingModel),
    liteLlm.embeddingModel || ''
  );
  agentRuntime.value = liteLlm.runtime === 'deep' ? 'deep' : 'standard';
  finalReviewMode.value = ['off', 'always'].includes(liteLlm.finalReviewMode) ? liteLlm.finalReviewMode : 'changes';
  updateRunControlsSummary();
  hasStoredLiteLlmKey = Boolean(liteLlm.hasApiKey);
  renderProviderFields();
  const savedConnectionReady = Boolean(liteLlm.endpoint && liteLlm.model && (!liteLlm.requiresKey || liteLlm.hasApiKey));
  setupCallout.classList.toggle('hidden', savedConnectionReady);
  document.getElementById('litellm-key-state').textContent = liteLlm.requiresKey
    ? (liteLlm.hasApiKey ? '· stored securely' : '· required')
    : '· not required';
  const details = [];
  if (liteLlm.caCertificatePath) details.push('CA: ' + liteLlm.caCertificatePath);
  details.push(liteLlm.providerLabel || 'LiteLLM');
  if (liteLlm.requiresKey) details.push('Auth: ' + (liteLlm.authHeader || 'authorization'));
  details.push('POST /chat/completions');
  document.getElementById('litellm-details').textContent = details.join(' · ');
  liteLlmSettingsError.classList.add('hidden');
  connectionDiagnostics.classList.add('hidden');
  updateConnectionReadiness();
  showConnectionSetupStep(connectionSetupStep);
}

function setConnectionReadiness(state, title, detail) {
  connectionReadiness.classList.remove('configured', 'verified', 'failed');
  if (state) connectionReadiness.classList.add(state);
  readinessTitle.textContent = title;
  readinessDetail.textContent = detail;
}

function updateConnectionReadiness() {
  const requiresKey = modelProvider.value !== 'ollama';
  const configured = Boolean(
    liteLlmEndpoint.value.trim() &&
    liteLlmModel.value.trim() &&
    (!requiresKey || liteLlmApiKey.value.trim() || hasStoredLiteLlmKey)
  );
  if (configured) {
    setConnectionReadiness('configured', 'Ready to test', 'Validate chat, tools and semantic memory before saving.');
  } else {
    setConnectionReadiness('', 'Setup required', requiresKey
      ? 'Add the endpoint, model and provider key.'
      : 'Add the local endpoint and Ollama model.');
  }
}

function renderProviderFields() {
  const provider = modelProvider.value || 'litellm';
  const isLiteLlm = provider === 'litellm';
  const isOllama = provider === 'ollama';
  providerSetupNote.textContent = isOllama
    ? 'Connect only to an Ollama server on this machine. No API key is used.'
    : provider === 'openai'
      ? 'Direct OpenAI access is enabled only by this explicitly installed package. The key stays in VS Code Secret Storage.'
      : 'Use the approved HTTPS gateway and keep its key in VS Code Secret Storage.';
  providerEndpointLabel.textContent = isOllama ? 'Local Ollama Base URL' : provider === 'openai' ? 'OpenAI Base URL' : 'Gateway Base URL';
  providerKeyLabel.childNodes[0].textContent = provider === 'openai' ? 'OpenAI API Key ' : 'Gateway Key ';
  providerKeyField.classList.toggle('hidden', isOllama);
  authHeaderField.classList.toggle('hidden', !isLiteLlm);
  modelCatalogField.classList.toggle('hidden', !isLiteLlm);
  ollamaModelDiscovery.classList.toggle('hidden', !isOllama);
  profileActions.classList.toggle('hidden', !isLiteLlm);
  advancedSetupButton.classList.toggle('hidden', connectionSetupStep !== 1 || !isLiteLlm);
  liteLlmEndpoint.readOnly = provider === 'openai';
  liteLlmEndpoint.placeholder = isOllama
    ? 'http://127.0.0.1:11434/v1'
    : provider === 'openai'
      ? 'https://api.openai.com/v1'
      : 'https://gateway.example.com/v1 or …/chat/completions';
  embeddingProviderNote.textContent = isOllama
    ? 'Ollama serves chat and embeddings locally. Enter an embedding model explicitly if desired; Chroma data stays on this machine.'
    : provider === 'openai'
      ? 'OpenAI provides chat and optional embeddings; Chroma data stays on this machine.'
      : 'The same model catalog and LiteLLM base are used for chat and embeddings. Vectors and Chroma data stay on this machine.';
}

function markConnectionEdited() {
  connectionDiagnostics.classList.add('hidden');
  liteLlmSettingsError.classList.add('hidden');
  updateConnectionReadiness();
  showConnectionSetupStep(connectionSetupStep);
}

function renderConnectionDiagnostics(diagnostics) {
  lastConnectionDiagnostics = diagnostics || [];
  connectionDiagnostics.innerHTML = lastConnectionDiagnostics.map((item, diagnosticIndex) => {
    const duration = item.durationMs === undefined ? '' : '<span class="diagnostic-time">' + item.durationMs + ' ms</span>';
    const fixes = (item.fixes || []).length
      ? '<span class="diagnostic-fixes">' + item.fixes.map((fix, fixIndex) =>
          '<button type="button" data-diagnostic-fix="' + diagnosticIndex + ':' + fixIndex + '">' + escapeHtml(fix.label) + '</button>'
        ).join('') + '</span>'
      : '';
    return '<div class="diagnostic ' + escapeHtml(item.status) + '">' +
      '<span class="diagnostic-dot" aria-hidden="true"></span>' +
      '<span class="diagnostic-copy"><strong>' + escapeHtml(item.label) + '</strong><small>' + escapeHtml(item.detail) + '</small>' + fixes + '</span>' +
      duration + '</div>';
  }).join('');
  connectionDiagnostics.classList.remove('hidden');
}

function applyDiagnosticFix(fix) {
  if (!fix) return;
  const advancedSettings = document.getElementById('advanced-settings');
  let retest = false;
  if (fix.kind === 'set-reasoning') {
    advancedSettings.open = true;
    liteLlmReasoningEffort.value = fix.value;
    applyModelCapabilities(false);
    retest = true;
  } else if (fix.kind === 'clear-sampling') {
    advancedSettings.open = true;
    if (fix.target === 'temperature' || fix.target === 'both') liteLlmTemperature.value = '';
    if (fix.target === 'top-p' || fix.target === 'both') liteLlmTopP.value = '';
    retest = true;
  } else if (fix.kind === 'set-auth-header') {
    liteLlmAuthHeader.value = fix.value;
    retest = true;
  } else if (fix.kind === 'open-ca-setup') {
    status.textContent = 'Opening corporate CA setup';
    vscode.postMessage({ type: 'configureGatewayCa' });
    return;
  } else if (fix.kind === 'focus-field') {
    showConnectionSetupStep(fix.field === 'model' ? 2 : 1, true);
    const field = {
      endpoint: liteLlmEndpoint,
      model: liteLlmModel,
      'api-key': liteLlmApiKey,
      'auth-header': liteLlmAuthHeader
    }[fix.field];
    field?.focus();
    announce(fix.label);
    return;
  }
  if (!retest) return;
  diagnosticFixApplied = true;
  markConnectionEdited();
  status.textContent = 'Applied recommended connection settings';
  announce('Recommended settings applied. Testing the connection again.');
  requestAnimationFrame(testLiteLlmSettings);
}

function isEmbeddingModel(model) {
  const normalized = String(model).toLowerCase();
  return normalized.includes('embed')
    || /(^|[-_:])(?:bge|e5|gte|minilm)(?:[-_:]|$)/.test(normalized);
}

function fillEmbeddingModelOptions(models, selected) {
  const aliases = [...new Set([...(models || []), selected]
    .map(model => String(model).trim())
    .filter(model => model && (isEmbeddingModel(model) || model === selected)))]
    .sort();
  embeddingModelAliases.innerHTML = aliases
    .map(model => '<option value="' + escapeHtml(model) + '">' + escapeHtml(model) + '</option>')
    .join('');
  embeddingModel.value = selected || '';
}

function fillModelProfile(model, fallback, recommendDefaults = false) {
  const profile = liteLlmModelProfiles[String(model).trim()] || fallback || {};
  liteLlmModelPreset.value = profile.preset || 'auto';
  liteLlmReasoningEffort.value = profile.reasoningEffort || 'omit';
  liteLlmTemperature.value = profile.temperature === undefined ? '' : String(profile.temperature);
  liteLlmTopP.value = profile.topP === undefined ? '' : String(profile.topP);
  applyModelCapabilities(recommendDefaults);
}

function detectModelPreset(model) {
  const normalized = String(model).trim().toLowerCase();
  if (/gpt-6(?:\.1)?[-_/ ]*(?:astra|sol)/.test(normalized) && /gpt-6\.1|astra/.test(normalized)) return 'gpt-6-responses-tools';
  if (/gpt-6[-_/ ]*(?:sol|luna)/.test(normalized)) return 'gpt-6-chat-tools';
  if (/gpt-5\.6/.test(normalized)) return 'gpt-5.6';
  if (/gpt-5(?:\.[2-5])?/.test(normalized)) return 'gpt-5-reasoning';
  if (/gpt-4|gpt-4o/.test(normalized)) return 'gpt-standard';
  if (normalized.includes('claude')) {
    if (/claude.*(?:5(?:[._-]|$)|4[._-](?:7|8|9))/.test(normalized)) return 'claude-modern';
    if (/claude.*4[._-]6/.test(normalized)) return 'claude-4.6';
    return 'claude-legacy';
  }
  return 'custom';
}

function profileModelForControls() {
  const vision = visionModel.value.trim();
  return profileTarget === 'vision' && vision ? vision : liteLlmModel.value.trim();
}

function previewModelCompatibility() {
  const selectedModel = profileModelForControls();
  const resolved = liteLlmModelPreset.value === 'auto'
    ? detectModelPreset(selectedModel)
    : liteLlmModelPreset.value;
  renderModelCompatibility(resolved, modelCapabilityCatalog[resolved] || modelCapabilityCatalog.custom);
}

function renderModelCompatibility(resolved, capabilities) {
  const alias = profileModelForControls();
  modelCompatibility.classList.toggle('hidden', !alias);
  if (!alias) return;
  const automatic = liteLlmModelPreset.value === 'auto';
  const effort = liteLlmReasoningEffort.value;
  let state = 'ready';
  let title = 'Compatibility profile ready to test';
  let detail = (automatic ? 'Auto-detected' : 'Selected manually') + ' · ' + capabilities.label + '.';
  if (capabilities.toolCalling === 'unsupported') {
    state = 'failed';
    title = 'Not compatible with this agent';
    detail = capabilities.label + ' requires an API other than Chat Completions for function tools. Choose another model or use Custom only if the gateway exposes different capabilities.';
  } else if (resolved === 'custom') {
    state = 'warning';
    title = automatic ? 'Compatibility could not be inferred' : 'Gateway-defined compatibility';
    detail = 'No assumptions are applied to this alias. Configure only documented parameters, then run Test connection.';
  } else if (capabilities.toolCalling === 'reasoning-none-only' && effort !== 'none') {
    state = 'warning';
    title = 'Reasoning none is required for tools';
    detail = capabilities.label + ' needs reasoning_effort none on Chat Completions. The recommended value can be selected in Advanced model settings.';
  } else {
    detail += ' Run Test connection to verify the actual gateway deployment.';
  }
  modelCompatibility.classList.remove('ready', 'warning', 'failed');
  modelCompatibility.classList.add(state);
  modelCompatibilityTitle.textContent = title;
  modelCompatibilityDetail.textContent = detail;
}

function applyModelCapabilities(recommendDefaults) {
  const selectedModel = profileModelForControls();
  const resolved = liteLlmModelPreset.value === 'auto'
    ? detectModelPreset(selectedModel)
    : liteLlmModelPreset.value;
  const capabilities = modelCapabilityCatalog[resolved] || modelCapabilityCatalog.custom;
  const currentEffort = liteLlmReasoningEffort.value;
  [...liteLlmReasoningEffort.options].forEach(option => {
    option.disabled = option.value !== 'omit' && !capabilities.reasoningEfforts.includes(option.value);
  });
  if (recommendDefaults && capabilities.toolCalling === 'reasoning-none-only') {
    liteLlmReasoningEffort.value = 'none';
  } else if (currentEffort !== 'omit' && !capabilities.reasoningEfforts.includes(currentEffort)) {
    liteLlmReasoningEffort.value = 'omit';
  }
  const effort = liteLlmReasoningEffort.value;
  const samplingAllowed = capabilities.sampling === 'supported' || capabilities.sampling === 'custom' ||
    (capabilities.sampling === 'reasoning-none-only' && effort === 'none') ||
    (capabilities.sampling === 'reasoning-omitted-only' && effort === 'omit');
  liteLlmTemperature.disabled = !samplingAllowed;
  liteLlmTopP.disabled = !samplingAllowed;
  if (!samplingAllowed) {
    liteLlmTemperature.value = '';
    liteLlmTopP.value = '';
  }
  liteLlmCapabilities.textContent = capabilities.label + ' · ' + capabilities.guidance;
  renderModelCompatibility(resolved, capabilities);
}

function openLiteLlmSettings() {
  openTopPanel(
    liteLlmSettings,
    liteLlmToggle,
    () => setupSteps.find(section => !section.hidden)?.querySelector('h3') || liteLlmEndpoint
  );
}

function liteLlmFormMessage(type) {
  return {
    type,
    provider: modelProvider.value,
    endpoint: liteLlmEndpoint.value,
    modelsEndpoint: liteLlmModelsEndpoint.value,
    model: liteLlmModel.value,
    profileModel: profileModelForControls(),
    apiKey: liteLlmApiKey.value,
    authHeader: liteLlmAuthHeader.value,
    preset: liteLlmModelPreset.value,
    reasoningEffort: liteLlmReasoningEffort.value,
    temperature: liteLlmTemperature.value,
    topP: liteLlmTopP.value,
    semanticMemoryEnabled: semanticMemoryEnabled.checked,
    embeddingModel: embeddingModel.value,
    embeddingEndpoint: embeddingEndpoint.value,
    visionModel: visionModel.value
  };
}

function saveLiteLlmSettings() {
  liteLlmSettingsError.classList.add('hidden');
  vscode.postMessage(liteLlmFormMessage('saveLiteLlm'));
}

function testLiteLlmSettings() {
  liteLlmSettingsError.classList.add('hidden');
  vscode.postMessage(liteLlmFormMessage('testLiteLlm'));
}

function wireStarterButtons() {
  document.querySelectorAll('[data-prompt]').forEach(button => button.addEventListener('click', () => {
    prompt.value = button.dataset.prompt;
    resizePrompt();
    scheduleDraftPersist();
    prompt.focus();
    const placeholderStart = prompt.value.indexOf('[');
    const placeholderEnd = placeholderStart < 0 ? -1 : prompt.value.indexOf(']', placeholderStart);
    if (placeholderStart >= 0 && placeholderEnd > placeholderStart) {
      prompt.setSelectionRange(placeholderStart, placeholderEnd + 1);
    }
    announce('Editable task draft prepared. Nothing runs until you press Send.');
  }));
}

function resetConversation(context, history, threads, draft = '') {
  finishRunActivity();
  clearAssistantStreams();
  hiddenHistoryMessages = [];
  timeline.innerHTML = welcomeMarkup;
  resetConversationScroll();
  clearCurrentPlan();
  renderContextState(context || currentContextState);
  if (threads) renderThreads(threads);
  if (threads?.activeThreadId) vscode.postMessage({ type: 'markThreadRead', id: threads.activeThreadId });
  setContextExpanded(false);
  closeTopPanels(false);
  prompt.value = draft || localDrafts[activeThreadId] || '';
  updatePromptTokenEstimate();
  rememberDraftLocally();
  replacePendingOnSubmit = false;
  newThreadButton.disabled = false;
  const recovery = threads?.recovery;
  setAutonomyMode(recovery?.mode || threads?.autonomyMode || 'review');
  remoteRunActive = Boolean(threads?.remoteRunActive);
  setBusy(false);
  wireStarterButtons();
  renderConversationHistory(history);
  const latest = (history || []).at(-1);
  pendingRequestText = latest?.role === 'user' ? latest.text : '';
  pendingRequestId = latest?.role === 'user' ? latest.id : '';
  if (pendingRequestText && recovery?.partialAssistant?.content) {
    appendMessage({
      id: recovery.partialAssistant.id,
      runId: recovery.id,
      role: 'assistant',
      text: recovery.partialAssistant.content,
      html: renderText(recovery.partialAssistant.content),
      createdAt: recovery.partialAssistant.createdAt,
      status: recovery.status === 'running' ? 'streaming' : recovery.status
    }, false);
  }
  if (pendingRequestText && recovery?.status === 'running') {
    appendRecovery(
      recovery.partialAssistant?.content
        ? 'A partial response is preserved above. This request is still active in another VS Code window; continue there or refresh after it finishes.'
        : 'This request is still marked active in another VS Code window. Continue there, or refresh after that run finishes.',
      false,
      false,
      'Try again',
      true
    );
  } else if (pendingRequestText && recovery?.status === 'interrupted') {
    appendRecovery(
      recovery.partialAssistant?.content
        ? 'The partial response above was preserved after the previous session ended. Restarting replays the request safely from the beginning.'
        : 'The previous extension session ended before an answer was saved. Restarting replays this request safely from the beginning.',
      false,
      true,
      'Restart request'
    );
  } else if (pendingRequestText && recovery?.status === 'cancelled') {
    appendRecovery(
      recovery.partialAssistant?.content
        ? 'The run was cancelled and its partial response was preserved above. You can run the request again or edit it first.'
        : 'This run was cancelled. You can run the request again or edit it first.',
      false,
      true,
      'Run again'
    );
  } else if (pendingRequestText && recovery?.status === 'failed') {
    appendRecovery(
      recovery.partialAssistant?.content
        ? 'The run ended with an error and its partial response was preserved above. You can retry it or edit the request first.'
        : 'This run ended with an error. You can retry it or edit the request first.'
    );
  } else if (pendingRequestText) {
    appendRecovery('This request did not receive an answer. You can retry it or edit it before sending again.');
  }
  resizePrompt();
  updateComposerHint();
}

send.addEventListener('click', submit);
goalButton.addEventListener('click', setAsGoal);
goalResume.addEventListener('click', () => {
  if (!activeGoalId) return;
  vscode.postMessage({ type: activeGoalStatus === 'awaiting-criteria' ? 'activateGoal' : 'resumeGoal', id: activeGoalId });
});
goalOpen.addEventListener('click', () => { if (activeGoalId) vscode.postMessage({ type: 'openGoal', id: activeGoalId }); });
goalEdit.addEventListener('click', () => { if (!activeGoalId) return; goalPanel.classList.remove('hidden'); goalEditor.classList.remove('hidden'); goalCriteria.classList.add('hidden'); goalCriteriaInput.focus(); });
goalDetails.addEventListener('click', () => { goalPanel.classList.toggle('hidden'); });
goalPanelClose.addEventListener('click', () => goalPanel.classList.add('hidden'));
goalSaveCriteria.addEventListener('click', () => { if (!activeGoalId) return; const criteria = goalCriteriaInput.value.split(/\\r?\\n/).map(item => item.trim()).filter(Boolean); vscode.postMessage({ type: 'saveGoalCriteria', id: activeGoalId, criteria }); goalEditor.classList.add('hidden'); goalCriteria.classList.remove('hidden'); });
goalCancelCriteria.addEventListener('click', () => { goalEditor.classList.add('hidden'); goalCriteria.classList.remove('hidden'); });
goalPause.addEventListener('click', () => { if (activeGoalId) vscode.postMessage({ type: 'pauseGoal', id: activeGoalId }); });
goalCancel.addEventListener('click', () => { if (activeGoalId) vscode.postMessage({ type: 'cancelGoal', id: activeGoalId }); });
cancel.addEventListener('click', () => {
  if (!busy || cancellationPending) return;
  setCancellationPending(true);
  updateRunActivityStatus('Requesting stop');
  announce('Stop requested. Waiting for the current operation to finish cancelling.');
  vscode.postMessage({ type: 'cancel' });
});
activityCancel.addEventListener('click', () => cancel.click());
browserTakeControl.addEventListener('click', () => {
  if (!browserLiveMode || !busy) return;
  setBrowserManualControl(!browserManualControl);
  vscode.postMessage({ type: 'setLocalBrowserManualControl', enabled: browserManualControl });
  announce(browserManualControl ? 'Browser control handed to you.' : 'Browser control returned to the agent.');
});
timeline.addEventListener('click', event => {
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest('[data-show-earlier]')) {
    revealEarlierHistory();
    return;
  }
  const copyMessage = target?.closest('[data-copy-message]');
  if (copyMessage && !copyMessage.disabled) {
    const message = copyMessage.closest('.message.assistant');
    const text = message ? messageSources.get(message) : '';
    copyMessage.disabled = true;
    copyMessage.textContent = 'Copying…';
    vscode.postMessage({ type: 'copyMessage', id: message?.dataset.messageId || '', text: text || '' });
    return;
  }
  if (target?.closest('[data-add-memory-message]') && !busy && !remoteRunActive) {
    vscode.postMessage({ type: 'addMemoryEntry' });
    return;
  }
  const openReview = target?.closest('[data-open-run-review]');
  if (openReview) {
    openRunReview(openReview.dataset.openRunReview, openReview);
    return;
  }
  const reviewChange = target?.closest('[data-review-change]');
  if (reviewChange) {
    vscode.postMessage({ type: 'openChangeDiff', id: reviewChange.dataset.reviewChange });
    return;
  }
  const restoreChange = target?.closest('[data-restore-change]');
  if (restoreChange && !restoreChange.disabled) {
    restoreChange.disabled = true;
    restoreChange.textContent = 'Restoring…';
    vscode.postMessage({ type: 'restoreChange', id: restoreChange.dataset.restoreChange });
    return;
  }
  if (target?.closest('[data-open-changes]')) {
    vscode.postMessage({ type: 'openChanges' });
    return;
  }
  if (target?.closest('[data-refresh-run]')) {
    status.textContent = 'Refreshing run status';
    vscode.postMessage({ type: 'refreshRunState' });
    return;
  }
  if (target?.closest('[data-retry-pending]') && pendingRequestText && !busy) {
    currentRunSummary = createRunSummary();
    clearCurrentPlan();
    timeline.querySelectorAll('.recovery-actions').forEach(element => element.remove());
    setBusy(true);
    vscode.postMessage({ type: 'retry', mode: autonomyMode.value });
    return;
  }
  if (target?.closest('[data-edit-pending]') && pendingRequestText && !busy) {
    replacePendingOnSubmit = true;
    prompt.value = pendingRequestText;
    resizePrompt();
    scheduleDraftPersist();
    prompt.focus();
    return;
  }
  if (target?.closest('[data-discard-pending]') && pendingRequestText && !busy && !remoteRunActive) {
    timeline.querySelectorAll('[data-retry-pending], [data-edit-pending], [data-discard-pending]').forEach(button => {
      button.disabled = true;
    });
    status.textContent = 'Confirming request discard';
    vscode.postMessage({ type: 'discardRecovery', threadId: activeThreadId, messageId: pendingRequestId });
  }
});
runReviewPanel.addEventListener('click', event => {
  const target = event.target instanceof Element ? event.target : null;
  const openTerminalCommand = target?.closest('[data-open-terminal-command]');
  if (openTerminalCommand) {
    vscode.postMessage({ type: 'openTerminalCommand', command: openTerminalCommand.getAttribute('data-open-terminal-command') || '' });
    return;
  }
  const reviewChange = target?.closest('[data-review-change]');
  if (reviewChange) {
    vscode.postMessage({ type: 'openChangeDiff', id: reviewChange.dataset.reviewChange });
    return;
  }
  const restoreChange = target?.closest('[data-restore-change]');
  if (restoreChange && !restoreChange.disabled) {
    restoreChange.disabled = true;
    restoreChange.textContent = 'Restoring…';
    vscode.postMessage({ type: 'restoreChange', id: restoreChange.dataset.restoreChange });
    return;
  }
  const restoreRun = target?.closest('[data-restore-run]');
  if (restoreRun && !restoreRun.disabled) {
    const review = runReviews.get(restoreRun.dataset.restoreRun);
    if (!review) return;
    const changeIds = review.files.map(file => file.id).filter(Boolean);
    restoreRun.disabled = true;
    restoreRun.textContent = 'Preparing undo…';
    vscode.postMessage({ type: 'restoreRunChanges', runId: review.id, changeIds });
    return;
  }
  if (target?.closest('[data-open-changes]')) vscode.postMessage({ type: 'openChanges' });
  if (target?.closest('[data-open-problems]')) vscode.postMessage({ type: 'openProblems' });
});
runReviewPanel.addEventListener('change', event => {
  const target = event.target instanceof HTMLSelectElement ? event.target : null;
  if (!target?.matches('[data-evidence-filter]')) return;
  runReviewPanel.querySelectorAll('[data-evidence-type]').forEach(row => {
    row.classList.toggle('hidden', target.value !== 'all' && row.getAttribute('data-evidence-type') !== target.value);
  });
});
newThreadButton.addEventListener('click', () => {
  if (newThreadButton.disabled) return;
  persistDraftNow();
  newThreadButton.disabled = true;
  status.textContent = 'Starting a new thread';
  vscode.postMessage({ type: 'newThread' });
});
browserControl.addEventListener('click', () => {
  if (browserControl.disabled) return;
  setBrowserControl(browserControlEnabled, true);
  vscode.postMessage({ type: 'setLocalBrowserToolsEnabled', enabled: !browserControlEnabled });
});
browserLiveControl.addEventListener('click', () => {
  if (browserLiveControl.disabled) return;
  setBrowserLiveMode(!browserLiveMode);
  vscode.postMessage({ type: 'setLocalBrowserLiveMode', enabled: browserLiveMode });
});
mcpConnections.addEventListener('click', () => {
  if (mcpConnections.disabled) return;
  setMcpConnectionState({ count: mcpConnectionCount, enabled: mcpConnections.getAttribute('aria-pressed') === 'true' ? 1 : 0 }, true);
  vscode.postMessage({ type: 'openMcpConnections' });
});
memoryToggle.addEventListener('click', () => memoryPanel.classList.contains('hidden') ? openMemoryCenter() : closeTopPanels());
briefToggle.addEventListener('click', () => briefPanel.classList.contains('hidden') ? openTaskBrief() : closeTopPanels());
liteLlmToggle.addEventListener('click', () => liteLlmSettings.classList.contains('hidden') ? openLiteLlmSettings() : closeTopPanels());
document.getElementById('litellm-close').addEventListener('click', () => closeTopPanels());
document.getElementById('brief-close').addEventListener('click', () => closeTopPanels());
document.getElementById('brief-use').addEventListener('click', useTaskBrief);
document.getElementById('brief-clear').addEventListener('click', clearTaskBrief);
[briefObjective, briefScope, briefDone, briefConstraints].forEach(field => {
  field.addEventListener('input', captureBriefState);
});
document.getElementById('profile-import').addEventListener('click', () => vscode.postMessage({ type: 'importConnectionProfile' }));
document.getElementById('profile-export').addEventListener('click', () => vscode.postMessage({ type: 'exportConnectionProfile' }));
document.getElementById('support-export').addEventListener('click', () => vscode.postMessage({
  type: 'exportSupportBundle',
  diagnostics: lastConnectionDiagnostics
}));
document.getElementById('memory-close').addEventListener('click', () => closeTopPanels());
document.getElementById('memory-add').addEventListener('click', () => vscode.postMessage({ type: 'addMemoryEntry' }));
document.getElementById('memory-open-file').addEventListener('click', () => vscode.postMessage({ type: 'openMemoryFile' }));
memoryList.addEventListener('click', event => {
  const target = event.target instanceof Element ? event.target : null;
  const edit = target?.closest('[data-edit-memory]');
  const remove = target?.closest('[data-delete-memory]');
  if (edit) vscode.postMessage({ type: 'editMemoryEntry', id: edit.dataset.editMemory });
  else if (remove) vscode.postMessage({ type: 'deleteMemoryEntry', id: remove.dataset.deleteMemory });
});
threadsToggle.addEventListener('click', () => setThreadPanelOpen(threadPanel.classList.contains('hidden')));
document.getElementById('threads-close').addEventListener('click', () => setThreadPanelOpen(false));
document.getElementById('run-review-close').addEventListener('click', () => closeTopPanels());
threadSearch.addEventListener('input', renderThreadList);
threadList.addEventListener('click', event => {
  const target = event.target instanceof Element ? event.target : null;
  const select = target?.closest('[data-select-thread]');
  const pin = target?.closest('[data-pin-thread]');
  const rename = target?.closest('[data-rename-thread]');
  const remove = target?.closest('[data-delete-thread]');
  if (select) {
    if (select.dataset.selectThread === activeThreadId) setThreadPanelOpen(false);
    else {
      persistDraftNow();
      suppressLiveRunEvents = Boolean(liveRunThreadId && select.dataset.selectThread !== liveRunThreadId);
      vscode.postMessage({ type: 'selectThread', id: select.dataset.selectThread });
    }
  } else if (pin) {
    vscode.postMessage({ type: 'toggleThreadPinned', id: pin.dataset.pinThread });
  } else if (rename) {
    vscode.postMessage({ type: 'renameThread', id: rename.dataset.renameThread });
  } else if (remove) {
    vscode.postMessage({ type: 'deleteThread', id: remove.dataset.deleteThread });
  }
});
connectionSaveButton.addEventListener('click', saveLiteLlmSettings);
connectionTestButton.addEventListener('click', testLiteLlmSettings);
setupBackButton.addEventListener('click', () => moveToConnectionSetupStep(connectionSetupStep - 1));
setupNextButton.addEventListener('click', () => moveToConnectionSetupStep(connectionSetupStep + 1));
setupStepButtons.forEach(button => button.addEventListener('click', () => {
  moveToConnectionSetupStep(Number(button.dataset.setupStepTarget));
}));
connectionDiagnostics.addEventListener('click', event => {
  const button = event.target instanceof Element ? event.target.closest('[data-diagnostic-fix]') : null;
  if (!button) return;
  const [diagnosticIndex, fixIndex] = String(button.dataset.diagnosticFix || '').split(':').map(Number);
  const fix = lastConnectionDiagnostics[diagnosticIndex]?.fixes?.[fixIndex];
  applyDiagnosticFix(fix);
});
contextToggle.addEventListener('click', () => setContextExpanded(contextInspector.classList.contains('hidden')));
contextClear.addEventListener('click', () => vscode.postMessage({ type: 'clearPinnedContext' }));
contextAddFile.addEventListener('click', () => vscode.postMessage({ type: 'addFileContext' }));
setupCalloutAction.addEventListener('click', openLiteLlmSettings);
pinnedContext.addEventListener('click', event => {
  const button = event.target instanceof Element ? event.target.closest('[data-remove-context]') : null;
  if (button) vscode.postMessage({ type: 'removePinnedContext', id: button.dataset.removeContext });
});
activityToggle.addEventListener('click', () => {
  if (!activityDock.classList.contains('has-plan')) return;
  const expand = !activityDock.classList.contains('expanded');
  planManuallyCollapsed = !expand;
  setActivityExpanded(expand);
});
jumpLatest.addEventListener('click', () => {
  scrollConversationToBottom({ force: true, countUpdate: false });
  announce('Moved to the latest conversation activity.');
});
timeline.addEventListener('scroll', () => {
  const nearBottom = conversationIsNearBottom();
  conversationPinnedToBottom = nearBottom;
  if (nearBottom) unseenConversationUpdates = 0;
  renderJumpToLatest();
}, { passive: true });
advancedSetupButton.addEventListener('click', () => vscode.postMessage({ type: 'configureGatewayCa' }));
modelProvider.addEventListener('change', () => {
  providerDrafts[activeProvider] = {
    endpoint: liteLlmEndpoint.value,
    modelsEndpoint: liteLlmModelsEndpoint.value,
    model: liteLlmModel.value,
    visionModel: visionModel.value,
    embeddingModel: embeddingModel.value,
    embeddingEndpoint: embeddingEndpoint.value
  };
  activeProvider = modelProvider.value;
  const draft = providerDrafts[activeProvider] || {};
  liteLlmEndpoint.value = draft.endpoint || (activeProvider === 'ollama'
    ? 'http://127.0.0.1:11434/v1'
    : activeProvider === 'openai'
      ? 'https://api.openai.com/v1'
      : '');
  liteLlmModelsEndpoint.value = draft.modelsEndpoint || '';
  embeddingEndpoint.value = draft.embeddingEndpoint || '';
  liteLlmModel.value = draft.model || '';
  visionModel.value = draft.visionModel || '';
  liteLlmApiKey.value = '';
  hasStoredLiteLlmKey = Boolean(providerKeyStates[activeProvider]);
  fillEmbeddingModelOptions([], draft.embeddingModel || '');
  document.getElementById('litellm-key-state').textContent = activeProvider === 'ollama'
    ? '· not required'
    : hasStoredLiteLlmKey ? '· stored securely' : '· required';
  renderProviderFields();
  fillModelProfile(liteLlmModel.value, {}, true);
  markConnectionEdited();
});
document.getElementById('litellm-load-models').addEventListener('click', () => {
  liteLlmSettingsError.classList.add('hidden');
  vscode.postMessage({
    type: 'listModels',
    endpoint: liteLlmModelsEndpoint.value,
    apiKey: liteLlmApiKey.value
  });
});
ollamaLoadModels.addEventListener('click', () => {
  liteLlmSettingsError.classList.add('hidden');
  ollamaLoadModels.disabled = true;
  ollamaLoadModels.textContent = 'Loading…';
  vscode.postMessage({
    type: 'listModels',
    endpoint: liteLlmEndpoint.value,
    apiKey: ''
  });
});
liteLlmModel.addEventListener('change', () => {
  profileTarget = 'chat';
  const hasSavedProfile = Boolean(liteLlmModelProfiles[String(liteLlmModel.value).trim()]);
  fillModelProfile(liteLlmModel.value, {}, !hasSavedProfile);
});
liteLlmModel.addEventListener('input', previewModelCompatibility);
visionModel.addEventListener('change', () => {
  profileTarget = visionModel.value.trim() ? 'vision' : 'chat';
  const selected = profileModelForControls();
  const hasSavedProfile = Boolean(liteLlmModelProfiles[selected]);
  fillModelProfile(selected, {}, !hasSavedProfile);
});
visionModel.addEventListener('input', previewModelCompatibility);
liteLlmModelPreset.addEventListener('change', () => applyModelCapabilities(true));
liteLlmReasoningEffort.addEventListener('change', () => applyModelCapabilities(false));
liteLlmTemperature.addEventListener('input', () => {
  if (liteLlmTemperature.value !== '') liteLlmTopP.value = '';
});
liteLlmTopP.addEventListener('input', () => {
  if (liteLlmTopP.value !== '') liteLlmTemperature.value = '';
});
[
  modelProvider,
  liteLlmEndpoint,
  liteLlmModelsEndpoint,
  liteLlmModel,
  visionModel,
  liteLlmApiKey,
  liteLlmAuthHeader,
  liteLlmModelPreset,
  liteLlmReasoningEffort,
  liteLlmTemperature,
  liteLlmTopP,
  semanticMemoryEnabled,
  embeddingModel
].forEach(element => {
  element.addEventListener('input', markConnectionEdited);
  element.addEventListener('change', markConnectionEdited);
});
agentRuntime.addEventListener('change', () => {
  updateRunControlsSummary();
  vscode.postMessage({ type: 'selectRuntime', runtime: agentRuntime.value });
});
autonomyMode.addEventListener('change', () => {
  setAutonomyMode(autonomyMode.value);
  vscode.postMessage({ type: 'selectAutonomy', mode: autonomyMode.value });
});
finalReviewMode.addEventListener('change', () => {
  updateRunControlsSummary();
  vscode.postMessage({ type: 'selectFinalReview', mode: finalReviewMode.value });
});
responseLanguage.addEventListener('change', () => {
  vscode.postMessage({ type: 'selectResponseLanguage', language: responseLanguage.value });
  status.textContent = responseLanguage.value === 'en' ? 'Agent language set to English' : 'Idioma do agente definido como português';
  announce(status.textContent);
});
prompt.addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); submit(); }
});
prompt.addEventListener('input', () => {
  resizePrompt();
  updatePromptTokenEstimate();
  scheduleDraftPersist();
});
prompt.addEventListener('blur', persistDraftNow);
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape' || event.defaultPrevented) return;
  if (topPanels.some(panel => !panel.classList.contains('hidden'))) {
    event.preventDefault();
    closeTopPanels();
    return;
  }
  if (!contextInspector.classList.contains('hidden')) {
    event.preventDefault();
    setContextExpanded(false);
    contextToggle.focus();
    return;
  }
  if (runControls.open) {
    event.preventDefault();
    runControls.open = false;
    runControls.querySelector('summary').focus();
    return;
  }
  if (activityDock.classList.contains('expanded')) {
    event.preventDefault();
    planManuallyCollapsed = true;
    setActivityExpanded(false);
    activityToggle.focus();
  }
});
wireStarterButtons();
updateRunControlsSummary();

document.addEventListener('click', event => {
  if (runControls.open && event.target instanceof Node && !runControls.contains(event.target)) {
    runControls.open = false;
  }
});

window.addEventListener('message', ({ data }) => {
  if (suppressLiveRunEvents && ['status', 'plan', 'contextReceipt', 'evidence', 'verification', 'activity', 'goal', 'changes', 'usage', 'error', 'assistantStart', 'assistantDelta', 'assistantReset', 'assistant'].includes(data.type)) return;
  switch (data.type) {
    case 'protocolError':
      if (!data.active) setBusy(false);
      status.textContent = 'Local action rejected';
      appendRecovery(data.message || 'The local action could not be processed safely.', true, false);
      announce(status.textContent + '. ' + (data.message || ''));
      break;
    case 'hydrate':
      document.getElementById('workspace').textContent = data.workspace;
      responseLanguage.value = data.responseLanguage === 'en' ? 'en' : 'pt-BR';
      setBrowserLiveMode(Boolean(data.browserLiveMode));
      setBrowserManualControl(false);
      setBrowserControl(Boolean(data.browserControlEnabled));
      setMcpConnectionState(data.mcpConnections || {});
      fillLiteLlmSettings(data.liteLlm || {});
      resetConversation(data.context, data.history, data, data.draft);
      break;
    case 'mcpConnectionChanged':
      setMcpConnectionState(data);
      if (data.message) {
        status.textContent = data.message;
        announce(data.message);
      }
      break;
    case 'mcpConnectionError':
      setMcpConnectionState({ count: mcpConnectionCount, enabled: mcpConnections.getAttribute('aria-pressed') === 'true' ? 1 : 0 });
      status.textContent = 'Could not update corporate MCP connections';
      announce(data.message || status.textContent);
      break;
    case 'openConnectionSettings':
      fillLiteLlmSettings(data.liteLlm || {});
      showConnectionSetupStep(1, false);
      openLiteLlmSettings();
      vscode.postMessage({ type: 'connectionSettingsOpened' });
      break;
    case 'liteLlmSettings':
      fillLiteLlmSettings(data.liteLlm);
      if (data.message) status.textContent = data.message;
      break;
    case 'responseLanguageChanged':
      responseLanguage.value = data.language === 'en' ? 'en' : 'pt-BR';
      status.textContent = data.message || status.textContent;
      announce(status.textContent);
      break;
    case 'responseLanguageChangeError':
      responseLanguage.value = data.language === 'en' ? 'en' : 'pt-BR';
      status.textContent = data.message || 'Could not change agent language';
      announce(status.textContent);
      break;
    case 'gatewayCaError':
      liteLlmSettingsError.textContent = data.message;
      liteLlmSettingsError.classList.remove('hidden');
      openLiteLlmSettings();
      break;
    case 'gatewayCaUpdated':
      liteLlmSettingsError.classList.add('hidden');
      status.textContent = data.message || 'Gateway certificate updated';
      announce(data.message || 'Gateway certificate updated');
      openLiteLlmSettings();
      break;
    case 'modelsLoaded':
      ollamaLoadModels.disabled = false;
      ollamaLoadModels.textContent = 'List local models';
      liteLlmModelsEndpoint.value = data.endpoint;
      loadedModelCatalog = data.models || [];
      const catalogModels = [...new Set([...loadedModelCatalog, ...Object.keys(liteLlmModelProfiles)])]
        .sort();
      const discoveredEmbeddingModels = new Set(data.embeddingModels || []);
      const chatModels = catalogModels.filter(model => !discoveredEmbeddingModels.has(model) && !isEmbeddingModel(model));
      const embeddingModels = catalogModels.filter(model => discoveredEmbeddingModels.has(model) || isEmbeddingModel(model));
      liteLlmModelAliases.innerHTML = chatModels
        .map(model => '<option value="' + escapeHtml(model) + '"></option>')
        .join('');
      fillEmbeddingModelOptions(embeddingModels, embeddingModel.value);
      status.textContent = chatModels.length + ' chat · ' + embeddingModels.length + ' embedding models loaded';
      liteLlmModel.focus();
      break;
    case 'modelsLoadError':
      ollamaLoadModels.disabled = false;
      ollamaLoadModels.textContent = 'List local models';
      liteLlmSettingsError.textContent = data.message;
      liteLlmSettingsError.classList.remove('hidden');
      openLiteLlmSettings();
      break;
    case 'connectionTestStarted':
      connectionTestButton.disabled = true;
      connectionSaveButton.disabled = true;
      connectionTestButton.textContent = 'Testing…';
      connectionDiagnostics.classList.add('hidden');
      setConnectionReadiness('configured', 'Testing connection', 'Checking the configured local gateway paths.');
      break;
    case 'connectionTested':
      connectionTestButton.disabled = false;
      connectionSaveButton.disabled = false;
      connectionTestButton.textContent = 'Test connection';
      renderConnectionDiagnostics(data.diagnostics);
      const failedDiagnostic = (data.diagnostics || []).find(item => item.status === 'failed');
      if (failedDiagnostic) {
        setConnectionReadiness('failed', 'Connection needs attention', failedDiagnostic.label + ': ' + failedDiagnostic.detail);
      } else {
        setConnectionReadiness(
          'verified',
          diagnosticFixApplied ? 'Correction verified' : 'Connection verified',
          diagnosticFixApplied
            ? 'The recommended settings work. Save the connection to keep them.'
            : 'Chat and all configured services responded successfully.'
        );
      }
      break;
    case 'liteLlmSaved':
      fillLiteLlmSettings(data.liteLlm);
      closeTopPanels();
      status.textContent = data.message;
      break;
    case 'profileImported':
      fillLiteLlmSettings(data.liteLlm || {});
      setAutonomyMode(data.autonomyMode || 'review');
      showConnectionSetupStep(data.needsKey || data.needsCorporateCa ? 1 : 3, true);
      liteLlmSettingsError.textContent = data.needsKey && data.needsCorporateCa
        ? 'Profile imported. Enter the gateway key and import the required corporate CA PEM; neither is stored in profile files.'
        : data.needsKey
          ? 'Profile imported. Enter the gateway key; it is intentionally never stored in profile files.'
        : data.needsCorporateCa
          ? 'Profile imported. Import the required corporate CA PEM on this machine before testing.'
          : '';
      liteLlmSettingsError.classList.toggle('hidden', !liteLlmSettingsError.textContent);
      setConnectionReadiness(
        'configured',
        data.needsKey || data.needsCorporateCa ? 'Local setup still required' : 'Profile imported',
        data.needsKey || data.needsCorporateCa
          ? 'Add the machine-local credential or certificate, then test the connection.'
          : 'No secret material was imported. Test the connection before use.'
      );
      status.textContent = data.message;
      break;
    case 'profileExported':
      status.textContent = data.message;
      announce(data.message);
      break;
    case 'supportBundleExported':
      status.textContent = data.message;
      announce(data.message);
      break;
    case 'profileActionError':
      liteLlmSettingsError.textContent = data.message;
      liteLlmSettingsError.classList.remove('hidden');
      openLiteLlmSettings();
      break;
    case 'memoryState':
      renderMemoryState(data.memory, data.message || '');
      if (!memoryPanel.classList.contains('hidden')) announce(data.message || 'Project memory loaded');
      break;
    case 'memoryActionError':
      memoryOverview.textContent = data.message || 'Could not update project memory';
      memoryOverview.setAttribute('role', 'alert');
      announce(memoryOverview.textContent);
      break;
    case 'runtimeChanged':
      agentRuntime.value = data.runtime;
      updateRunControlsSummary();
      status.textContent = data.message;
      break;
    case 'runtimeChangeError':
      fillLiteLlmSettings(data.liteLlm || {});
      status.textContent = 'Could not change agent runtime';
      const runtimeError = document.createElement('div');
      runtimeError.className = 'error';
      runtimeError.setAttribute('role', 'alert');
      runtimeError.textContent = data.message;
      timeline.appendChild(runtimeError);
      break;
    case 'browserControlChanged':
      setBrowserLiveMode(Boolean(data.liveMode));
      setBrowserControl(Boolean(data.enabled));
      if (data.message) {
        status.textContent = data.message;
        announce(data.message);
      }
      break;
    case 'browserControlError':
      setBrowserLiveMode(Boolean(data.liveMode));
      setBrowserControl(Boolean(data.enabled));
      status.textContent = 'Could not change browser control';
      appendRecovery(data.message || 'The browser-control setting could not be changed.', true, false);
      announce(status.textContent + '. ' + (data.message || ''));
      break;
    case 'browserManualControlChanged':
      setBrowserManualControl(Boolean(data.enabled));
      break;
    case 'autonomyChanged':
      setAutonomyMode(data.mode || 'review');
      status.textContent = data.message;
      break;
    case 'finalReviewChanged':
      finalReviewMode.value = ['off', 'always'].includes(data.mode) ? data.mode : 'changes';
      updateRunControlsSummary();
      if (data.message) {
        status.textContent = data.message;
        announce(data.message);
      }
      break;
    case 'finalReviewChangeError':
      finalReviewMode.value = ['off', 'always'].includes(data.mode) ? data.mode : 'changes';
      updateRunControlsSummary();
      status.textContent = 'Could not change final review';
      appendRecovery(data.message || 'The final-review setting could not be changed.', true, false);
      break;
    case 'liteLlmSaveError':
      liteLlmSettingsError.textContent = data.message;
      liteLlmSettingsError.classList.remove('hidden');
      openLiteLlmSettings();
      break;
    case 'user':
      pendingRequestId = data.message?.id || '';
      appendMessage(data.message);
      break;
    case 'pendingUserReplaced':
      pendingRequestText = data.text || pendingRequestText;
      pendingRequestId = data.id || pendingRequestId;
      updatePendingMessage(pendingRequestText, data.html || '');
      timeline.querySelectorAll('.recovery-actions').forEach(element => element.remove());
      timeline.querySelectorAll('.message.assistant[data-message-status]:not([data-message-status="complete"])').forEach(element => element.remove());
      break;
    case 'assistantStart':
      startAssistantStream(data);
      break;
    case 'assistantDelta':
      appendAssistantDelta(data);
      break;
    case 'assistantReset':
      resetAssistantStream(data);
      break;
    case 'assistant':
      pendingRequestText = '';
      pendingRequestId = '';
      replacePendingOnSubmit = false;
      timeline.querySelectorAll('.recovery-actions').forEach(element => element.remove());
      completeAssistantMessage(data.message);
      break;
    case 'sendRejected':
      prompt.value = data.text || pendingRequestText;
      if (data.replacePending) {
        replacePendingOnSubmit = true;
      } else {
        pendingRequestText = '';
        pendingRequestId = '';
        replacePendingOnSubmit = false;
      }
      resizePrompt();
      persistDraftNow();
      prompt.focus();
      break;
    case 'recoveryDiscarded':
      pendingRequestText = '';
      pendingRequestId = '';
      replacePendingOnSubmit = false;
      status.textContent = data.message || 'Unfinished request discarded';
      announce(status.textContent);
      break;
    case 'recoveryDiscardCancelled':
      timeline.querySelectorAll('[data-retry-pending], [data-edit-pending], [data-discard-pending]').forEach(button => {
        button.disabled = false;
      });
      status.textContent = 'Request kept';
      break;
    case 'recoveryDiscardError':
      timeline.querySelectorAll('[data-retry-pending], [data-edit-pending], [data-discard-pending]').forEach(button => {
        button.disabled = false;
      });
      appendRecovery(data.message || 'The unfinished request could not be discarded.', true, false);
      break;
    case 'preflightFailed':
      setBusy(false);
      prompt.value = data.text || pendingRequestText;
      if (data.replacePending) replacePendingOnSubmit = true;
      else {
        pendingRequestText = '';
        pendingRequestId = '';
      }
      resizePrompt();
      persistDraftNow();
      status.textContent = 'Request not started';
      announce('Request not started. ' + data.message);
      if (data.openConnectionSettings) {
        liteLlmSettingsError.textContent = data.message;
        liteLlmSettingsError.classList.remove('hidden');
        showConnectionSetupStep(data.kind === 'model' ? 2 : 1, false);
        openLiteLlmSettings();
        requestAnimationFrame(() => (data.kind === 'model' ? liteLlmModel : liteLlmEndpoint).focus());
      } else {
        appendRecovery(data.message, true, false);
        prompt.focus();
      }
      break;
    case 'messageCopied':
      const copiedButton = timeline.querySelector('.message[data-message-id="' + CSS.escape(data.id || '') + '"] [data-copy-message]');
      if (copiedButton) {
        copiedButton.textContent = 'Copied';
        announce('Agent response copied to the clipboard.');
        setTimeout(() => {
          if (!copiedButton.isConnected) return;
          copiedButton.disabled = false;
          copiedButton.textContent = 'Copy';
        }, 1400);
      }
      break;
    case 'messageCopyError':
      const failedCopyButton = timeline.querySelector('.message[data-message-id="' + CSS.escape(data.id || '') + '"] [data-copy-message]');
      if (failedCopyButton) {
        failedCopyButton.disabled = false;
        failedCopyButton.textContent = 'Copy';
      }
      status.textContent = data.message || 'Could not copy the response';
      announce(status.textContent);
      break;
    case 'busy': setBusy(data.value); break;
    case 'cancelState':
      if (data.state === 'requested' || data.state === 'already-requested') {
        setCancellationPending(true);
        updateRunActivityStatus('Stopping current operation');
      } else {
        setCancellationPending(false);
        if (busy) updateRunActivityStatus('No cancellable operation is active');
      }
      break;
    case 'status':
      status.textContent = data.label;
      updateRunActivityStatus(data.label);
      if (busy) appendExecutionTimelineEvent('status', data.label);
      renderActivityOverview();
      break;
    case 'plan':
      const firstPlanUpdate = currentRunSummary.plan.length === 0;
      currentRunSummary.plan = (data.items || []).map(item => ({ text: item.text, completed: Boolean(item.completed) }));
      planItems.innerHTML = data.items.map(item => '<li class="' + (item.completed ? 'done' : '') + '">' + escapeHtml(item.text) + '</li>').join('');
      if (busy) ensureRunActivity();
      renderActivityOverview();
      if (firstPlanUpdate && !planManuallyCollapsed) setActivityExpanded(true);
      break;
    case 'contextReceipt':
      currentRunSummary.contextReceipt = data.receipt || undefined;
      break;
    case 'evidence':
      currentRunSummary.evidence = data.evidence || undefined;
      break;
    case 'verification':
      currentRunSummary.verification = data.review || undefined;
      renderActivityOverview();
      break;
    case 'activity': appendActivity(data.kind, data.title, data.detail); break;
    case 'goal':
      renderGoal(data.goal);
      appendGoalTimeline(data.goal, data.goal?.lastOutcome || 'Goal progress updated.');
      break;
    case 'changes':
      currentRunSummary.files = new Map((data.items || []).map(item => [item.path, item]));
      currentRunSummary.omittedChanges = Number(data.omitted || 0);
      renderActivityOverview();
      break;
    case 'usage':
      currentRunSummary.usage = { input: data.input, output: data.output };
      status.textContent = 'Ready · ' + data.input + ' in / ' + data.output + ' out';
      renderActivityOverview();
      break;
    case 'error':
      currentRunSummary.failed = true;
      currentRunSummary.error = data.message || '';
      status.textContent = 'Run needs attention';
      renderActivityOverview();
      appendRecovery(data.message, true, data.recoverable !== false);
      break;
    case 'done':
      setCancellationPending(false);
      currentRunSummary.cancelled = data.outcome === 'cancelled';
      currentRunSummary.failed = data.outcome === 'failed';
      if (data.outcome !== 'completed') markAssistantStreamsInterrupted(data.outcome);
      renderRunSummary();
      if (liveRunThreadId && liveRunThreadId === activeThreadId) vscode.postMessage({ type: 'markThreadRead', id: liveRunThreadId });
      break;
    case 'reset':
      suppressLiveRunEvents = Boolean(liveRunThreadId && data.activeThreadId && data.activeThreadId !== liveRunThreadId);
      resetConversation(data.context, data.history, data, data.draft);
      break;
    case 'threadsUpdated':
      renderThreads(data);
      setRemoteRunActive(data.remoteRunActive);
      break;
    case 'changeRestored':
      currentRunSummary.files.set(data.change.path, data.change);
      runReviews.forEach(review => {
        const index = review.files.findIndex(file => file.id === data.change.id);
        if (index >= 0) review.files[index] = { ...data.change };
      });
      document.querySelectorAll('[data-restore-change="' + CSS.escape(data.change.id) + '"]').forEach(button => {
        button.disabled = true;
        button.textContent = 'Restored';
      });
      if (activeRunReviewId && !runReviewPanel.classList.contains('hidden')) {
        const review = runReviews.get(activeRunReviewId);
        if (review) renderRunReview(review);
      }
      status.textContent = data.warning ? 'File restored · manual save required' : 'Restored ' + data.change.path + ' to its pre-run state';
      if (data.warning) appendRecovery(data.warning, true, false);
      break;
    case 'runChangesRestored':
      (data.changes || []).forEach(change => {
        currentRunSummary.files.set(change.path, change);
        runReviews.forEach(review => {
          const index = review.files.findIndex(file => file.id === change.id);
          if (index >= 0) review.files[index] = { ...change };
        });
      });
      if (activeRunReviewId && !runReviewPanel.classList.contains('hidden')) {
        const restoredReview = runReviews.get(activeRunReviewId);
        if (restoredReview) renderRunReview(restoredReview);
      }
      status.textContent = data.warning ? 'Run changes restored · manual save required' : 'All tracked file changes from the run were undone';
      if (data.warning) appendRecovery(data.warning, true, false);
      announce(status.textContent);
      break;
    case 'runRestoreCancelled':
      if (activeRunReviewId === data.runId && !runReviewPanel.classList.contains('hidden')) {
        const cancelledReview = runReviews.get(activeRunReviewId);
        if (cancelledReview) renderRunReview(cancelledReview);
      }
      status.textContent = 'Run undo cancelled';
      break;
    case 'runChangeActionError':
      if (activeRunReviewId === data.runId && !runReviewPanel.classList.contains('hidden')) {
        const failedReview = runReviews.get(activeRunReviewId);
        if (failedReview) renderRunReview(failedReview);
      }
      appendRecovery(data.message, true, false);
      break;
    case 'changeActionError':
      document.querySelectorAll('[data-restore-change="' + CSS.escape(data.id || '') + '"]').forEach(button => {
        button.disabled = false;
        button.textContent = 'Restore';
      });
      appendRecovery(data.message, true, false);
      break;
    case 'threadError':
      const threadActionError = document.createElement('div');
      threadActionError.className = 'error';
      threadActionError.setAttribute('role', 'alert');
      threadActionError.textContent = data.message;
      timeline.appendChild(threadActionError);
      scrollConversationToBottom();
      break;
    case 'newThreadError':
      newThreadButton.disabled = false;
      status.textContent = 'New thread failed';
      const threadError = document.createElement('div');
      threadError.className = 'error';
      threadError.setAttribute('role', 'alert');
      threadError.textContent = data.message;
      timeline.appendChild(threadError);
      scrollConversationToBottom();
      break;
    case 'contextState': renderContextState(data.context); break;
    case 'toast': status.textContent = data.message; break;
  }
});

vscode.postMessage({ type: 'ready' });
`;
