import assert from "node:assert/strict";
import test from "node:test";
import {readFile,mkdtemp,rm,writeFile} from "node:fs/promises";
import path from "node:path";
import {tmpdir} from "node:os";
import {PNG} from "pngjs";
import {initializeVectorRasterizer} from "../packages/adapter-game-assets/src/rasterizer";
import {processGameMedia} from "../packages/adapter-game-assets/src/process";
import {createLocalGameAssetProcessor} from "../packages/adapter-game-assets/src/index";
import {gameVectorImageOperation,vectorRecipePath} from "../packages/contracts/src/game-vector";
import {gameMediaProcessRequest} from "../packages/contracts/src/game-media-worker";
import {gameAssetSpec} from "../packages/contracts/src/game-assets";
import {vectorIllustrationFixture} from "./game-vector-fixtures";
import {fixtureGameDocument} from "./game-fixtures";
import {gameContentHash} from "../packages/game-design/src/project";
import {contentHash} from "../packages/contracts/src/identity";
import type {Registration} from "../packages/contracts/src/index";

test("pinned Wasm rasterizes typed geometry as real deterministic PNG with alpha, transforms and gradients offline",async()=>{
  const bytes=await readFile(require.resolve("@resvg/resvg-wasm/index_bg.wasm"));
  await assert.rejects(initializeVectorRasterizer(bytes.subarray(1)),/integrity/);
  const fetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error("Rasterization must not fetch fonts, images or codecs");};
  try{
    const rasterize=await initializeVectorRasterizer(bytes);
    const operation=gameVectorImageOperation.parse({type:"image.vector",output:"assets/alpha.png",width:16,height:16,shapes:[{kind:"rect",id:"red",x:2,y:2,width:6,height:6,fill:"#ff000080",transform:{x:2,y:0}}]});
    const result=processGameMedia(operation,new Map(),rasterize),again=processGameMedia(operation,new Map(),rasterize);
    assert.deepEqual(result,again);assert.equal(result.files[0]!.mime,"image/png");
    assert.equal(Buffer.from(result.files[0]!.data).subarray(0,8).toString("hex"),"89504e470d0a1a0a");
    const image=PNG.sync.read(Buffer.from(result.files[0]!.data)),pixel=(x:number,y:number)=>[...image.data.subarray((y*16+x)*4,(y*16+x)*4+4)];
    assert.equal(image.width,16);assert.equal(image.height,16);assert.deepEqual(pixel(0,0),[0,0,0,0]);assert.deepEqual(pixel(5,4),[255,0,0,128]);assert.deepEqual(pixel(2,4),[0,0,0,0]);
    assert.deepEqual(JSON.parse(Buffer.from(result.files[1]!.data).toString()),{schemaVersion:1,operation});assert.equal(result.files[1]!.path,vectorRecipePath(operation.output));
    assert.throws(()=>processGameMedia(operation,new Map()),/verified packaged rasterizer/);
    const gradient=gameVectorImageOperation.parse({...operation,output:"assets/gradient.png",shapes:[{kind:"rect",id:"gradient",x:0,y:0,width:16,height:16,fill:{type:"linear",x1:0,y1:0,x2:16,y2:0,stops:[{offset:0,color:"#ff0000ff"},{offset:1,color:"#0000ffff"}]}}]});
    const pixels=PNG.sync.read(Buffer.from(processGameMedia(gradient,new Map(),rasterize).files[0]!.data)).data;
    assert.ok(pixels[0]!>pixels[15*4]!);assert.ok(pixels[2]!<pixels[15*4+2]!);assert.equal(pixels[3],255);
    const illustrated={...vectorIllustrationFixture(),output:"assets/lantern.png"};
    const illustration=PNG.sync.read(Buffer.from(processGameMedia(illustrated,new Map(),rasterize).files[0]!.data));
    assert.equal(illustration.width,illustrated.width);assert.ok(new Set(Array.from({length:illustration.data.length/4},(_,i)=>illustration.data.subarray(i*4,i*4+4).toString("hex"))).size>100,"curves, antialiasing and gradients produce actual detailed pixels");
  }finally{globalThis.fetch=fetch;}
});

test("processor availability refuses missing or modified rasterizer bytes instead of advertising a PNG fallback",async()=>{
  const root=await mkdtemp(path.join(tmpdir(),"vector-integrity-"));
  const reg:Registration={id:"raster-fixture",product:"companion-mac",profile:"fixture",workspace:"",providers:["ollama"],hostTools:[]};
  try{
    const missing=createLocalGameAssetProcessor({rasterizerPath:path.join(root,"missing.wasm")});assert.equal((await missing.probe(reg)).available,false);
    const bytes=await readFile(require.resolve("@resvg/resvg-wasm/index_bg.wasm"));bytes[0]=bytes[0]!^1;const altered=path.join(root,"altered.wasm");await writeFile(altered,bytes);
    const processor=createLocalGameAssetProcessor({rasterizerPath:altered});assert.equal((await processor.probe(reg)).available,false);
  }finally{await rm(root,{recursive:true,force:true});}
});

test("PNG vector recipes preserve strict geometry/path limits and remain unavailable to the fixed Core worker",()=>{
  const operation={...vectorIllustrationFixture(),output:"assets/lantern.png"};assert.equal(gameVectorImageOperation.safeParse(operation).success,true);
  for(const output of ["assets/lantern.jpg","../lantern.png","assets/lantern.PNG",`assets/${"a".repeat(247)}.png`])assert.equal(gameVectorImageOperation.safeParse({...operation,output}).success,false);
  const document=fixtureGameDocument(),spec=gameAssetSpec.parse({processorId:"kidos-core-media-v1",target:{id:"lantern",role:"Typed raster",placeholder:true},operation});
  assert.equal(gameMediaProcessRequest.safeParse({schemaVersion:1,requestId:"core-raster-denied",sourceHash:gameContentHash(document),recipeHash:contentHash(spec),toolchain:{id:"fixture",version:"1",sha256:"a".repeat(64)},document,spec,sources:[]}).success,false);
});
