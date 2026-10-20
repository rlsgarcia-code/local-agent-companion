import type { ConnectionDiagnosticFix } from "./connection-remediation";
import type { CompletionReview } from "./completion-review";
import type { RunOutcome } from "./completion-notification";
import type { ProjectGuidanceDocument } from "./project-guidance";
import type { RunEvidenceSnapshot } from "./run-evidence";
import type { GoalRecord } from "./goal-state";
import type { ResponseLanguage } from "./response-language";

export type RunMode = "review" | "execute" | "plan";
export type AgentRuntime = "standard" | "deep";
export type { ResponseLanguage };

export type RunPreflightResult =
  | { ready: true }
  | {
      ready: false;
      kind: "workspace" | "busy" | "connection" | "model" | "certificate";
      message: string;
      openConnectionSettings: boolean;
    };

export type ConnectionDiagnostic = {
  id: "configuration" | "catalog" | "chat" | "embeddings";
  label: string;
  status: "passed" | "failed" | "skipped";
  detail: string;
  durationMs?: number;
  fixes?: ConnectionDiagnosticFix[];
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  html?: string;
  createdAt: number;
  runId?: string;
  status?: "complete" | "streaming" | "interrupted" | "failed" | "cancelled";
  completedAt?: number;
};

export type PinnedContextSource = {
  id: string;
  filename: string;
  range: string;
  kind: "selection" | "file";
  characters: number;
  estimatedTokens: number;
};

export type AgentContextReceipt = {
  automaticContextEnabled: boolean;
  activeFile?: string;
  guidanceFiles: string[];
  pinnedSources: Array<Pick<PinnedContextSource, "filename" | "range" | "kind">>;
  diagnostics: number;
  openFiles: number;
  projectFiles: number;
  estimatedTokens: number;
  utilizationPercent: number;
  truncated: boolean;
  memory: {
    mode: "recent" | "semantic";
    recalledChunks: number;
    estimatedTokens: number;
    fallback: boolean;
    references: string[];
  };
};

export type RunFileChange = {
  id: string;
  path: string;
  kind: "created" | "modified" | "deleted";
  restored: boolean;
};

export type ContextSnapshot = {
  automaticContextEnabled: boolean;
  workspaceName: string;
  workspaceRoots: string[];
  activeFile?: string;
  language?: string;
  cursor?: string;
  selection?: string;
  diagnostics: string[];
  openFiles: string[];
  projectFiles: string[];
  projectGuidance: ProjectGuidanceDocument[];
  pinnedContext: string[];
  pinnedSources: PinnedContextSource[];
};

export type AgentUiEvent =
  | { type: "goal"; goal: GoalRecord }
  | {
      type: "thread";
      threadId: string;
      userMessage: { id: string; text: string; createdAt: number };
    }
  | { type: "status"; label: string }
  | { type: "plan"; items: Array<{ text: string; completed: boolean }> }
  | { type: "activity"; kind: string; title: string; detail?: string }
  | { type: "changes"; items: RunFileChange[]; omitted: number }
  | { type: "evidence"; evidence: RunEvidenceSnapshot }
  | { type: "verification"; review: CompletionReview }
  | { type: "contextReceipt"; receipt: AgentContextReceipt }
  | { type: "assistantStart"; id: string; runId: string; createdAt: number }
  | { type: "assistantDelta"; id: string; runId: string; sequence: number; delta: string }
  | { type: "assistantReset"; id: string; runId: string; sequence: number }
  | {
      type: "assistant";
      id: string;
      runId: string;
      text: string;
      createdAt: number;
      completedAt: number;
    }
  | { type: "usage"; input: number; output: number }
  | { type: "error"; message: string; recoverable?: boolean }
  | { type: "done"; outcome: RunOutcome };
