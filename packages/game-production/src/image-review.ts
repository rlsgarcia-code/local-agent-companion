import {createHash} from 'node:crypto';
import {PNG} from 'pngjs';
import type {GameImageBinding} from '../../contracts/src/game-image-review';
import type {GameFile} from '../../contracts/src/games';
import {verifyPngInflation} from '../../adapter-game-assets/src/images';
export const GAME_REVIEW_IMAGE_BYTES=2*1024*1024;
export type PreparedGameImage={binding:GameImageBinding;mime:'image/png';data:string};
export type GameImageReviewer=(image:PreparedGameImage)=>Promise<unknown>;
/** Private model-call data, never public activity, ToolMessage or screenshot
 * capture. Preserve original bytes; no resizing/conversion or file/URL access. */
export function prepareGameReviewImage(file:GameFile,read:()=>Uint8Array,binding:Omit<GameImageBinding,'file'|'width'|'height'>):PreparedGameImage{
 const fail=():never=>{throw Error('Image review requires a verified 8-bit PNG up to 2 MiB and 4,194,304 pixels; original bytes are preserved.');};
 if(file.mime!=='image/png'||file.size>GAME_REVIEW_IMAGE_BYTES||file.size<33)return fail();
 const bytes=Buffer.from(read());
 if(bytes.length!==file.size||createHash('sha256').update(bytes).digest('hex')!==file.sha256)return fail();
 if(!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||bytes.subarray(12,16).toString()!=='IHDR'||bytes[24]!==8)return fail();
 const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);
 if(!width||!height||width>4096||height>4096||width*height>4*1024*1024)return fail();
 try{verifyPngInflation(bytes,width,height);const image=PNG.sync.read(bytes,{checkCRC:true});if(image.width!==width||image.height!==height)return fail();}catch{return fail();}
 return {binding:{...binding,file:{path:file.path,mime:'image/png',size:file.size,sha256:file.sha256},width,height},mime:'image/png',data:bytes.toString('base64')};
}
