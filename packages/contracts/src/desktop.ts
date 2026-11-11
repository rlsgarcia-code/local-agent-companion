import type {
  OllamaRecommendationPlan,
  OllamaRoleConfiguration,
} from "./ollama";
import { z } from "zod";
import { modelRoles, providerSpec, type EngineUpdateBlockers, type RunState } from "./index";
import type { ModelOptimizationProfile, ModelSelectionMode } from "./models";

export const desktopRunSpec = z
  .object({
    thread: z
      .object({
        id: z.string().max(128),
        title: z.string().max(300),
        messages: z
          .array(
            z
              .object({
                id: z.string().max(128),
                role: z.enum(["user", "assistant"]),
                text: z.string().max(1_000_000),
                createdAt: z.number(),
              })
              .passthrough(),
          )
          .max(2000),
        createdAt: z.number(),
        updatedAt: z.number(),
      })
      .passthrough(),
    request: z.string().min(1).max(1_000_000),
    workspacePath: z.string().max(4096),
    modelRoles,
    provider: providerSpec.optional(),
    dockerSandboxEnabled: z.boolean(),
    mode: z.enum(["review", "execute", "plan"]),
    agentRuntime: z.enum(["standard", "deep"]),
    assistantMessageId: z.string().max(128),
    userMessageId: z.string().min(1).max(128).optional(),
    contextPages: z
      .array(
        z
          .object({
            title: z.string().max(1000),
            url: z.string().max(8000),
            visibleText: z.string().max(200_000),
          })
          .strict(),
      )
      .max(30),
  })
  .strict();

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
  kind:
    | "context"
    | "read"
    | "search"
    | "edit"
    | "command"
    | "thinking"
    | "verification";
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
  modelProvider: "ollama" | "openai";
  modelSelectionMode: ModelSelectionMode;
  modelOptimizationProfile: ModelOptimizationProfile;
  openAiKeyStored: boolean;
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
  engine: {
    version: string;
    state: "ready" | "busy";
    blockers: EngineUpdateBlockers;
  };
  ollama: {
    connected: boolean;
    version?: string;
    models: OllamaModel[];
    error?: string;
  };
  context: DesktopContextSnapshot;
  ollamaPublicCatalogLoaded: boolean;
  modelRoleNotices: string[];
  providerCatalog: {
    provider: "ollama" | "openai";
    models: string[];
    loadedAt?: number;
    error?: string;
  };
  running: boolean;
  runState?: RunState;
};

export type DesktopActivity = {
  id: string;
  kind:
    | "context"
    | "read"
    | "search"
    | "edit"
    | "command"
    | "thinking"
    | "verification";
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
  | {
      type: "run-start";
      threadId: string;
      message: DesktopMessage;
      assistantMessageId: string;
    }
  | {
      type: "assistant-delta";
      threadId: string;
      messageId: string;
      delta: string;
    }
  | {
      type: "assistant-step";
      threadId: string;
      messageId: string;
      step: DesktopExecutionStep;
    }
  | { type: "assistant-reset"; threadId: string; messageId: string }
  | {
      type: "assistant-complete";
      threadId: string;
      message: DesktopMessage;
      changes: DesktopChange[];
    }
  | { type: "run-state"; state?: RunState }
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

export type DesktopModelSettingsInput = {
  provider: "ollama" | "openai";
  selectionMode: ModelSelectionMode;
  optimizationProfile: ModelOptimizationProfile;
  roles: OllamaRoleConfiguration;
  openAiKey?: string;
};

export type PullProgress = {
  model: string;
  line: string;
  done: boolean;
  error?: string;
};
