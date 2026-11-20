import { z } from "zod";
import { identifier } from "./schema";
import { gameEngine } from "./games";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const page = { cursor: z.number().int().nonnegative().default(0), limit: z.number().int().min(1).max(100).default(30) };
const uuid = z.string().uuid();
/** Host/operator data only. Never register these requests as agent tools or
 * reinterpret them as collector-issued quality reports. No name/contact field. */
export const gamePlaytestCreate = z.object({ requestId: identifier, buildId: identifier,
  title: z.string().trim().min(1).max(200), audience: z.string().trim().min(1).max(500),
}).strict();
export const gamePlaytestStudy = z.object({ id: uuid, projectId: identifier, buildId: identifier,
  artifactHash: hash, sourceHash: hash, revision: z.number().int().positive(), engine: gameEngine,
  title: gamePlaytestCreate.shape.title, audience: gamePlaytestCreate.shape.audience, createdAt: z.number().int().nonnegative(),
  protocolVersion: z.literal(1),
}).strict();
const responseInput = z.object({ requestId: identifier, studyId: uuid, participantId: uuid,
  consentConfirmed: z.literal(true), distinctParticipantConfirmed: z.literal(true),
  understoodWithoutHelp: z.boolean(), actionSeconds: z.number().min(0).max(3600).nullable(),
  experienceScore: z.number().int().min(1).max(5),
  environment: z.object({ platform: z.string().trim().min(1).max(128), device: z.string().trim().min(1).max(300),
    browser: z.string().trim().min(1).max(128), input: z.array(z.enum(["keyboard", "pointer", "touch", "gamepad"])).min(1).max(4),
  }).strict(), notes: z.string().max(2000).default(""),
}).strict();
function observedAction(value: {understoodWithoutHelp:boolean;actionSeconds:number|null}, context:z.RefinementCtx) {
  if (value.understoodWithoutHelp !== (value.actionSeconds !== null))
    context.addIssue({ code: "custom", path: ["actionSeconds"], message: "Record observed seconds only for an action understood without help; otherwise use null." });
}
export const gamePlaytestRecord = responseInput.superRefine(observedAction);
export const gamePlaytestWithdraw = z.object({ requestId: identifier, studyId: uuid, participantId: uuid,
  consentWithdrawalConfirmed: z.literal(true),
}).strict();
export const gamePlaytestRead = z.object({ studyId: uuid, ...page }).strict();
export const gamePlaytestList = z.object({ projectId: identifier, ...page }).strict();
export const gamePlaytestInspect = z.object({ requestId: identifier }).strict();
export const gamePlaytestInspection = z.discriminatedUnion("state", [
  z.object({ state: z.literal("missing") }).strict(),
  z.object({ state: z.literal("acknowledged"), bindingHash: hash, studyId: uuid,
    participantId: uuid.nullable(), withdrawn: z.boolean().optional() }).strict(),
]);
export type GamePlaytestInspection = z.infer<typeof gamePlaytestInspection>;
export const gamePlaytestExportRequest = z.object({ studyId: uuid, includeResponses: z.boolean() }).strict();
export const gamePlaytestResponse = z.discriminatedUnion("withdrawn", [
  responseInput.omit({ requestId: true }).extend({ recordedAt: z.number().int().nonnegative(), withdrawn: z.literal(false) }).strict(),
  z.object({ studyId: uuid, participantId: uuid, withdrawn: z.literal(true), recordedAt: z.number().int().nonnegative(), withdrawnAt: z.number().int().nonnegative() }).strict(),
]);
export type GamePlaytestStudy = z.infer<typeof gamePlaytestStudy>;
export type GamePlaytestRecord = z.infer<typeof gamePlaytestRecord>;
export type GamePlaytestCreate = z.infer<typeof gamePlaytestCreate>;
export type GamePlaytestWithdraw = z.infer<typeof gamePlaytestWithdraw>;
export type GamePlaytestResponse = z.infer<typeof gamePlaytestResponse>;
export const gamePlaytestCorrect = z.object({ requestId:identifier,studyId:uuid,participantId:uuid,
  expectedResponseHash:hash,correctionConfirmed:z.literal(true),reason:z.string().trim().min(1).max(1000),
  answers:responseInput.omit({requestId:true,studyId:true,participantId:true}).superRefine(observedAction),
}).strict();
export type GamePlaytestCorrect=z.infer<typeof gamePlaytestCorrect>;
const correctionIdentity={requestId:identifier,sequence:z.number().int().min(1).max(1000),correctedAt:z.number().int().nonnegative(),beforeHash:hash,afterHash:hash};
export const gamePlaytestCorrectionEntry=z.discriminatedUnion('withdrawn',[
  z.object({...correctionIdentity,withdrawn:z.literal(false),reason:gamePlaytestCorrect.shape.reason,
    before:gamePlaytestResponse.options[0],after:gamePlaytestResponse.options[0]}).strict(),
  z.object({...correctionIdentity,withdrawn:z.literal(true),withdrawnAt:z.number().int().nonnegative()}).strict(),
]);
export const gamePlaytestCorrectionsRead=z.object({studyId:uuid,participantId:uuid,...page}).strict();
export const gamePlaytestCorrections=z.object({studyId:uuid,participantId:uuid,current:gamePlaytestResponse,currentResponseHash:hash,
  entries:z.array(gamePlaytestCorrectionEntry).max(100),cursor:z.number().int().nonnegative(),hasMore:z.boolean()}).strict();
export type GamePlaytestCorrections=z.infer<typeof gamePlaytestCorrections>;
const count = z.number().int().nonnegative().max(1000);
export const gamePlaytestSummary = z.object({ active: count, withdrawn: count, totalRecorded: count,
  understoodWithin30Seconds: count, ratedAtLeastFour: count, minimumParticipants: z.literal(10),
  requiredComprehension: count, requiredRatings: count, numericalTargetsMet: z.boolean(),
  source: z.literal("operator-attested"), qualityApproved: z.literal(false),
}).strict();
export const gamePlaytestStatus = z.object({ study: gamePlaytestStudy, stale: z.boolean(), summary: gamePlaytestSummary }).strict();
export const gamePlaytestSnapshot = gamePlaytestStatus.extend({ responses: z.array(gamePlaytestResponse).max(100), cursor: z.number().int().nonnegative(), hasMore: z.boolean() }).strict();
export const gamePlaytestPage = z.object({ studies: z.array(gamePlaytestStatus).max(100), cursor: z.number().int().nonnegative(), hasMore: z.boolean() }).strict();
export type GamePlaytestSummary = z.infer<typeof gamePlaytestSummary>;
export type GamePlaytestSnapshot = z.infer<typeof gamePlaytestSnapshot>;
export const gamePlaytestExport = gamePlaytestStatus.extend({ schemaVersion: z.literal(1), kind: z.literal("operator-playtest-study"),
  exportedAt: z.number().int().nonnegative(), includeResponses: z.boolean(), responses: z.array(gamePlaytestResponse).max(1000),
}).strict().superRefine((value, context) => {
  if (!value.includeResponses && value.responses.length) context.addIssue({ code: "custom", path: ["responses"], message: "Summary exports cannot include participant records." });
});
export type GamePlaytestExport = z.infer<typeof gamePlaytestExport>;
