import {z} from 'zod';
import {identifier} from './schema';
import {gameFilePath} from './games';
const count=z.number().int().nonnegative(),hash=z.string().regex(/^[a-f0-9]{64}$/);
export const gameFileCompare=z.object({projectId:identifier,baseRevision:z.number().int().positive(),targetRevision:z.number().int().positive(),path:gameFilePath,
 context:z.number().int().min(0).max(20).default(3),cursor:count.default(0),limit:z.number().int().min(1).max(100).default(50),bindingHash:hash.optional(),
}).strict().superRefine((value,context)=>{if(value.cursor>0&&!value.bindingHash)context.addIssue({code:'custom',path:['bindingHash'],message:'Continuation requires the original comparison binding.'});});
export type GameFileCompare=z.infer<typeof gameFileCompare>;
const file=z.object({path:gameFilePath,sha256:hash,size:count,mime:z.string().max(128)}).strict();
const side=z.object({revision:z.number().int().positive(),contentHash:hash,file:file.nullable(),lines:count.nullable(),utf8Bom:z.boolean().nullable()}).strict();
export const gameFileDiffRow=z.discriminatedUnion('kind',[
 z.object({kind:z.enum(['context','removed','added']),baseLine:count.nullable(),targetLine:count.nullable(),text:z.string().max(16384),ending:z.enum(['lf','crlf','cr','none'])}).strict(),
 z.object({kind:z.literal('omitted'),baseLine:count,targetLine:count,count:count}).strict(),
]);
export type GameFileDiffRow=z.infer<typeof gameFileDiffRow>;
export const gameFileComparison=z.object({projectId:identifier,path:gameFilePath,base:side,target:side,context:z.number().int().min(0).max(20),bindingHash:hash,
 state:z.enum(['text','unavailable']),reason:z.enum(['file-size','line-size','line-count','binary-or-encoding','edit-limit']).nullable(),
 counts:z.object({added:count,removed:count,unchanged:count}).strict().nullable(),
 totalRows:count,rows:z.array(gameFileDiffRow).max(100),cursor:count,hasMore:z.boolean(),
}).strict();
export type GameFileComparison=z.infer<typeof gameFileComparison>;
