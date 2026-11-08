import { createHash, randomUUID } from "node:crypto";
import { AgentError, errors, type Registration } from "../../contracts/src/index";
import { TRANSFER_CHUNK_BYTES, type Transfer, type transferBegin } from "../../contracts/src/transfers";
import type { z } from "zod";
import { namespace } from "./security";
import type { Store } from "./store";

/** Private, resumable, bounded transfers. No client path ever reaches the filesystem. */
export class Transfers {
  constructor(private readonly store: Store) {
    store.db.exec(`
      CREATE TABLE IF NOT EXISTS transfers(id TEXT PRIMARY KEY, namespace TEXT NOT NULL, key TEXT NOT NULL, size INTEGER NOT NULL,
        sha256 TEXT NOT NULL, mime TEXT NOT NULL, received INTEGER NOT NULL DEFAULT 0, committed INTEGER NOT NULL DEFAULT 0,
        UNIQUE(namespace,key));
      CREATE TABLE IF NOT EXISTS transfer_parts(id TEXT NOT NULL REFERENCES transfers(id) ON DELETE CASCADE,
        offset INTEGER NOT NULL, data BLOB NOT NULL, PRIMARY KEY(id,offset));
    `);
  }
  get(reg: Registration, id: string): Transfer {
    const row = this.store.db.prepare("SELECT id,key,size,sha256,mime,received,committed FROM transfers WHERE namespace=? AND id=?")
      .get(namespace(reg), id) as (Omit<Transfer, "committed"> & { committed: number }) | undefined;
    if (!row) throw new AgentError(errors.missing, "Transfer not found in this namespace.");
    return { ...row, committed: Boolean(row.committed) };
  }
  begin(reg: Registration, spec: z.infer<typeof transferBegin>): Transfer {
    return this.store.db.transaction(() => {
      const previous = this.store.db.prepare("SELECT id FROM transfers WHERE namespace=? AND key=?").get(namespace(reg), spec.key) as { id: string } | undefined;
      if (previous) {
        const transfer = this.get(reg, previous.id);
        if (transfer.size !== spec.size || transfer.sha256 !== spec.sha256 || transfer.mime !== spec.mime)
          throw new AgentError(errors.conflict, "Transfer key was used for different content.");
        return transfer;
      }
      const usage = this.store.db.prepare("SELECT coalesce(sum(size),0) AS bytes FROM transfers WHERE namespace=?").get(namespace(reg)) as { bytes: number };
      if (usage.bytes + spec.size > 768 * 1024 * 1024)
        throw new AgentError(errors.conflict, "Transfer storage limit reached. Export or remove a transfer before retrying; source data was not changed.");
      const id = randomUUID();
      this.store.db.prepare("INSERT INTO transfers(id,namespace,key,size,sha256,mime) VALUES(?,?,?,?,?,?)")
        .run(id, namespace(reg), spec.key, spec.size, spec.sha256, spec.mime);
      return this.get(reg, id);
    })();
  }
  append(reg: Registration, id: string, offset: number, data: Buffer): Transfer {
    return this.store.db.transaction(() => {
      const transfer = this.get(reg, id);
      if (!data.length || data.length > TRANSFER_CHUNK_BYTES || offset + data.length > transfer.size)
        throw new AgentError(errors.invalid, "Invalid transfer chunk size.");
      const prior = this.store.db.prepare("SELECT data FROM transfer_parts WHERE id=? AND offset=?").get(id, offset) as { data: Buffer } | undefined;
      if (prior) {
        if (!prior.data.equals(data)) throw new AgentError(errors.conflict, "Transfer chunk content changed.");
        return transfer;
      }
      if (transfer.committed || offset !== transfer.received)
        throw new AgentError(errors.conflict, "Transfer offset differs from the acknowledged cursor.");
      this.store.db.prepare("INSERT INTO transfer_parts VALUES(?,?,?)").run(id, offset, data);
      this.store.db.prepare("UPDATE transfers SET received=received+? WHERE id=?").run(data.length, id);
      return this.get(reg, id);
    })();
  }
  commit(reg: Registration, id: string): Transfer {
    return this.store.db.transaction(() => {
      const transfer = this.get(reg, id);
      if (transfer.committed) return transfer;
      if (transfer.received !== transfer.size) throw new AgentError(errors.conflict, "Transfer is incomplete; resume from its acknowledged cursor.");
      const hash = createHash("sha256");
      for (const row of this.store.db.prepare("SELECT data FROM transfer_parts WHERE id=? ORDER BY offset").iterate(id) as Iterable<{ data: Buffer }>) hash.update(row.data);
      if (hash.digest("hex") !== transfer.sha256) throw new AgentError(errors.invalid, "Transfer SHA-256 mismatch.");
      this.store.db.prepare("UPDATE transfers SET committed=1 WHERE id=?").run(id);
      return this.get(reg, id);
    })();
  }
  read(reg: Registration, id: string, offset: number): { data: string; nextOffset: number; done: boolean } {
    const transfer = this.get(reg, id);
    if (!transfer.committed) throw new AgentError(errors.conflict, "Transfer must be verified before reading.");
    if (offset > transfer.size) throw new AgentError(errors.invalid, "Invalid transfer read offset.");
    const end = Math.min(offset + TRANSFER_CHUNK_BYTES, transfer.size);
    const rows = this.store.db.prepare("SELECT offset,data FROM transfer_parts WHERE id=? AND offset<? AND offset+length(data)>? ORDER BY offset")
      .all(id, end, offset) as { offset: number; data: Buffer }[];
    const data = Buffer.concat(rows.map((row) => row.data.subarray(Math.max(0, offset - row.offset), Math.min(row.data.length, end - row.offset))));
    return { data: data.toString("base64"), nextOffset: end, done: end === transfer.size };
  }
  json(reg: Registration, id: string): unknown {
    const transfer = this.get(reg, id);
    if (!transfer.committed || transfer.mime !== "application/json")
      throw new AgentError(errors.invalid, "Import requires a verified JSON transfer.");
    const rows = this.store.db.prepare("SELECT data FROM transfer_parts WHERE id=? ORDER BY offset").all(id) as { data: Buffer }[];
    try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(rows.map((row) => row.data)))); }
    catch { throw new AgentError(errors.invalid, "Transferred domain is not valid UTF-8 JSON. Source and transfer were preserved."); }
  }
  image(reg: Registration, id: string): { mime: string; data: string } {
    const transfer = this.get(reg, id);
    if (!transfer.committed || !["image/png", "image/jpeg", "image/webp"].includes(transfer.mime) || transfer.size > 20 * 1024 * 1024)
      throw new AgentError(errors.invalid, "Image requires a verified PNG, JPEG or WebP attachment of at most 20 MiB. The source was preserved.");
    const rows = this.store.db.prepare("SELECT data FROM transfer_parts WHERE id=? ORDER BY offset").all(id) as { data: Buffer }[];
    const data = Buffer.concat(rows.map((row) => row.data));
    const signatures: Record<string, boolean> = {
      "image/png": data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
      "image/jpeg": data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff,
      "image/webp": data.subarray(0, 4).toString() === "RIFF" && data.subarray(8, 12).toString() === "WEBP",
    };
    if (!signatures[transfer.mime]) throw new AgentError(errors.invalid, "Image content does not match its declared media type.");
    return { mime: transfer.mime, data: data.toString("base64") };
  }
}
