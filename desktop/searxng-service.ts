import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function configureManagedSearxng(input: {
  enabled: boolean;
  composeFile: string;
  endpoint: string;
}): Promise<void> {
  const endpoint = normalizeSearxngEndpoint(input.endpoint);
  if (input.enabled && await probe(endpoint)) return;
  const args = ["compose", "--project-name", "local-agent-searxng", "--file", input.composeFile];
  if (input.enabled) args.push("up", "--detach", "--remove-orphans");
  else args.push("down", "--remove-orphans");
  try {
    await execFileAsync("docker", args, {
      env: { ...process.env, SEARXNG_SECRET: randomBytes(32).toString("hex") },
      timeout: 120_000,
      maxBuffer: 512_000,
      windowsHide: true,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (/ENOENT|not found/i.test(detail))
      throw new Error("Docker não foi encontrado. Instale e inicie o Docker Desktop para usar pesquisa local.");
    throw new Error(`Não foi possível ${input.enabled ? "iniciar" : "encerrar"} o SearXNG local: ${detail.replace(/\s+/g, " ").slice(0, 600)}`);
  }
  if (input.enabled) {
    const deadline = Date.now() + 25_000;
    while (Date.now() < deadline) {
      if (await probe(endpoint)) return;
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
    throw new Error("O SearXNG foi iniciado, mas não ficou disponível a tempo.");
  }
}

async function probe(endpoint: string): Promise<boolean> {
  try {
    const response = await fetch(endpoint, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(750) });
    return response.status > 0;
  } catch { return false; }
}

function normalizeSearxngEndpoint(value: string): string {
  const url = new URL(value.trim() || "http://127.0.0.1:8080");
  const hostname = url.hostname.toLowerCase();
  if (!["http:", "https:"].includes(url.protocol) || !["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname))
    throw new Error("O endpoint SearXNG deve usar um endereço loopback.");
  if (url.username || url.password || url.search || url.hash)
    throw new Error("O endpoint SearXNG não pode conter credenciais, consulta ou fragmento.");
  url.pathname = url.pathname.replace(/\/+$/, "").replace(/\/search$/i, "");
  return url.toString().replace(/\/$/, "");
}
