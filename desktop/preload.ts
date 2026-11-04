import { contextBridge, ipcRenderer } from "electron";
import type {
  ApprovalRequest,
  DesktopAgentRuntime,
  DesktopContextBounds,
  DesktopContextSnapshot,
  DesktopEvent,
  DesktopRunMode,
  DesktopSnapshot,
  PullProgress,
  SendRequest
} from "./contracts";

const api = {
  snapshot: (): Promise<DesktopSnapshot> => ipcRenderer.invoke("companion:snapshot"),
  chooseWorkspace: (): Promise<DesktopSnapshot> => ipcRenderer.invoke("companion:choose-workspace"),
  setModel: (model: string): Promise<DesktopSnapshot> => ipcRenderer.invoke("companion:set-model", model),
  setMode: (mode: DesktopRunMode): Promise<DesktopSnapshot> => ipcRenderer.invoke("companion:set-mode", mode),
  setAgentRuntime: (runtime: DesktopAgentRuntime): Promise<DesktopSnapshot> => ipcRenderer.invoke("companion:set-agent-runtime", runtime),
  selectThread: (threadId: string): Promise<DesktopSnapshot> => ipcRenderer.invoke("companion:select-thread", threadId),
  newThread: (): Promise<DesktopSnapshot> => ipcRenderer.invoke("companion:new-thread"),
  refreshOllama: (): Promise<DesktopSnapshot> => ipcRenderer.invoke("companion:refresh-ollama"),
  recommendModels: (): Promise<DesktopSnapshot> => ipcRenderer.invoke("companion:recommend-models"),
  setPublicOllamaCatalog: (enabled: boolean): Promise<DesktopSnapshot> => ipcRenderer.invoke("companion:set-public-ollama-catalog", enabled),
  setDockerSandbox: (enabled: boolean): Promise<DesktopSnapshot> => ipcRenderer.invoke("companion:set-docker-sandbox", enabled),
  refreshPublicOllamaCatalog: (): Promise<DesktopSnapshot> => ipcRenderer.invoke("companion:refresh-public-ollama-catalog"),
  applyRecommendation: (roles: Record<string, string>): Promise<DesktopSnapshot> => ipcRenderer.invoke("companion:apply-recommendation", roles),
  pullRecommended: (): Promise<DesktopSnapshot> => ipcRenderer.invoke("companion:pull-recommended"),
  pullModel: (model: string): Promise<DesktopSnapshot> => ipcRenderer.invoke("companion:pull-model", model),
  send: (request: SendRequest): Promise<void> => ipcRenderer.invoke("companion:send", request),
  cancel: (): Promise<void> => ipcRenderer.invoke("companion:cancel"),
  openContext: (value: string): Promise<DesktopContextSnapshot> => ipcRenderer.invoke("companion:context-open", value),
  selectContextTab: (id: string): Promise<DesktopContextSnapshot> => ipcRenderer.invoke("companion:context-select", id),
  closeContextTab: (id: string): Promise<DesktopContextSnapshot> => ipcRenderer.invoke("companion:context-close", id),
  toggleContextIncluded: (id: string): Promise<DesktopContextSnapshot> => ipcRenderer.invoke("companion:context-toggle-included", id),
  navigateContext: (action: "back" | "forward" | "reload"): Promise<DesktopContextSnapshot> => ipcRenderer.invoke("companion:context-navigate", action),
  setContextExternalAccess: (enabled: boolean): Promise<DesktopContextSnapshot> => ipcRenderer.invoke("companion:context-external", enabled),
  setContextBounds: (bounds: DesktopContextBounds): Promise<DesktopContextSnapshot> => ipcRenderer.invoke("companion:context-bounds", bounds),
  answerApproval: (id: string, approved: boolean): Promise<void> => ipcRenderer.invoke("companion:approval", id, approved),
  onEvent: (listener: (event: DesktopEvent) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, value: DesktopEvent) => listener(value);
    ipcRenderer.on("companion:event", wrapped);
    return () => ipcRenderer.removeListener("companion:event", wrapped);
  },
  onApproval: (listener: (request: ApprovalRequest) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, value: ApprovalRequest) => listener(value);
    ipcRenderer.on("companion:approval-request", wrapped);
    return () => ipcRenderer.removeListener("companion:approval-request", wrapped);
  },
  onPullProgress: (listener: (progress: PullProgress) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, value: PullProgress) => listener(value);
    ipcRenderer.on("companion:pull-progress", wrapped);
    return () => ipcRenderer.removeListener("companion:pull-progress", wrapped);
  }
};

contextBridge.exposeInMainWorld("companion", api);

export type CompanionDesktopApi = typeof api;
