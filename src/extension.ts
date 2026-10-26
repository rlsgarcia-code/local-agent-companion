import * as vscode from "vscode";
import { DevelopmentAgent } from "./agent";
import { ChangeReviewManager } from "./change-review";
import { ContextCollector } from "./context";
import { ProjectMemory } from "./memory";
import { configuredModelProvider, modelProviderLabel, modelProviderSecret } from "./model-provider";
import { redactSensitiveText, safeErrorMessage } from "./redaction";
import { AgentViewProvider } from "./webview";

export function activate(context: vscode.ExtensionContext): void {
  const collector = new ContextCollector();
  const memory = new ProjectMemory();
  const changeReview = new ChangeReviewManager();
  const agent = new DevelopmentAgent(context, collector, memory, changeReview);
  const provider = new AgentViewProvider(context, agent, collector, memory, changeReview);

  context.subscriptions.push(
    agent,
    provider,
    changeReview,
    vscode.workspace.registerTextDocumentContentProvider(ChangeReviewManager.scheme, changeReview),
    vscode.window.registerWebviewViewProvider("localAgentCompanion.chat", provider, {
      webviewOptions: { retainContextWhenHidden: true }
    }),
    vscode.commands.registerCommand("localAgentCompanion.open", async () => {
      await vscode.commands.executeCommand("workbench.view.extension.localAgentCompanion");
      provider.reveal();
    }),
    vscode.commands.registerCommand("localAgentCompanion.newThread", async () => {
      try {
        await provider.newThread();
      } catch (error) {
        void vscode.window.showErrorMessage(safeErrorMessage(error));
      }
    }),
    vscode.commands.registerCommand("localAgentCompanion.addSelection", () => provider.addSelection()),
    vscode.commands.registerCommand("localAgentCompanion.addFileContext", () => provider.addFileContext()),
    vscode.commands.registerCommand("localAgentCompanion.remember", async () => {
      const note = await vscode.window.showInputBox({
        title: "Remember for this project",
        prompt: "Save a durable decision, convention, or fact. Do not store secrets.",
        placeHolder: "Example: Use Vitest for new unit tests"
      });
      if (!note) return;
      const secretNames = [modelProviderSecret("litellm"), modelProviderSecret("openai")]
        .filter((name): name is string => Boolean(name));
      const storedSecrets = (await Promise.all(secretNames.map((name) => context.secrets.get(name))))
        .filter((value): value is string => Boolean(value));
      if (redactSensitiveText(note, storedSecrets) !== note) {
        void vscode.window.showErrorMessage("Project memory cannot contain gateway keys or other detected credentials.");
        return;
      }
      const uri = await memory.append(note);
      void vscode.window.showInformationMessage(`Project memory updated: ${vscode.workspace.asRelativePath(uri)}`);
    }),
    vscode.commands.registerCommand("localAgentCompanion.configureLiteLlm", async () => {
      await provider.openConnectionSettings();
    }),
    vscode.commands.registerCommand("localAgentCompanion.clearLiteLlmKey", async () => {
      const provider = configuredModelProvider(vscode.workspace.getConfiguration("localAgentCompanion"));
      const secretName = modelProviderSecret(provider);
      if (secretName) await context.secrets.delete(secretName);
      await agent.reloadProviderConfiguration();
      void vscode.window.showInformationMessage(`${modelProviderLabel(provider)} key removed from Secret Storage.`);
    }),
    vscode.commands.registerCommand("localAgentCompanion.openMcpConnections", async () => {
      try {
        await provider.openMcpConnections();
      } catch (error) {
        void vscode.window.showErrorMessage(safeErrorMessage(error));
      }
    }),
    vscode.commands.registerCommand("localAgentCompanion.configureMcpCatalogs", async () => {
      try {
        await provider.configureMcpCatalogs();
      } catch (error) {
        void vscode.window.showErrorMessage(safeErrorMessage(error));
      }
    }),
    vscode.commands.registerCommand("localAgentCompanion.refreshMcpCatalogs", async () => {
      try {
        await provider.refreshMcpCatalogs();
      } catch (error) {
        void vscode.window.showErrorMessage(safeErrorMessage(error));
      }
    }),
    vscode.commands.registerCommand("localAgentCompanion.searchMcpCatalog", async () => {
      try {
        await provider.searchMcpCatalogFromCommand();
      } catch (error) {
        void vscode.window.showErrorMessage(safeErrorMessage(error));
      }
    }),
    vscode.commands.registerCommand("localAgentCompanion.generateMcpCatalogItem", async () => {
      try {
        await provider.generateMcpCatalogItemFromClipboard();
      } catch (error) {
        void vscode.window.showErrorMessage(safeErrorMessage(error));
      }
    })
  );
}

export function deactivate(): void {}
