import { z } from "zod";
import { identifier } from "./schema";
import { gameFilePath } from "./games";

const scalar=z.number().finite().min(-10000).max(10000);
const vector=z.tuple([scalar,scalar,scalar]);
const positive=z.number().finite().min(0.001).max(1000);
const scale=z.tuple([positive,positive,positive]);
const rgba=z.string().regex(/^#[a-fA-F0-9]{8}$/);
const source=z.object({assetId:identifier,path:gameFilePath}).strict();
const geometry=z.discriminatedUnion("kind",[
  z.object({kind:z.literal("box"),size:scale}).strict(),
  z.object({kind:z.literal("sphere"),radius:positive,segments:z.number().int().min(8).max(64).default(24),rings:z.number().int().min(4).max(32).default(12)}).strict(),
  z.object({kind:z.literal("cylinder"),radius:positive,depth:positive,segments:z.number().int().min(3).max(64).default(24)}).strict(),
  z.object({kind:z.literal("cone"),radius:positive,tipRadius:z.number().min(0).max(1000).default(0),depth:positive,segments:z.number().int().min(3).max(64).default(24)}).strict(),
  z.object({kind:z.literal("torus"),radius:positive,tubeRadius:positive}).strict(),
  z.object({kind:z.literal("plane"),size:z.tuple([positive,positive])}).strict(),
  z.object({kind:z.literal("mesh"),vertices:z.array(vector).min(3).max(50000),triangles:z.array(z.tuple([z.number().int().nonnegative().max(49999),z.number().int().nonnegative().max(49999),z.number().int().nonnegative().max(49999)])).min(1).max(100000)}).strict(),
  z.object({kind:z.literal("glb"),source:source.extend({path:gameFilePath.refine((s)=>s.endsWith(".glb"))})}).strict(),
]);
const key=z.object({frame:z.number().int().min(0).max(600),value:vector}).strict();
const target=z.discriminatedUnion("kind",[z.object({kind:z.literal("object"),id:identifier}).strict(),z.object({kind:z.literal("bone"),id:identifier}).strict()]);
const skin=z.object({weights:z.array(z.array(z.object({bone:identifier,weight:z.number().finite().gt(0).max(1)}).strict()).min(1).max(4)).min(3).max(50000)}).strict();
export const gameModelOperation=z.object({
  type:z.literal("model.scene"),outputBase:gameFilePath.refine((s)=>s.startsWith("assets/")&&s.split("/").at(-1)!.length<=200),
  materials:z.array(z.object({id:identifier,color:rgba,metallic:z.number().min(0).max(1).default(0),roughness:z.number().min(0).max(1).default(0.5),
    emission:rgba.default("#000000ff"),texture:source.extend({path:gameFilePath.refine((s)=>s.endsWith(".png"))}).optional()}).strict()).max(32).default([]),
  objects:z.array(z.object({id:identifier,geometry,parent:identifier.optional(),material:identifier.optional(),position:vector.default([0,0,0]),rotation:vector.default([0,0,0]),scale:scale.default([1,1,1]),
    smooth:z.boolean().default(false),bevel:z.number().min(0).max(0.5).default(0),subdivision:z.number().int().min(0).max(2).default(0),bindBone:identifier.optional(),skin:skin.optional()}).strict()).min(1).max(128),
  rig:z.object({id:identifier,bones:z.array(z.object({id:identifier,parent:identifier.optional(),head:vector,tail:vector}).strict()).min(1).max(128)}).strict().optional(),
  fps:z.union([z.literal(24),z.literal(30),z.literal(60)]).default(30),
  clips:z.array(z.object({id:identifier,frames:z.number().int().min(1).max(600),tracks:z.array(z.object({target,channel:z.enum(["position","rotation","scale"]),keys:z.array(key).min(1).max(256)}).strict()).min(1).max(128)}).strict()).max(16).default([]),
  preview:z.object({position:vector,target:vector,orthographicScale:z.number().min(0.1).max(1000).default(6),transparent:z.boolean().default(false),background:rgba.default("#182238ff"),
    samples:z.union([z.literal(8),z.literal(16),z.literal(32)]).default(16),
    lights:z.array(z.object({position:vector,target:vector,power:z.number().min(0).max(5000),size:z.number().min(0.1).max(30).default(5)}).strict()).min(1).max(4),
  }).strict(),
}).strict().superRefine((scene,ctx)=>{
  const invalid=(message:string)=>ctx.addIssue({code:"custom",message});
  const objects=new Map(scene.objects.map((o)=>[o.id,o])),materials=new Set(scene.materials.map((m)=>m.id)),bones=new Map(scene.rig?.bones.map((b)=>[b.id,b])??[]);
  if(objects.size!==scene.objects.length||materials.size!==scene.materials.length||bones.size!==(scene.rig?.bones.length??0)||new Set(scene.clips.map((c)=>c.id)).size!==scene.clips.length)invalid("Model, material, bone and clip identities must be unique.");
  function hierarchy(nodes:Map<string,{parent?:string}>) {for(const [id,node]of nodes){const seen=new Set([id]);let parent=node.parent;while(parent){if(seen.has(parent)||!nodes.has(parent)){invalid("Model hierarchy contains a cycle or missing parent.");break;}seen.add(parent);parent=nodes.get(parent)!.parent;}}}
  hierarchy(objects);hierarchy(bones);
  let estimatedTriangles=0,skinnedVertices=0,influences=0;
  for(const object of scene.objects){
    const geometry=object.geometry;
    if(object.material&&!materials.has(object.material))invalid("Model material reference is missing.");
    if(object.bindBone&&(!bones.has(object.bindBone)||object.parent||object.geometry.kind==="glb"))invalid("Rigid bone binding requires an existing bone and a generated unparented mesh.");
    if(object.skin){
      if(!scene.rig||object.bindBone||object.parent||geometry.kind!=="mesh"||object.bevel||object.subdivision)invalid("Weighted skinning requires a rig and an explicit unparented triangle mesh without rigid binding or topology modifiers.");
      if(geometry.kind==="mesh"&&object.skin.weights.length!==geometry.vertices.length)invalid("Skin weights must identify every source vertex in original order.");
      skinnedVertices+=object.skin.weights.length;
      for(const weights of object.skin.weights){
        influences+=weights.length;
        if(new Set(weights.map(w=>w.bone)).size!==weights.length||weights.some(w=>!bones.has(w.bone))||Math.abs(weights.reduce((sum,w)=>sum+w.weight,0)-1)>1e-6)invalid("Skin influences must reference distinct existing bones and sum to one per vertex.");
      }
    }
    if(geometry.kind==="mesh"&&geometry.triangles.some((face)=>face.some((i)=>i>=geometry.vertices.length)))invalid("Mesh triangle refers to an absent vertex.");
    if(object.geometry.kind==="glb"&&(object.bevel||object.subdivision))invalid("Import GLB before editing topology explicitly; do not apply mesh modifiers to an imported hierarchy.");
    const base=geometry.kind==="mesh"?geometry.triangles.length:geometry.kind==="sphere"?2*geometry.segments*(geometry.rings-1):geometry.kind==="cylinder"||geometry.kind==="cone"?4*geometry.segments:geometry.kind==="torus"?1152:geometry.kind==="box"?12:geometry.kind==="plane"?2:0;
    estimatedTriangles+=base*4**object.subdivision*(object.bevel?8:1);
  }
  if(estimatedTriangles>300000)invalid("Generated mesh complexity exceeds the 300000-triangle working budget.");
  if(skinnedVertices>50000||influences>200000)invalid("Weighted skinning exceeds the aggregate 50000-vertex/200000-influence working budget.");
  if(scene.rig&&objects.has(scene.rig.id))invalid("Rig identity must differ from scene objects.");
  if([...bones.values()].some((b)=>b.head.every((v,i)=>v===b.tail[i])))invalid("Bones need a nonzero rest length.");
  let totalKeys=0;
  for(const clip of scene.clips){const tracks=new Set<string>();for(const track of clip.tracks){
    const id=`${track.target.kind}:${track.target.id}:${track.channel}`;
    if(tracks.has(id)||!(track.target.kind==="object"?objects:bones).has(track.target.id))invalid("Animation tracks must be unique and target an existing object/bone.");tracks.add(id);
    totalKeys+=track.keys.length;
    if(new Set(track.keys.map((k)=>k.frame)).size!==track.keys.length||track.keys.some((k)=>k.frame>clip.frames||track.channel==="scale"&&k.value.some((v)=>v<=0)))invalid("Animation keys must have unique frames inside the clip and positive scale.");
  }}
  if(totalKeys>8192)invalid("Animation processing exceeds 8192 keys; preserve and split the original clips.");
  if(scene.preview.position.every((v,i)=>v===scene.preview.target[i])||scene.preview.lights.some((l)=>l.position.every((v,i)=>v===l.target[i])))invalid("Camera/light positions must differ from their target.");
  if([".glb",".blend",".preview.png",".model.json"].some((s)=>!gameFilePath.safeParse(scene.outputBase+s).success))invalid("Generated model paths must fit portable file limits.");
});
export type GameModelOperation=z.infer<typeof gameModelOperation>;
export function modelSources(scene:GameModelOperation){return [...scene.objects.flatMap((o)=>o.geometry.kind==="glb"?[o.geometry.source]:[]),...scene.materials.flatMap((m)=>m.texture?[m.texture]:[])];}
