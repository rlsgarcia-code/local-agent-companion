import assert from 'node:assert/strict';
import test from 'node:test';
import {PNG} from 'pngjs';
import {encodeGamePng} from '../packages/adapter-game-assets/src/png-encoding';
import {imageProcessor,verifyPngInflation} from '../packages/adapter-game-assets/src/images';
import {gameAssetOperation} from '../packages/contracts/src/game-assets';
function image(width:number,height:number,paint:(x:number,y:number)=>number[]){const data=Buffer.alloc(width*height*4);for(let y=0;y<height;y++)for(let x=0;x<width;x++)data.set(paint(x,y),(y*width+x)*4);return {width,height,data};}
function decoded(bytes:Buffer){verifyPngInflation(bytes,bytes.readUInt32BE(16),bytes.readUInt32BE(20));return PNG.sync.read(bytes,{checkCRC:true});}
function randomPalette(count:number){let seed=1093;const next=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return seed>>>0;};const colors=Array.from({length:count},(_,n)=>[n&255,n>>>8,next()&255,next()&255]);return image(256,256,()=>colors[next()%count]!);}

test('legacy and explicit RGBA8 preserve original bytes and the input buffer',()=>{
 const source=randomPalette(257),copy=Buffer.from(source.data),png=new PNG({width:source.width,height:source.height});png.data=source.data;
 const original=PNG.sync.write(png,{colorType:6,bitDepth:8,deflateLevel:9,filterType:-1});
 assert.deepEqual(encodeGamePng(source).data,original);assert.deepEqual(encodeGamePng(source,'rgba8').data,original);assert.deepEqual(source.data,copy);
 assert.throws(()=>encodeGamePng({...source,width:0}));assert.throws(()=>encodeGamePng({...source,data:source.data.subarray(4)}));
 assert.throws(()=>encodeGamePng(source,'jpeg' as never));
});

test('exact palette compression preserves every RGBA sample including partial alpha',()=>{
 const source=randomPalette(256),before=Buffer.from(source.data),encoded=encodeGamePng(source,'lossless-smallest');
 assert.equal(encoded.format,'Indexed8 PNG');assert.equal(encoded.data[24],8);assert.equal(encoded.data[25],3);
 assert.deepEqual(decoded(encoded.data).data,source.data);assert.deepEqual(source.data,before);
 assert.ok(encoded.encodedBytes<encoded.rgba8Bytes*.7);assert.equal(encoded.bytesSaved,encoded.rgba8Bytes-encoded.data.length);
 assert.deepEqual(encodeGamePng(source,'lossless-smallest'),encoded);
});

test('more than 256 exact colors never quantize or discard transparent RGB',()=>{
 for(const source of [randomPalette(257),image(300,3,(x,y)=>[x&255,x>>>8,(x+y)&255,y===0?0:y===1?128:255])]){
  const encoded=encodeGamePng(source,'lossless-smallest');assert.notEqual(encoded.data[25],3);assert.deepEqual(decoded(encoded.data).data,source.data);assert.ok(encoded.encodedBytes<=encoded.rgba8Bytes);
 }
 const transparent=image(128,128,(x,y)=>[x,y,137,0]),encoded=encodeGamePng(transparent,'lossless-smallest');assert.deepEqual(decoded(encoded.data).data,transparent.data);
});

test('opaque, grayscale and mixed-alpha sources roundtrip without increasing baseline bytes',()=>{
 const cases=[image(256,128,(x,y)=>[x,y,(x+y)&255,255]),image(256,128,(x,y)=>[(x+y)&255,(x+y)&255,(x+y)&255,255]),image(256,128,(x,y)=>[x,x,x,y*2])];
 for(const source of cases){const encoded=encodeGamePng(source,'lossless-smallest');assert.deepEqual(decoded(encoded.data).data,source.data);assert.ok(encoded.data.length<=encoded.rgba8Bytes);}
});

test('composition and multiatlas keep decoded pixels, layout and all animation metadata',()=>{
 const raw=image(180,180,(x,y)=>[(x*11)&255,(y*17)&255,(x+y)&255,255]),png=encodeGamePng(raw).data,files=new Map([['assets/raw.png',png]]),source={assetId:'raw',path:'assets/raw.png'};
 const compose=gameAssetOperation.parse({type:'image.compose',output:'assets/result.png',width:180,height:180,layers:[{source,x:0,y:0,width:180,height:180,filter:'nearest'}]});assert.equal(compose.type,'image.compose');if(compose.type!=='image.compose')return;
 assert.equal('pngEncoding'in compose,false);const baseline=imageProcessor(files).compose(compose),small=imageProcessor(files).compose({...compose,pngEncoding:'lossless-smallest'});
 assert.deepEqual(decoded(Buffer.from(baseline.files[0]!.data)).data,decoded(Buffer.from(small.files[0]!.data)).data);assert.equal(small.info.bytesSaved,small.info.rgba8Bytes as number-Buffer.from(small.files[0]!.data).length);
 const atlas=gameAssetOperation.parse({type:'image.atlas',outputBase:'assets/actors',pageSize:256,maxPages:2,frames:[{id:'one',source},{id:'two',source}],animations:[{id:'walk',frames:['one','two'],fps:12,loop:true}]});if(atlas.type!=='image.atlas')throw Error('fixture');
 const a=imageProcessor(files).atlas(atlas),b=imageProcessor(files).atlas({...atlas,pngEncoding:'lossless-smallest'});assert.equal(a.files.length,b.files.length);assert.equal(a.info.pages,2);
 for(let i=0;i<a.files.length-1;i++)assert.deepEqual(decoded(Buffer.from(a.files[i]!.data)).data,decoded(Buffer.from(b.files[i]!.data)).data);
 assert.deepEqual(a.files.at(-1)!.data,b.files.at(-1)!.data);assert.ok((b.info.encodedBytes as number)<=(b.info.rgba8Bytes as number));assert.throws(()=>gameAssetOperation.parse({...atlas,pngEncoding:'quantize'}));
 const roundtrip=imageProcessor(new Map([['assets/again.png',Buffer.from(small.files[0]!.data)]]));const again={...compose,layers:[{...compose.layers[0]!,source:{assetId:'again',path:'assets/again.png'}}]};assert.deepEqual(decoded(Buffer.from(roundtrip.compose(again).files[0]!.data)).data,raw.data);
});
