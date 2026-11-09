import {AsyncLocalStorage} from "node:async_hooks";
import {CompositeBackend,StateBackend,type BackendProtocolV2,type ReadResult,type ReadRawResult,type LsResult,type GlobResult,type GrepResult,type WriteResult,type EditResult,type DeleteResult} from "deepagents";
import {createMiddleware} from "langchain";
import {interrupt} from "@langchain/langgraph";
import {AgentError,errors,type RunSpec} from "../../contracts/src/index";
import {decodeHostValue,WORKSPACE_BACKEND_TOOLS} from "../../contracts/src/workspace-backend";
import type {ExecutionContext} from "./index";
import {graphOperationId} from "./operations";
import {contentHash} from "../../contracts/src/identity";

export function workspaceBackend(spec:RunSpec,context:ExecutionContext){
 if(!spec.workspace||spec.runtime!=="deep")return undefined;
 const scope=new AsyncLocalStorage<{id:string;state:unknown}>();
 const middleware=createMiddleware({name:"WorkspaceHostBridge",wrapToolCall:async(request,handler)=>{
  const messageId=[...request.state.messages].reverse().find(message=>"tool_calls" in message&&Array.isArray(message.tool_calls)&&message.tool_calls.length)?.id;
  const id=graphOperationId(request.runtime.configurable,messageId,request.toolCall.id);
  try{return await scope.run({id,state:request.state},()=>handler(request));}
  catch(error){if(error instanceof AgentError&&error.code===errors.reconciliation)interrupt({kind:"tool_reconciliation",callId:id});throw error;}
 }});
 class Backend implements BackendProtocolV2 {
  private async call<T>(method:string,args:unknown[]):Promise<T>{
   const current=scope.getStore();if(!current)throw new AgentError(errors.invalid,"Workspace operations require a persisted graph tool identity.");
   const expected=WORKSPACE_BACKEND_TOOLS.find(tool=>tool.name===`vscode_backend_${method}`)!;
   const definition=spec.tools.find(tool=>tool.name===expected.name);
   if(!definition||definition.host!=="vscode-backend"||definition.effect!==expected.effect)throw new AgentError(errors.forbidden,"The editor backend is not registered.");
   const envelope=await context.invokeTool(definition,{args:args.map(value=>value===undefined?null:value)},contentHash({id:current.id,method}),current.state) as {kind?:string;result:unknown};
   if(envelope?.kind!=="workspace-tool-result")throw new AgentError(errors.reconciliation,"Editor operation returned no valid receipt.");
   return decodeHostValue(envelope.result) as T;
  }
  ls(filePath:string){return this.call<LsResult>("ls",[filePath]);}
  read(filePath:string,offset?:number,limit?:number){return this.call<ReadResult>("read",[filePath,offset,limit]);}
  readRaw(filePath:string){return this.call<ReadRawResult>("readRaw",[filePath]);}
  write(filePath:string,content:string){return this.call<WriteResult>("write",[filePath,content]);}
  edit(filePath:string,oldString:string,newString:string,replaceAll?:boolean){return this.call<EditResult>("edit",[filePath,oldString,newString,replaceAll]);}
  delete(filePath:string){return this.call<DeleteResult>("delete",[filePath]);}
  glob(pattern:string,filePath?:string){return this.call<GlobResult>("glob",[pattern,filePath]);}
  grep(pattern:string,filePath?:string|null,glob?:string|null,maxCount?:number|null){return this.call<GrepResult>("grep",[pattern,filePath,glob,maxCount]);}
 }
 return {backend:new CompositeBackend(new StateBackend(),{"/workspace/":new Backend()}),middleware};
}
