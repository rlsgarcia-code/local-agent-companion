import { app,BrowserWindow,dialog,ipcMain } from "electron";
import { randomUUID } from "node:crypto";
import * as path from "node:path";
import { GameStudioController } from "../packages/client-ts/src/game-studio";
import { exportGameDirectory } from "../packages/client-ts/src/game-export";
import { openGamePreview } from "../packages/adapter-game-browser/src/preview";
import {openGameModelPreview} from "../packages/adapter-game-browser/src/model-preview";
import type { OllamaDesktopRuntime } from "./runtime-client";
import { gameStudioDraftKey } from "../packages/client-ts/src/game-studio-drafts";
import { desktopGameStudioDraftStore } from "./game-studio-drafts";

const windows=new Map<string,BrowserWindow>(),handlers=new Map<number,(command:unknown)=>Promise<unknown>>();
let registered=false;
export async function openDesktopGameStudio(options:{runtime:OllamaDesktopRuntime;workspace:string;thread:{id:string;title:string;messages:unknown[]};canWrite():boolean}){
  const key=JSON.stringify([options.workspace,options.thread.id]),existing=windows.get(key);if(existing&&!existing.isDestroyed()){existing.show();existing.focus();return;}
  const connection=await options.runtime.gameStudioConnection(options.thread,options.workspace);
  const drafts=desktopGameStudioDraftStore(app.getPath("userData"),gameStudioDraftKey(connection.client.options.credential.registration,connection.session.id));
  if(!registered){registered=true;ipcMain.handle("companion:game-studio-request",async(event,command:unknown)=>{
    const handler=handlers.get(event.sender.id);if(!handler||event.senderFrame!==event.sender.mainFrame)throw new Error("Esta janela não é um cliente Game Studio autorizado.");return handler(command);
  });}
  const window=new BrowserWindow({width:1200,height:850,minWidth:640,minHeight:600,title:`Game Studio · ${options.thread.title}`,backgroundColor:"#f8f9fc",webPreferences:{preload:path.join(__dirname,"game-studio-preload.cjs"),partition:`game-studio-${randomUUID()}`,sandbox:true,nodeIntegration:false,contextIsolation:true}});
  const abort=new AbortController(),previews=new Set<Pick<Awaited<ReturnType<typeof openGamePreview>>,"close"|"page">>();let client=connection.client,controller:GameStudioController;
  const host={canWrite:options.canWrite,approve:async(message:string)=>!window.isDestroyed()&&(await dialog.showMessageBox(window,{type:"question",message,buttons:["Cancelar","Continuar"],defaultId:0,cancelId:0})).response===1,
    preview:async(artifact:Parameters<typeof openGamePreview>[0]["artifact"],readFile:(name:string)=>Promise<Buffer>)=>{const preview=await openGamePreview({artifact,readFile,signal:abort.signal});previews.add(preview);preview.page.once("close",()=>previews.delete(preview));},
    previewModel:async(result:Parameters<typeof openGameModelPreview>[0]["result"],modelPath:string,readFile:(name:string)=>Promise<Buffer>)=>{const preview=await openGameModelPreview({result,modelPath,readFile,runtimeDirectory:path.join(__dirname,"game-model-runtime"),signal:abort.signal});previews.add(preview);preview.page.once("close",()=>previews.delete(preview));},
    exportSource:async(projectId:string,revision:number)=>{
      const chosen=await dialog.showOpenDialog(window,{title:"Escolha a pasta para exportar a fonte e o histórico",properties:["openDirectory","createDirectory"]});if(chosen.canceled||!chosen.filePaths[0])return false;
      const target=await exportGameDirectory({client,parent:chosen.filePaths[0],source:{projectId,revision}});await dialog.showMessageBox(window,{message:"Fonte e histórico exportados",detail:target});return true;
    },
    exportAsset:async(jobId:string)=>{
      const chosen=await dialog.showOpenDialog(window,{title:"Escolha a pasta para exportar o candidato de mídia",properties:["openDirectory","createDirectory"]});if(chosen.canceled||!chosen.filePaths[0])return false;
      const target=await exportGameDirectory({client,parent:chosen.filePaths[0],candidate:{jobId}});await dialog.showMessageBox(window,{message:"Candidato de mídia exportado",detail:target});return true;
    },
    exportPlaytest:async(studyId:string,includeResponses:boolean)=>{
      const chosen=await dialog.showOpenDialog(window,{title:includeResponses?"Exportar resumo e registros do playtest":"Exportar somente o resumo do playtest",properties:["openDirectory","createDirectory"]});if(chosen.canceled||!chosen.filePaths[0])return false;
      const target=await exportGameDirectory({client,parent:chosen.filePaths[0],playtest:{studyId,includeResponses}});await dialog.showMessageBox(window,{message:"Playtest exportado",detail:target});return true;
    },
    exportBuild:async(artifact:Parameters<typeof exportGameDirectory>[0]["artifact"])=>{
      const chosen=await dialog.showOpenDialog(window,{title:"Escolha a pasta para exportar o build",properties:["openDirectory","createDirectory"]});if(chosen.canceled||!chosen.filePaths[0])return false;
      const target=await exportGameDirectory({client,parent:chosen.filePaths[0],artifact});await dialog.showMessageBox(window,{message:"Build exportado",detail:target});return true;
    }};
  controller=new GameStudioController(client,connection.session.id,host);
  handlers.set(window.webContents.id,async(command)=>{if(drafts.handles(command))return drafts.dispatch(command);const current=await connection.reconnect();if(current!==client){client=current;controller=new GameStudioController(client,connection.session.id,host);}return controller.dispatch(command);});
  windows.set(key,window);window.webContents.setWindowOpenHandler(()=>({action:"deny"}));window.webContents.on("will-navigate",(event)=>event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
  const senderId=window.webContents.id;
  let closing=false;
  window.on("close",event=>{event.preventDefault();if(closing)return;closing=true;
    void drafts.flush().then(()=>window.destroy()).catch(async()=>{
      const choice=await dialog.showMessageBox(window,{type:"warning",message:"A última edição ainda não foi confirmada no armazenamento local.",detail:"O rascunho anterior está preservado. Volte ao Studio para conferir os ajustes antes de fechar.",buttons:["Voltar ao Studio","Fechar mesmo assim"],defaultId:0,cancelId:0});
      if(choice.response===1)window.destroy();else closing=false;
    }).catch(()=>{closing=false;});
  });
  window.once("closed",()=>{windows.delete(key);handlers.delete(senderId);abort.abort();for(const preview of previews)void preview.close().catch(()=>{});});
  await window.loadFile(path.join(__dirname,"game-studio","index.html"));
}
