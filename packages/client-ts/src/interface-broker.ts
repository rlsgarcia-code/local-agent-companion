import { lstat, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ModelConfiguration } from "../../contracts/src/index";

export type InterfaceModelConfiguration = {
  provider: "ollama" | "openai";
  selectionMode: "optimized" | "custom";
  optimizationProfile: "quality" | "balanced" | "speed";
  assignments: ModelConfiguration["roles"];
  hasApiKey: boolean;
};

type BrokerDescriptor = {
  protocolVersion: 1;
  baseUrl: string;
  token: string;
  service: "companion-interface-broker";
};

export function interfaceBrokerDescriptorPath(): string {
  return path.join(tmpdir(), "local-agent-companion", "interface-broker.json");
}

async function descriptor(file: string): Promise<BrokerDescriptor> {
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size <= 0 || info.size > 16_384 ||
      process.platform !== "win32" && (info.mode & 0o077) !== 0 || process.getuid && info.uid !== process.getuid())
    throw new Error("The Companion interface broker descriptor is not trusted.");
  const value = JSON.parse(await readFile(file, "utf8")) as Partial<BrokerDescriptor>;
  const url = new URL(String(value.baseUrl ?? ""));
  if (value.protocolVersion !== 1 || value.service !== "companion-interface-broker" ||
      url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port || url.pathname !== "/" ||
      typeof value.token !== "string" || value.token.length < 32)
    throw new Error("The Companion interface broker descriptor is incompatible.");
  return value as BrokerDescriptor;
}

export class CompanionInterfaceBroker {
  private constructor(private readonly value: BrokerDescriptor) {}

  static async connect(file = interfaceBrokerDescriptorPath()): Promise<CompanionInterfaceBroker> {
    return new CompanionInterfaceBroker(await descriptor(path.resolve(file)));
  }

  private async request<T>(route: string, method = "GET", body?: unknown): Promise<T> {
    const response = await fetch(`${this.value.baseUrl}${route}`, {
      method,
      headers: {
        authorization: `Bearer ${this.value.token}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(120_000),
    });
    const payload = await response.json().catch(() => ({})) as { detail?: unknown };
    if (!response.ok)
      throw new Error(typeof payload.detail === "string" ? payload.detail : "The Companion interface broker rejected the request.");
    return payload as T;
  }

  modelConfiguration(): Promise<InterfaceModelConfiguration> {
    return this.request("/v1/model-configuration");
  }

  configureModels(input: InterfaceModelConfiguration): Promise<InterfaceModelConfiguration> {
    return this.request("/v1/model-configuration", "PUT", input);
  }

  async leaseOpenAiCredential(targetClientId: string): Promise<void> {
    if (!/^[a-zA-Z0-9_.:-]{1,128}$/.test(targetClientId)) throw new Error("Invalid Companion client identity.");
    await this.request("/v1/credentials/openai/lease", "POST", { targetClientId });
  }

  async openSettings(): Promise<void> {
    await this.request("/v1/settings/open", "POST");
  }
}
