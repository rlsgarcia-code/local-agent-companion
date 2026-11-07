import { redactSensitiveText } from "../src/redaction";

const MAX_FAILURE_REASON_LENGTH = 1_200;

export function formatDesktopRunFailure(
  partialAssistantText: string,
  reason: string,
  cancellationRequested: boolean
): string {
  const partial = partialAssistantText.replace(/<\/?tool_call>/gi, "").trim();
  const safeReason = redactSensitiveText(reason)
    .replace(/<\/?tool_call>/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_FAILURE_REASON_LENGTH);
  const summary = cancellationRequested
    ? "A execução foi interrompida."
    : `A execução não foi concluída.${safeReason ? `\n\nMotivo: ${safeReason}` : ""}`;
  return partial ? `${partial}\n\n---\n\n${summary}` : summary;
}
