import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { chmod, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import type { DesktopModelSettingsInput } from "./contracts";

export type InterfaceModelConfiguration = {
  provider: "ollama" | "openai";
  selectionMode: "optimized" | "custom";
  optimizationProfile: "quality" | "balanced" | "speed";
  webResearch: DesktopModelSettingsInput["webResearch"];
  assignments: DesktopModelSettingsInput["roles"];
  hasApiKey: boolean;
};

type InterfaceBrokerOptions = {
  configuration: () => Promise<InterfaceModelConfiguration>;
  configure: (input: InterfaceModelConfiguration) => Promise<InterfaceModelConfiguration>;
  leaseOpenAi: (targetClientId?: string) => Promise<void>;
  openSettings: () => void;
  descriptorPath?: string;
};

const MAX_BODY_BYTES = 64 * 1024;

function respond(response: import("node:http").ServerResponse, status: number, body: unknown): void {
  const encoded = Buffer.from(JSON.stringify(body));
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": encoded.length,
    "Cache-Control": "no-store",
  });
  response.end(encoded);
}

async function body(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += value.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error("Request exceeds the broker limit."), { status: 413 });
    chunks.push(value);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); }
  catch { throw Object.assign(new Error("Request body must be valid JSON."), { status: 400 }); }
}

export function interfaceBrokerDescriptorPath(): string {
  return path.join(tmpdir(), "local-agent-companion", "interface-broker.json");
}

export async function startInterfaceBroker(options: InterfaceBrokerOptions): Promise<{ close: () => Promise<void>; descriptorPath: string }> {
  const token = randomBytes(32).toString("base64url");
  const descriptorPath = options.descriptorPath ?? interfaceBrokerDescriptorPath();
  let server: Server;
  server = createServer(async (request, response) => {
    try {
      if (request.headers.authorization !== `Bearer ${token}`) return respond(response, 401, { detail: "Unauthorized local interface." });
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (request.method === "GET" && url.pathname === "/v1/model-configuration") {
        return respond(response, 200, await options.configuration());
      }
      if (request.method === "PUT" && url.pathname === "/v1/model-configuration") {
        const input = await body(request) as InterfaceModelConfiguration;
        return respond(response, 200, await options.configure(input));
      }
      if (request.method === "POST" && url.pathname === "/v1/credentials/openai/lease") {
        const input = await body(request) as { targetClientId?: unknown };
        const targetClientId = input.targetClientId;
        if (targetClientId !== undefined && (typeof targetClientId !== "string" || !/^[a-zA-Z0-9_.:-]{1,128}$/.test(targetClientId)))
          throw Object.assign(new Error("Invalid credential delegation target."), { status: 422 });
        await options.leaseOpenAi(targetClientId);
        return respond(response, 202, { accepted: true, expiresInSeconds: 300 });
      }
      if (request.method === "POST" && url.pathname === "/v1/settings/open") {
        options.openSettings();
        return respond(response, 202, { status: "opened" });
      }
      return respond(response, 404, { detail: "Unknown interface broker route." });
    } catch (error) {
      return respond(response, Number((error as { status?: number }).status) || 400, {
        detail: error instanceof Error ? error.message : "Interface broker request failed.",
      });
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Interface broker failed to reserve a loopback port.");
  await mkdir(path.dirname(descriptorPath), { recursive: true, mode: 0o700 });
  const descriptor = {
    protocolVersion: 1,
    baseUrl: `http://127.0.0.1:${address.port}`,
    token,
    pid: process.pid,
    startedAt: new Date().toISOString(),
    service: "companion-interface-broker",
  };
  const prepared = `${descriptorPath}.prepared-${process.pid}`;
  await rm(prepared, { force: true });
  await writeFile(prepared, JSON.stringify(descriptor), { mode: 0o600, flag: "wx" });
  await rename(prepared, descriptorPath);
  if (process.platform !== "win32") await chmod(descriptorPath, 0o600);
  return {
    descriptorPath,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(descriptorPath, { force: true });
    },
  };
}
