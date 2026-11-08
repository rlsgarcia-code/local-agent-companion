import { X509Certificate } from "node:crypto";
import { connect, type TLSSocket } from "node:tls";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  AgentError,
  MAX_FRAME_BYTES,
  PROTOCOL_VERSION,
  terminalStates,
  type ClientCredential,
  type EngineEvent,
  type RpcResponse,
  type Run,
} from "../../contracts/src/index";

export type ConnectionOptions = {
  address: string;
  certificate: string;
  credential: ClientCredential;
  timeout?: number;
};
export class AgentClient {
  private socket?: TLSSocket;
  private readonly pending = new Map<
    string,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();
  private buffer = Buffer.alloc(0);
  constructor(readonly options: ConnectionOptions) {}
  get connected(): boolean {
    return Boolean(this.socket && !this.socket.destroyed);
  }
  async connect(): Promise<void> {
    if (this.socket && !this.socket.destroyed) return;
    const expected = new X509Certificate(this.options.certificate)
      .fingerprint256;
    const socket = connect({
      path: this.options.address,
      minVersion: "TLSv1.3",
      rejectUnauthorized: false,
    });
    this.socket = socket;
    socket.on("error", (error) => this.rejectAll(error));
    socket.on("close", () =>
      this.rejectAll(
        new AgentError(
          -32011,
          "Local engine connection closed. Reconnect to resume.",
        ),
      ),
    );
    socket.on("data", (chunk) => this.receive(chunk));
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error("Local engine TLS handshake timed out."));
      }, this.options.timeout ?? 10000);
      socket.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      socket.once("secureConnect", () => {
        clearTimeout(timer);
        if (socket.getPeerCertificate().fingerprint256 !== expected) {
          socket.destroy();
          reject(
            new Error(
              "Local engine certificate changed. Repair the trusted bootstrap before reconnecting.",
            ),
          );
          return;
        }
        resolve();
      });
    });
    // No credential is sent until the exact bootstrap certificate is verified.
    await this.call("authenticate", {
      id: this.options.credential.registration.id,
      token: this.options.credential.token,
      protocol: PROTOCOL_VERSION,
    });
  }
  call<T = unknown>(
    method: string,
    params: unknown = {},
    timeout?: number,
  ): Promise<T> {
    if (!this.socket || this.socket.destroyed)
      return Promise.reject(
        new AgentError(-32011, "Local engine is unavailable."),
      );
    const id = randomUUID(),
      frame = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
    if (Buffer.byteLength(frame) > MAX_FRAME_BYTES)
      return Promise.reject(
        new Error("Agent API request exceeds the frame limit."),
      );
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(
        () => {
          this.pending.delete(id);
          reject(new Error(`Agent API timeout: ${method}`));
        },
        timeout ?? this.options.timeout ?? 30000,
      );
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      });
      this.socket!.write(frame);
    });
  }
  private receive(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    if (this.buffer.length > MAX_FRAME_BYTES) {
      this.socket?.destroy();
      return;
    }
    let index: number;
    while ((index = this.buffer.indexOf(10)) !== -1) {
      const frame = this.buffer.subarray(0, index);
      this.buffer = this.buffer.subarray(index + 1);
      try {
        const response = JSON.parse(frame.toString("utf8")) as RpcResponse;
        const wait = this.pending.get(String(response.id));
        if (!wait) continue;
        clearTimeout(wait.timer);
        this.pending.delete(String(response.id));
        if (response.error)
          wait.reject(
            new AgentError(
              response.error.code,
              response.error.message,
              response.error.data,
            ),
          );
        else wait.resolve(response.result);
      } catch {
        this.socket?.destroy();
      }
    }
  }
  private rejectAll(error: Error): void {
    for (const wait of this.pending.values()) {
      clearTimeout(wait.timer);
      wait.reject(error);
    }
    this.pending.clear();
  }
  async waitForRun(
    id: string,
    sessionId: string,
    onEvent: (event: EngineEvent) => void,
    host?: (request: {
      id: string;
      kind: string;
      payload: unknown;
    }) => Promise<unknown>,
    signal?: AbortSignal,
  ): Promise<Run> {
    let cursor = 0;
    const handled = new Set<string>();
    while (true) {
      signal?.throwIfAborted();
      const events = await this.call<EngineEvent[]>("events.read", {
        sessionId,
        cursor,
      });
      for (const event of events) {
        if (event.sequence > cursor) {
          cursor = event.sequence;
          if (event.runId === id) onEvent(event);
        }
      }
      if (host) {
        const requests =
          await this.call<
            { id: string; runId: string; kind: string; payload: unknown }[]
          >("host.poll");
        for (const request of requests) {
          if (request.runId !== id || handled.has(request.id)) continue;
          handled.add(request.id);
          void host(request)
            .then((value) =>
              this.call("host.respond", { id: request.id, value }),
            )
            .catch(() => {
              handled.delete(request.id);
            });
        }
      }
      const run = await this.call<Run>("runs.get", { id });
      if (terminalStates.has(run.state)) return run;
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
    }
  }
  close(): void {
    this.socket?.destroy();
    this.socket = undefined;
  }
  static async fromFiles(
    address: string,
    certificateFile: string,
    credentialFile: string,
  ): Promise<AgentClient> {
    return new AgentClient({
      address,
      certificate: await readFile(certificateFile, "utf8"),
      credential: JSON.parse(
        await readFile(credentialFile, "utf8"),
      ) as ClientCredential,
    });
  }
}
