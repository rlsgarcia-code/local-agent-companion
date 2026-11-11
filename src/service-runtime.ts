import * as path from "node:path";
import * as vscode from "vscode";
import { randomUUID } from "node:crypto";
import { AgentClient, type HostResponses } from "../packages/client-ts/src/index";
import { ensureEngine, PreparedEngineUpdateError } from "../packages/client-ts/src/bootstrap";
import { COMPANION_RELEASE_PUBLIC_KEY } from "../packages/client-ts/src/release-key";
import { contentHash } from "../packages/contracts/src/identity";
import { encodeHostValue, WORKSPACE_BACKEND_TOOLS } from "../packages/contracts/src/workspace-backend";
import { type EngineEvent, type EngineUpdateStatus, type ProviderSpec, type Run, type RunSpec, type Session, type ToolSpec, terminalStates } from "../packages/contracts/src/index";
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
 constructor(private readonly context:vscode.ExtensionContext,private readonly testOptions?:{stateDirectory:string;bundleDirectory:string;signed?:boolean}){if(testOptions&&context.extensionMode!==vscode.ExtensionMode.Development)throw Error("Isolated fixtures require development mode.");}
 get alive(){return !this.detached;}
 private openEngine(workspace:string,catalog:ToolSpec[],activation:"idle"|"stop-managed"="idle"):Promise<AgentClient>{
  return ensureEngine({bundleDirectory:this.testOptions?.bundleDirectory??path.join(this.context.extensionPath,"dist","engine"),stateDirectory:this.testOptions?.stateDirectory,product:"companion-vscode",profile:"default",workspace,providers:[...AVAILABLE_MODEL_PROVIDERS],hostTools:catalog.map(tool=>tool.name),toolCatalog:catalog,
    activation,development:this.context.extensionMode===vscode.ExtensionMode.Development,publicKey:this.context.extensionMode===vscode.ExtensionMode.Development&&!this.testOptions?.signed?undefined:COMPANION_RELEASE_PUBLIC_KEY});
 }
 async connect(workspace:string,catalog:ToolSpec[]=[]):Promise<AgentClient>{
  const key=contentHash({workspace,catalog});let pending=this.clients.get(key);
  if(!pending){pending=this.openEngine(workspace,catalog);
   this.clients.set(key,pending);pending.catch(()=>this.clients.delete(key));}
  try{const client=await pending;if(!client.connected){this.clients.delete(key);return this.connect(workspace,catalog);}return client;}
  catch(error){
   if(!(error instanceof PreparedEngineUpdateError))throw error;
   const action="Stop local resources and update";
   const choice=await vscode.window.showWarningMessage("A verified Companion engine update is ready.",{modal:true,detail:engineUpdateDetail(error)},action);
   if(choice!==action)throw error;
   this.clients.delete(key);
   const replacement=this.openEngine(workspace,catalog,"stop-managed");
   this.clients.set(key,replacement);replacement.catch(()=>this.clients.delete(key));
   return replacement;
  }
 }
 async session(client:AgentClient,thread:{id:string;title:string;messages:unknown[]}):Promise<Session>{
  const key=`vscode:${thread.id}`;const existing=(await client.call<Session[]>("sessions.list")).find(session=>session.importedFrom===key);
  return existing??client.importSession(key,{thread});
 }
 async workspaceStatus(workspace:string):Promise<{busy:boolean;runId?:string;state?:Run["state"]}>{
  return (await this.connect(workspace)).call("workspace.status");
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
 async restartEngine(workspace:string):Promise<void>{
  const client=await this.connect(workspace),status=await client.call<EngineUpdateStatus>("engine.updateStatus");
  if(status.blockers.activeRuns||status.blockers.modelOperations||status.blockers.desktopResources){
   const labels=[status.blockers.activeRuns&&`${status.blockers.activeRuns} active run(s)`,status.blockers.modelOperations&&`${status.blockers.modelOperations} model operation(s)`,status.blockers.desktopResources&&`${status.blockers.desktopResources} desktop resource(s)`].filter(Boolean).join(", ");
   throw new Error(`Finish protected work before restarting the engine: ${labels}.`);
  }
  const action="Stop resources and restart";
  const choice=await vscode.window.showWarningMessage("Restart the Companion engine?",{modal:true,detail:`${status.blockers.managedProcesses?`This stops ${status.blockers.managedProcesses} managed local server(s). `:""}Completed conversations and configuration are preserved.`},action);
  if(choice!==action)return;
  const result=await client.call<{accepted:boolean;reason?:string}>("engine.stopManagedResourcesForUpdate");
  if(!result.accepted)throw new Error(result.reason??"The engine still has protected work.");
  for(let wait=0;wait<100&&client.connected;wait++)await new Promise(resolve=>setTimeout(resolve,50));
  if(client.connected)throw new Error("The Companion engine did not stop in time.");
  for(const pending of this.clients.values())void pending.then(value=>value.close(),()=>undefined);
  this.clients.clear();await this.connect(workspace);
 }
 cancel(){if(this.active)void this.active.client.call("runs.cancel",{id:this.active.run.id});}
 dispose(){this.detached=true;for(const observer of this.observers)observer.abort();for(const client of this.clients.values())void client.then(client=>client.close());this.clients.clear();}
}

export { WORKSPACE_BACKEND_TOOLS };

function engineUpdateDetail(error:PreparedEngineUpdateError):string{
 const blockers=error.blockers;
 const parts=blockers?[blockers.activeRuns&&`${blockers.activeRuns} active run(s)`,blockers.managedProcesses&&`${blockers.managedProcesses} managed server(s)`,blockers.modelOperations&&`${blockers.modelOperations} model operation(s)`,blockers.desktopResources&&`${blockers.desktopResources} desktop resource(s)`].filter(Boolean):[];
 const status=parts?.length?`Blocking the update: ${parts.join(", ")}.`:`${error.reason}`;
 return `Engine ${error.installedVersion} is active; ${error.requestedVersion} is prepared. ${status}\n\nFinish important work first. Continuing stops Companion-managed local resources, restarts the engine, and preserves completed conversations.`;
}
