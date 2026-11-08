import type { ToolSpec } from "./index";
export const WORKSPACE_BACKEND_METHODS = ["ls","read","readRaw","write","edit","delete","glob","grep"] as const;
export const WORKSPACE_BACKEND_TOOLS: ToolSpec[] = WORKSPACE_BACKEND_METHODS.map((method) => ({
  name:`vscode_backend_${method}`,description:`Editor workspace backend: ${method}. Applies the installed workspace and approval policy.`,
  schema:{type:"object",properties:{args:{type:"array",maxItems:5}},required:["args"],additionalProperties:false},
  effect:["write","edit","delete"].includes(method)?"write":"read",evidenceKind:["write","edit","delete"].includes(method)?"diff":"note",host:"vscode-backend",
}));
export function encodeHostValue(value:unknown):unknown {
  if(value instanceof Uint8Array)return {__companion_bytes:Buffer.from(value).toString("base64")};
  if(Array.isArray(value))return value.map(encodeHostValue);
  if(value&&typeof value==="object")return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,encodeHostValue(item)]));
  return value;
}
export function decodeHostValue(value:unknown):unknown {
  if(value&&typeof value==="object"&&!Array.isArray(value)&&Object.keys(value).length===1&&typeof (value as {__companion_bytes?:unknown}).__companion_bytes==="string")return new Uint8Array(Buffer.from((value as {__companion_bytes:string}).__companion_bytes,"base64"));
  if(Array.isArray(value))return value.map(decodeHostValue);
  if(value&&typeof value==="object")return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,decodeHostValue(item)]));
  return value;
}

export function serviceProcessTool(tool:ToolSpec):ToolSpec{return ["run_command","start_local_process","inspect_local_process","wait_for_local_process","stop_local_process","restart_local_process"].includes(tool.name)?{...tool,host:"service-process",effect:["inspect_local_process","wait_for_local_process"].includes(tool.name)?"read":"external"}:tool;}
