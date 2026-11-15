import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import { ChatOpenAICompletions } from "@langchain/openai";
import { APIConnectionTimeoutError } from "openai";
import { FakeToolCallingModel } from "langchain";
import { ModelFailureCallback, ModelTransportError } from "../packages/agent-core/src/model-failure";
import { ProviderModels } from "../packages/agent-core/src/provider-models";
import { executeGraph } from "../packages/agent-core/src/index";
import { OllamaDesktopRuntime } from "../packages/agent-core/src/desktop-runtime";
import { AgentService } from "../packages/agent-service/src/service";
import { Store } from "../packages/agent-service/src/store";
import { AgentError, errors, runSpec, type Registration, type Run, type Session } from "../packages/contracts/src/index";
import { modelFailure } from "../packages/contracts/src/model-failure";
import type { InferenceBudgetSnapshot } from "../packages/contracts/src/inference-budget";

test("model diagnostics require model origin, allowlist fields and preserve HTTP, admission, cancellation and unknown causes", () => {
  const observed = new ModelFailureCallback(), signal = new AbortController();
  const secrets = "provider body, prompt, https://private.invalid/?key=secret";
  const cause = Object.assign(new Error(secrets), { code: "UND_ERR_BODY_TIMEOUT", headers: { authorization: secrets } });
  const error = new TypeError("terminated", { cause });
  assert.equal(observed.terminalError(error, signal.signal), error, "a tool with the same transport error is not model inference");
  observed.handleLLMError(error);
  const unrelated = new TypeError("terminated", { cause });
  assert.equal(observed.terminalError(unrelated, signal.signal), unrelated, "matching error text is not model origin");
  const normalized = observed.terminalError(error, signal.signal);
  assert.ok(normalized instanceof ModelTransportError);
  assert.deepEqual(normalized.failure, { category: "response_inactivity", code: "UND_ERR_BODY_TIMEOUT" });
  assert.equal("cause" in normalized, false); assert.equal(JSON.stringify(normalized).includes(secrets), false);
  for (const original of [Object.assign(new Error(secrets), { status: 401, cause }),
    new AgentError(errors.reconciliation, "Protected result needs inspection"), new Error("Request timed out in a tool")]) {
    observed.handleLLMError(original); assert.equal(observed.terminalError(original, signal.signal), original);
  }
  const circular = new TypeError("terminated"); circular.cause = circular; observed.handleLLMError(circular);
  assert.deepEqual((observed.terminalError(circular, signal.signal) as ModelTransportError).failure, { category: "response_interrupted" });
  signal.abort(); assert.equal(observed.terminalError(error, signal.signal), error);
  assert.throws(() => modelFailure.parse({ category: "response_inactivity", message: secrets }));
});

test("SDK and official LangChain deadline identities are diagnosed only after the exact model callback, never from text or constructor-name lookalikes",()=>{
  const callback=new ModelFailureCallback(),signal=new AbortController();
  for(const error of [new APIConnectionTimeoutError({message:"synthetic private body"}),Object.assign(new Error("unrelated private text"),{name:"TimeoutError"})]){
    assert.equal(callback.terminalError(error,signal.signal),error);
    callback.handleLLMError(error);const safe=callback.terminalError(error,signal.signal);assert.ok(safe instanceof ModelTransportError);assert.deepEqual(safe.failure,{category:"request_timeout"});assert.equal(JSON.stringify(safe).includes("private"),false);
  }
  for(const error of [new Error("Request timed out."),Object.assign(new Error("private"),{constructor:{name:"APIConnectionTimeoutError"}}),Object.assign(new Error("private"),{name:"TimeoutError",status:429}),Object.assign(new Error("private"),{name:"TimeoutError",cause:{status:401}})]){
    callback.handleLLMError(error);assert.equal(callback.terminalError(error,signal.signal),error);
  }
  for(const status of [400,401,403,408,429,500,504])for(const location of ['status','response'] as const){
    const error=Object.assign(new Error('private'),{name:'TimeoutError',...(location==='status'?{status}:{response:{status}})});callback.handleLLMError(error);assert.equal(callback.terminalError(error,signal.signal),error,'An actual HTTP response is not an SDK request deadline.');
  }
  const cancelled=new APIConnectionTimeoutError();callback.handleLLMError(cancelled);signal.abort();assert.equal(callback.terminalError(cancelled,signal.signal),cancelled);
});

test("Standard/Deep retain original HTTP and authority errors through official middleware and the v3 stream boundary", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "graph-failure-"));
  const saver = SqliteSaver.fromConnString(path.join(directory, "graph.sqlite"));
  const reg: Registration = { id: "fixture", product: "companion-vscode", profile: "fixture", workspace: "", providers: ["ollama"], hostTools: [] };
  try {
    for (const runtime of ["standard", "deep"] as const) for (const original of [
      Object.assign(new Error("Synthetic authentication failure"), { status: 401 }),
      new AgentError(errors.reconciliation, "Inspect the protected receipt"),
    ]) {
      const model = new class extends FakeToolCallingModel {
        override bindTools(..._args: Parameters<FakeToolCallingModel["bindTools"]>): this { return this; }
        override async _generate(..._args: Parameters<FakeToolCallingModel["_generate"]>): ReturnType<FakeToolCallingModel["_generate"]> { throw original; }
      }();
      model.disableStreaming = true;
      const spec = runSpec.parse({ runtime, mode: "plan", provider: { kind: "ollama", endpoint: "http://127.0.0.1:11434/v1", roles: { executor: "fixture" } },
        messages: [{ role: "user", content: "Read-only simulated failure" }], systemPrompt: "No effects", tools: [] });
      await assert.rejects(executeGraph(spec, { registration: reg, threadId: `${runtime}-${original.name}`, checkpointer: saver,
        signal: new AbortController().signal, model, emit: () => {}, invokeTool: async () => assert.fail("No tool execution") }),
      (error: unknown) => { assert.equal(error, original); return true; });
    }
  } finally { saver.db.close(); await rm(directory, { recursive: true, force: true }); }
});

for (const runtime of ["standard", "deep"] as const) for (const mode of ["socket-close", "body-idle", "request-deadline"] as const) {
  test(`${runtime}: ${mode} persists a safe terminal diagnosis and unknown usage without retry, success or lost partial text`, async () => {
    let requests = 0, timer: ReturnType<typeof setTimeout> | undefined;
    const server = createServer((request, response) => {
      requests++; assert.equal(request.method, "POST"); assert.equal(request.url, "/v1/chat/completions"); request.resume();
      request.on("end", () => {
        if(mode === "request-deadline")return; // The SDK's deadline expires before any response headers.
        response.writeHead(200, { "content-type": "text/event-stream" }); response.flushHeaders();
        response.write(`data: ${JSON.stringify({ id: "interrupted", object: "chat.completion.chunk", created: 1, model: "fixture",
          choices: [{ index: 0, delta: { role: "assistant", content: "PUBLIC_PREFIX" }, finish_reason: null }] })}\n\n`);
        if (mode === "socket-close") timer = setTimeout(() => response.destroy(), 80);
      });
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address(); assert.ok(address && typeof address === "object");
    const directory = await mkdtemp(path.join(tmpdir(), "model-failure-"));
    const reg: Registration = { id: "fixture", product: "companion-vscode", profile: "fixture", workspace: "", providers: ["ollama"], hostTools: [] };
    const spec = runSpec.parse({ runtime, mode: "plan", provider: { kind: "ollama", endpoint: `http://127.0.0.1:${address.port}/v1`, roles: { executor: "fixture" } },
      messages: [{ role: "user", content: "Read-only simulated transport qualification" }], systemPrompt: "No tools or effects", tools: [] });
    const service = new AgentService(new Store(path.join(directory, "metadata.sqlite")), directory, async (request, context) => {
      const models = new ProviderModels(request.provider, undefined, context.signal);
      try { return await executeGraph(request, { ...context, model: models.model("executor", true, { timeout: mode === "socket-close" ? 2_000 : 300, requiresTools: false }) }); }
      finally { await models.close(); }
    });
    try {
      const session = await service.dispatch(reg, "sessions.create", { title: "Interrupted fixture" }, "fixture") as Session;
      const run = await service.dispatch(reg, "runs.start", { sessionId: session.id, key: "one", spec }, "fixture") as Run;
      for (let i = 0; i < 1_000 && service.store.run(reg, run.id).state === "running"; i++) await new Promise(resolve => setTimeout(resolve, 5));
      const saved = service.store.run(reg, run.id); assert.equal(saved.state, "failed"); assert.equal(requests, 1);
      assert.match(saved.error!, mode === "body-idle" ? /sem enviar dados/ : mode === "request-deadline" ? /solicitação ao provedor excedeu/ : /conexão.*caiu/i);
      const snapshot = service.store.snapshot(reg, session.id);
      assert.equal(snapshot.events.some(event => event.type === "text.delta" && JSON.stringify(event.data).includes("PUBLIC_PREFIX")),mode!=="request-deadline");
      assert.equal(snapshot.events.some(event => event.type === "text.final"), false);
      const diagnostics = snapshot.events.filter(event => event.type === "model.failure"); assert.equal(diagnostics.length, 1);
      assert.deepEqual(modelFailure.parse(diagnostics[0]!.data), mode === "body-idle"
        ? { category: "response_inactivity", code: "UND_ERR_BODY_TIMEOUT" }
        : mode === "request-deadline" ? {category:"request_timeout"} : { category: "connection_interrupted", code: "UND_ERR_SOCKET" });
      const budget = await service.dispatch(reg, "inference.budgets.get", { sessionId: session.id }, "fixture") as InferenceBudgetSnapshot;
      const namespace = budget.budgets.find(value => value.scope.kind === "namespace")!;
      assert.equal(namespace.calls, 1); assert.equal(namespace.unreportedCalls, 1); assert.equal(namespace.pendingCalls, 0);
      const attempts=service.store.db.prepare('SELECT value FROM inference_calls WHERE run=?').all(run.id) as {value:string}[];
      assert.equal(attempts.length,1);const attempt=JSON.parse(attempts[0]!.value) as {reservation:number;state:string};
      assert.equal(attempt.state,'unreported');assert.ok(attempt.reservation>namespace.reservedTokensPerCall,'The request-sized reservation includes actual input bytes');
      assert.equal(namespace.chargedTokens, attempt.reservation, "unknown usage preserves the whole admitted reservation, not just its minimum floor");
      await service.dispatch(reg, "runs.start", { sessionId: session.id, key: "one", spec }, "fixture");
      assert.equal(requests, 1, "idempotent replay must not dispatch another request");
      await service.close();
      const reopened = new Store(path.join(directory, "metadata.sqlite"));
      try {
        assert.equal(reopened.run(reg, run.id).error, saved.error);
        assert.deepEqual(reopened.snapshot(reg, session.id).events.filter(event => event.type === "model.failure"), diagnostics);
      } finally { reopened.close(); }
    } finally {
      await service.close(); clearTimeout(timer); server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve())); await rm(directory, { recursive: true, force: true });
    }
  });
}

test("Mac runtime diagnoses its actual model error without changing the request or executing game tools", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "desktop-model-failure-"));
  const saver = SqliteSaver.fromConnString(path.join(directory, "graph.sqlite"));
  let calls = 0;
  class FixtureRuntime extends OllamaDesktopRuntime {
    protected override createModel(modelName: string, streaming: boolean): ChatOpenAICompletions {
      return new ChatOpenAICompletions({ model: modelName, apiKey: "synthetic-only", streaming, disableStreaming: !streaming, maxRetries: 0,
        configuration: { baseURL: "http://127.0.0.1:11434/v1", fetch: async () => {
          calls++; throw Object.assign(new Error("synthetic confidential body"), { code: "ECONNREFUSED" });
        } } });
    }
  }
  const desktop = new FixtureRuntime(saver);
  try {
    await assert.rejects(desktop.run({ thread: { id: "fixture", title: "Read", messages: [], createdAt: 1, updatedAt: 1 }, request: "Read-only fixture",
      workspacePath: directory, modelRoles: { executor: "fixture" }, dockerSandboxEnabled: false, mode: "plan", agentRuntime: "standard",
      assistantMessageId: "answer", contextPages: [], openPreview: async () => assert.fail("No preview is allowed"),
      callbacks: { approval: async () => assert.fail("No approval is allowed"), activity: () => {}, delta: () => {}, step: () => {}, reset: () => {} } }),
    (error: unknown) => {
      assert.ok(error instanceof ModelTransportError); assert.deepEqual(error.failure, { category: "connection_failed", code: "ECONNREFUSED" });
      assert.equal(error.message.includes("confidential"), false); return true;
    });
    assert.equal(calls, 1); assert.equal(desktop.running, false);
  } finally { await desktop.shutdown(); saver.db.close(); await rm(directory, { recursive: true, force: true }); }
});

for(const runtime of ['standard','deep'] as const)test(`Mac ${runtime}: the actual SDK deadline is diagnosed without opening host resources or silently retrying`,async()=>{
 let requests=0;const server=createServer(request=>{requests++;request.resume();});await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address==='object');
 const directory=await mkdtemp(path.join(tmpdir(),'desktop-sdk-deadline-')),saver=SqliteSaver.fromConnString(path.join(directory,'graph.sqlite'));
 class FixtureRuntime extends OllamaDesktopRuntime{
  protected override createModel(modelName:string,streaming:boolean):ChatOpenAICompletions{return new ChatOpenAICompletions({model:modelName,apiKey:'synthetic-only',streaming,disableStreaming:!streaming,maxRetries:0,timeout:200,configuration:{baseURL:`http://127.0.0.1:${(address as {port:number}).port}/v1`}});}
 }
 const desktop=new FixtureRuntime(saver);try{
  await assert.rejects(desktop.run({thread:{id:'fixture',title:'Read',messages:[],createdAt:1,updatedAt:1},request:'Read-only simulated request deadline.',workspacePath:directory,modelRoles:{executor:'fixture'},dockerSandboxEnabled:false,mode:'plan',agentRuntime:runtime,assistantMessageId:'answer',contextPages:[],openPreview:async()=>assert.fail('No host preview'),callbacks:{approval:async()=>assert.fail('No approval'),activity:()=>{},delta:()=>{},step:()=>{},reset:()=>{}}}),
   (error:unknown)=>{assert.ok(error instanceof ModelTransportError);assert.deepEqual(error.failure,{category:'request_timeout'});assert.equal('cause' in error,false);return true;});
  assert.equal(requests,1);assert.equal(desktop.running,false);
 }finally{await desktop.shutdown();saver.db.close();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(directory,{recursive:true,force:true});}
});
