import { withOfflineTokenCounting } from "./offline-token-count";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { ChatOpenAICompletions } from "@langchain/openai";
import type { OllamaModel, PullProgress } from "../../contracts/src/desktop";

const OLLAMA_ORIGIN = "http://127.0.0.1:11434";
const OLLAMA_API_BASE = `${OLLAMA_ORIGIN}/v1`;
export const MODEL_NAME = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;

export class OllamaModels {
  private pullController?: AbortController;
  public get downloading(): boolean { return Boolean(this.pullController); }
  public cancelDownload(): void { this.pullController?.abort(); }
  public async ollamaStatus(): Promise<{
    connected: boolean;
    version?: string;
    models: OllamaModel[];
    error?: string;
  }> {
    try {
      const [versionResponse, modelsResponse] = await Promise.all([
        loopbackFetch(`${OLLAMA_ORIGIN}/api/version`, {
          signal: AbortSignal.timeout(3_000),
        }),
        loopbackFetch(`${OLLAMA_ORIGIN}/api/tags`, {
          signal: AbortSignal.timeout(5_000),
        }),
      ]);
      if (!modelsResponse.ok)
        throw new Error(`Ollama returned HTTP ${modelsResponse.status}.`);
      const modelsPayload = (await modelsResponse.json()) as {
        models?: Array<{ name?: string; size?: number; modified_at?: string }>;
      };
      const versionPayload = versionResponse.ok
        ? ((await versionResponse.json()) as { version?: string })
        : {};
      const models: OllamaModel[] = [];
      for (const item of modelsPayload.models ?? []) {
        if (typeof item.name !== "string") continue;
        const metadata = await this.inspectModel(item.name);
        models.push({
          name: item.name,
          size: typeof item.size === "number" ? item.size : 0,
          modifiedAt: item.modified_at,
          ...metadata,
        });
      }
      return {
        connected: true,
        version: versionPayload.version,
        models: models.sort((left, right) =>
          left.name.localeCompare(right.name),
        ),
      };
    } catch (error) {
      return {
        connected: false,
        models: [],
        error:
          error instanceof Error ? error.message : "Ollama is unavailable.",
      };
    }
  }

  public async invokeAdvisor(
    modelName: string,
    prompt: string,
    signal: AbortSignal,
  ): Promise<string> {
    if (!MODEL_NAME.test(modelName))
      throw new Error("Choose a valid installed Ollama advisor model.");
    const model = this.createModel(modelName, false, 10 * 60_000);
    const response = await model.invoke(
      [
        new SystemMessage(
          "You are a local Ollama setup advisor. Return only the requested JSON object.",
        ),
        new HumanMessage(prompt),
      ],
      { signal },
    );
    return response.text;
  }

  public async pullModel(
    model: string,
    onProgress: (progress: PullProgress) => void,
  ): Promise<void> {
    if (!MODEL_NAME.test(model)) throw new Error("Invalid Ollama model name.");
    if (this.pullController)
      throw new Error("Outro modelo já está sendo baixado.");
    this.pullController = new AbortController();
    try {
      await pullOllamaModel(model, onProgress, this.pullController.signal);
    } finally {
      this.pullController = undefined;
    }
  }

  protected createModel(
    modelName: string,
    streaming: boolean,
    timeout = 120_000,
  ): ChatOpenAICompletions {
    if (!MODEL_NAME.test(modelName))
      throw new Error(`Invalid Ollama model alias: ${modelName}`);
    return withOfflineTokenCounting(new ChatOpenAICompletions({
      model: modelName,
      apiKey: "ollama-local",
      streaming,
      disableStreaming: !streaming,
      streamUsage: true,
      maxRetries: streaming ? 0 : 1,
      timeout,
      configuration: { baseURL: OLLAMA_API_BASE, fetch: loopbackFetch },
    }), modelName);
  }

  private async inspectModel(
    name: string,
  ): Promise<Pick<OllamaModel, "capabilities" | "contextLength">> {
    try {
      const response = await loopbackFetch(`${OLLAMA_ORIGIN}/api/show`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: name, verbose: true }),
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) return {};
      const payload = (await response.json()) as {
        capabilities?: unknown;
        model_info?: unknown;
      };
      const capabilities = Array.isArray(payload.capabilities)
        ? payload.capabilities
            .filter((value): value is string => typeof value === "string")
            .slice(0, 20)
        : [];
      const info =
        payload.model_info && typeof payload.model_info === "object"
          ? (payload.model_info as Record<string, unknown>)
          : {};
      const contextLength = Object.entries(info).find(
        ([key, value]) =>
          /context_length$/i.test(key) && typeof value === "number",
      )?.[1];
      return {
        ...(capabilities.length ? { capabilities } : {}),
        ...(typeof contextLength === "number" ? { contextLength } : {}),
      };
    } catch {
      return {};
    }
  }
}

type OllamaPullEvent = {
  status?: unknown;
  error?: unknown;
  completed?: unknown;
  total?: unknown;
};

type OllamaFetch = (input: string, init?: RequestInit) => Promise<Response>;

export async function pullOllamaModel(
  model: string,
  onProgress: (progress: PullProgress) => void,
  signal: AbortSignal,
  request: OllamaFetch = loopbackFetch,
): Promise<void> {
  let completed = false;
  try {
    const response = await request(`${OLLAMA_ORIGIN}/api/pull`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, stream: true }),
      redirect: "error",
      signal,
    });
    if (!response.ok) {
      const detail = (await response.text()).trim().slice(0, 500);
      throw new Error(
        `Ollama returned HTTP ${response.status}${detail ? `: ${detail}` : "."}`,
      );
    }
    if (!response.body)
      throw new Error("Ollama did not return a download stream.");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffered = "";
    const consume = (line: string): void => {
      if (!line.trim()) return;
      let event: OllamaPullEvent;
      try {
        event = JSON.parse(line) as OllamaPullEvent;
      } catch {
        throw new Error("Ollama returned an invalid download progress event.");
      }
      if (typeof event.error === "string" && event.error.trim())
        throw new Error(event.error.trim());
      const status =
        typeof event.status === "string" && event.status.trim()
          ? event.status.trim().slice(0, 512)
          : "Downloading model";
      const total =
        typeof event.total === "number" && event.total > 0
          ? event.total
          : undefined;
      const current =
        typeof event.completed === "number" && event.completed >= 0
          ? event.completed
          : undefined;
      const percent =
        total !== undefined && current !== undefined
          ? ` · ${Math.min(100, Math.round((current / total) * 100))}%`
          : "";
      completed = status.toLowerCase() === "success";
      onProgress({
        model,
        line: completed ? "Modelo pronto" : `${status}${percent}`,
        done: completed,
      });
    };

    try { while (true) {
      const { value, done } = await reader.read();
      buffered += decoder.decode(value, { stream: !done });
      const lines = buffered.split("\n");
      buffered = lines.pop() ?? "";
      if (buffered.length > 65_536 || lines.some((line) => line.length > 65_536)) throw new Error("Ollama download progress exceeded its size limit.");
      for (const line of lines) consume(line);
      if (done) break;
    } } finally { await reader.cancel().catch(() => {}); }
    consume(buffered);
    if (!completed) throw new Error("Ollama ended the download without confirming success. Check the installed models before retrying.");
  } catch (error) {
    const message = signal.aborted
      ? "Download cancelado."
      : error instanceof Error
        ? error.message
        : "Não foi possível baixar o modelo pelo Ollama local.";
    onProgress({ model, line: message, done: true, error: message });
    throw new Error(message, { cause: error });
  }
}

async function loopbackFetch(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  const url = new URL(
    typeof input === "string" || input instanceof URL
      ? input.toString()
      : input.url,
  );
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    url.port !== "11434"
  ) {
    throw new Error(
      "The desktop Ollama build permits only http://127.0.0.1:11434.",
    );
  }
  return fetch(url, { ...init, redirect: "error" });
}
