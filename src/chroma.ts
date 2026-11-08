import * as vscode from "vscode";
import { LocalChromaServer as ServiceChromaServer } from "../packages/adapter-workspace/src/chroma";
export class LocalChromaServer extends ServiceChromaServer implements vscode.Disposable {
  constructor(context: vscode.ExtensionContext) {
    super({storageRoot:context.globalStorageUri.fsPath,launcher:vscode.Uri.joinPath(context.extensionUri,"dist","chroma","server.cjs").fsPath});
  }
}
