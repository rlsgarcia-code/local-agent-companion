import assert from "node:assert/strict";
import * as path from "node:path";
import * as vscode from "vscode";
import {DevelopmentAgent} from "../../src/agent";
import {EditorServiceRuntime} from "../../src/service-runtime";
import {ContextCollector} from "../../src/context";
import {ProjectMemory} from "../../src/memory";
import {ChangeReviewManager} from "../../src/change-review";

export async function run(){
 const root=process.env.COMPANION_FIXTURE_ROOT!,bundle=process.env.COMPANION_FIXTURE_BUNDLE!,state=process.env.COMPANION_FIXTURE_STATE!;
 const configuration=vscode.workspace.getConfiguration('localAgentCompanion');
 for(const [key,value] of Object.entries({modelProvider:'ollama',liteLlmEndpoint:process.env.COMPANION_FIXTURE_PROVIDER!,liteLlmModel:'fixture',embeddingModel:'',semanticMemoryEnabled:false,finalReviewMode:'off',autoContext:false,localBrowserToolsEnabled:false}))
  await configuration.update(key,value,vscode.ConfigurationTarget.Workspace);
 const storage=new Map<string,unknown>();
 const memento={keys:()=>[...storage.keys()],get:(key:string,fallback:unknown)=>storage.get(key)??fallback,update:async(key:string,value:unknown)=>{storage.set(key,JSON.parse(JSON.stringify(value)));}};
 const context={extensionPath:root,extensionMode:vscode.ExtensionMode.Development,globalStorageUri:vscode.Uri.file(path.join(root,'storage')),workspaceState:memento,globalState:memento,secrets:{get:async()=>undefined}} as unknown as vscode.ExtensionContext;
 const create=()=>new DevelopmentAgent(context,new ContextCollector(),new ProjectMemory(),new ChangeReviewManager(),new EditorServiceRuntime(context,{stateDirectory:state,bundleDirectory:bundle}));
 for(const runtime of ['standard','deep']){
  await configuration.update('agentRuntime',runtime,vscode.ConfigurationTarget.Workspace);
  const agent=create();const events:any[]=[];
  await agent.run('Read README.md and report the verified fixture header.','plan',event=>events.push(event));
  assert.ok(events.some(event=>event.type==='assistant'&&event.text.includes('Shared engine fixture verified.')),JSON.stringify(events.filter(event=>['error','assistant','done'].includes(event.type))));
  assert.equal(events.at(-1).outcome,'completed');
  const snapshot=await agent.threadSnapshot();assert.equal(snapshot.messages.filter(message=>message.role==='assistant').length,1);assert.equal(snapshot.recovery,undefined);
  await agent.newThread();agent.dispose();
 }
 // Admission, actual editor read, UI shutdown, completion in the service and
 // reopening reconstruct the original stable message without a second run.
 await configuration.update('agentRuntime','standard',vscode.ConfigurationTarget.Workspace);
 const original=create();
 const client=await new EditorServiceRuntime(context,{stateDirectory:state,bundleDirectory:bundle}).connect(vscode.workspace.workspaceFolders![0]!.uri.fsPath);
 const running=original.run('Read README.md; DETACH_FIXTURE after the read.','plan',()=>{});
 let ready=false;
 for(let n=0;n<200&&!ready;n++){const sessions=await client.call<any[]>('sessions.list');for(const session of sessions){const events=await client.readEvents(session.id);if(events.some(event=>event.type==='tool.receipt'&&(event.data as any).tool==='read_file')){const snap=await client.snapshotSession(session.id);ready ||= snap.runs.some(run=>run.state==='running');}}if(!ready)await new Promise(resolve=>setTimeout(resolve,50));}
 assert.equal(ready,true,'the actual editor read must finish before closing its UI');original.dispose();await running;
 await new Promise(resolve=>setTimeout(resolve,2200));
 const reopened=create();const snapshot=await reopened.threadSnapshot();
 assert.equal(snapshot.recovery,undefined);assert.equal(snapshot.messages.filter(message=>message.role==='assistant').length,1);assert.match(snapshot.messages.at(-1)!.content,/Shared engine fixture verified/);
 reopened.dispose();await client.call('engine.shutdownIfIdle');client.close();
 console.log('VSCODE_SHARED_ENGINE_EXECUTORS_OK standard deep detach recover');
}
