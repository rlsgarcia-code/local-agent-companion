import {PNG} from "pngjs";
import {crc32,deflateSync} from "node:zlib";

export type PngEncoding="rgba8"|"lossless-smallest";
type Image={width:number;height:number;data:Buffer};
type Format="RGBA8 PNG"|"RGB8 PNG"|"G8 PNG"|"GA8 PNG"|"Indexed8 PNG";
/** Original 8-bit samples only. No resizing, quantization, new colors, profile
 * conversion, file/URL access or metadata authority. Compare bounded candidates
 * by actual bytes; ties preserve the earlier representation. */
export function encodeGamePng(image:Image,mode:PngEncoding="rgba8"){
 if(!Number.isInteger(image.width)||!Number.isInteger(image.height)||image.width<1||image.height<1||image.width>4096||image.height>4096||image.width*image.height>16*1024*1024||image.data.length!==image.width*image.height*4)throw Error("PNG encoding exceeds the exact image/pixel bounds.");
 if(mode!=="rgba8"&&mode!=="lossless-smallest")throw Error("Unsupported PNG encoding; original data was preserved.");
 const write=(colorType:0|2|4|6)=>{const output=new PNG({width:image.width,height:image.height});output.data=image.data;return PNG.sync.write(output,{colorType,inputColorType:6,inputHasAlpha:true,bitDepth:8,deflateLevel:9,filterType:-1});};
 const baseline=write(6);let data=baseline,format:Format="RGBA8 PNG";
 if(mode==="lossless-smallest"){
  let opaque=true,gray=true,palettePossible=true;const colors=new Map<number,number>(),palette:number[]=[];let indices:Buffer|undefined=Buffer.alloc(image.width*image.height);
  for(let at=0,pixel=0;at<image.data.length;at+=4,pixel++){
   const r=image.data[at]!,g=image.data[at+1]!,b=image.data[at+2]!,a=image.data[at+3]!;
   if(a!==255)opaque=false;if(r!==g||g!==b)gray=false;
   if(palettePossible){const color=image.data.readUInt32BE(at);let index=colors.get(color);
    if(index===undefined){if(palette.length===256){palettePossible=false;indices=undefined;continue;}index=palette.length;colors.set(color,index);palette.push(color);}indices![pixel]=index;
   }
  }
  const consider=(candidate:Buffer,label:Format)=>{if(candidate.length<data.length){data=candidate;format=label;}};
  if(opaque)consider(write(2),"RGB8 PNG");
  if(gray)consider(write(opaque?0:4),opaque?"G8 PNG":"GA8 PNG");
  if(palettePossible&&indices)consider(indexed(image.width,image.height,indices,palette),"Indexed8 PNG");
 }
 return {data,format,rgba8Bytes:baseline.length,encodedBytes:data.length,bytesSaved:baseline.length-data.length};
}
function chunk(type:string,data:Buffer){
 const name=Buffer.from(type,"ascii"),out=Buffer.alloc(data.length+12);out.writeUInt32BE(data.length,0);name.copy(out,4);data.copy(out,8);out.writeUInt32BE(crc32(data,crc32(name)),data.length+8);return out;
}
function paeth(a:number,b:number,c:number){const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;}
function indexed(width:number,height:number,indices:Buffer,palette:number[]){
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width,0);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=3;
 const plte=Buffer.alloc(palette.length*3),alpha=Buffer.alloc(palette.length);let lastAlpha=-1;
 palette.forEach((color,index)=>{plte[index*3]=color>>>24;plte[index*3+1]=(color>>>16)&255;plte[index*3+2]=(color>>>8)&255;alpha[index]=color&255;if(alpha[index]!==255)lastAlpha=index;});
 const filtered=Buffer.alloc((width+1)*height),trial=Buffer.alloc(width),best=Buffer.alloc(width);
 for(let y=0;y<height;y++){
  let bestScore=Infinity,bestFilter=0;const start=y*width;
  for(let filter=0;filter<=4;filter++){
   let score=0;
   for(let x=0;x<width;x++){
    const value=indices[start+x]!,left=x?indices[start+x-1]!:0,up=y?indices[start-width+x]!:0,diagonal=x&&y?indices[start-width+x-1]!:0;
    const prediction=filter===0?0:filter===1?left:filter===2?up:filter===3?Math.floor((left+up)/2):paeth(left,up,diagonal),byte=(value-prediction)&255;
    trial[x]=byte;score+=Math.min(byte,256-byte);
   }
   if(score<bestScore){bestScore=score;bestFilter=filter;trial.copy(best);}
  }
  filtered[y*(width+1)]=bestFilter;best.copy(filtered,y*(width+1)+1);
 }
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk("IHDR",ihdr),chunk("PLTE",plte),...(lastAlpha>=0?[chunk("tRNS",alpha.subarray(0,lastAlpha+1))]:[]),chunk("IDAT",deflateSync(filtered,{level:9})),chunk("IEND",Buffer.alloc(0))]);
}
