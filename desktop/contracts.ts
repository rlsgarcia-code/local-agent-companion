import type { OllamaRecommendationPlan, OllamaRoleConfiguration } from "../src/ollama-recommendation";

export type DesktopRunMode = "review" | "execute" | "plan";
export type DesktopAgentRuntime = "standard" | "deep";

export type DesktopExecutionStep = {
  id: string;
  text: string;
  createdAt: number;
};

export type DesktopRunOutputs = {
  activityCount: number;
  commandCount: number;
  changeCount: number;
  contextCount: number;
  previewUrls: string[];
  changes: DesktopChange[];
  commands: DesktopCommandOutput[];
  activities: DesktopActivityOutput[];
};

export type DesktopCommandOutput = {
  title: string;
  detail?: string;
  status: "complete" | "failed";
};

export type DesktopActivityOutput = {
  kind: "context" | "read" | "search" | "edit" | "command" | "thinking" | "verification";
  title: string;
  detail?: string;
  status: "complete" | "failed";
};

export type DesktopMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: number;
  status?: "complete" | "streaming" | "failed";
  executionSteps?: DesktopExecutionStep[];
  outputs?: DesktopRunOutputs;
};

export type DesktopThread = {
  id: string;
  title: string;
  messages: DesktopMessage[];
  createdAt: number;
  updatedAt: number;
  pinned?: boolean;
};

export type DesktopState = {
  workspacePath: string;
  modelRoles: OllamaRoleConfiguration;
  ollamaPublicCatalogEnabled: boolean;
  dockerSandboxEnabled: boolean;
  lastRecommendation?: OllamaRecommendationPlan;
  mode: DesktopRunMode;
  agentRuntime: DesktopAgentRuntime;
  activeThreadId: string;
  threads: DesktopThread[];
};

export type OllamaModel = {
  name: string;
  size: number;
  modifiedAt?: string;
  capabilities?: string[];
  contextLength?: number;
};

export type DesktopContextTab = {
  id: string;
  kind: "local" | "web" | "search";
  title: string;
  url: string;
  status: "loading" | "ready" | "failed";
  error?: string;
  included: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
};

export type DesktopContextSnapshot = {
  externalAccess: boolean;
  activeTabId?: string;
  tabs: DesktopContextTab[];
};

export type DesktopContextBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
  visible: boolean;
};

export type DesktopContextPage = {
  title: string;
  url: string;
  visibleText: string;
};

export type DesktopSnapshot = DesktopState & {
  ollama: {
    connected: boolean;
    version?: string;
    models: OllamaModel[];
    error?: string;
  };
  context: DesktopContextSnapshot;
  ollamaPublicCatalogLoaded: boolean;
  modelRoleNotices: string[];
  running: boolean;
};

export type DesktopActivity = {
  id: string;
  kind: "context" | "read" | "search" | "edit" | "command" | "thinking" | "verification";
  title: string;
  detail?: string;
  status: "active" | "complete" | "failed";
  createdAt: number;
};

export type DesktopChange = {
  path: string;
  kind: "created" | "modified" | "deleted";
};

export type DesktopEvent =
  | { type: "snapshot"; snapshot: DesktopSnapshot }
  | { type: "run-start"; threadId: string; message: DesktopMessage; assistantMessageId: string }
  | { type: "assistant-delta"; threadId: string; messageId: string; delta: string }
  | { type: "assistant-step"; threadId: string; messageId: string; step: DesktopExecutionStep }
  | { type: "assistant-reset"; threadId: string; messageId: string }
  | { type: "assistant-complete"; threadId: string; message: DesktopMessage; changes: DesktopChange[] }
  | { type: "activity"; activity: DesktopActivity }
  | { type: "context-snapshot"; snapshot: DesktopContextSnapshot }
  | { type: "context-focus"; url: string }
  | { type: "run-error"; threadId: string; message: string }
  | { type: "run-done"; threadId: string };

export type ApprovalRequest = {
  id: string;
  kind: "file" | "command";
  title: string;
  detail: string;
  confirmLabel: string;
};

export type SendRequest = {
  text: string;
  threadId: string;
};

export type PullProgress = {
  model: string;
  line: string;
  done: boolean;
  error?: string;
};
