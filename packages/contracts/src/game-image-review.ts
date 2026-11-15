import {z} from 'zod';
import {identifier} from './schema';
import {gameFilePath} from './games';
/** Reference only. No bytes, URL, provider, model alias, host path or authority
 * can be supplied by a model/client. Images stay under their exact namespace. */
export const gameImageReview=z.object({
 source:z.discriminatedUnion('kind',[
  z.object({kind:z.literal('project'),projectId:identifier,revision:z.number().int().positive(),path:gameFilePath}).strict(),
  z.object({kind:z.literal('report'),reportId:identifier,path:gameFilePath}).strict(),
 ]),
 focus:z.string().trim().min(1).max(2000),
}).strict();
export type GameImageReview=z.infer<typeof gameImageReview>;
export type GameImageBinding={projectId:string;revision:number;sourceHash:string;reportId?:string;buildId?:string;artifactHash?:string;
 file:{path:string;mime:'image/png';size:number;sha256:string};width:number;height:number};
