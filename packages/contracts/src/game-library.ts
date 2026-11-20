import { z } from "zod";
import { identifier } from "./schema";
import { gameFilePath,gameFileTreeConflict } from "./games";

const sha=z.string().regex(/^[a-f0-9]{64}$/);
const text=z.string().trim().min(1).max(4000),short=z.string().trim().min(1).max(300);
export const gameLibraryFile=z.object({path:gameFilePath,sha256:sha,size:z.number().int().min(1).max(64*1024*1024),
  mime:z.enum(["image/png","image/jpeg","image/webp","image/svg+xml","audio/wav","audio/ogg","model/gltf-binary","model/gltf+json","application/octet-stream","application/json","text/plain","font/ttf","font/otf","font/woff2"]),
}).strict();
export const gameLibraryMetadata=z.object({id:identifier,title:short,version:short,author:short,
  source:text.refine(value=>{try{const url=new URL(value);return url.protocol==="https:"&&!url.username&&!url.password;}catch{return false;}},"Library source requires an HTTPS citation without credentials; it is never fetched at runtime."),
  spdx:z.string().min(1).max(80),licenseFiles:z.array(gameFilePath).min(1).max(4),
}).strict();
export const gameLibraryEntry=z.object({id:identifier,title:short,kind:z.enum(["image","sprite","atlas","model","animation","material","audio","font","other"]),
  tags:z.array(short).max(32),animations:z.array(short).max(128).default([]),files:z.array(gameLibraryFile).min(1).max(16),
}).strict().superRefine((value,context)=>{
  const conflict=gameFileTreeConflict([...value.files.map(file=>file.path),"LIBRARY.json"]);
  if(conflict)context.addIssue({code:"custom",path:["files"],message:conflict.message});
  if(value.files.reduce((total,file)=>total+file.size,0)>64*1024*1024)context.addIssue({code:"custom",path:["files"],message:"Library entry exceeds its 64 MiB byte budget."});
});
export const gameLibrarySelection=z.object({manifestSha256:sha,library:gameLibraryMetadata,entry:gameLibraryEntry}).strict().superRefine((value,context)=>{
  if(new Set(value.library.licenseFiles).size!==value.library.licenseFiles.length||value.library.licenseFiles.some(path=>!value.entry.files.some(file=>file.path===path&&file.mime==="text/plain")))
    context.addIssue({code:"custom",path:["library","licenseFiles"],message:"Every complete license/notice document must be an included text file of this entry."});
});
export const gameLibraryManifest=z.object({schemaVersion:z.literal(1),library:gameLibraryMetadata,entries:z.array(gameLibraryEntry).min(1).max(10000)}).strict().superRefine((value,context)=>{
  if(new Set(value.entries.map(entry=>entry.id.toLocaleLowerCase("en-US"))).size!==value.entries.length)context.addIssue({code:"custom",path:["entries"],message:"Library entry identities must be unique."});
  for(const [index,entry] of value.entries.entries())if(!gameLibrarySelection.safeParse({manifestSha256:"0".repeat(64),library:value.library,entry}).success)
    context.addIssue({code:"custom",path:["entries",index],message:"Library entry is missing its complete license/notice files."});
});
export const gameLibraryCopyOperation=z.object({type:z.literal("library.copy"),selection:gameLibrarySelection,
  outputBase:gameFilePath.refine(path=>path.startsWith("assets/"),"Library outputs must remain under assets/."),
}).strict().superRefine((value,context)=>{
  if([...value.selection.entry.files.map(file=>file.path),"LIBRARY.json"].some(path=>!gameFilePath.safeParse(`${value.outputBase}/${path}`).success))
    context.addIssue({code:"custom",path:["outputBase"],message:"Every copied file and metadata sidecar must fit portable path/component limits."});
});
export const gameLibraryQuery=z.object({processorId:identifier.default("licensed-libraries-v1"),libraryId:identifier.optional(),entryId:identifier.optional(),query:z.string().trim().max(200).default(""),cursor:z.number().int().nonnegative().default(0),limit:z.number().int().min(1).max(30).default(20)}).strict();
export const gameLibraryPage=z.object({entries:z.array(gameLibrarySelection).max(30),cursor:z.number().int().nonnegative(),hasMore:z.boolean()}).strict();
export type GameLibrarySelection=z.infer<typeof gameLibrarySelection>;
export type GameLibraryManifest=z.infer<typeof gameLibraryManifest>;
export type GameLibraryCopyOperation=z.infer<typeof gameLibraryCopyOperation>;
export type GameLibraryQuery=z.input<typeof gameLibraryQuery>;
export type GameLibraryPage=z.infer<typeof gameLibraryPage>;
