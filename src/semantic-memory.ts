import * as vscode from "vscode";
import { SemanticProjectMemory as ServiceSemanticMemory } from "../packages/agent-core/src/semantic-memory";
export type { SemanticMemoryOptions } from "../packages/agent-core/src/semantic-memory";
export class SemanticProjectMemory extends ServiceSemanticMemory implements vscode.Disposable {
  constructor(context:vscode.ExtensionContext) {
    super({workspaceId:vscode.workspace.workspaceFolders?.[0]?.uri.toString()??"no-workspace",storageRoot:context.globalStorageUri.fsPath,launcher:vscode.Uri.joinPath(context.extensionUri,"dist","chroma","server.cjs").fsPath});
  }
}
