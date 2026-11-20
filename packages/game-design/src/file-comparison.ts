import {diffArrays} from 'diff';
import type {GameFile,GameRevision} from '../../contracts/src/games';
import type {GameFileCompare,GameFileComparison,GameFileDiffRow} from '../../contracts/src/game-file-comparison';
import {contentHash} from '../../contracts/src/identity';

export const GAME_FILE_DIFF_MAX_BYTES=512*1024;
const MAX_LINES=16000,MAX_LINE_BYTES=16384,MAX_EDITS=512,PAGE_BYTES=128*1024;
type Reason=NonNullable<GameFileComparison['reason']>;
type Decoded={lines:string[];bom:boolean};
export class FileComparisonError extends Error{
 constructor(readonly kind:'missing'|'conflict',message:string){super(message);}
}
/** Preserve all newline forms and EOF exactly. This is display data, not code
 * execution, a patch to apply, a parser or a model/tool loop. */
function decode(bytes:Uint8Array):Decoded|Reason{
 let text:string;try{text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);}catch{return 'binary-or-encoding';}
 if(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text))return 'binary-or-encoding';
 const lines:string[]=[];let start=0;
 for(let i=0;i<text.length;i++)if(text[i]==='\r'||text[i]==='\n'){
  if(text[i]==='\r'&&text[i+1]==='\n')i++;lines.push(text.slice(start,i+1));start=i+1;
  if(lines.length>MAX_LINES)return 'line-count';
 }
 if(start<text.length)lines.push(text.slice(start));
 if(lines.length>MAX_LINES)return 'line-count';
 if(lines.some(line=>Buffer.byteLength(line)>MAX_LINE_BYTES))return 'line-size';
 return {lines,bom:text.startsWith('\ufeff')};
}
const metadata=(value:GameFile|undefined)=>value?{path:value.path,sha256:value.sha256,size:value.size,mime:value.mime}:null;
function line(value:string){
 const ending=value.endsWith('\r\n')?'crlf':value.endsWith('\n')?'lf':value.endsWith('\r')?'cr':'none';
 return {text:ending==='none'?value:value.slice(0,ending==='crlf'?-2:-1),ending} as const;
}

/** The service supplies two authenticated immutable revisions and verified
 * small blobs. Limits refuse a projection, never truncate or change originals. */
export function compareGameFile(base:GameRevision,target:GameRevision,request:GameFileCompare,read:(file:GameFile)=>Uint8Array):GameFileComparison{
 if(base.projectId!==request.projectId||target.projectId!==request.projectId||base.revision!==request.baseRevision||target.revision!==request.targetRevision)throw Error('Comparison revisions do not match their requested identities.');
 const a=base.document.files.find(file=>file.path===request.path),b=target.document.files.find(file=>file.path===request.path);
 if(!a&&!b)throw new FileComparisonError('missing','File not found in either selected revision.');
 let reason:Reason|null=null,left:Decoded|null=null,right:Decoded|null=null;
 if([a,b].some(file=>file&&file.size>GAME_FILE_DIFF_MAX_BYTES))reason='file-size';
 else{
  const values=[a,b].map(file=>file?decode(read(file)):{lines:[],bom:false});
  reason=values.find((value):value is Reason=>typeof value==='string')??null;
  if(typeof values[0]!=='string')left=values[0]!;if(typeof values[1]!=='string')right=values[1]!;
  if(!reason&&left&&right&&left.lines.length+right.lines.length>MAX_LINES)reason='line-count';
 }
 const rows:GameFileDiffRow[]=[],counts={added:0,removed:0,unchanged:0};
 if(!reason&&left&&right){
  // Deterministic edit bound, not a timeout-dependent page cache. The pinned
  // library owns Myers' diff; no alternate algorithm or whitespace rewriting.
  const chunks=diffArrays(left.lines,right.lines,{maxEditLength:MAX_EDITS});
  if(!chunks)reason='edit-limit';
  else{
   const all:Exclude<GameFileDiffRow,{kind:'omitted'}>[]=[],visible:boolean[]=[];let baseLine=1,targetLine=1;
   for(const chunk of chunks)for(const text of chunk.value){
    const kind=chunk.added?'added':chunk.removed?'removed':'context';counts[kind==='context'?'unchanged':kind]++;
    all.push({kind,baseLine:chunk.added?null:baseLine++,targetLine:chunk.removed?null:targetLine++,...line(text)});
   }
   for(let i=0;i<all.length;i++)if(all[i]!.kind!=='context')for(let j=Math.max(0,i-request.context);j<=Math.min(all.length-1,i+request.context);j++)visible[j]=true;
   for(let i=0;i<all.length;){
    if(visible[i])rows.push(all[i++]!);
    else{const start=i;while(i<all.length&&!visible[i])i++;rows.push({kind:'omitted',baseLine:all[start]!.baseLine!,targetLine:all[start]!.targetLine!,count:i-start});}
   }
  }
 }
 const side=(revision:GameRevision,file:GameFile|undefined,value:Decoded|null)=>({revision:revision.revision,contentHash:revision.contentHash,file:metadata(file),lines:value?.lines.length??null,utf8Bom:file&&value?value.bom:null});
 const identity={projectId:request.projectId,path:request.path,base:side(base,a,left),target:side(target,b,right),context:request.context,
  state:reason?'unavailable' as const:'text' as const,reason,counts:reason?null:counts,totalRows:rows.length};
 const bindingHash=contentHash({algorithm:'jsdiff-9-lines-eol-exact-v1',...identity});
 if(request.bindingHash&&request.bindingHash!==bindingHash)throw new FileComparisonError('conflict','File comparison binding changed; preserve the displayed comparison and request it again.');
 if(request.cursor>rows.length)throw new FileComparisonError('conflict','File comparison cursor is outside the selected comparison.');
 const page:GameFileDiffRow[]=[];let bytes=0;
 for(let i=request.cursor;i<rows.length&&page.length<request.limit;i++){const row=rows[i]!,size=Buffer.byteLength(JSON.stringify(row));if(page.length&&bytes+size>PAGE_BYTES)break;page.push(row);bytes+=size;}
 const cursor=request.cursor+page.length;
 return {...identity,bindingHash,rows:page,cursor,hasMore:cursor<rows.length};
}
