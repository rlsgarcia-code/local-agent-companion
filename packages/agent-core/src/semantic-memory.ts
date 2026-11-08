import { createHash } from "node:crypto";
import { Chroma } from "@langchain/community/vectorstores/chroma";
import { Document } from "@langchain/core/documents";
import { OpenAIEmbeddings } from "@langchain/openai";
import { LocalChromaServer } from "../../adapter-workspace/src/chroma";
import { memoryChunks } from "./memory-chunks";

export type SemanticMemoryOptions = {
  query: string;
  memoryText: string;
  embeddingModel: string;
  embeddingsBaseUrl: string;
  apiKey: string;
  defaultHeaders?: Record<string, string | null>;
  fetch?: typeof globalThis.fetch;
  results: number;
  signal?: AbortSignal;
};

export class SemanticProjectMemory {
  private readonly server: LocalChromaServer;
  private readonly indexedCollections = new Map<string, string>();

  public constructor(private readonly options: { workspaceId: string; storageRoot: string; launcher: string }) {
    this.server = new LocalChromaServer(options);
  }

  public async recall(options: SemanticMemoryOptions): Promise<string[]> {
    options.signal?.throwIfAborted();
    const model = options.embeddingModel.trim();
    if (!model) return [];
    const chunks = memoryChunks(options.memoryText);
    if (!chunks.length) return [];

    const endpoint = await this.server.start();
    options.signal?.throwIfAborted();
    const workspaceId = createHash("sha256")
      .update(this.options.workspaceId)
      .digest("hex")
      .slice(0, 20);
    const modelId = createHash("sha256").update(`${model}\0${options.embeddingsBaseUrl}`).digest("hex").slice(0, 12);
    const collectionName = `local-memory-${workspaceId}-${modelId}`;
    const embeddings = new OpenAIEmbeddings({
      model,
      apiKey: options.apiKey,
      batchSize: 64,
      maxConcurrency: 2,
      configuration: {
        baseURL: options.embeddingsBaseUrl,
        ...(options.defaultHeaders ? { defaultHeaders: options.defaultHeaders } : {}),
        ...(options.fetch ? { fetch: options.fetch } : {})
      }
    });
    const store = new Chroma(embeddings, {
      url: endpoint,
      collectionName
    });

    const memoryHash = createHash("sha256").update(options.memoryText).digest("hex");
    if (this.indexedCollections.get(collectionName) !== memoryHash) {
      await store.delete({ filter: { workspace_id: workspaceId } }).catch(() => undefined);
      options.signal?.throwIfAborted();
      const documents = chunks.map((pageContent, index) => new Document({
        pageContent,
        metadata: { workspace_id: workspaceId, source: ".local-agent/memory.md", chunk: index }
      }));
      const ids = chunks.map((chunk, index) => createHash("sha256")
        .update(`${workspaceId}\0${modelId}\0${index}\0${chunk}`)
        .digest("hex"));
      await store.addDocuments(documents, { ids });
      options.signal?.throwIfAborted();
      this.indexedCollections.set(collectionName, memoryHash);
    }

    options.signal?.throwIfAborted();
    const matches = await store.similaritySearch(options.query, Math.max(1, Math.min(options.results, 12)), {
      workspace_id: workspaceId
    });
    options.signal?.throwIfAborted();
    return matches.map((match) => match.pageContent.trim()).filter(Boolean);
  }

  public dispose(): void {
    this.indexedCollections.clear();
    this.server.dispose();
  }
}
