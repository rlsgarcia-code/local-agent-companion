import { gzip } from "node:zlib";

// Only representation bytes change. The caller must authenticate and verify the
// original artifact on every request, including before using a cached encoding.
const maxInput = 64 * 1024 * 1024, maxCache = 16 * 1024 * 1024;
function preferences(header: string | undefined): { gzip: number; identity: number } {
  if (!header?.trim()) return { gzip: 0, identity: 1 };
  const entries = new Map<string, number>();
  for (const item of header.split(",")) {
    const [coding, ...parameters] = item.trim().toLowerCase().split(";").map((v) => v.trim());
    if (!coding) continue;
    const valid = parameters.length === 0 || (parameters.length === 1 && /^q=(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/.test(parameters[0]!));
    const quality = valid ? (parameters.length ? Number(parameters[0]!.slice(2)) : 1) : 0;
    // Ambiguous duplicates cannot override an explicit refusal.
    entries.set(coding, Math.min(entries.get(coding) ?? 1, quality));
  }
  return { gzip: entries.get("gzip") ?? entries.get("*") ?? 0,
    identity: entries.get("identity") ?? (entries.get("*") === 0 ? 0 : 1) };
}

/** Per-listener bounded cache/CPU work, discarded on closure. No disk or
 * downloads, and no compression of already packed media. */
export function artifactEncoder() {
  const cached = new Map<string, Buffer>(), pending = new Map<string, Promise<Buffer>>();
  let cachedBytes = 0, closed = false;
  return {
    async encode(data: Buffer, mime: string, hash: string, accept: string | undefined): Promise<{ data: Buffer; gzip: boolean } | undefined> {
      if (closed) return undefined;
      const preference = preferences(accept);
      const compressible = data.length >= 1024 && data.length <= maxInput &&
        /^(?:text\/[^;]+|application\/(?:wasm|javascript|json)|image\/svg\+xml)(?:;|$)/i.test(mime);
      if (preference.gzip > 0 && preference.gzip >= preference.identity && compressible) {
        let compressed = cached.get(hash);
        if (compressed) { cached.delete(hash); cached.set(hash, compressed); }
        else {
          let work = pending.get(hash);
          if (!work && pending.size < 2) {
            work = new Promise<Buffer>((resolve, reject) => gzip(data, { level: 6 }, (error, bytes) => error ? reject(error) : resolve(bytes)));
            pending.set(hash, work);
          }
          if (work) {
            try {
              compressed = await work;
              if (!closed && compressed.length < data.length && compressed.length <= maxCache && !cached.has(hash)) {
                while (cachedBytes + compressed.length > maxCache) {
                  const oldest = cached.keys().next().value!;
                  cachedBytes -= cached.get(oldest)!.length; cached.delete(oldest);
                }
                cached.set(hash, compressed); cachedBytes += compressed.length;
              }
            } finally { if (pending.get(hash) === work) pending.delete(hash); }
          }
        }
        if (closed) return undefined;
        if (compressed && (compressed.length < data.length || preference.identity === 0)) return { data: compressed, gzip: true };
      }
      return preference.identity > 0 ? { data, gzip: false } : undefined;
    },
    async close() {
      closed = true;
      // Native zlib work cannot be cancelled. At most two bounded jobs exist;
      // await their settlement before acknowledging transport shutdown.
      await Promise.allSettled([...pending.values()]);
      pending.clear(); cached.clear(); cachedBytes = 0;
    },
  };
}
