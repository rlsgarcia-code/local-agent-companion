import { z } from "zod";

const identifier = z.string().min(1).max(128);
const messageText = z.string().max(200_000);
const draftText = z.string().max(50_000);
const shortText = z.string().max(512);
const urlText = z.string().max(4_096);
const secretText = z.string().max(16_384);
const runMode = z.enum(["review", "execute", "plan"]);
const runtime = z.enum(["standard", "deep"]);
const finalReviewMode = z.enum(["off", "changes", "always"]);
const responseLanguage = z.enum(["pt-BR", "en"]);
const authHeader = z.enum(["authorization", "api-key", "ocp-apim-subscription-key"]);
const modelProvider = z.enum(["litellm", "ollama", "openai"]);
const noPayload = <Type extends string>(type: Type) => z.object({ type: z.literal(type) }).strict();
const boundedDiagnostics = z.unknown().refine((value) => {
  try {
    const serialized = JSON.stringify(value);
    return serialized === undefined || serialized.length <= 256_000;
  } catch {
    return false;
  }
});

const liteLlmFields = {
  provider: modelProvider,
  endpoint: urlText,
  model: shortText,
  apiKey: secretText,
  authHeader,
  modelsEndpoint: urlText,
  preset: z.string().max(128),
  reasoningEffort: z.string().max(64),
  temperature: z.string().max(64),
  topP: z.string().max(64),
  semanticMemoryEnabled: z.boolean(),
  embeddingModel: shortText
} as const;

export const incomingMessageSchema = z.discriminatedUnion("type", [
  noPayload("ready"),
  noPayload("environmentCheck"),
  z.object({ type: z.literal("send"), text: messageText, mode: runMode, replacePending: z.boolean().optional() }).strict(),
  z.object({ type: z.literal("createGoal"), text: messageText, mode: runMode, runtime, finalReview: finalReviewMode }).strict(),
  z.object({ type: z.literal("createGoalAndRun"), text: messageText, mode: runMode, runtime, finalReview: finalReviewMode, replacePending: z.boolean().optional() }).strict(),
  z.object({ type: z.literal("activateGoal"), id: identifier }).strict(),
  z.object({ type: z.literal("resumeGoal"), id: identifier }).strict(),
  z.object({ type: z.literal("pauseGoal"), id: identifier }).strict(),
  z.object({ type: z.literal("cancelGoal"), id: identifier }).strict(),
  z.object({ type: z.literal("openGoal"), id: identifier }).strict(),
  z.object({ type: z.literal("editGoal"), id: identifier }).strict(),
  z.object({ type: z.literal("saveGoalCriteria"), id: identifier, criteria: z.array(shortText).min(1).max(20) }).strict(),
  z.object({ type: z.literal("retry"), mode: runMode }).strict(),
  z.object({ type: z.literal("discardRecovery"), threadId: identifier, messageId: identifier }).strict(),
  noPayload("refreshRunState"),
  z.object({ type: z.literal("draftChanged"), threadId: identifier, text: draftText }).strict(),
  z.object({ type: z.literal("copyMessage"), id: identifier, text: messageText }).strict(),
  noPayload("cancel"),
  noPayload("newThread"),
  z.object({ type: z.literal("selectThread"), id: identifier }).strict(),
  z.object({ type: z.literal("toggleThreadPinned"), id: identifier }).strict(),
  z.object({ type: z.literal("renameThread"), id: identifier }).strict(),
  z.object({ type: z.literal("deleteThread"), id: identifier }).strict(),
  noPayload("openMemoryCenter"),
  noPayload("openMemoryFile"),
  noPayload("addMemoryEntry"),
  z.object({ type: z.literal("editMemoryEntry"), id: identifier }).strict(),
  z.object({ type: z.literal("deleteMemoryEntry"), id: identifier }).strict(),
  noPayload("openChanges"),
  noPayload("openProblems"),
  z.object({ type: z.literal("openTerminalCommand"), command: shortText }).strict(),
  z.object({ type: z.literal("openChangeDiff"), id: identifier }).strict(),
  z.object({ type: z.literal("restoreChange"), id: identifier }).strict(),
  z.object({
    type: z.literal("restoreRunChanges"),
    runId: identifier,
    changeIds: z.array(identifier).min(1).max(50)
  }).strict(),
  noPayload("addFileContext"),
  z.object({ type: z.literal("removePinnedContext"), id: identifier }).strict(),
  noPayload("clearPinnedContext"),
  noPayload("connectionSettingsOpened"),
  noPayload("openMcpConnections"),
  noPayload("configureGatewayCa"),
  noPayload("exportConnectionProfile"),
  noPayload("importConnectionProfile"),
  z.object({ type: z.literal("exportSupportBundle"), diagnostics: boundedDiagnostics.optional() }).strict(),
  z.object({ type: z.literal("listModels"), endpoint: urlText, apiKey: secretText }).strict(),
  z.object({ type: z.literal("selectRuntime"), runtime }).strict(),
  z.object({ type: z.literal("selectAutonomy"), mode: runMode }).strict(),
  z.object({ type: z.literal("selectFinalReview"), mode: finalReviewMode }).strict(),
  z.object({ type: z.literal("selectResponseLanguage"), language: responseLanguage }).strict(),
  z.object({ type: z.literal("setLocalBrowserToolsEnabled"), enabled: z.boolean() }).strict(),
  z.object({ type: z.literal("testLiteLlm"), ...liteLlmFields }).strict(),
  z.object({ type: z.literal("saveLiteLlm"), ...liteLlmFields }).strict()
]);

export type IncomingMessage = z.infer<typeof incomingMessageSchema>;

export function parseIncomingMessage(value: unknown): IncomingMessage | undefined {
  const parsed = incomingMessageSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}
