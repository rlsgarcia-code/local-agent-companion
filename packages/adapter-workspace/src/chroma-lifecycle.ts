export const CHROMA_HEARTBEAT_TIMEOUT_MS = 750;
export const CHROMA_STARTUP_TIMEOUT_MS = 20_000;
export const CHROMA_START_LOCK_STALE_MS = 30_000;
export const CHROMA_LOCK_WAIT_TIMEOUT_MS = 35_000;
export const CHROMA_POLL_INTERVAL_MS = 250;

export type ChromaServerMetadata = {
  version: 1;
  pid: number;
  port: number;
  startedAt: number;
};

export type ChromaStartLock = {
  version: 1;
  pid: number;
  createdAt: number;
};

export type ChromaClientLease = {
  version: 1;
  id: string;
  pid: number;
  createdAt: number;
};

export function parseChromaServerMetadata(value: unknown): ChromaServerMetadata | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const pid = finiteInteger(record.pid);
  const port = finiteInteger(record.port);
  const startedAt = finiteNumber(record.startedAt) ?? 0;
  const version = record.version === undefined ? 1 : finiteInteger(record.version);
  if (version !== 1 || !pid || pid < 1 || !port || port < 1 || port > 65_535 || startedAt < 0) {
    return undefined;
  }
  return { version: 1, pid, port, startedAt };
}

export function parseChromaStartLock(value: unknown): ChromaStartLock | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const pid = finiteInteger(record.pid);
  const createdAt = finiteNumber(record.createdAt);
  if (record.version !== 1 || !pid || pid < 1 || createdAt === undefined || createdAt < 0) return undefined;
  return { version: 1, pid, createdAt };
}

export function parseChromaClientLease(value: unknown): ChromaClientLease | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const id = typeof record.id === "string" && /^[a-zA-Z0-9-]{8,80}$/.test(record.id) ? record.id : undefined;
  const pid = finiteInteger(record.pid);
  const createdAt = finiteNumber(record.createdAt);
  if (record.version !== 1 || !id || !pid || pid < 1 || createdAt === undefined || createdAt < 0) return undefined;
  return { version: 1, id, pid, createdAt };
}

export function parseChromaHeartbeat(value: unknown): number | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = (value as Record<string, unknown>)["nanosecond heartbeat"];
  const heartbeat = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() ? Number(raw) : NaN;
  return Number.isFinite(heartbeat) && heartbeat > 0 ? heartbeat : undefined;
}

export function shouldReclaimChromaStartLock(
  lock: ChromaStartLock | undefined,
  modifiedAt: number,
  now: number,
  processIsAlive: (pid: number) => boolean
): boolean {
  if (lock && !processIsAlive(lock.pid)) return true;
  const createdAt = lock?.createdAt ?? modifiedAt;
  return Number.isFinite(createdAt) && now - createdAt > CHROMA_START_LOCK_STALE_MS;
}

function finiteInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && Number.isFinite(value) ? value : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
