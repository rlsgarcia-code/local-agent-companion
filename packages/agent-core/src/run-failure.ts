import { redactSensitiveText } from "../../../src/redaction";

const MAX_FAILURE_REASON_LENGTH = 1_200;

export function formatDesktopRunFailure(
  partialAssistantText: string,
  reason: string,
  cancellationRequested: boolean,
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
  return partial
    ? `${summary}\n\n---\n\nConteúdo parcial não verificado:\n\n${partial}`
    : summary;
}

export function formatDesktopIncompleteResult(
  reason: string | undefined,
  changedPaths: readonly string[],
): string {
  const safeReason = redactSensitiveText(
    reason || "O resultado pretendido não foi verificado.",
  )
    .replace(/<\/?tool_call>/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_FAILURE_REASON_LENGTH);
  const preserved = changedPaths.length
    ? `\n\nTrabalho parcial preservado em ${changedPaths.length} arquivo(s): ${changedPaths.slice(0, 8).join(", ")}${changedPaths.length > 8 ? ", …" : ""}.`
    : "\n\nNenhuma alteração verificável foi registrada.";
  return `A tarefa não foi concluída nem verificada.\n\nMotivo: ${safeReason}${preserved}`;
}
