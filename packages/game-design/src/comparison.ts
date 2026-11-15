import type {GameRevision,GameFile} from "../../contracts/src/games";
import type {GameComparisonChange,GameComparisonValue,GameRevisionCompare,GameRevisionComparison} from "../../contracts/src/game-comparison";
import {canonical,contentHash} from "../../contracts/src/identity";

const kind=(value:unknown)=>value===undefined?"absent":value===null?"null":Array.isArray(value)?"array":typeof value;
function state(value:unknown):GameComparisonValue{
  const type=kind(value);
  if(type==="absent"||type==="null")return {kind:type};
  if(type==="string")return {kind:"string",value:value as string};
  if(type==="number")return {kind:"number",value:value as number};
  if(type==="boolean")return {kind:"boolean",value:value as boolean};
  return {kind:type as "array"|"object",count:type==="array"?(value as unknown[]).length:Object.keys(value as object).length};
}
type Section=GameComparisonChange["section"];
function change(section:Section,path:string[],before:unknown,after:unknown):GameComparisonChange{
  return {section,path,change:before===undefined?"added":after===undefined?"removed":"modified",before:state(before),after:state(after)};
}
const keys=(a:object,b:object)=>[...new Set([...Object.keys(a),...Object.keys(b)])].sort();
const identified=(a:unknown[])=>a.every(value=>value!==null&&typeof value==="object"&&!Array.isArray(value)&&typeof (value as {id?:unknown}).id==="string")&&new Set(a.map(value=>(value as {id:string}).id)).size===a.length;

/** Deterministic structural changes, not a semantic/quality judgment. Scalar
 * values stay complete. Arrays with IDs match by identity and expose moves;
 * other arrays preserve their ordered indices. Containers are never flattened
 * into a giant unpaged JSON response. */
function* fields(section:Section,before:unknown,after:unknown,path:string[]=[]):Generator<GameComparisonChange>{
  if(Object.is(before,after))return;
  const left=kind(before),right=kind(after);
  const leftContainer=left==="object"||left==="array",rightContainer=right==="object"||right==="array";
  if(!leftContainer&&!rightContainer){yield change(section,path,before,after);return;}
  if(left!==right)yield change(section,path,before,after);
  if(left==="array"||right==="array"){
    const a=left==="array"?before as unknown[]:[],b=right==="array"?after as unknown[]:[];
    if(identified(a)&&identified(b)){
      const old=new Map(a.map((value,index)=>[(value as {id:string}).id,{value,index}])),next=new Map(b.map((value,index)=>[(value as {id:string}).id,{value,index}]));
      for(const id of [...new Set([...old.keys(),...next.keys()])].sort()){
        const l=old.get(id),r=next.get(id),key=[...path,`id:${id}`];
        if(l&&r&&l.index!==r.index)yield {...change(section,[...key,"@order"],l.index,r.index),change:"moved"};
        yield*fields(section,l?.value,r?.value,key);
      }
    }else for(let i=0;i<Math.max(a.length,b.length);i++)yield*fields(section,a[i],b[i],[...path,String(i)]);
  }
  if(left==="object"||right==="object"){
    const a=left==="object"?before as Record<string,unknown>:{},b=right==="object"?after as Record<string,unknown>:{};
    for(const key of keys(a,b))yield*fields(section,a[key],b[key],[...path,key]);
  }
}
const fileState=(file:GameFile|undefined):GameComparisonValue=>file?{kind:"file",path:file.path,sha256:file.sha256,size:file.size,mime:file.mime}:{kind:"absent"};
function* files(before:GameFile[],after:GameFile[]):Generator<GameComparisonChange>{
  const old=new Map(before.map((value,index)=>[value.path,{value,index}])),next=new Map(after.map((value,index)=>[value.path,{value,index}]));
  for(const name of [...new Set([...old.keys(),...next.keys()])].sort()){
    const l=old.get(name),r=next.get(name),a=fileState(l?.value),b=fileState(r?.value);
    if(contentHash(a)!==contentHash(b))yield {section:"files",path:[name],change:!l?"added":!r?"removed":"modified",before:a,after:b};
    if(l&&r&&l.index!==r.index)yield {...change("files",[name,"@order"],l.index,r.index),change:"moved"};
  }
}
function* changes(base:GameRevision,target:GameRevision):Generator<GameComparisonChange>{
  const {design:a,files:af,assets:aa,legacy:al,...overviewA}=base.document,{design:b,files:bf,assets:ba,legacy:bl,...overviewB}=target.document;
  yield*fields("overview",overviewA,overviewB);
  yield*fields("design",a,b);
  yield*files(af,bf);
  yield*fields("assets",aa,ba);
  if(contentHash(al??null)!==contentHash(bl??null)){
    const opaque=(value:unknown):GameComparisonValue=>value===undefined?{kind:"absent"}:{kind:"opaque",sha256:contentHash(value),bytes:Buffer.byteLength(canonical(value))};
    yield {section:"legacy",path:[],change:al===undefined?"added":bl===undefined?"removed":"modified",before:opaque(al),after:opaque(bl)};
  }
}

/** The service supplies two authenticated immutable revisions. This pure
 * projection cannot read blobs, execute code, restore, approve or mutate them. */
export function compareGameRevisions(base:GameRevision,target:GameRevision,request:GameRevisionCompare):GameRevisionComparison{
  if(base.projectId!==request.projectId||target.projectId!==request.projectId||base.revision!==request.baseRevision||target.revision!==request.targetRevision)throw Error("Comparison revisions do not match their requested identities.");
  const counts={overview:0,design:0,files:0,assets:0,legacy:0,total:0},page:GameComparisonChange[]=[];let matching=0;
  for(const entry of changes(base,target)){
    counts[entry.section]++;counts.total++;
    if(request.section!=="all"&&request.section!==entry.section)continue;
    if(matching>=request.cursor&&page.length<request.limit)page.push(entry);matching++;
  }
  const cursor=Math.min(request.cursor+page.length,Math.max(request.cursor,matching));
  const metadata=(value:GameRevision)=>({revision:value.revision,contentHash:value.contentHash,createdAt:value.createdAt});
  return {projectId:request.projectId,base:metadata(base),target:metadata(target),sourceEqual:base.contentHash===target.contentHash,counts,section:request.section,
    changes:page,cursor,hasMore:cursor<matching};
}
