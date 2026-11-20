import { inspectGlbSkins } from "./glb-skin";
/** Independent bounded GLB validation. No engine/plugin execution or external
 * URI resolution; original source bytes remain in the project on rejection. */
export function inspectGameGlb(bytes:Uint8Array){
  const buffer=Buffer.from(bytes);
  function invalid(message:string):never{throw new Error(`Invalid/self-contained GLB: ${message}`);}
  if(buffer.length<28||buffer.length>64*1024*1024||buffer.readUInt32LE(0)!==0x46546c67||buffer.readUInt32LE(4)!==2||buffer.readUInt32LE(8)!==buffer.length)invalid("header, version or size");
  let offset=12,json:unknown,bin:Buffer|undefined;
  while(offset<buffer.length){
    if(offset+8>buffer.length)invalid("truncated chunk");const size=buffer.readUInt32LE(offset),type=buffer.readUInt32LE(offset+4);offset+=8;
    if(size%4||offset+size>buffer.length)invalid("chunk alignment/length");
    const data=buffer.subarray(offset,offset+size);offset+=size;
    if(type===0x4e4f534a&&json===undefined&&!bin){if(size>8*1024*1024)invalid("JSON exceeds 8 MiB");json=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(data));}
    else if(type===0x004e4942&&json!==undefined&&!bin)bin=data;
    else invalid("unexpected/duplicate chunk");
  }
  if(!json||typeof json!=="object"||Array.isArray(json)||!bin)invalid("missing JSON/BIN");
  const doc=json as Record<string,any>;
  const integer=(n:unknown,max:number)=>typeof n==="number"&&Number.isSafeInteger(n)&&n>=0&&n<=max;
  const list=(name:string,max:number):any[]=>{const value=doc[name]??[];if(!Array.isArray(value)||value.length>max)invalid(`${name} collection exceeds limits`);return value;};
  if(doc.asset?.version!=="2.0")invalid("asset version");
  const buffers=list("buffers",1);if(buffers.length!==1||buffers[0].uri!==undefined||!integer(buffers[0].byteLength,bin!.length)||bin!.length-buffers[0].byteLength>3)invalid("external/inconsistent buffer");
  const views=list("bufferViews",4096),accessors=list("accessors",4096),nodes=list("nodes",1024),meshes=list("meshes",512),images=list("images",128),animations=list("animations",64),skins=list("skins",64);
  function view(index:unknown){if(!integer(index,views.length-1))invalid("bufferView reference");return views[index as number];}
  for(const v of views)if(!v||v.buffer!==0||!integer(v.byteOffset??0,bin!.length)||!integer(v.byteLength,bin!.length)||(v.byteOffset??0)+v.byteLength>buffers[0].byteLength||
    v.byteStride!==undefined&&(!integer(v.byteStride,252)||v.byteStride<4||v.byteStride%4))invalid("bufferView range/stride");
  const components:Record<number,number>={5120:1,5121:1,5122:2,5123:2,5125:4,5126:4},dimensions:Record<string,number>={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT2:4,MAT3:9,MAT4:16};
  let inspectedComponents=0;
  function region(index:unknown,start:unknown,count:number,type:number,dimension:number){
    const v=view(index),size=components[type]??invalid("component type"),stride=v.byteStride??size*dimension,begin=start===undefined?0:typeof start==="number"?start:invalid("accessor offset");
    if(!integer(begin,v.byteLength)||begin%size||stride<size*dimension||count&&begin+(count-1)*stride+size*dimension>v.byteLength)invalid("accessor range/type");
    inspectedComponents+=count*dimension;if(inspectedComponents>24_000_000)invalid("accessor inspection working budget exceeded");
    if(type===5126)for(let i=0;i<count;i++)for(let j=0;j<dimension;j++)if(!Number.isFinite(bin!.readFloatLE((v.byteOffset??0)+(begin as number)+i*stride+j*size)))invalid("nonfinite float data");
  }
  for(const a of accessors){
    const dimension=dimensions[a?.type]??invalid("accessor dimension"),size=components[a?.componentType]??invalid("component type");
    if(!size||!integer(a.count,1_000_000))invalid("accessor dimensions/count");
    if(a.bufferView!==undefined)region(a.bufferView,a.byteOffset,a.count,a.componentType,dimension);
    else if(a.byteOffset)invalid("accessor without bufferView");
    if(a.sparse){const s=a.sparse;if(!integer(s.count,a.count)||![5121,5123,5125].includes(s.indices?.componentType))invalid("sparse accessor");
      region(s.indices.bufferView,s.indices.byteOffset,s.count,s.indices.componentType,1);region(s.values?.bufferView,s.values?.byteOffset,s.count,a.componentType,dimension);}
  }
  function accessor(index:unknown){if(!integer(index,accessors.length-1))invalid("accessor reference");return accessors[index as number];}
  function indices(a:any,maximum:number){
    if(a.type!=="SCALAR"||![5121,5123,5125].includes(a.componentType))invalid("index accessor type");
    const values=new Uint32Array(a.count),read=(v:any,start:number,type:number,i:number)=>{const bytes=components[type]!,offset=(v.byteOffset??0)+start+i*(v.byteStride??bytes);return type===5121?bin!.readUInt8(offset):type===5123?bin!.readUInt16LE(offset):bin!.readUInt32LE(offset);};
    if(a.bufferView!==undefined){const v=view(a.bufferView);for(let i=0;i<a.count;i++)values[i]=read(v,a.byteOffset??0,a.componentType,i);}
    if(a.sparse){const s=a.sparse,iv=view(s.indices.bufferView),vv=view(s.values.bufferView);let previous=-1;
      for(let i=0;i<s.count;i++){const index=read(iv,s.indices.byteOffset??0,s.indices.componentType,i);if(index<=previous||index>=a.count)invalid("sparse index order/range");previous=index;values[index]=read(vv,s.values.byteOffset??0,a.componentType,i);}}
    if(values.some((value)=>value>=maximum))invalid("triangle index outside vertex range");
  }
  for(const image of images)if(!image||image.uri!==undefined||!["image/png","image/jpeg"].includes(image.mimeType)||!view(image.bufferView))invalid("external/unsupported image");
  let triangles=0,vertices=0;
  for(const mesh of meshes){if(!Array.isArray(mesh?.primitives)||!mesh.primitives.length||mesh.primitives.length>128)invalid("mesh primitive count");for(const p of mesh.primitives){
    const position=accessor(p.attributes?.POSITION);if(position.type!=="VEC3")invalid("position accessor");vertices+=position.count;
    for(const index of Object.values(p.attributes??{}))if(accessor(index).count!==position.count)invalid("attribute vertex count mismatch");
    const count=p.indices!==undefined?accessor(p.indices).count:position.count,mode=p.mode??4;
    if(!integer(mode,6))invalid("primitive mode");if(mode===4){if(count%3)invalid("triangle element count");triangles+=count/3;}else if(mode===5||mode===6)triangles+=Math.max(0,count-2);
    if(triangles>300000||vertices>1_000_000)invalid("geometry working budget exceeded");
    if(p.indices!==undefined)indices(accessor(p.indices),position.count);
    if(p.material!==undefined&&!integer(p.material,list("materials",256).length-1))invalid("material reference");
  }}
  if(triangles>300000||vertices>1_000_000)invalid("geometry working budget exceeded");
  const parents=new Map<number,number>();
  for(const [index,node]of nodes.entries()){
    if(!node||node.mesh!==undefined&&!integer(node.mesh,meshes.length-1)||node.skin!==undefined&&!integer(node.skin,skins.length-1))invalid("node mesh/skin reference");
    for(const name of ["matrix","translation","rotation","scale"]){const n=node[name];if(n!==undefined&&(!Array.isArray(n)||n.length!==({matrix:16,translation:3,rotation:4,scale:3} as Record<string,number>)[name]||n.some((v:unknown)=>typeof v!=="number"||!Number.isFinite(v)||Math.abs(v)>1e8)))invalid("node transform");}
    if(node.children!==undefined){if(!Array.isArray(node.children)||node.children.length>1024)invalid("node children");for(const child of node.children){if(!integer(child,nodes.length-1)||parents.has(child))invalid("node parent reference");parents.set(child,index);}}
  }
  for(let i=0;i<nodes.length;i++){const seen=new Set<number>();let n:number|undefined=i;while(n!==undefined){if(seen.has(n))invalid("cyclic hierarchy");seen.add(n);n=parents.get(n);}}
  for(const skin of skins){if(!Array.isArray(skin?.joints)||skin.joints.length>128||skin.joints.some((i:unknown)=>!integer(i,nodes.length-1)))invalid("skin joints");if(skin.inverseBindMatrices!==undefined)accessor(skin.inverseBindMatrices);}
  let animationChannels=0;
  for(const animation of animations){if(!Array.isArray(animation?.channels)||animation.channels.length>1024||!Array.isArray(animation.samplers)||animation.samplers.length>1024)invalid("animation bounds");animationChannels+=animation.channels.length;
    for(const s of animation.samplers){accessor(s.input);accessor(s.output);}
    for(const c of animation.channels)if(!integer(c?.sampler,animation.samplers.length-1)||!integer(c.target?.node,nodes.length-1)||!["translation","rotation","scale","weights"].includes(c.target?.path))invalid("animation target");}
  const supported=["KHR_materials_unlit","KHR_texture_transform","KHR_mesh_quantization","KHR_materials_emissive_strength","KHR_materials_ior","KHR_materials_specular"];
  if(doc.extensionsRequired!==undefined&&(!Array.isArray(doc.extensionsRequired)||doc.extensionsRequired.some((s:unknown)=>!supported.includes(s as string))))invalid("required extension is not supported by this qualified processing path");
  return {document:doc,triangles,vertices,meshes:meshes.length,nodes:nodes.length,skins:skins.length,animations:animations.length,animationChannels,...inspectGlbSkins(doc,bin!)};
}
