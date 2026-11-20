import * as vscode from "vscode";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import {isAbsolute} from "node:path";
import { z } from "zod";
import type { DevelopmentAgent } from "./agent";
import { GameStudioController,type GameStudioHost } from "../packages/client-ts/src/game-studio";
import { exportGameDirectory } from "../packages/client-ts/src/game-export";
import { openGamePreview } from "../packages/adapter-game-browser/src/preview";
import {openGameModelPreview} from "../packages/adapter-game-browser/src/model-preview";
import { gameStudioDraftKey } from "../packages/client-ts/src/game-studio-drafts";
import {fileGameStudioDraftStore} from "../packages/client-ts/src/game-studio-file-drafts";

const panels=new Map<string,vscode.WebviewPanel>();
export async function openEditorGameStudio(context:vscode.ExtensionContext,agent:DevelopmentAgent){
  const connection=await agent.gameStudioConnection(),key=connection.session.id,existing=panels.get(key);
  if(existing){existing.reveal();return;}
  const draftScope=gameStudioDraftKey(connection.client.options.credential.registration,connection.session.id),draftKey=`gameStudio.draft.v1.${draftScope}`;
  const storage=context.globalStorageUri;
  // Native local VS Code also exposes disk-backed profile storage through
  // vscode-userdata (FileUserDataProvider). Never reinterpret a remote/custom
  // provider URI as an OS path merely because it has an fsPath property.
  const localProfile=storage.scheme==="vscode-userdata"&&vscode.env.uiKind===vscode.UIKind.Desktop&&!vscode.env.remoteName;
  if((storage.scheme!=="file"&&!localProfile)||storage.authority||storage.query||storage.fragment||!isAbsolute(storage.fsPath))throw new Error("O Game Studio precisa de armazenamento local para confirmar seus rascunhos antes de enviar alterações.");
  // Memento acknowledgment does not prove a disk flush before an editor crash.
  // Preserve it as legacy input only; new acknowledged saves fsync the private
  // file and directory before the renderer may dispatch an effect.
  const drafts=fileGameStudioDraftStore(context.globalStorageUri.fsPath,draftScope,{readLegacy:async()=>context.workspaceState.get(draftKey)});
  const root=vscode.Uri.joinPath(context.extensionUri,"dist","game-studio"),panel=vscode.window.createWebviewPanel("companionGameStudio",`Game Studio · ${connection.title}`,vscode.ViewColumn.Active,{enableScripts:true,retainContextWhenHidden:true,localResourceRoots:[root]});
  const abort=new AbortController(),previews=new Set<Pick<Awaited<ReturnType<typeof openGamePreview>>,"close"|"page">>();let client=connection.client;
  const host:GameStudioHost={canWrite:()=>vscode.workspace.isTrusted&&vscode.workspace.getConfiguration("localAgentCompanion").get<string>("autonomyMode","review")!=="plan",
    approve:async(message)=>await vscode.window.showWarningMessage(message,{modal:true},"Continuar")==="Continuar",
    preview:async(artifact,readFile)=>{const preview=await openGamePreview({artifact,readFile,signal:abort.signal});previews.add(preview);preview.page.once("close",()=>previews.delete(preview));},
    previewModel:async(result,modelPath,readFile)=>{const preview=await openGameModelPreview({result,modelPath,readFile,runtimeDirectory:vscode.Uri.joinPath(context.extensionUri,"dist","game-model-runtime").fsPath,signal:abort.signal});previews.add(preview);preview.page.once("close",()=>previews.delete(preview));},
    exportSource:async(projectId,revision)=>{
      const result=await vscode.window.showOpenDialog({canSelectFolders:true,canSelectFiles:false,canSelectMany:false,openLabel:"Exportar fonte e histórico aqui"});if(!result?.[0])return false;
      if(result[0].scheme!=="file")throw new Error("Escolha uma pasta local para exportar.");
      const target=await exportGameDirectory({client,parent:result[0].fsPath,source:{projectId,revision}});void vscode.window.showInformationMessage(`Fonte exportada em ${target}`);return true;
    },
    exportAsset:async(jobId)=>{
      const result=await vscode.window.showOpenDialog({canSelectFolders:true,canSelectFiles:false,canSelectMany:false,openLabel:"Exportar candidato de mídia aqui"});if(!result?.[0])return false;
      if(result[0].scheme!=="file")throw new Error("Escolha uma pasta local para exportar.");
      const target=await exportGameDirectory({client,parent:result[0].fsPath,candidate:{jobId}});void vscode.window.showInformationMessage(`Candidato de mídia exportado em ${target}`);return true;
    },
    exportPlaytest:async(studyId,includeResponses)=>{
      const result=await vscode.window.showOpenDialog({canSelectFolders:true,canSelectFiles:false,canSelectMany:false,openLabel:includeResponses?"Exportar resumo e registros aqui":"Exportar somente o resumo aqui"});if(!result?.[0])return false;
      if(result[0].scheme!=="file")throw new Error("Escolha uma pasta local para exportar.");
      const target=await exportGameDirectory({client,parent:result[0].fsPath,playtest:{studyId,includeResponses}});void vscode.window.showInformationMessage(`Playtest exportado em ${target}`);return true;
    },
    exportBuild:async(artifact)=>{
      const result=await vscode.window.showOpenDialog({canSelectFolders:true,canSelectFiles:false,canSelectMany:false,openLabel:"Exportar build aqui"});if(!result?.[0])return false;
      if(result[0].scheme!=="file")throw new Error("Escolha uma pasta local para exportar.");
      const target=await exportGameDirectory({client,parent:result[0].fsPath,artifact});void vscode.window.showInformationMessage(`Build exportado em ${target}`);return true;
    }};
  let controller=new GameStudioController(client,connection.session.id,host);
  const messages=panel.webview.onDidReceiveMessage(async(input:unknown)=>{
    const parsed=z.object({type:z.literal("game-studio-request"),id:z.string().uuid(),command:z.unknown()}).strict().safeParse(input);if(!parsed.success)return;
    const {id,command}=parsed.data;
    // The shared controller owns canonical command validation, including known
    // pre-dispatch rejections. A second parser here turned them into transport
    // errors and could freeze an import that had never been dispatched.
    try{let value:unknown;if(drafts.handles(command))value=await drafts.dispatch(command);else{const current=await connection.reconnect();if(client!==current){client=current;controller=new GameStudioController(client,connection.session.id,host);}value=await controller.dispatch(command);}await panel.webview.postMessage({type:"game-studio-response",id,value});}
    catch(error){await panel.webview.postMessage({type:"game-studio-response",id,error:error instanceof Error?error.message:"Não foi possível atualizar o projeto."});}
  });
  panels.set(key,panel);panel.onDidDispose(()=>{panels.delete(key);messages.dispose();abort.abort();for(const preview of previews)void preview.close().catch(()=>{});});
  context.subscriptions.push(panel);
  const nonce=randomUUID().replaceAll("-",""),script=panel.webview.asWebviewUri(vscode.Uri.joinPath(root,"studio.js")).toString(),style=panel.webview.asWebviewUri(vscode.Uri.joinPath(root,"studio.css")).toString();
  const template=await readFile(vscode.Uri.joinPath(root,"index.html").fsPath,"utf8");
  panel.webview.html=template.replace(/content="default-src[^\"]*"/,`content="default-src 'none'; script-src 'nonce-${nonce}'; style-src ${panel.webview.cspSource}; img-src data:; media-src data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"`).replace('href="studio.css"',`href="${style}"`).replace('src="studio.js"',`nonce="${nonce}" src="${script}"`);
}
