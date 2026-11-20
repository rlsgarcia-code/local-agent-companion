import { PNG } from "pngjs";
import * as path from "node:path";
import { inflateSync } from "node:zlib";
import {encodeGamePng} from "./png-encoding";
import type { GameAssetOperation } from "../../contracts/src/game-assets";
import type { ProcessedGameAsset } from "../../game-production/src/index";

type Image = { width: number; height: number; data: Buffer };
type Rect = { x: number; y: number; w: number; h: number };
const pixelBudget = 16 * 1024 * 1024;
export function imageProcessor(files: Map<string, Buffer>) {
  const cache = new Map<string, Image>(); let pixels = 0;
  const load = (name: string): Image => {
    const cached = cache.get(name); if (cached) return cached;
    const bytes = files.get(name);
    if (!bytes || bytes.length < 33 || bytes.length > 16 * 1024 * 1024 || !bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ||
        bytes.subarray(12, 16).toString() !== "IHDR" || bytes[24] !== 8) throw new Error("Image processing requires bounded 8-bit PNG sources; original files were preserved.");
    const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
    if (!width || !height || width > 4096 || height > 4096 || (pixels += width * height) > pixelBudget) throw new Error("Source image pixel budget exceeded; split the operation explicitly.");
    verifyPngInflation(bytes,width,height);
    const image = PNG.sync.read(bytes, { checkCRC: true });
    if(image.gamma && Math.abs(image.gamma-0.45455)>0.001)throw new Error("This operation requires sRGB-compatible PNG samples; preserve and convert other color spaces explicitly.");
    cache.set(name, image); return image;
  };
  const canvas = (width: number, height: number): Image => ({ width, height, data: Buffer.alloc(width * height * 4) });
  function compose(operation: Extract<GameAssetOperation, { type: "image.compose" }>): ProcessedGameAsset {
    if (operation.layers.reduce((sum, layer) => sum + layer.width * layer.height, 0) > 32 * 1024 * 1024) throw new Error("Composition layer pixel budget exceeded.");
    const output = canvas(operation.width, operation.height), background = color(operation.background);
    for (let index = 0; index < output.data.length; index += 4) for (let c = 0; c < 4; c++) output.data[index + c] = background[c]!;
    for (const layer of operation.layers) {
      const image = load(layer.source.path), crop = layer.crop ?? { x: 0, y: 0, width: image.width, height: image.height }, tint = color(layer.tint);
      if (crop.x + crop.width > image.width || crop.y + crop.height > image.height) throw new Error("Requested crop extends outside its exact source image.");
      for (let y = Math.max(0, layer.y); y < Math.min(output.height, layer.y + layer.height); y++) for (let x = Math.max(0, layer.x); x < Math.min(output.width, layer.x + layer.width); x++) {
        let u = (x - layer.x + 0.5) * crop.width / layer.width - 0.5, v = (y - layer.y + 0.5) * crop.height / layer.height - 0.5;
        if (layer.flipX) u = crop.width - 1 - u; if (layer.flipY) v = crop.height - 1 - v;
        u = Math.min(crop.width - 1, Math.max(0, u)); v = Math.min(crop.height - 1, Math.max(0, v));
        const rgba = sample(image, crop.x + u, crop.y + v, layer.filter);
        const index = (y * output.width + x) * 4, sa = rgba[3]! / 255 * layer.opacity * tint[3]! / 255, da = output.data[index + 3]! / 255, alpha = sa + da * (1 - sa);
        for (let c = 0; c < 3; c++) output.data[index + c] = alpha ? Math.round((rgba[c]! * tint[c]! / 255 * sa + output.data[index + c]! * da * (1 - sa)) / alpha) : 0;
        output.data[index + 3] = Math.round(alpha * 255);
      }
    }
    const encoded=encodeGamePng(output,operation.pngEncoding);
    return { files: [{ path: operation.output, mime: "image/png", data: encoded.data }], info: { width: output.width, height: output.height, layers: operation.layers.length, format: encoded.format,...(operation.pngEncoding==="lossless-smallest"?{pngEncoding:operation.pngEncoding,rgba8Bytes:encoded.rgba8Bytes,encodedBytes:encoded.encodedBytes,bytesSaved:encoded.bytesSaved}:{}) } };
  }
  function atlas(operation: Extract<GameAssetOperation, { type: "image.atlas" }>): ProcessedGameAsset {
    const bounds = new Map<Image, Rect>();
    const frames = operation.frames.map((frame, order) => {
      const image = load(frame.source.path); let crop = bounds.get(image);
      if (!crop) { crop = operation.trim ? trimmed(image) : { x: 0, y: 0, w: image.width, h: image.height }; bounds.set(image, crop); }
      return { ...frame, image, crop, order, w: crop.w + operation.padding * 2, h: crop.h + operation.padding * 2 };
    }).sort((a, b) => Math.max(b.w,b.h)-Math.max(a.w,a.h) || b.w*b.h-a.w*a.h || a.order-b.order);
    type Page = { image: Image; free: Rect[]; frames: Record<string, unknown>[] };
    const pages: Page[] = [];
    for (const frame of frames) {
      if (frame.w > operation.pageSize || frame.h > operation.pageSize) throw new Error("An atlas frame plus padding exceeds the selected page size.");
      let selected: { page: Page; rect: Rect; score: number } | undefined;
      for (const page of pages) for (const free of page.free) if (free.w >= frame.w && free.h >= frame.h) {
        const score = Math.min(free.w - frame.w, free.h - frame.h) * operation.pageSize ** 2 + free.w * free.h - frame.w * frame.h;
        if (!selected || score < selected.score) selected = { page, rect: { x: free.x, y: free.y, w: frame.w, h: frame.h }, score };
      }
      if (!selected) {
        if (pages.length >= operation.maxPages || (pages.length + 1) * operation.pageSize ** 2 > pixelBudget) throw new Error("Atlas page/pixel budget exceeded; no frames were dropped.");
        const page = { image: canvas(operation.pageSize, operation.pageSize), free: [{ x:0,y:0,w:operation.pageSize,h:operation.pageSize }], frames: [] } as Page;
        pages.push(page); selected = { page, rect: { x:0,y:0,w:frame.w,h:frame.h }, score: 0 };
      }
      const { page, rect } = selected; page.free = splitFree(page.free, rect);
      const padding = operation.padding;
      for (let y = 0; y < rect.h; y++) for (let x = 0; x < rect.w; x++) {
        const sx = frame.crop.x + Math.max(0, Math.min(frame.crop.w - 1, x - padding)), sy = frame.crop.y + Math.max(0, Math.min(frame.crop.h - 1, y - padding));
        const sourceIndex = (sy * frame.image.width + sx) * 4, targetIndex = ((rect.y + y) * page.image.width + rect.x + x) * 4;
        frame.image.data.copy(page.image.data, targetIndex, sourceIndex, sourceIndex + 4);
      }
      page.frames.push({ filename: frame.id, frame: { x: rect.x+padding, y:rect.y+padding, w:frame.crop.w, h:frame.crop.h }, rotated:false,
        trimmed: frame.crop.w !== frame.image.width || frame.crop.h !== frame.image.height,
        spriteSourceSize: frame.crop, sourceSize: { w:frame.image.width,h:frame.image.height } });
    }
    const names = pages.map((_page, index) => `${operation.outputBase}-page-${String(index).padStart(2,"0")}.png`);
    const metadata = { textures: pages.map((page, index) => ({ image: path.posix.basename(names[index]!), format: "RGBA8888", size: { w:page.image.width,h:page.image.height }, scale: 1, frames: page.frames })),
      animations: Object.fromEntries(operation.animations.map((clip) => [clip.id, { frames: clip.frames, fps: clip.fps, loop: clip.loop }])),
      meta: { app: "Companion local asset processor", schemaVersion: 1, padding: operation.padding } };
    const encoded=pages.map(page=>encodeGamePng(page.image,operation.pngEncoding));
    return { files: [...encoded.map((page, index) => ({ path:names[index]!,mime:"image/png",data:page.data })),
      { path: `${operation.outputBase}.atlas.json`, mime: "application/json", data: Buffer.from(JSON.stringify(metadata)) }],
      info: { pages: pages.length, frames: frames.length, animations: operation.animations.length, pageSize: operation.pageSize, extrudedPadding: operation.padding, format:operation.pngEncoding==="lossless-smallest"?"Lossless 8-bit PNG multiatlas":"RGBA8 PNG multiatlas",...(operation.pngEncoding==="lossless-smallest"?{pngEncoding:operation.pngEncoding,rgba8Bytes:encoded.reduce((sum,page)=>sum+page.rgba8Bytes,0),encodedBytes:encoded.reduce((sum,page)=>sum+page.encodedBytes,0),bytesSaved:encoded.reduce((sum,page)=>sum+page.bytesSaved,0)}:{}) } };
  }
  return { compose, atlas };
}
function color(hex: string): number[] { return [1,3,5,7].map((index) => Number.parseInt(hex.slice(index,index+2),16)); }
export function verifyPngInflation(data:Buffer,width:number,height:number) {
  const bpp=({0:1,2:3,3:1,4:2,6:4} as Record<number,number>)[data[25]!];
  if(!bpp || data[28]!>1)throw new Error("Unsupported PNG color/interlace format.");
  let expected=0;
  for(const [x,y,dx,dy] of data[28] ? [[0,0,8,8],[4,0,8,8],[0,4,4,8],[2,0,4,4],[0,2,2,4],[1,0,2,2],[0,1,1,2]] : [[0,0,1,1]]) {
    const w=Math.max(0,Math.ceil((width-x!)/dx!)),h=Math.max(0,Math.ceil((height-y!)/dy!));if(w&&h)expected+=(w*bpp+1)*h;
  }
  const chunks:Buffer[]=[];let offset=8,count=0;
  while(offset+12<=data.length) {
    if(++count>10000)throw new Error("PNG chunk budget exceeded.");
    const size=data.readUInt32BE(offset),type=data.subarray(offset+4,offset+8).toString();
    if(size>data.length-offset-12)throw new Error("Truncated PNG chunk.");
    if(["acTL","fcTL","fdAT","iCCP"].includes(type))throw new Error("Animated PNG or embedded color profiles need an explicit compatible processor; originals were preserved.");
    if(type==="IDAT")chunks.push(data.subarray(offset+8,offset+8+size));offset+=size+12;
    if(type==="IEND")break;
  }
  if(offset!==data.length || !chunks.length)throw new Error("Incomplete PNG data.");
  // PNGJS's Adam7 path does not impose its own inflate length. Bound it before
  // decoding; identical immutable bytes cannot inflate beyond this verified size.
  if(inflateSync(Buffer.concat(chunks),{maxOutputLength:expected}).length!==expected)throw new Error("PNG decompressed size differs from its declared pixels.");
}
function sample(image: Image, x: number, y: number, filter: "nearest" | "bilinear"): number[] {
  if (filter === "nearest") { const index = (Math.round(y) * image.width + Math.round(x)) * 4; return [...image.data.subarray(index,index+4)]; }
  const left=Math.floor(x), top=Math.floor(y), result=[0,0,0,0];
  for (const [sx,sy,weight] of [[left,top,(1-x+left)*(1-y+top)], [Math.min(left+1,image.width-1),top,(x-left)*(1-y+top)], [left,Math.min(top+1,image.height-1),(1-x+left)*(y-top)], [Math.min(left+1,image.width-1),Math.min(top+1,image.height-1),(x-left)*(y-top)]]) {
    const index=(sy!*image.width+sx!)*4, alpha=image.data[index+3]!/255;
    for(let c=0;c<3;c++) result[c]! += image.data[index+c]!*alpha*weight!;
    result[3]! += alpha*weight!;
  }
  return [...result.slice(0,3).map((value)=>result[3] ? value/result[3] : 0),result[3]!*255];
}
function trimmed(image: Image): Rect {
  let left=image.width,top=image.height,right=-1,bottom=-1;
  for(let y=0;y<image.height;y++)for(let x=0;x<image.width;x++)if(image.data[(y*image.width+x)*4+3]) {left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y);}
  return right<0 ? {x:0,y:0,w:1,h:1} : {x:left,y:top,w:right-left+1,h:bottom-top+1};
}
function splitFree(free: Rect[], used: Rect): Rect[] {
  const result: Rect[]=[];
  for(const box of free) {
    if(used.x>=box.x+box.w || used.x+used.w<=box.x || used.y>=box.y+box.h || used.y+used.h<=box.y) {result.push(box);continue;}
    if(used.x>box.x)result.push({...box,w:used.x-box.x});
    if(used.x+used.w<box.x+box.w)result.push({...box,x:used.x+used.w,w:box.x+box.w-used.x-used.w});
    if(used.y>box.y)result.push({...box,h:used.y-box.y});
    if(used.y+used.h<box.y+box.h)result.push({...box,y:used.y+used.h,h:box.y+box.h-used.y-used.h});
  }
  const pruned=result.filter((box,index)=>!result.some((other,i)=>i!==index && other.x<=box.x && other.y<=box.y && other.x+other.w>=box.x+box.w && other.y+other.h>=box.y+box.h && (i<index || other.w*other.h>box.w*box.h)));
  if(pruned.length>4096)throw new Error("Atlas packing complexity budget exceeded."); return pruned;
}
