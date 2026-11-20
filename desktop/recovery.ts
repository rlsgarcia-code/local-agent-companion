import type { DesktopMessage } from "./contracts";
import { terminalStates, type RunState } from "@companion/client-sdk/contracts";

/** A terminal local projection already contains the delivered result, including failures. */
export function needsDesktopRecovery(message: DesktopMessage | undefined, engineState?: RunState): boolean {
  return !message || message.status === "streaming" || Boolean(engineState && !terminalStates.has(engineState));
}
