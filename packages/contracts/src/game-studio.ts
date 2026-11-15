import { z } from "zod";
import { identifier } from "./schema";
import { gameDesignV2,gameFilePath } from "./games";
import { gameImageComposeOperation,gameAssetSpec,gameAudioRenderOperation } from "./game-assets";
import { gameVectorImageOperation } from "./game-vector";
import { gameModelOperation } from "./game-models";
import {gameLibraryQuery,gameLibraryCopyOperation} from "./game-library";
import { gamePlaytestCreate, gamePlaytestRecord, gamePlaytestWithdraw,gamePlaytestCorrect } from "./game-playtests";
import {gameRevisionCompare} from "./game-comparison";
import {gameFileCompare} from "./game-file-comparison";
import {gameAudioEncodeOperation} from './game-audio-codec';
import {gameWebDelivery} from './game-web-compiler';
const deliveryEdit={projectId:identifier,expectedRevision:z.number().int().positive(),requestId:identifier,
  configSha256:z.string().regex(/^[a-f0-9]{64}$/),delivery:gameWebDelivery.nullable()};
export const gameStudioAudioEncode=z.object({action:z.literal('encode-audio'),projectId:identifier,expectedRevision:z.number().int().positive(),requestId:identifier,
  sourceSha256:z.string().regex(/^[a-f0-9]{64}$/),spec:z.object({processorId:z.literal('audio-codec-isolated-v1'),target:gameAssetSpec.shape.target,operation:gameAudioEncodeOperation}).strict()}).strict();

export const gameStudioPlaytestMutation = z.discriminatedUnion("action", [
  gamePlaytestCreate.extend({ action: z.literal("create-playtest"), projectId: identifier }).strict(),
  z.object({ action: z.literal("record-playtest"), projectId: identifier, artifactHash: z.string().regex(/^[a-f0-9]{64}$/), request: gamePlaytestRecord }).strict(),
  z.object({ action: z.literal("withdraw-playtest"), projectId: identifier, artifactHash: z.string().regex(/^[a-f0-9]{64}$/), request: gamePlaytestWithdraw }).strict(),
  z.object({action:z.literal('correct-playtest'),projectId:identifier,artifactHash:z.string().regex(/^[a-f0-9]{64}$/),request:gamePlaytestCorrect}).strict(),
]);

/** UI commands, not Agent API registration or permission declarations. The host
 * supplies the authenticated client/session; a renderer cannot select a namespace. */
export const gameStudioCommand=z.discriminatedUnion("action",[
  z.object({action:z.literal('delivery-settings'),projectId:identifier,revision:z.number().int().positive().optional()}).strict(),
  z.object({action:z.literal('set-delivery'),...deliveryEdit}).strict(),
  z.object({action:z.literal('resume-delivery'),...deliveryEdit}).strict(),
  gameStudioAudioEncode,
  z.object({action:z.literal('resume-encode-audio'),projectId:identifier,command:gameStudioAudioEncode}).strict(),
  ...gameStudioPlaytestMutation.options,
  z.object({ action: z.literal("resume-playtest"), projectId: identifier, command: gameStudioPlaytestMutation }).strict(),
  z.object({ action: z.literal("playtests"), projectId: identifier, cursor: z.number().int().nonnegative().default(0) }).strict(),
  z.object({ action: z.literal("playtest"), projectId: identifier, studyId: z.string().uuid(), cursor: z.number().int().nonnegative().default(0) }).strict(),
  z.object({action:z.literal('playtest-corrections'),projectId:identifier,studyId:z.string().uuid(),participantId:z.string().uuid(),cursor:z.number().int().nonnegative().default(0)}).strict(),
  z.object({ action: z.literal("export-playtest"), projectId: identifier, studyId: z.string().uuid(), includeResponses: z.boolean() }).strict(),
  z.object({action:z.literal("refresh"),projectCursor:z.number().int().nonnegative().default(0)}).strict(),
  z.object({action:z.literal("select"),projectId:identifier}).strict(),
  z.object({projectId:identifier,action:z.literal("history"),cursor:z.number().int().nonnegative()}).strict(),
  gameRevisionCompare.extend({action:z.literal("compare")}).strict(),
  gameFileCompare.safeExtend({action:z.literal("compare-file")}),
  z.object({projectId:identifier,action:z.literal("jobs"),cursor:z.number().int().nonnegative()}).strict(),
  z.object({projectId:identifier,action:z.literal("libraries"),query:gameLibraryQuery}).strict(),
  z.object({projectId:identifier,action:z.literal("import-library"),expectedRevision:z.number().int().positive(),requestId:identifier,
    spec:z.object({processorId:identifier,target:gameAssetSpec.shape.target,operation:gameLibraryCopyOperation}).strict()}).strict(),
  z.object({projectId:identifier,action:z.literal("build"),expectedRevision:z.number().int().positive(),requestId:identifier}).strict(),
  z.object({projectId:identifier,action:z.literal("advance-stage"),expectedVersion:z.number().int().positive(),expectedRevision:z.number().int().positive(),requestId:identifier}).strict(),
  z.object({projectId:identifier,action:z.literal("continue-production"),expectedVersion:z.number().int().positive(),expectedRevision:z.number().int().positive(),requestId:identifier}).strict(),
  z.object({projectId:identifier,action:z.literal("reopen-production"),expectedVersion:z.number().int().positive(),expectedRevision:z.number().int().positive(),requestId:identifier}).strict(),
  z.object({projectId:identifier,action:z.literal("validate"),buildId:identifier,collectorId:identifier,requestId:identifier}).strict(),
  z.object({projectId:identifier,action:z.literal("cancel"),jobId:identifier}).strict(),
  z.object({projectId:identifier,action:z.literal("reconcile"),jobId:identifier}).strict(),
  z.object({projectId:identifier,action:z.literal("restore"),revision:z.number().int().positive(),expectedRevision:z.number().int().positive(),requestId:identifier}).strict(),
  z.object({projectId:identifier,action:z.literal("resume-restore"),revision:z.number().int().positive(),expectedRevision:z.number().int().positive(),requestId:identifier}).strict(),
  z.object({projectId:identifier,action:z.literal("design"),design:gameDesignV2,expectedRevision:z.number().int().positive(),requestId:identifier}).strict(),
  z.object({projectId:identifier,action:z.literal("resume-design"),design:gameDesignV2,expectedRevision:z.number().int().positive(),requestId:identifier}).strict(),
  z.object({projectId:identifier,action:z.literal("preview"),buildId:identifier}).strict(),
  z.object({projectId:identifier,action:z.literal("export-source"),expectedRevision:z.number().int().positive(),revision:z.number().int().positive().optional()}).strict(),
  z.object({projectId:identifier,action:z.literal("export-build"),buildId:identifier}).strict(),
  z.object({projectId:identifier,action:z.literal("media"),path:gameFilePath}).strict(),
  z.object({projectId:identifier,action:z.literal("revision-media"),revision:z.number().int().positive(),path:gameFilePath,sha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict(),
  z.object({projectId:identifier,action:z.literal("asset-result"),jobId:identifier}).strict(),
  z.object({projectId:identifier,action:z.literal("asset-audio-analysis"),jobId:identifier}).strict(),
  z.object({projectId:identifier,action:z.literal("export-asset"),jobId:identifier}).strict(),
  z.object({projectId:identifier,action:z.literal("asset-media"),jobId:identifier,path:gameFilePath}).strict(),
  z.object({projectId:identifier,action:z.literal("preview-model"),jobId:identifier,path:gameFilePath}).strict(),
  z.object({projectId:identifier,action:z.literal("apply-asset"),jobId:identifier,expectedRevision:z.number().int().positive(),requestId:identifier}).strict(),
  z.object({projectId:identifier,action:z.literal("adjust-image"),jobId:identifier,expectedRevision:z.number().int().positive(),requestId:identifier,operation:gameImageComposeOperation}).strict(),
  z.object({projectId:identifier,action:z.literal("adjust-vector"),jobId:identifier,expectedRevision:z.number().int().positive(),requestId:identifier,operation:gameVectorImageOperation}).strict(),
  z.object({projectId:identifier,action:z.literal("adjust-audio"),jobId:identifier,expectedRevision:z.number().int().positive(),requestId:identifier,operation:gameAudioRenderOperation}).strict(),
  z.object({projectId:identifier,action:z.literal("adjust-model"),jobId:identifier,expectedRevision:z.number().int().positive(),requestId:identifier,operation:gameModelOperation}).strict(),
  z.object({projectId:identifier,action:z.literal("capture"),buildId:identifier,reportId:identifier,path:gameFilePath}).strict(),
]);
export type GameStudioCommand=z.infer<typeof gameStudioCommand>;
