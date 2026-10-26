import { fetch as undiciFetch } from "undici";

export const OFFICIAL_MCP_REGISTRY = "https://registry.modelcontextprotocol.io/v0.1/servers?limit=100";
export const MCP_CATALOG_SOURCES_KEY = "localAgentCompanion.mcpCatalogSources.v1";
export const MCP_CATALOG_ENTRIES_KEY = "localAgentCompanion.mcpCatalogEntries.v1";

export type McpCatalogSource = {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  kind: "official" | "custom";
  updatedAt?: number;
  error?: string;
};

export type McpCatalogEntry = {
  id: string;
  name: string;
  title?: string;
  description?: string;
  version?: string;
  sourceId: string;
  sourceName: string;
  repository?: string;
  packages?: unknown[];
  remotes?: unknown[];
  status?: string;
  updatedAt: number;
};

export const defaultMcpCatalogSources: McpCatalogSource[] = [{
  id: "official-mcp-registry",
  name: "Official MCP Registry",
  url: OFFICIAL_MCP_REGISTRY,
  enabled: false,
  kind: "official"
}];

function sourceUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("MCP catalog sources require HTTPS.");
  if (url.username || url.password || url.hash) throw new Error("MCP catalog URLs cannot contain credentials or fragments.");
  return url;
}

function normalizeEntry(value: unknown, source: McpCatalogSource): McpCatalogEntry | undefined {
  if (!value || typeof value !== "object") return undefined;
  const item = value as Record<string, unknown>;
  const name = typeof item.name === "string" ? item.name.trim().slice(0, 240) : "";
  if (!name) return undefined;
  return {
    id: `${source.id}:${name}`,
    name,
    ...(typeof item.title === "string" ? { title: item.title.slice(0, 240) } : {}),
    ...(typeof item.description === "string" ? { description: item.description.slice(0, 2_000) } : {}),
    ...(typeof item.version === "string" ? { version: item.version.slice(0, 80) } : {}),
    sourceId: source.id,
    sourceName: source.name,
    ...(typeof item.repository === "string" ? { repository: item.repository.slice(0, 1_000) } : {}),
    ...(Array.isArray(item.packages) ? { packages: item.packages.slice(0, 20) } : {}),
    ...(Array.isArray(item.remotes) ? { remotes: item.remotes.slice(0, 20) } : {}),
    ...(typeof item.status === "string" ? { status: item.status.slice(0, 80) } : {}),
    updatedAt: Date.now()
  };
}

export async function fetchMcpCatalog(source: McpCatalogSource): Promise<McpCatalogEntry[]> {
  const url = sourceUrl(source.url);
  const entries: McpCatalogEntry[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 100; page += 1) {
    const pageUrl = new URL(url.href);
    if (cursor) pageUrl.searchParams.set("cursor", cursor);
    const response = await undiciFetch(pageUrl, { redirect: "manual", headers: { accept: "application/json", "cache-control": "no-cache" } });
    if (response.status >= 300 && response.status < 400) throw new Error("MCP catalog redirects are disabled; configure the final HTTPS URL.");
    if (!response.ok) throw new Error(`MCP catalog returned HTTP ${response.status}.`);
    const payload = await response.json() as unknown;
    const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : undefined;
    const values: unknown[] = Array.isArray(payload) ? payload : Array.isArray(record?.servers) ? record.servers as unknown[] : [];
    entries.push(...values.map((item) => normalizeEntry(item, source)).filter((item): item is McpCatalogEntry => Boolean(item)));
    const metadata = record?.metadata && typeof record.metadata === "object" ? record.metadata as Record<string, unknown> : undefined;
    const next = typeof metadata?.nextCursor === "string" ? metadata.nextCursor : undefined;
    if (!next || !values.length || Array.isArray(payload)) break;
    cursor = next;
    if (entries.length >= 10_000) break;
  }
  return entries.slice(0, 10_000);
}

export function searchMcpCatalog(entries: readonly McpCatalogEntry[], query: string): McpCatalogEntry[] {
  const terms = query.toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u).filter((term) => term.length > 2);
  if (!terms.length) return [];
  return entries.map((entry) => {
    const text = [entry.name, entry.title, entry.description, entry.repository, entry.sourceName].filter(Boolean).join(" ").toLocaleLowerCase();
    const score = terms.reduce((total, term) => total + (text.includes(term) ? (entry.name.toLocaleLowerCase().includes(term) ? 3 : 1) : 0), 0);
    return { entry, score };
  }).filter((item) => item.score > 0).sort((left, right) => right.score - left.score || left.entry.name.localeCompare(right.entry.name)).slice(0, 12).map((item) => item.entry);
}
