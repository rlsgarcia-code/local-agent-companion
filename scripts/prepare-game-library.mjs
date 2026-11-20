// Administrative OFFLINE preparation. No downloads, plugins, source execution or model calls.
import {readFile,writeFile,mkdir,lstat,copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
const root=path.resolve('packages/adapter-game-library');
const lock=JSON.parse(await readFile(path.join(root,'upstream.lock.json'),'utf8'));
const input=path.resolve(process.argv[2]??`.cache/game-libraries/${lock.id}/${lock.commit}/input`);
const sha=data=>createHash('sha256').update(data).digest('hex');
async function regular(name){
  let current=input;
  for(const part of name.split('/')){if(!part||part==='.'||part==='..')throw Error('Unsafe upstream path');current=path.join(current,part);const s=await lstat(current);if(s.isSymbolicLink())throw Error('Linked upstream input');}
  const s=await lstat(current);if(!s.isFile()||s.nlink!==1)throw Error('Expected a regular unlinked upstream input');return current;
}
const inputs=new Map();
for(const file of lock.files){
  const bytes=await readFile(await regular(file.path));
  if(bytes.length!==file.size||sha(bytes)!==file.sha256||createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex')!==file.gitBlob)throw Error(`Pinned upstream integrity mismatch: ${file.path}`);
  inputs.set(file.path,bytes);
}
const base='sample/Mini Arena/',models=base+'Models/GLB format/';
const declarations=[{source:base+'License.txt',path:'License.txt',mime:'text/plain'},
  {source:models+'Textures/colormap.png',path:'Textures/colormap.png',mime:'image/png'}];
const library={id:lock.id,title:lock.title,version:`${lock.version}+${lock.commit}`,author:lock.author,source:lock.source,spdx:lock.spdx,licenseFiles:['License.txt']};
const entries=[];
for(const file of lock.files.filter(file=>file.path.endsWith('.glb'))){
  const bytes=inputs.get(file.path);
  if(bytes.readUInt32LE(0)!==0x46546c67||bytes.readUInt32LE(4)!==2||bytes.readUInt32LE(8)!==bytes.length||bytes.readUInt32LE(16)!==0x4e4f534a)throw Error('Expected original GLB 2 JSON chunk');
  const gltf=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString('utf8'));
  if((gltf.buffers??[]).some(buffer=>buffer.uri)||(gltf.images??[]).some(image=>image.uri&&image.uri!=='Textures/colormap.png')||gltf.extensionsRequired?.length)throw Error('Unqualified dependency or required glTF extension');
  const id=path.basename(file.path,'.glb'),animations=(gltf.animations??[]).map((clip,index)=>clip.name??`animation-${index}`);
  const files=[{source:file.path,path:path.basename(file.path),mime:'model/gltf-binary'},...declarations].map(item=>{
    const data=inputs.get(item.source);return {path:item.path,mime:item.mime,sha256:sha(data),size:data.length};
  });
  entries.push({id,title:id.split('-').map(word=>word[0].toUpperCase()+word.slice(1)).join(' '),kind:'model',tags:['3d','mini-arena',...id.split('-'),...(animations.length?['animated']:[])],animations,files});
}
const destination=path.join(root,'libraries',lock.id);await mkdir(path.join(destination,'blobs'),{recursive:true});
for(const [name,data] of inputs){await copyFile(await regular(name),path.join(destination,'blobs',sha(data)));}
const manifest=Buffer.from(JSON.stringify({schemaVersion:1,library,entries},null,2)+'\n');
await writeFile(path.join(destination,'manifest.json'),manifest);
await writeFile(path.join(root,'libraries/index.json'),JSON.stringify({schemaVersion:1,libraries:[{id:library.id,manifestSha256:sha(manifest)}]},null,2)+'\n');
await mkdir(path.join(root,'licenses'),{recursive:true});
await writeFile(path.join(root,'licenses',`${library.id}-License.txt`),inputs.get(base+'License.txt'));
console.log(JSON.stringify({library:library.id,entries:entries.length,files:inputs.size,bytes:[...inputs.values()].reduce((sum,value)=>sum+value.length,0),manifestSha256:sha(manifest)}));
