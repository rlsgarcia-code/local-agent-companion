import { contextBridge,ipcRenderer } from "electron";
contextBridge.exposeInMainWorld("gameStudioHost",{request:(command:unknown)=>ipcRenderer.invoke("companion:game-studio-request",command)});
