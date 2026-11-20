export class GameTextPageError extends Error {}

/** Byte cursors preserve BOM/CRLF and whole Unicode scalars. Never execute text. */
export function readUtf8TextPage(data:Uint8Array,cursor:number,limit:number,maxBytes:number){
  if(!Number.isSafeInteger(cursor)||cursor<0||cursor>data.length||!Number.isSafeInteger(limit)||limit<256||limit>16384)
    throw new GameTextPageError('Invalid text byte cursor or limit.');
  if(data.length>maxBytes)throw new GameTextPageError('This text exceeds the text view limit; its complete bytes remain available through the SDK.');
  const decoder=()=>new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
  try{decoder().decode(data);}catch{throw new GameTextPageError('The text is not valid UTF-8. Download its original bytes through the SDK.');}
  if(cursor<data.length&&(data[cursor]!&0xc0)===0x80)throw new GameTextPageError('The text cursor splits a UTF-8 character. Use the previous response cursor.');
  let end=Math.min(data.length,cursor+limit);
  while(end<data.length&&(data[end]!&0xc0)===0x80)end--;
  return {content:decoder().decode(data.subarray(cursor,end)),offset:cursor,cursor:end,hasMore:end<data.length,totalBytes:data.length,encoding:'utf-8' as const};
}
