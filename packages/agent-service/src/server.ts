import { createServer, type TLSSocket, type Server } from "node:tls";
import { randomUUID } from "node:crypto";
import { chmod, lstat, readdir, readFile, unlink } from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";
import {
  AgentError,
  errors,
  MAX_FRAME_BYTES,
  negotiate,
  rpcRequest,
  type ClientCredential,
  type Registration,
  type RpcResponse,
} from "../../contracts/src/index";
import { AgentService } from "./service";
import { ensureIdentity, ipcPath, privateDirectory } from "./security";
import { Store } from "./store";

export class LocalServer {
  private server?: Server;
  readonly sockets = new Set<TLSSocket>();
  constructor(
    readonly service: AgentService,
    readonly directory: string,
  ) {}
  async listen(): Promise<void> {
    const identity = await ensureIdentity(this.directory),
      address = ipcPath(this.directory);
    if (process.platform !== "win32") {
      await privateDirectory(path.dirname(address));
      // Never unlink another live process's endpoint. Stale cleanup belongs to bootstrap.
      try {
        await lstat(address);
        throw new AgentError(
          errors.conflict,
          "Engine endpoint already exists. Run the bootstrap health check.",
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    this.server = createServer(
      {
        key: identity.key,
        cert: identity.cert,
        minVersion: "TLSv1.3",
        handshakeTimeout: 5000,
      },
      (socket) => this.accept(socket),
    );
    this.server.on("tlsClientError", () => {
      /* Protocol errors contain no application data. */
    });
    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(address, () => {
        this.server!.off("error", reject);
        try {
          // Only the process that acquired the one IPC endpoint may recover
          // runs. A second cold-start must never interrupt the live owner.
          this.service.recover();
          resolve();
        } catch (error) {
          this.server!.close();
          reject(error);
        }
      });
    });
    if (process.platform !== "win32") await chmod(address, 0o600);
  }
  private accept(socket: TLSSocket): void {
    this.sockets.add(socket);
    const connection = randomUUID();
    let buffer = Buffer.alloc(0),
      reg: Registration | undefined,
      credential: { id: string; token: string } | undefined;
    const send = (response: RpcResponse) => {
      if (socket.destroyed) return;
      const frame = JSON.stringify(response) + "\n";
      socket.write(Buffer.byteLength(frame) <= MAX_FRAME_BYTES ? frame : JSON.stringify({
        jsonrpc: "2.0", id: response.id,
        error: { code: errors.invalid, message: "Response exceeds the local frame limit. Use the chunked transfer API." },
      }) + "\n");
    };
    socket.on("data", (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      let newline: number;
      while ((newline = buffer.indexOf(10)) !== -1) {
        if (newline + 1 > MAX_FRAME_BYTES) { socket.destroy(); return; }
        const frame = buffer.subarray(0, newline).toString("utf8");
        buffer = buffer.subarray(newline + 1);
        void (async () => {
          let id: string | number | null = null;
          try {
            const request = rpcRequest.parse(JSON.parse(frame));
            id = request.id;
            if (request.method === "authenticate") {
              if (reg)
                throw new AgentError(
                  errors.conflict,
                  "Connection is already authenticated.",
                );
              const p = z
                .object({
                  id: z.string().max(128),
                  token: z.string().max(256),
                  protocol: z.string().max(16),
                })
                .strict()
                .parse(request.params);
              negotiate(p.protocol);
              credential = p;
              reg = this.service.store.authenticate(p.id, p.token);
              send({
                jsonrpc: "2.0",
                id,
                result: { authenticated: true, product: reg.product },
              });
              return;
            }
            if (!reg || !credential)
              throw new AgentError(
                errors.forbidden,
                "Authenticate before requesting data.",
              );
            // Check revocation on every operation, including long-lived connections.
            this.service.store.authenticate(credential.id, credential.token);
            const result = await this.service.dispatch(reg, request.method, request.params, connection);
            send({
              jsonrpc: "2.0",
              id,
              result,
            });
            if (["engine.shutdownIfIdle","engine.stopManagedResourcesForUpdate"].includes(request.method) && (result as { accepted: boolean }).accepted)
              setImmediate(() => { void this.close(); });
          } catch (error) {
            const known = error instanceof AgentError;
            send({
              jsonrpc: "2.0",
              id,
              error: {
                code: known
                  ? error.code
                  : error instanceof z.ZodError
                    ? errors.invalid
                    : -32603,
                message: known
                  ? error.message
                  : error instanceof z.ZodError
                    ? "Invalid Agent API parameters."
                    : "Local engine request failed.",
              },
            });
          }
        })().catch(() => {
          socket.destroy();
        });
      }
      if (buffer.length > MAX_FRAME_BYTES) socket.destroy();
    });
    socket.on("error", () => {});
    socket.on("close", () => {
      this.sockets.delete(socket);
      this.service.disconnect(connection);
    });
  }
  async close(): Promise<void> {
    for (const socket of this.sockets) socket.destroy();
    if (this.server)
      await new Promise<void>((resolve) => this.server!.close(() => resolve()));
    await this.service.close();
  }
}
export async function loadProvisionedClients(
  store: Store,
  directory: string,
): Promise<void> {
  const clients = path.join(directory, "clients");
  await privateDirectory(clients);
  for (const name of await readdir(clients)) {
    if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
    const file = path.join(clients, name),
      info = await lstat(file);
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      info.size > MAX_FRAME_BYTES ||
      (process.getuid && info.uid !== process.getuid())
    )
      throw new Error("Unsafe client registration file.");
    const credential = JSON.parse(
      await readFile(file, "utf8"),
    ) as ClientCredential;
    try { store.register(credential); }
    catch(error) {
      // Immutable adapter upgrades and rollback leave previous enrollment files
      // as history. The current system policy decides which identities load.
      if(error instanceof AgentError && error.code === errors.forbidden)continue;
      throw error;
    }
  }
}
