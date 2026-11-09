import { AgentError, errors, type Registration } from "../../contracts/src/index";
import { contentHash } from "../../contracts/src/identity";
import type { MemoryEntry, memoryWrite } from "../../contracts/src/memory";
import type { z } from "zod";
import { namespace } from "./security";
import type { Store } from "./store";

export class ProductMemory {
  constructor(private readonly store: Store) {
    store.db.exec(`CREATE TABLE IF NOT EXISTS memory(namespace TEXT NOT NULL,key TEXT NOT NULL,value TEXT NOT NULL,PRIMARY KEY(namespace,key));
      CREATE TABLE IF NOT EXISTS memory_mutations(namespace TEXT NOT NULL,request TEXT NOT NULL,hash TEXT NOT NULL,value TEXT NOT NULL,PRIMARY KEY(namespace,request));`);
  }
  list(reg: Registration): Omit<MemoryEntry, "content">[] {
    return (this.store.db.prepare("SELECT value FROM memory WHERE namespace=? ORDER BY key").all(namespace(reg)) as { value: string }[])
      .map((row) => { const { content: _content, ...metadata } = JSON.parse(row.value) as MemoryEntry; return metadata; });
  }
  get(reg: Registration, key: string): MemoryEntry | undefined {
    const row = this.store.db.prepare("SELECT value FROM memory WHERE namespace=? AND key=?").get(namespace(reg), key) as { value: string } | undefined;
    return row ? JSON.parse(row.value) as MemoryEntry : undefined;
  }
  put(reg: Registration, input: z.infer<typeof memoryWrite>): MemoryEntry {
    return this.store.db.transaction(() => {
      const ns = namespace(reg), hash = contentHash(input);
      const receipt = this.store.db.prepare("SELECT hash,value FROM memory_mutations WHERE namespace=? AND request=?").get(ns, input.requestId) as { hash: string; value: string } | undefined;
      if (receipt) {
        if (receipt.hash !== hash) throw new AgentError(errors.conflict, "Memory request identity was used for different content.");
        return JSON.parse(receipt.value) as MemoryEntry;
      }
      const previous = this.get(reg, input.key);
      if ((previous?.revision ?? 0) !== input.revision) throw new AgentError(errors.conflict, "Memory changed. Refresh before saving.");
      const usage = this.store.db.prepare("SELECT coalesce(sum(length(cast(json_extract(value,'$.content') AS BLOB))),0) AS bytes FROM memory WHERE namespace=?")
        .get(ns) as { bytes: number };
      if (usage.bytes - Buffer.byteLength(previous?.content ?? "") + Buffer.byteLength(input.content) > 2_000_000)
        throw new AgentError(errors.conflict, "The existing 2 MB project-memory limit was reached. Current memory was preserved.");
      const entry: MemoryEntry = { key: input.key, content: input.content, revision: input.revision + 1, updatedAt: Date.now() };
      this.store.db.prepare("INSERT INTO memory VALUES(?,?,?) ON CONFLICT(namespace,key) DO UPDATE SET value=excluded.value").run(ns, input.key, JSON.stringify(entry));
      this.store.db.prepare("INSERT INTO memory_mutations VALUES(?,?,?,?)").run(ns, input.requestId, hash, JSON.stringify(entry));
      return entry;
    })();
  }
}
