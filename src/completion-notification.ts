export type CompletionNotificationMode = "whenHidden" | "always" | "never";
export type RunOutcome = "completed" | "failed" | "cancelled" | "waiting";

export type CompletionNotification = {
  level: "information" | "warning";
  message: string;
  action: "Open result";
};

export function parseCompletionNotificationMode(value: unknown): CompletionNotificationMode {
  return value === "always" || value === "never" || value === "whenHidden" ? value : "whenHidden";
}

export function completionNotification(
  mode: CompletionNotificationMode,
  viewVisible: boolean,
  outcome: RunOutcome
): CompletionNotification | undefined {
  if (outcome === "waiting" || outcome === "cancelled" || mode === "never" || (mode === "whenHidden" && viewVisible)) {
    return undefined;
  }
  return outcome === "failed"
    ? {
        level: "warning",
        message: "Local Agent Companion needs attention.",
        action: "Open result"
      }
    : {
        level: "information",
        message: "Local Agent Companion finished the request.",
        action: "Open result"
      };
}
