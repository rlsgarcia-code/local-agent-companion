import type { StructuredToolInterface } from "@langchain/core/tools";
import { loadMcpTools } from "@langchain/mcp-adapters";
import { Client, StreamableHTTPClientTransport, UnauthorizedError } from "@modelcontextprotocol/client";
import { Agent as UndiciAgent } from "undici";
import * as vscode from "vscode";
import { requestLocalApproval } from "./local-approval";
import {
  mcpConnectionDescription,
  mcpSecretStorageKey,
  type McpConnectionProfile,
  type McpConnectionSnapshot,
  type McpHttpConnectionProfile,
  type McpStdioConnectionProfile,
  normalizeMcpCommand,
  normalizeMcpEndpoint,
  normalizeMcpEnvironment,
  normalizeMcpServerName,
  parseStoredMcpProfiles,
  safeMcpToolPrefix,
  validateMcpArgument,
  validateMcpEnvironmentName,
  validateMcpHeaderName,
  validateMcpHeaderValue,
  validateMcpStdioLaunch,
  validateMcpToolName
} from "./mcp-config";
import { mcpFetch } from "./mcp-transport";
import { McpOAuthProvider } from "./mcp-oauth";
import { connectStdioMcpClient } from "./mcp-stdio";
import { redactSensitiveText, safeErrorMessage } from "./redaction";
import type { AgentUiEvent, RunMode } from "./types";

const MCP_PROFILES_KEY = "localAgentCompanion.mcpConnections.v1";

type McpConnectionInputBase = {
  id?: string;
  name: string;
  enabled: boolean;
  secrets: Record<string, string>;
  tools: string[];
};

export type SaveMcpConnectionInput = McpConnectionInputBase & ({
  transport: "http";
  url: string;
  headers: Record<string, string>;
} | {
  transport: "stdio";
  command: string;
  args: string[];
  env: Record<string, string>;
});

export type McpConnectionTest = {
  profile: McpConnectionSnapshot;
  discoveredTools: string[];
  enabledTools: string[];
};

export type McpRunSession = {
  tools: StructuredToolInterface[];
  sensitiveValues: string[];
  close(): Promise<void>;
};

type ResolvedMcpConnection = {
  values: Record<string, string>;
  sensitiveValues: string[];
};

const oauthProviders = new WeakMap<Client, McpOAuthProvider>();

async function closeMcpClient(client: Client): Promise<void> {
  await client.close().catch(() => undefined);
  const provider = oauthProviders.get(client);
  oauthProviders.delete(client);
  await provider?.close().catch(() => undefined);
}

export class CorporateMcpManager {
  public constructor(private readonly context: vscode.ExtensionContext) {}

  public async snapshots(): Promise<McpConnectionSnapshot[]> {
    const profiles = this.profiles();
    return Promise.all(profiles.map(async (profile) => ({
      ...profile,
      missingSecrets: (await Promise.all(profileSecretDescriptors(profile).map(async ({ label, storageName }) => ({
        label,
        present: Boolean(await this.context.secrets.get(mcpSecretStorageKey(profile.id, storageName)))
      })))).filter(({ present }) => !present).map(({ label }) => label)
    })));
  }

  public async save(input: SaveMcpConnectionInput): Promise<McpConnectionSnapshot> {
    const id = input.id ?? crypto.randomUUID();
    const profile = normalizeConnectionInput(input, id, true);
    const current = this.profiles();
    const previous = current.find((candidate) => candidate.id === id);
    const next = [profile, ...current.filter((candidate) => candidate.id !== id)].slice(0, 20);
    await this.context.workspaceState.update(MCP_PROFILES_KEY, next);
    const incomingSecrets = inputSecretEntries(input);
    await Promise.all(incomingSecrets.map(async ({ storageName, value }) => {
      const normalized = value.trim();
      if (normalized) await this.context.secrets.store(mcpSecretStorageKey(id, storageName), normalized);
    }));
    if (previous) {
      const retained = new Set(profileSecretDescriptors(profile).map(({ storageName }) => storageName.toLowerCase()));
      const removed = profileSecretDescriptors(previous).filter(({ storageName }) => !retained.has(storageName.toLowerCase()));
      await Promise.all(removed.map(({ storageName }) => this.context.secrets.delete(mcpSecretStorageKey(id, storageName))));
    }
    return (await this.snapshots()).find((candidate) => candidate.id === id)!;
  }

  public async discover(
    input: SaveMcpConnectionInput,
    dispatcher?: UndiciAgent,
    signal?: AbortSignal,
    stdioCaPath?: string
  ): Promise<string[]> {
    const profile = normalizeConnectionInput(input, input.id ?? crypto.randomUUID(), false);
    const resolved = resolveInputValues(profile, input.secrets);
    const client = await this.connect(profile, resolved, dispatcher, signal, stdioCaPath);
    try {
      return (await client.listTools(undefined, { signal })).tools.map(({ name }) => name).sort();
    } catch (error) {
      throw new Error(safeErrorMessage(error, resolved.sensitiveValues));
    } finally {
      await closeMcpClient(client);
    }
  }

  public async setEnabled(id: string, enabled: boolean): Promise<void> {
    const profiles = this.profiles();
    const profile = profiles.find((candidate) => candidate.id === id);
    if (!profile) throw new Error("The MCP connection no longer exists.");
    profile.enabled = enabled;
    profile.updatedAt = Date.now();
    await this.context.workspaceState.update(MCP_PROFILES_KEY, profiles);
  }

  public async remove(id: string): Promise<void> {
    const profiles = this.profiles();
    const profile = profiles.find((candidate) => candidate.id === id);
    if (!profile) return;
    await this.context.workspaceState.update(MCP_PROFILES_KEY, profiles.filter((candidate) => candidate.id !== id));
    await Promise.all(profileSecretDescriptors(profile).map(({ storageName }) => (
      this.context.secrets.delete(mcpSecretStorageKey(id, storageName))
    )));
  }

  public async test(
    id: string,
    dispatcher?: UndiciAgent,
    signal?: AbortSignal,
    stdioCaPath?: string
  ): Promise<McpConnectionTest> {
    const profile = (await this.snapshots()).find((candidate) => candidate.id === id);
    if (!profile) throw new Error("The MCP connection no longer exists.");
    if (profile.missingSecrets.length) {
      throw new Error(`Add the missing MCP credentials: ${profile.missingSecrets.join(", ")}.`);
    }
    const resolved = await this.resolvedStoredValues(profile);
    const client = await this.connect(profile, resolved, dispatcher, signal, stdioCaPath);
    try {
      const discovered = (await client.listTools(undefined, { signal })).tools.map(({ name }) => name).sort();
      return {
        profile,
        discoveredTools: discovered,
        enabledTools: profile.tools.filter((tool) => discovered.includes(tool))
      };
    } catch (error) {
      throw new Error(safeErrorMessage(error, resolved.sensitiveValues));
    } finally {
      await client.close().catch(() => undefined);
    }
  }

  public async createRunSession(options: {
    mode: RunMode;
    dispatcher?: UndiciAgent;
    signal: AbortSignal;
    onEvent: (event: AgentUiEvent) => void;
    onToolUsed?: (name: string) => void;
    sensitiveValues: readonly string[];
    stdioCaPath?: string;
  }): Promise<McpRunSession> {
    if (options.mode === "plan") return emptySession();
    const clients: Client[] = [];
    const tools: StructuredToolInterface[] = [];
    const sensitiveValues: string[] = [];
    for (const profile of (await this.snapshots()).filter((candidate) => candidate.enabled)) {
      if (profile.missingSecrets.length) {
        options.onEvent({
          type: "activity",
          kind: "mcp",
          title: `MCP unavailable · ${profile.name}`,
          detail: `Missing credentials: ${profile.missingSecrets.join(", ")}`
        });
        continue;
      }
      let client: Client | undefined;
      try {
        const resolved = await this.resolvedStoredValues(profile);
        sensitiveValues.push(...resolved.sensitiveValues);
        client = await this.connect(profile, resolved, options.dispatcher, options.signal, options.stdioCaPath);
        const prefix = safeMcpToolPrefix(profile.name);
        const loaded = await loadMcpTools(prefix, client, {
          prefixToolNameWithServerName: true,
          elicitation: false,
          defaultToolTimeout: 120_000,
          outputHandling: {
            text: "content",
            image: "artifact",
            audio: "artifact",
            resource: "artifact",
            resource_link: "artifact"
          },
          beforeToolCall: async ({ name, args }) => {
            const redactionValues = [...options.sensitiveValues, ...sensitiveValues];
            const approved = await requestLocalApproval(options.onEvent, {
              prompt: `Allow the agent to call the corporate MCP tool “${name}”?`,
              action: "Run MCP tool",
              target: mcpApprovalTarget(profile),
              explanation: `${mcpApprovalExplanation(profile)}\n\nArguments:\n${boundedMcpArguments(args, redactionValues)}`,
              risk: "sensitive",
              sensitiveValues: redactionValues
            });
            if (!approved) throw new Error("The user declined this MCP tool call.");
            options.onEvent({ type: "status", label: `Calling ${profile.name} · ${name}` });
          },
          afterToolCall: async ({ name, result }) => {
            options.onToolUsed?.(name);
            options.onEvent({
              type: "activity",
              kind: "mcp",
              title: `MCP completed · ${name}`,
              detail: profile.name
            });
            return {
              result: sanitizeMcpResult(result, [...options.sensitiveValues, ...sensitiveValues])
            };
          }
        });
        const allowlist = new Set(profile.tools.map((name) => `${prefix}_${name}`));
        const allowed = loaded.filter((tool) => allowlist.has(tool.name));
        tools.push(...allowed);
        clients.push(client);
        client = undefined;
        options.onEvent({
          type: "activity",
          kind: "mcp",
          title: `MCP connected · ${profile.name}`,
          detail: `${allowed.length} approved tool${allowed.length === 1 ? "" : "s"} available`
        });
      } catch (error) {
        if (client) await closeMcpClient(client);
        options.onEvent({
          type: "activity",
          kind: "mcp",
          title: `MCP unavailable · ${profile.name}`,
          detail: safeErrorMessage(error, [...options.sensitiveValues, ...sensitiveValues])
        });
      }
    }
    return {
      tools,
      sensitiveValues,
      async close() {
        await Promise.all(clients.map((client) => closeMcpClient(client)));
      }
    };
  }

  private profiles(): McpConnectionProfile[] {
    return parseStoredMcpProfiles(this.context.workspaceState.get<unknown>(MCP_PROFILES_KEY));
  }

  private async resolvedStoredValues(profile: McpConnectionProfile): Promise<ResolvedMcpConnection> {
    const values = profile.transport === "http" ? { ...profile.headers } : { ...profile.env };
    const sensitiveValues: string[] = [];
    for (const { label, storageName } of profileSecretDescriptors(profile)) {
      const secret = await this.context.secrets.get(mcpSecretStorageKey(profile.id, storageName));
      if (!secret) throw new Error(`Missing credential for MCP ${profile.transport === "http" ? "header" : "environment variable"} ${label}.`);
      values[label] = secret;
      sensitiveValues.push(secret, secret.replace(/^Bearer\s+/i, ""));
    }
    return { values, sensitiveValues: sensitiveValues.filter(Boolean) };
  }

  private async connect(
    profile: McpConnectionProfile,
    resolved: ResolvedMcpConnection,
    dispatcher?: UndiciAgent,
    signal?: AbortSignal,
    stdioCaPath?: string
  ): Promise<Client> {
    if (profile.transport === "stdio") {
      const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!workspace) throw new Error("Open a workspace before starting a local MCP server.");
      return connectStdioMcpClient({
        command: profile.command,
        args: profile.args,
        env: {
          ...resolved.values
        },
        workspace,
        signal,
        caCertificatePath: stdioCaPath,
        sensitiveValues: resolved.sensitiveValues
      });
    }
    const oauth = new McpOAuthProvider(this.context, profile.id, new URL(profile.url));
    await oauth.start();
    const createTransport = () => new StreamableHTTPClientTransport(new URL(profile.url), {
      authProvider: oauth,
      requestInit: { headers: resolved.values, redirect: "manual" },
      redirectPolicy: "same-origin",
      reconnectionOptions: {
        maxRetries: 0,
        initialReconnectionDelay: 1_000,
        maxReconnectionDelay: 30_000,
        reconnectionDelayGrowFactor: 1.5
      },
      fetch: mcpFetch(profile.url, dispatcher, signal, undefined, { allowOAuthEndpoints: true })
    });
    const client = new Client({ name: "local-agent-companion", version: "0.11.0" });
    let transport = createTransport();
    try {
      await client.connect(transport, { signal, timeout: 30_000 });
      oauthProviders.set(client, oauth);
      return client;
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        try {
          await oauth.finishAuthorization(transport);
        } catch (authorizationError) {
          await client.close().catch(() => undefined);
          await oauth.close();
          throw new Error(safeErrorMessage(authorizationError, resolved.sensitiveValues));
        }
        await client.close().catch(() => undefined);
        const retryClient = new Client({ name: "local-agent-companion", version: "0.11.0" });
        transport = createTransport();
        try {
          await retryClient.connect(transport, { signal, timeout: 30_000 });
          oauthProviders.set(retryClient, oauth);
          return retryClient;
        } catch (retryError) {
          await retryClient.close().catch(() => undefined);
          await oauth.close();
          throw retryError;
        }
      }
      await client.close().catch(() => undefined);
      await oauth.close();
      throw new Error(safeErrorMessage(error, resolved.sensitiveValues));
    }
  }
}

function normalizeConnectionInput(
  input: SaveMcpConnectionInput,
  id: string,
  requireTools: boolean
): McpConnectionProfile {
  const common = {
    id,
    name: normalizeMcpServerName(input.name),
    enabled: input.enabled,
    tools: [...new Set(input.tools.map(validateMcpToolName))].slice(0, 200),
    updatedAt: Date.now()
  };
  if (requireTools && !common.tools.length) throw new Error("Choose at least one MCP tool to expose to the agent.");
  if (input.transport === "stdio") {
    const command = normalizeMcpCommand(input.command);
    const args = input.args.map(validateMcpArgument);
    validateMcpStdioLaunch(command, args);
    return {
      ...common,
      transport: "stdio",
      command,
      args,
      env: normalizeMcpEnvironment(input.env),
      secretEnvironment: [...new Set(Object.keys(input.secrets).map(validateMcpEnvironmentName))]
    } satisfies McpStdioConnectionProfile;
  }
  return {
    ...common,
    transport: "http",
    url: normalizeMcpEndpoint(input.url),
    headers: Object.fromEntries(Object.entries(input.headers).map(([name, value]) => [
      validateMcpHeaderName(name),
      validateMcpHeaderValue(value)
    ]).filter(([, value]) => Boolean(value))),
    secretHeaders: [...new Set(Object.keys(input.secrets).map(validateMcpHeaderName))]
  } satisfies McpHttpConnectionProfile;
}

function inputSecretEntries(input: SaveMcpConnectionInput): Array<{ storageName: string; value: string }> {
  return Object.entries(input.secrets).map(([name, value]) => ({
    storageName: input.transport === "stdio" ? `env:${name}` : name,
    value
  }));
}

function profileSecretDescriptors(profile: McpConnectionProfile): Array<{ label: string; storageName: string }> {
  return profile.transport === "stdio"
    ? profile.secretEnvironment.map((name) => ({ label: name, storageName: `env:${name}` }))
    : profile.secretHeaders.map((name) => ({ label: name, storageName: name }));
}

function resolveInputValues(profile: McpConnectionProfile, secrets: Record<string, string>): ResolvedMcpConnection {
  const values = profile.transport === "http" ? { ...profile.headers } : { ...profile.env };
  const sensitiveValues: string[] = [];
  for (const [name, rawSecret] of Object.entries(secrets)) {
    const secret = rawSecret.trim();
    if (!secret) throw new Error(`Enter the MCP credential ${name} before testing the connection.`);
    values[name] = secret;
    sensitiveValues.push(secret, secret.replace(/^Bearer\s+/i, ""));
  }
  return { values, sensitiveValues: sensitiveValues.filter(Boolean) };
}

function mcpApprovalTarget(profile: McpConnectionProfile): string {
  return profile.transport === "http"
    ? `${profile.name} · ${new URL(profile.url).host}`
    : `${profile.name} · local ${profile.command}`;
}

function mcpApprovalExplanation(profile: McpConnectionProfile): string {
  if (profile.transport === "http") {
    return "The request is sent only to this configured HTTPS MCP route. Its result may be included in the next request to your configured model provider.";
  }
  return `The tool runs through the approved local MCP process “${mcpConnectionDescription(profile)}”. The process may access files, applications, or networks according to that tool. Its result may be included in the next request to your configured model provider.`;
}

function emptySession(): McpRunSession {
  return { tools: [], sensitiveValues: [], close: async () => undefined };
}

function boundedMcpArguments(args: unknown, sensitiveValues: readonly string[]): string {
  try {
    return redactSensitiveText(JSON.stringify(args, null, 2), sensitiveValues).slice(0, 2_000) || "{}";
  } catch {
    return "[arguments could not be displayed safely]";
  }
}

function sanitizeMcpResult(
  result: readonly [string | McpContentBlock[], unknown[]],
  sensitiveValues: readonly string[]
): [string | McpContentBlock[], []] {
  const [content] = result;
  if (typeof content === "string") {
    return [boundedMcpText(content, sensitiveValues), []];
  }
  let remaining = 30_000;
  const sanitized = content.flatMap((block) => {
    if (block.type !== "text" || typeof block.text !== "string" || remaining <= 0) return [];
    const text = redactSensitiveText(block.text, sensitiveValues).slice(0, remaining);
    remaining -= text.length;
    return [{ ...block, text }];
  });
  return [sanitized, []];
}

type McpContentBlock = {
  type: string;
  id?: string;
  [key: string]: unknown;
};

function boundedMcpText(value: string, sensitiveValues: readonly string[]): string {
  const redacted = redactSensitiveText(value, sensitiveValues);
  return redacted.length <= 30_000
    ? redacted
    : `${redacted.slice(0, 30_000)}\n\n[MCP output truncated locally]`;
}
