import {z} from "zod";
const text=z.string().max(20000),path=z.string().max(4096);
export const workspaceToolState=z.object({epoch:z.string().min(1).max(128).optional(),
 changes:z.array(z.object({path,kind:z.string().max(100),excerpt:z.string().max(3000).optional()}).strict()).max(50),
 omitted:z.number().int().nonnegative(),approvalWasDenied:z.boolean().optional(),
 evidence:z.object({
 commands:z.array(z.object({command:text,exitCode:z.number(),verification:z.boolean(),detail:text.optional()}).strict()).max(30),
 diagnostics:z.array(z.object({action:z.enum(["current","baseline","compare"]),count:z.number().optional(),introduced:z.number().optional(),resolved:z.number().optional()}).strict()).max(20),
 browser:z.array(z.object({action:text,pageErrors:z.number(),consoleErrors:z.number(),blockedRequests:z.number(),analyzed:z.boolean().optional(),detail:text.optional()}).strict()).max(20),
 processes:z.array(z.object({action:text,state:text.optional(),ready:z.boolean().optional()}).strict()).max(20),
 diffs:z.array(z.object({path,kind:z.enum(["created","modified","deleted"])}).strict()).max(50).optional(),
 filesRead:z.array(z.object({path,sha256:z.string().regex(/^[a-f0-9]{64}$/),startLine:z.number().optional(),endLine:z.number().optional()}).strict()).max(100),
 mcp:z.array(z.object({tool:text,approved:z.boolean()}).strict()).max(30).optional(),projectIndexInspected:z.boolean(),playbooksRead:z.array(text).max(20)
 }).strict()
}).strict();
export const workspaceToolResult=z.object({kind:z.literal("workspace-tool-result"),result:z.unknown(),state:workspaceToolState}).strict();
