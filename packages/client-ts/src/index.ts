import { X509Certificate } from "node:crypto";
import { connect, type TLSSocket } from "node:tls";
import { createHash, randomUUID } from "node:crypto";
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
  type Session,
  type SessionSnapshot,
  type RunState,
} from "../../contracts/src/index";
import { MAX_TRANSFER_BYTES, TRANSFER_CHUNK_BYTES, type Transfer } from "../../contracts/src/transfers";
import { contentHash } from "../../contracts/src/identity";

export type HostResponses = Map<string, { signature: string; response: Promise<unknown> }>;

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
    let index: number;
    while ((index = this.buffer.indexOf(10)) !== -1) {
      if (index + 1 > MAX_FRAME_BYTES) { this.socket?.destroy(); return; }
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
    if (this.buffer.length > MAX_FRAME_BYTES) this.socket?.destroy();
  }
  private rejectAll(error: Error): void {
    for (const wait of this.pending.values()) {
      clearTimeout(wait.timer);
      wait.reject(error);
    }
    this.pending.clear();
  }
  async upload(key: string, content: Uint8Array, mime: Transfer["mime"]): Promise<Transfer> {
    const data = Buffer.from(content);
    if (data.length > MAX_TRANSFER_BYTES) throw new Error("Attachment exceeds the negotiated transfer limit. The source was preserved.");
    const transfer = await this.call<Transfer>("transfers.begin", {
      key, size: data.length, sha256: createHash("sha256").update(data).digest("hex"), mime,
    });
    let cursor = transfer.received;
    while (cursor < data.length) {
      const end = Math.min(cursor + TRANSFER_CHUNK_BYTES, data.length);
      const next = await this.call<Transfer>("transfers.append", {
        id: transfer.id, offset: cursor, data: data.subarray(cursor, end).toString("base64"),
      });
      if (next.received < end || next.received > data.length) throw new Error("Invalid upload acknowledgement.");
      cursor = next.received;
    }
    return this.call("transfers.commit", { id: transfer.id });
  }
  async download(id: string): Promise<Buffer> {
    const transfer = await this.call<Transfer>("transfers.get", { id });
    if (!transfer.committed || transfer.size > MAX_TRANSFER_BYTES || transfer.size < 0)
      throw new Error("Invalid attachment metadata.");
    const parts: Buffer[] = [];
    let cursor = 0;
    while (cursor < transfer.size) {
      const part = await this.call<{ data: string; nextOffset: number }>("transfers.read", { id, offset: cursor });
      const data = Buffer.from(part.data, "base64");
      if (!data.length || data.length > TRANSFER_CHUNK_BYTES || part.nextOffset !== cursor + data.length || part.nextOffset > transfer.size)
        throw new Error("Invalid attachment chunk.");
      parts.push(data);
      cursor = part.nextOffset;
    }
    const data = Buffer.concat(parts);
    if (createHash("sha256").update(data).digest("hex") !== transfer.sha256)
      throw new Error("Downloaded attachment SHA-256 mismatch.");
    return data;
  }
  async importSession(key: string, domain: unknown): Promise<Session> {
    const data = Buffer.from(JSON.stringify(domain));
    const digest = createHash("sha256").update(data).digest("hex");
    const transfer = await this.upload(`import:${digest}`, data, "application/json");
    return this.call("sessions.import", { key, transferId: transfer.id });
  }
  async startRun(sessionId: string, key: string, spec: unknown, profile: "generic" | "desktop" = "generic"): Promise<Run> {
    const data = Buffer.from(JSON.stringify(spec));
    const method = profile === "desktop" ? "desktop.start" : "runs.start";
    if (data.length < 512 * 1024) return this.call(method, { sessionId, key, spec });
    const digest = createHash("sha256").update(data).digest("hex");
    const transfer = await this.upload(`run:${digest}`, data, "application/json");
    return this.call(method, { sessionId, key, specTransferId: transfer.id });
  }
  async exportSession(id: string): Promise<unknown> {
    const transfer = await this.call<Transfer>("sessions.export", { id });
    return JSON.parse((await this.download(transfer.id)).toString("utf8"));
  }
  async snapshotSession(id: string): Promise<SessionSnapshot> {
    const transfer = await this.call<Transfer>("sessions.snapshot", { id });
    const snapshot = JSON.parse((await this.download(transfer.id)).toString("utf8")) as SessionSnapshot;
    await this.hydrateEvents(snapshot.events);
    return snapshot;
  }
  async readEvents(sessionId: string, cursor = 0): Promise<EngineEvent[]> {
    const events = await this.call<EngineEvent[]>("events.read", { sessionId, cursor });
    await this.hydrateEvents(events);
    return events;
  }
  private async hydrateEvents(events: EngineEvent[]): Promise<void> {
    for (const event of events) {
      const data = event.data as { kind?: string; id?: string } | null;
      if (data?.kind === "agent-event-transfer" && data.id)
        event.data = JSON.parse((await this.download(data.id)).toString("utf8"));
    }
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
    replay: { cursor?: number; onCursor?: (cursor: number) => void; hostResponses?: HostResponses; onState?: (state: RunState) => void } = {},
  ): Promise<Run> {
    let cursor = replay.cursor ?? 0;
    const handled = new Set<string>();
    const responses: HostResponses = replay.hostResponses ?? new Map();
    while (true) {
      signal?.throwIfAborted();
      const events = await this.readEvents(sessionId, cursor);
      for (const event of events) {
        if (event.sequence > cursor) {
          cursor = event.sequence;
          if (event.runId === id) onEvent(event);
          replay.onCursor?.(cursor);
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
          const normalized = { ...(request.payload as Record<string, unknown>) };
          delete normalized.id;
          const signature = contentHash({ kind: request.kind, payload: normalized });
          const previous = responses.get(request.id);
          if (previous && previous.signature !== signature)
            throw new AgentError(-32009, "Host request identity changed its content.");
          const response = previous?.response ?? Promise.resolve().then(() => host(request));
          responses.set(request.id, { signature, response });
          const effect = request.kind === "tool" && typeof normalized.callId === "string";
          void response
            .then((value) =>
              this.call("host.respond", { id: request.id, value }),
              () => {
                if (effect) return this.call("host.failed", { id: request.id });
                responses.delete(request.id);
                handled.delete(request.id);
              },
            )
            .catch(() => {
              handled.delete(request.id);
            });
        }
      }
      const run = await this.call<Run>("runs.get", { id });
      replay.onState?.(run.state);
      if (terminalStates.has(run.state) && events.length === 0) {
        const result = run.result as { kind?: string; id?: string } | undefined;
        if (result?.kind === "agent-result-transfer" && result.id)
          run.result = JSON.parse((await this.download(result.id)).toString("utf8"));
        return run;
      }
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
