import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { RunSpec } from "../../contracts/src/index";
import { AgentError, errors } from "../../contracts/src/index";
import type { ExecutionContext } from "./index";
import { completionGateResult, createTaskCompletionMiddleware } from "./task-completion";
import { completionReviewAppendix, completionReviewPrompt, parseCompletionReview, shouldRunCompletionReview, type CompletionReviewChange } from "./completion-review";
import type { RunEvidenceSnapshot } from "./run-evidence";
import { conversationWindowMiddleware, TokenUsageHandler } from "./conversation";

const emptyEvidence=():RunEvidenceSnapshot=>({commands:[],diagnostics:[],browser:[],processes:[],diffs:[],filesRead:[],mcp:[],projectIndexInspected:false,playbooksRead:[]});
export type WorkspaceToolState={changes:CompletionReviewChange[];omitted:number;evidence:RunEvidenceSnapshot;epoch?:string;approvalWasDenied?:boolean};
export type WorkspaceToolResult={kind:"workspace-tool-result";result:unknown;state:WorkspaceToolState};
export function workspaceCompletion(spec:RunSpec,context:ExecutionContext,model:BaseChatModel,usage:TokenUsageHandler,images:{mimeType:string;data:string}[]) {
  if(!spec.workspace)return undefined;
  if(context.registration.product!=="companion-vscode")throw new AgentError(errors.forbidden,"Workspace intelligence belongs to the editor product.");
  const options=spec.workspace;
  const current=():WorkspaceToolState=>{
    const rows=context.operationResults?.()??[];
    const epochs=new Map<string,WorkspaceToolState>();
    for(const row of rows){const value=row.value as WorkspaceToolResult;if(value?.kind === "workspace-tool-result")epochs.set(value.state.epoch??"legacy",value.state);}
    const states=[...epochs.values()];if(!states.length)return {changes:[],omitted:0,evidence:emptyEvidence()};
    const latest=states.at(-1)!;
    const changes=new Map<string,WorkspaceToolState["changes"][number]>();for(const state of states)for(const change of state.changes)changes.set(change.path,change);
    const evidence=emptyEvidence();for(const key of ["commands","diagnostics","browser","processes","diffs","filesRead","mcp","playbooksRead"] as const)
      (evidence as unknown as Record<string,unknown>)[key]=states.flatMap(state=>(state.evidence as unknown as Record<string,unknown[]>)[key]??[]).slice(-100);
    evidence.projectIndexInspected=states.some(state=>state.evidence.projectIndexInspected);
    return {...latest,changes:[...changes.values()],omitted:states.reduce((sum,state)=>sum+state.omitted,0),evidence,approvalWasDenied:states.some(state=>state.approvalWasDenied)};
  };
  const middleware=createTaskCompletionMiddleware({model,structuredOutput:spec.provider.kind==="ollama",mode:spec.mode,responseLanguage:options.responseLanguage,
    conversation:spec.messages.filter(row=>row.role!=="system").map(row=>({role:row.role as "user"|"assistant",content:typeof row.content==="string"?row.content:row.content.filter(block=>block.type==="text").map(block=>block.text).join("\n")})),
    currentImages:images,changes:()=>current().changes,signal:context.signal,callbacks:[usage],sensitiveValues:context.credential?[context.credential]:[],
    hasObservedRead:()=>current().evidence.filesRead.length>0,approvalWasDenied:()=>current().approvalWasDenied===true,
    executionEvidence:()=>{const evidence=current().evidence;return [
      ...evidence.commands.filter(row=>row.exitCode===0).slice(-1).map(row=>({kind:"command_success" as const,detail:`${row.command} exited with code 0.`})),
      ...evidence.browser.filter(row=>row.action==="open"&&/^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/.test(row.detail??"")).slice(-1).map(row=>({kind:"live_preview" as const,detail:`Opened verified local page ${row.detail}.`}))];},
    onContract:contract=>context.emit("workspace.activity",{type:"activity",kind:"goal",title:"Interpreted task",detail:contract.objective}),
    onRetry:async attempt=>{context.emit("text.reset",{});context.emit("workspace.activity",{type:"status",label:options.responseLanguage==="en"?`Continuing after evidence check (${attempt}/2)`:`Continuando após verificar as evidências (${attempt}/2)`});},
  });
  return {middleware:[...(spec.runtime==="standard"?[conversationWindowMiddleware(options.maxConversationCharacters)]:[]),middleware],current,
    async finish(state:unknown,text:string){
      const gate=completionGateResult(state);if(!gate.completionOutcome)throw Error("The agent stopped without a task-completion verdict.");
      if(gate.completionOutcome==="incomplete")text+=options.responseLanguage==="en"?`\n\nTask incomplete: ${gate.completionReason}`:`\n\nTarefa incompleta: ${gate.completionReason}`;
      const host=current();let review;
      if(shouldRunCompletionReview(options.finalReview,spec.mode,host.changes.length,host.evidence)){
        try{const reply=await model.invoke([new SystemMessage("Review the actual evidence conservatively. Return the requested JSON without private reasoning."),new HumanMessage(completionReviewPrompt({request:typeof spec.messages.at(-1)?.content==="string"?spec.messages.at(-1)!.content as string:"Image request",draftAnswer:text,mode:spec.mode,changes:host.changes,omittedChanges:host.omitted,evidence:host.evidence,responseLanguage:options.responseLanguage}))],{signal:context.signal,callbacks:[usage]});review=parseCompletionReview(reply.text,options.responseLanguage);text+=completionReviewAppendix(review,options.responseLanguage);context.emit("workspace.activity",{type:"verification",review});}
        catch(error){if(context.signal.aborted)throw error;context.emit("workspace.activity",{type:"activity",kind:"verification",title:"Independent review unavailable"});}
      }
      return {text,completionOutcome:gate.completionOutcome,completionReason:gate.completionReason,evidence:host.evidence,changes:host.changes,omittedChanges:host.omitted,review,
        message:{id:options.assistantMessageId,role:"assistant",text,content:text,createdAt:Date.now(),status:"complete"},usage:{input:usage.input,output:usage.output}};
    }};
}
