import {DEFAULT_INFERENCE_TOKEN_RESERVATION} from '../../contracts/src/inference-budget';

/** Only the pinned model callback's input-bearing fields. Do not serialize the
 * model, endpoint, headers, credential, run config or arbitrary invocation data.
 * Bytes are a conservative local proxy, not an exact provider token count. */
export function modelRequestReservation(messages:unknown,extra?:Record<string,unknown>):number|undefined{
  const params=extra?.invocation_params;
  if(!params||typeof params!=='object'||typeof (params as {model?:unknown}).model!=='string')return undefined;
  const p=params as Record<string,unknown>;
  try{
    const text=JSON.stringify({messages,tools:p.tools,functions:p.functions,response_format:p.response_format,tool_choice:p.tool_choice,function_call:p.function_call});
    const bytes=Buffer.byteLength(text,'utf8');
    if(bytes>64*1024*1024)throw Error();
    const limits=[p.max_completion_tokens,p.max_tokens,p.max_output_tokens].filter((v):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>0);
    const headroom=Math.max(DEFAULT_INFERENCE_TOKEN_RESERVATION,...limits),reservation=bytes+headroom;
    if(!Number.isSafeInteger(reservation))throw Error();
    return reservation;
  }catch{throw new Error('Cannot reserve this model input safely; no provider request was admitted.');}
}
