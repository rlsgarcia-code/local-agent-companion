import * as path from "node:path";
import * as vscode from "vscode";
import { randomUUID } from "node:crypto";
import { AgentClient, type HostResponses } from "../packages/client-ts/src/index";
import { ensureEngine } from "../packages/client-ts/src/bootstrap";
import { COMPANION_RELEASE_PUBLIC_KEY } from "../packages/client-ts/src/release-key";
import { contentHash } from "../packages/contracts/src/identity";
import { encodeHostValue, WORKSPACE_BACKEND_TOOLS } from "../packages/contracts/src/workspace-backend";
import { type EngineEvent, type ProviderSpec, type Run, type RunSpec, type Session, type ToolSpec, terminalStates } from "../packages/contracts/src/index";
import { AVAILABLE_MODEL_PROVIDERS } from "./model-provider";
import { localApprovalPresentation, type LocalApprovalRequest } from "./approval-presentation";
import { withRemoteApproval } from "./local-approval";
import { redactSensitiveText } from "./redaction";
import type { WorkspaceToolState } from "../packages/agent-core/src/workspace-completion";

export type EditorTool = {name:string;description:string;schema:unknown;invoke(input:unknown):Promise<unknown>};
export type EditorRunResult = {text:string;message?:{id:string};completionOutcome?:string;evidence?:unknown;usage?:{input:number;output:number};goalEvaluation?:unknown;changes?:unknown};

export class EditorServiceRuntime {
 private readonly clients=new Map<string,Promise<AgentClient>>();
 private active?:{client:AgentClient;run:Run};
 private detached=false;
 private readonly observers=new Set<AbortController>();
 constructor(private readonly context:vscode.ExtensionContext,private readonly testOptions?:{stateDirectory:string;bundleDirectory:string}){if(testOptions&&context.extensionMode!==vscode.ExtensionMode.Development)throw Error("Isolated fixtures require development mode.");}
 get alive(){return !this.detached;}
 async connect(workspace:string,catalog:ToolSpec[]=[]):Promise<AgentClient>{
  const key=contentHash({workspace,catalog});let pending=this.clients.get(key);
  if(!pending){pending=ensureEngine({bundleDirectory:this.testOptions?.bundleDirectory??path.join(this.context.extensionPath,"dist","engine"),stateDirectory:this.testOptions?.stateDirectory,product:"companion-vscode",profile:"default",workspace,providers:[...AVAILABLE_MODEL_PROVIDERS],hostTools:catalog.map(tool=>tool.name),toolCatalog:catalog,
    development:this.context.extensionMode===vscode.ExtensionMode.Development,publicKey:this.context.extensionMode===vscode.ExtensionMode.Development?undefined:COMPANION_RELEASE_PUBLIC_KEY});
   this.clients.set(key,pending);pending.catch(()=>this.clients.delete(key));}
  const client=await pending;if(!client.connected){this.clients.delete(key);return this.connect(workspace,catalog);}return client;
 }
 async session(client:AgentClient,thread:{id:string;title:string;messages:unknown[]}):Promise<Session>{
  const key=`vscode:${thread.id}`;const existing=(await client.call<Session[]>("sessions.list")).find(session=>session.importedFrom===key);
  return existing??client.importSession(key,{thread});
 }
 async nativeApproval(payload:unknown):Promise<boolean>{
  const input=payload as Partial<LocalApprovalRequest>&{tool?:string;input?:unknown};
  const request:LocalApprovalRequest={prompt:input.prompt??`Allow ${input.tool??"this local operation"}?`,action:input.action??"Allow operation",target:input.target??input.tool??"Local workspace",explanation:input.explanation??JSON.stringify(input.input??{},null,2).slice(0,3000),risk:input.risk??"standard"};
  const presentation=localApprovalPresentation(request);
  const answer=await vscode.window.showWarningMessage(presentation.prompt,{modal:true,detail:presentation.modalDetail},presentation.action);
  if(!this.alive)return new Promise<boolean>(()=>{});
  return answer===presentation.action;
 }
 async run(options:{client:AgentClient;session:Session;key:string;spec:RunSpec;handlers:Map<string,(input:unknown)=>Promise<unknown>>;state:()=>WorkspaceToolState;sensitiveValues:readonly string[];
   onRun:(run:Run)=>Promise<void>;onEvent:(event:EngineEvent)=>void;onState:(state:Run["state"])=>void}):Promise<Run>{
  const {client}=options;
  const run=await client.call<Run|null>("runs.find",{sessionId:options.session.id,key:options.key})??await client.startRun(options.session.id,options.key,options.spec);
  this.active={client,run};await options.onRun(run);
  if(["awaiting_host","awaiting_credentials"].includes(run.state))await client.call("runs.resume",{id:run.id});
  let approvalDenied=false;const epoch=randomUUID();const hostResponses:HostResponses=new Map();const observer=new AbortController();let blocked=false;this.observers.add(observer);
  const safe=(value:unknown):unknown=>JSON.parse(JSON.stringify(encodeHostValue(value),(_key,item)=>typeof item==="string"?redactSensitiveText(item,options.sensitiveValues):item));
  try{return await client.waitForRun(run.id,run.sessionId,options.onEvent,async request=>{
   if(request.kind==="approval")return this.nativeApproval(request.payload);
   const payload=request.payload as {tool?:string;input?:unknown};const handler=options.handlers.get(payload.tool??"");
   if(!handler)throw Error("The original editor adapter is unavailable. Restore it before continuing.");
   const result=await withRemoteApproval(async original=>{
    const requestBody={prompt:original.prompt,action:original.action,target:original.target,explanation:original.explanation,risk:original.risk};
    const approval=await client.call<{id:string}>("host.approval.create",{parentId:request.id,request:safe(requestBody)});
    while(this.alive&&client.connected){const decision=await client.call<{state:string;value?:boolean}>("host.approval.get",{id:approval.id});if(decision.state==="answered"){if(decision.value!==true)approvalDenied=true;return decision.value===true;}await new Promise(resolve=>setTimeout(resolve,100));}
    return new Promise<boolean>(()=>{});
   },()=>handler(payload.input));
   return safe({kind:"workspace-tool-result",result,state:{...options.state(),epoch,...(approvalDenied?{approvalWasDenied:true}:{})}});
  },observer.signal,{hostResponses,onState:state=>{
   options.onState(state);
   if(["awaiting_reconciliation","awaiting_credentials"].includes(state)){blocked=true;observer.abort();}
  }});}catch(error){if(blocked)return client.call<Run>("runs.get",{id:run.id});throw error;}
  finally{this.observers.delete(observer);if(this.active?.run.id===run.id)this.active=undefined;}
 }
 async vision(client:AgentClient,runId:string,question:string,images:{bytes:Buffer;mimeType:string;label:string}[]):Promise<string>{
  const blocks:{type:string;text?:string;attachmentId?:string}[]=[{type:"text",text:question}];
  for(const image of images){const transfer=await client.upload(`vision:${contentHash(image.bytes.toString("base64"))}`,image.bytes,image.mimeType as "image/jpeg");blocks.push({type:"text",text:image.label},{type:"image",attachmentId:transfer.id});}
  return client.call<string>("models.invoke",{runId,role:"vision",messages:[{role:"user",content:blocks}]},600000);
 }
 cancel(){if(this.active)void this.active.client.call("runs.cancel",{id:this.active.run.id});}
 dispose(){this.detached=true;for(const observer of this.observers)observer.abort();for(const client of this.clients.values())void client.then(client=>client.close());this.clients.clear();}
}

export { WORKSPACE_BACKEND_TOOLS };
