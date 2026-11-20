import { constants } from "node:fs";
import { lstat, realpath, opendir, open, link, unlink } from "node:fs/promises";
import path from "node:path";
import { flushPublishedDirectory } from "../../platform-files/src/directory-flush";

export function invalidMedia(): never { throw new Error("The bounded media exchange is invalid; originals and candidate were preserved."); }

/** Caller supplies sealed private broker directories, never project host paths. */
export async function mediaDirectory(name:string):Promise<void> {
  const file=path.resolve(name),info=await lstat(file);
  if(!info.isDirectory()||info.isSymbolicLink()||await realpath(file)!==file)invalidMedia();
}
export async function mediaEntries(directory:string,maximum:number):Promise<string[]> {
  const entries:string[]=[];
  for await(const item of await opendir(directory)) {
    if(entries.length>=maximum)invalidMedia();entries.push(item.name);
  }
  return entries;
}
export async function readMediaFile(file:string,maximum:number):Promise<Buffer> {
  const before=await lstat(file);
  if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1||before.size>maximum)invalidMedia();
  const handle=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{
    const info=await handle.stat();
    if(!info.isFile()||info.nlink!==1||info.size>maximum||info.dev!==before.dev||info.ino!==before.ino)invalidMedia();
    const bytes=Buffer.alloc(info.size+1);let offset=0;
    while(offset<bytes.length){const part=await handle.read(bytes,offset,bytes.length-offset,offset);if(!part.bytesRead)break;offset+=part.bytesRead;}
    if(offset!==info.size)invalidMedia();return bytes.subarray(0,offset);
  }finally{await handle.close();}
}
export async function writeMediaFile(file:string,bytes:Uint8Array):Promise<void> {
  const handle=await open(file,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);
  try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}
}
export async function syncMediaDirectory(directory:string):Promise<void> {
  await flushPublishedDirectory(directory);
}
/** Atomic create-if-absent; a prior acknowledged result is never overwritten. */
export async function commitMediaResult(pending:string,destination:string):Promise<void> {
  await link(pending,destination);await unlink(pending);await syncMediaDirectory(path.dirname(destination));
}
