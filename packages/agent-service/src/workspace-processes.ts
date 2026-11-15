import * as path from "node:path";
import {realpath,stat} from "node:fs/promises";
import {z} from "zod";
import {LocalProcessManager} from "../../adapter-workspace/src/process-manager";
import {evaluateCommandPolicy} from "../../adapter-workspace/src/command-policy";
import {looksLikeVerificationCommand,RunEvidenceRecorder} from "../../agent-core/src/run-evidence";
import {AgentError,errors,type Registration,type ToolSpec} from "../../contracts/src/index";
import {namespace} from "./security";
const names=new Set(["run_command","start_local_process","inspect_local_process","wait_for_local_process","stop_local_process","restart_local_process"]);
const command=z.object({command:z.string().regex(/^[a-zA-Z0-9._+-]+$/),args:z.array(z.string().max(2000).refine(value=>!value.includes("\0"))).max(40),cwd:z.string().max(4096).optional(),timeout_ms:z.number().int().min(1000).max(120000).optional()}).strict();
const id=z.object({id:z.string().min(1).max(64)}).strict();
export class WorkspaceProcesses {
 private readonly managers=new Map<string,LocalProcessManager>();
 private readonly evidence=new Map<string,RunEvidenceRecorder>();
 get runningCount(){return [...this.managers.values()].reduce((count,manager)=>count+manager.inspect().filter(process=>process.state === "running").length,0);}
 get busy(){return this.runningCount>0;}
 async prepare(reg:Registration,tool:ToolSpec,input:unknown){
  if(reg.product!=="companion-vscode"||!names.has(tool.name)||tool.host!=="service-process"||tool.effect!==(["inspect_local_process","wait_for_local_process"].includes(tool.name)?"read":"external"))throw new AgentError(errors.forbidden,"This product cannot use the workspace process adapter.");
  if(tool.name === "run_command"||tool.name === "start_local_process"){
   const request=command.parse(input);const policy=evaluateCommandPolicy(request.command,request.args);
   if(tool.name === "start_local_process"&&policy.level === "destructive")throw new AgentError(errors.forbidden,"Destructive commands cannot run as managed processes.");
   const root=await realpath(reg.workspace),cwd=await realpath(path.resolve(root,request.cwd??"."));
   const relative=path.relative(root,cwd);if(relative === ".."||relative.startsWith(`..${path.sep}`)||path.isAbsolute(relative)||!(await stat(cwd)).isDirectory())throw new AgentError(errors.forbidden,"Process working directory must be inside the approved workspace.");
   return {...request,cwd};
  }
  if(tool.name === "inspect_local_process")return z.object({id:z.string().max(64).optional()}).strict().parse(input);
  if(tool.name === "wait_for_local_process")return id.extend({readiness_url:z.string().max(2048).optional(),timeout_ms:z.number().int().min(500).max(60000).optional()}).parse(input);
  return id.parse(input);
 }
 async invoke(reg:Registration,run:string,tool:ToolSpec,input:unknown,signal:AbortSignal,emit:(event:unknown)=>void){
  const args=await this.prepare(reg,tool,input) as {command:string;args:string[];cwd:string;id:string;timeout_ms?:number;readiness_url?:string};
  const scope=namespace(reg);let manager=this.managers.get(scope);if(!manager){manager=new LocalProcessManager();this.managers.set(scope,manager);}
  manager.setEventSink(emit);
  let evidence=this.evidence.get(run);if(!evidence){evidence=new RunEvidenceRecorder();this.evidence.set(run,evidence);}
  let result:unknown;
  if(tool.name === "run_command"||tool.name === "start_local_process"){
   const started=await manager.start(args);
   if(tool.name === "run_command"){
    let finished;
    try{finished=await manager.waitForExit(started.id,args.timeout_ms??60000,signal);}catch{finished=await manager.stop(started.id);}
    result={exitCode:finished.exitCode??-1,stdout:finished.stdout,stderr:finished.stderr};
    evidence.command({command:[args.command,...args.args].join(" "),exitCode:finished.exitCode??-1,verification:looksLikeVerificationCommand(args.command,args.args),detail:[finished.stdout,finished.stderr].filter(Boolean).join("\n").slice(0,2500)});
   }else {result=started;evidence.process({action:"start",state:started.state});}
  }else if(tool.name === "inspect_local_process")result=manager.inspect(args.id);
  else if(tool.name === "stop_local_process"){result=await manager.stop(args.id);evidence.process({action:"stop"});}
  else if(tool.name === "restart_local_process"){result=await manager.restart(args.id);evidence.process({action:"restart"});}
  else {const waited=await manager.waitForReady(args.id,args.readiness_url,args.timeout_ms??10000,signal);result=waited;evidence.process({action:"wait",ready:waited.ready,state:waited.process.state});}
  return {kind:"workspace-tool-result",result:JSON.stringify(result),state:{epoch:"service-process",changes:[],omitted:0,evidence:evidence.snapshot()}};
 }
 async close(){await Promise.allSettled([...this.managers.values()].map(manager=>manager.shutdown()));this.managers.clear();this.evidence.clear();}
}
