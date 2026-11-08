import * as path from "node:path";
import { AgentClient } from "../packages/client-ts/src/index";
import { COMPANION_RELEASE_PUBLIC_KEY } from "../packages/client-ts/src/release-key";
import { ensureEngine } from "../packages/client-ts/src/bootstrap";
import type {
  DesktopActivity,
  DesktopMessage,
  DesktopChange,
  DesktopExecutionStep,
  PullProgress,
} from "./contracts";
import type { OllamaDesktopRuntime as EngineRuntime } from "../packages/agent-core/src/desktop-runtime";
import type { Run, Session } from "../packages/contracts/src/index";

export class OllamaDesktopRuntime {
  constructor(
    private readonly installation: {
      bundleDirectory: string;
      development: boolean;
    },
  ) {}
  private client?: AgentClient;
  private readonly clients = new Map<string, Promise<AgentClient>>();
  private active?: { id: string; client: AgentClient };
  private detached = false;
  private preparing = false;
  get running(): boolean {
    return this.preparing || Boolean(this.active);
  }
  private async connect(workspace = ""): Promise<AgentClient> {
    let pending = this.clients.get(workspace);
    if (!pending) {
      pending = ensureEngine({
        ...this.installation,
        product: "companion-mac",
        profile: "default",
        workspace,
        providers: ["ollama"],
        hostTools: [],
        publicKey: this.installation.development
          ? undefined
          : COMPANION_RELEASE_PUBLIC_KEY,
      });
      this.clients.set(workspace, pending);
      pending.catch(() => this.clients.delete(workspace));
    }
    this.client = await pending;
    if (!this.client.connected) {
      this.clients.delete(workspace);
      return this.connect(workspace);
    }
    return this.client;
  }
  cancel(): void {
    void this.active?.client.call("runs.cancel", { id: this.active.id });
    void this.client?.call("desktop.cancel");
  }
  dispose(): void {
    this.detached = true;
    for (const client of this.clients.values())
      void client.then((c) => c.close());
    this.clients.clear();
  }
  async ollamaStatus(): ReturnType<EngineRuntime["ollamaStatus"]> {
    return (await this.connect()).call("desktop.ollamaStatus");
  }
  async dockerStatus(): ReturnType<EngineRuntime["dockerStatus"]> {
    return (await this.connect()).call("desktop.dockerStatus");
  }
  configureDockerSandbox(enabled: boolean): void {
    void this.connect().then((c) =>
      c.call("desktop.configureDocker", { enabled }),
    );
  }
  async invokeAdvisor(
    model: string,
    prompt: string,
    signal: AbortSignal,
  ): Promise<string> {
    signal.throwIfAborted();
    const client = await this.connect();
    const abort = () => {
      void client.call("desktop.cancelAdvisor");
    };
    signal.addEventListener("abort", abort, { once: true });
    try {
      signal.throwIfAborted();
      return await client.call("desktop.advisor", { model, prompt }, 610_000);
    } finally {
      signal.removeEventListener("abort", abort);
    }
  }
  async pullModel(
    model: string,
    onProgress: (progress: PullProgress) => void,
  ): Promise<void> {
    const client = await this.connect(),
      session = await client.call<Session>("sessions.create", {
        title: "Model download",
      });
    let cursor = 0;
    await client.call("desktop.pull", { model, sessionId: session.id });
    while (!this.detached) {
      const events = await client.call<
        { sequence: number; type: string; data: PullProgress }[]
      >("events.read", { sessionId: session.id, cursor });
      for (const event of events) {
        cursor = event.sequence;
        if (event.type === "model.pull") {
          onProgress(event.data);
          if (event.data.done) {
            if (event.data.error) throw new Error(event.data.error);
            return;
          }
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  async run(
    options: Parameters<EngineRuntime["run"]>[0],
  ): ReturnType<EngineRuntime["run"]> {
    if (this.running) throw new Error("A run is already active.");
    this.preparing = true;
    try {
      const client = await this.connect(options.workspacePath);
      const key = `desktop:${options.thread.id}`;
      const existing = (await client.call<Session[]>("sessions.list")).find(
        (session) => session.importedFrom === key,
      );
      const session =
        existing ??
        (await client.call<Session>("sessions.import", {
          key,
          domain: { thread: options.thread },
        }));
      const { callbacks, openPreview, ...spec } = options;
      const run = await client.call<Run>("desktop.start", {
        sessionId: session.id,
        key: options.assistantMessageId,
        spec,
      });
      this.active = { id: run.id, client };
      const result = await client.waitForRun(
        run.id,
        session.id,
        (event) => {
          const data = event.data as {
            messageId: string;
            delta: string;
            step: DesktopExecutionStep;
          };
          if (event.type === "desktop.delta")
            callbacks.delta(data.messageId, data.delta);
          else if (event.type === "desktop.reset")
            callbacks.reset(data.messageId);
          else if (event.type === "desktop.step")
            callbacks.step(data.messageId, data.step);
          else if (event.type === "desktop.activity")
            callbacks.activity(event.data as DesktopActivity);
        },
        async (request) => {
          if (request.kind === "approval")
            return callbacks.approval(
              request.payload as Parameters<typeof callbacks.approval>[0],
            );
          const preview = request.payload as { operation: string; url: string };
          if (preview.operation === "preview") {
            await openPreview(preview.url);
            return { opened: true };
          }
          throw new Error("Unknown desktop host request.");
        },
      );
      if (result.state !== "completed")
        throw new Error(result.error || "Execution did not complete.");
      return result.result as {
        message: DesktopMessage;
        changes: DesktopChange[];
      };
    } finally {
      this.preparing = false;
      this.active = undefined;
    }
  }
}
