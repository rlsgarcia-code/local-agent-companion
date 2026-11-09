import type { DesktopMessage } from "./contracts";

/** A terminal local projection already contains the delivered result, including failures. */
export function needsDesktopRecovery(message: DesktopMessage | undefined): boolean {
  return !message || message.status === "streaming";
}
