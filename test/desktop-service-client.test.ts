import assert from "node:assert/strict";
import test from "node:test";
import { OllamaDesktopRuntime } from "../desktop/runtime-client";
import type { AgentClient } from "@companion/client-sdk";
import { AgentError, engineCapabilities, errors } from "@companion/client-sdk/contracts";
const session = { id: "session", importedFrom: "desktop:thread" };
const run = { id: "run", sessionId: session.id, state: "running", createdAt: 1, updatedAt: 1 };
function fixture(overrides: Record<string, unknown> = {}) {
  const runtime = new OllamaDesktopRuntime({ bundleDirectory: "unused-fixture", development: true });
  const client = { connected: true, options: { credential: { registration: { workspace: "/fixture" } } },
    call: async (method: string) => method === "sessions.list" ? [session] : {}, importSession: async () => session,
    startRun: async () => run,
    waitForRun: async () => ({ ...run, state: "completed", result: { message: { id: "assistant", text: "Done" }, changes: [] } }),
    ...overrides,
  };
  (runtime as unknown as { connect: () => Promise<AgentClient> }).connect = async () => client as unknown as AgentClient;
  const options: Parameters<typeof runtime.run>[0] = {
    thread: { id: "thread", title: "Test", messages: [], createdAt: 1, updatedAt: 1 },
    request: "Read-only fixture", workspacePath: "/fixture", modelRoles: { executor: "fixture" },
    dockerSandboxEnabled: false, mode: "plan", agentRuntime: "standard", assistantMessageId: "assistant",
    contextPages: [], openPreview: async () => {}, callbacks: { approval: async () => false, activity: () => {}, delta: () => {}, step: () => {}, reset: () => {} },
  };
  return { runtime, options };
}

test("cancelling during preparation never admits the request afterward", async () => {
  let release!: () => void, called!: () => void, admissions = 0;
  const preparing = new Promise<void>((resolve) => { called = resolve; });
  const { runtime, options } = fixture({
    call: async () => { called(); await new Promise<void>((resolve) => { release = resolve; }); return [session]; },
    startRun: async () => { admissions++; return run; },
  });
  const pending = runtime.run(options);
  await preparing; runtime.cancel(); release();
  await assert.rejects(pending, /cancelled before admission/);
  assert.equal(admissions, 0);
});

test("cancelling while admission is awaiting acknowledgement targets the admitted run", async () => {
  let release!: (value: unknown) => void, called!: () => void;
  const started = new Promise<void>((resolve) => { called = resolve; });
  const cancellations: unknown[] = [];
  const { runtime, options } = fixture({
    startRun: async () => { called(); return new Promise((resolve) => { release = resolve; }); },
    call: async (method: string, params: unknown) => { if (method === "runs.cancel") cancellations.push(params); return method === "sessions.list" ? [session] : {}; },
    waitForRun: async () => ({ ...run, state: "cancelled" }),
  });
  const pending = runtime.run(options);
  await started; runtime.cancel(); release(run);
  await assert.rejects(pending, /did not complete/);
  assert.deepEqual(cancellations, [{ id: run.id }]);
});

test("a lost admission acknowledgement retries the same key and specification", async () => {
  const keys: string[] = [], specs: unknown[] = [];
  const { runtime, options } = fixture({ startRun: async (_session: string, key: string, spec: unknown) => {
    keys.push(key); specs.push(spec);
    if (keys.length === 1) throw new Error("Agent API timeout: desktop.start");
    return run;
  } });
  await runtime.run(options);
  assert.deepEqual(keys, [options.assistantMessageId, options.assistantMessageId]);
  assert.deepEqual(specs[0], specs[1]);
});

test("workspace recovery identifies only a desktop run owned by this Mac registration", async () => {
  const calls: string[] = [];
  const { runtime } = fixture({ call: async (method: string) => {
    calls.push(method);
    if (method === "workspace.status") return { busy: true, runId: "blocked", state: "awaiting_reconciliation" };
    if (method === "runs.describe") return { profile: "desktop", threadId: "original-thread" };
    return {};
  } });
  assert.deepEqual(await runtime.workspaceStatus("/fixture"), {
    busy: true, runId: "blocked", state: "awaiting_reconciliation", owned: true, threadId: "original-thread",
  });
  assert.deepEqual(calls, ["workspace.status", "runs.describe"]);
});

test("a workspace lease owned by another client stays visible but cannot be controlled by the Mac", async () => {
  const { runtime } = fixture({ call: async (method: string) => {
    if (method === "workspace.status") return { busy: true, runId: "foreign", state: "awaiting_host" };
    if (method === "runs.describe") throw new AgentError(errors.missing, "Run not found.");
    return {};
  } });
  assert.deepEqual(await runtime.workspaceStatus("/fixture"), {
    busy: true, runId: "foreign", state: "awaiting_host", owned: false,
  });
  await assert.rejects(runtime.cancelWorkspaceRun("/fixture"), /outro cliente/);
});

test("explicit Mac cancellation uses the atomic unknown-result endpoint", async () => {
  const calls: Array<{ method: string; params?: unknown }> = [];
  const { runtime } = fixture({ call: async (method: string, params?: unknown) => {
    calls.push({ method, params });
    if (method === "workspace.status") return { busy: true, runId: "blocked", state: "awaiting_reconciliation" };
    if (method === "runs.describe") return { profile: "desktop", threadId: "original-thread" };
    if (method === "runs.cancelUnknown") return { ...run, id: "blocked", state: "cancelled" };
    return {};
  } });
  assert.equal((await runtime.cancelWorkspaceRun("/fixture"))?.state, "cancelled");
  assert.deepEqual(calls.at(-1), { method: "runs.cancelUnknown", params: { id: "blocked" } });
  assert.ok(!calls.some((entry) => entry.method === "runs.resume"));
});

test("automatic desktop recovery never resumes an unknown effect", async () => {
  let observed = 0, described = 0;
  const unknown = { ...run, state: "awaiting_reconciliation" as const };
  const { runtime } = fixture({
    call: async (method: string) => {
      if (method === "sessions.list") return [session];
      if (method === "runs.list") return [unknown];
      if (method === "runs.describe") described++;
      return {};
    },
    waitForRun: async () => { observed++; return unknown; },
  });
  await runtime.recover("/fixture", () => { throw new Error("Unknown effects must require a user decision."); });
  assert.equal(described, 0);
  assert.equal(observed, 0);
});

test("a Mac provider-policy upgrade uses the enrolled Ollama identity only to activate the new engine", async () => {
  const providers: string[][] = [];
  let compatibilityClosed = false;
  let universalAttempts = 0;
  const runtime = new OllamaDesktopRuntime({
    bundleDirectory: "unused-fixture",
    development: true,
    ensureClient: async (options) => {
      providers.push([...options.providers]);
      if (options.providers.length === 2 && universalAttempts++ === 0) {
        throw new AgentError(errors.forbidden, "Client is not registered or was revoked.");
      }
      const compatibility = options.providers.length === 1;
      return {
        connected: true,
        close: () => { if (compatibility) compatibilityClosed = true; },
        engineInfo: async () => ({ version: "1.0.6", capabilities: [...engineCapabilities] }),
        call: async (method: string) => method === "engine.info"
          ? { version: "1.0.6" }
          : { ready: true, blockers: { activeRuns: 0, managedProcesses: 0, modelOperations: 0, desktopResources: 0 } },
      } as unknown as AgentClient;
    },
  });

  assert.equal((await runtime.engineStatus()).version, "1.0.6");
  assert.deepEqual(providers, [["ollama", "openai"], ["ollama"], ["ollama", "openai"]]);
  assert.equal(compatibilityClosed, true);
});

test("deferring a prepared update keeps compatible active-engine connections available", async () => {
  const activations: Array<string | undefined> = [];
  const runtime = new OllamaDesktopRuntime({
    bundleDirectory: "unused-fixture",
    development: true,
    ensureClient: async (options) => {
      activations.push(options.activation);
      return {
        connected: true,
        close: () => {},
        engineInfo: async () => ({ version: "1.1.1", capabilities: [...engineCapabilities] }),
        call: async (method: string) => method === "workspace.status" ? { busy: false } : {},
      } as unknown as AgentClient;
    },
  });

  await runtime.deferPreparedUpdate("/fixture");
  assert.deepEqual(await runtime.workspaceStatus("/other"), { busy: false });
  assert.deepEqual(activations, ["defer", "defer"]);
});

test("the Mac client rejects an engine that is missing a required SDK capability", async () => {
  let closed = false;
  const runtime = new OllamaDesktopRuntime({
    bundleDirectory: "unused-fixture",
    development: true,
    ensureClient: async () => ({
      connected: true,
      close: () => { closed = true; },
      engineInfo: async () => ({ version: "1.0.8", capabilities: engineCapabilities.slice(0, -1) }),
    }) as unknown as AgentClient,
  });

  await assert.rejects(runtime.engineStatus(), /requer uma atualização do Companion/);
  assert.equal(closed, true);
});
