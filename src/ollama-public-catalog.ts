import { gatewayFetch, type GatewayTransport } from "./gateway";
import { publicOllamaCatalogSchema } from "./ollama-recommendation";

export const OLLAMA_PUBLIC_CATALOG_URL = "https://raw.githubusercontent.com/rlsgarcia-code/local-agent-companion/main/catalogs/ollama-models.json";
export const OLLAMA_PUBLIC_CATALOG_MAX_BYTES = 512 * 1024;

export type PublicOllamaCatalog = ReturnType<typeof publicOllamaCatalogSchema.parse>;

export async function fetchPublicOllamaCatalog(
  transport?: GatewayTransport
): Promise<PublicOllamaCatalog> {
  const guarded = gatewayFetch(
    OLLAMA_PUBLIC_CATALOG_URL,
    true,
    undefined,
    undefined,
    transport,
    ["GET"]
  );
  const response = await guarded(OLLAMA_PUBLIC_CATALOG_URL, {
    method: "GET",
    headers: { "cache-control": "no-cache", accept: "application/json" }
  });
  if (!response.ok) throw new Error(`O catálogo público Ollama retornou HTTP ${response.status}.`);
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > OLLAMA_PUBLIC_CATALOG_MAX_BYTES) throw new Error("O catálogo público Ollama excede 512 KB.");
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > OLLAMA_PUBLIC_CATALOG_MAX_BYTES) throw new Error("O catálogo público Ollama excede 512 KB.");
  return publicOllamaCatalogSchema.parse(JSON.parse(text) as unknown);
}
