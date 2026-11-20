import { z } from "zod";
import { contentHash } from "../../contracts/src/identity";
import type { Registration } from "../../contracts/src/index";

export const MAX_GAME_STUDIO_DRAFT_BYTES = 2 * 1024 * 1024;
const valueSchema = z.object({ schemaVersion: z.literal(1), libraryImport: z.unknown().nullable(), mediaEdit: z.unknown().nullable(), designEdit: z.unknown().nullable(), playtestEdit: z.unknown().nullable().optional(), restoreEdit: z.unknown().nullable().optional(),audioEncodeEdit:z.unknown().nullable().optional(),deliveryEdit:z.unknown().nullable().optional() }).strict();
export type GameStudioDraft = z.infer<typeof valueSchema>;
type Record = { revision: number; value: GameStudioDraft | null };
const recordSchema = z.object({ revision: z.number().int().nonnegative(), value: valueSchema.nullable() }).strict();
const commandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("draft-read") }).strict(),
  z.object({ action: z.literal("draft-write"), expectedRevision: z.number().int().nonnegative(), value: valueSchema.nullable() }).strict(),
]);
const queues = new Map<string, Promise<unknown>>();

/** UI state only. Never interpreted as tool authority, code, credentials or a request to execute. */
export function parseGameStudioDraft(value: unknown): GameStudioDraft | null {
  const seen = new Set<object>(), stack: { value: unknown; depth: number }[] = [{ value, depth: 0 }];let entries = 0, bytes = 0;
  while (stack.length) {
    const item = stack.pop()!;
    if (++entries > 100000 || item.depth > 32) throw new Error("O rascunho excede os limites locais de estrutura; os dados anteriores foram preservados.");
    const v = item.value;
    bytes += typeof v === "string" ? Buffer.byteLength(v) + 2 : v === null ? 4 : typeof v === "number" || typeof v === "boolean" ? String(v).length : 2;
    if (bytes > MAX_GAME_STUDIO_DRAFT_BYTES) throw new Error("O rascunho excede 2 MiB; os dados anteriores foram preservados.");
    if (v === null || typeof v === "boolean" || typeof v === "string" || typeof v === "number" && Number.isFinite(v)) continue;
    if (typeof v !== "object" || seen.has(v) || !Array.isArray(v) && ![Object.prototype, null].includes(Object.getPrototypeOf(v)))
      throw new Error("O rascunho deve conter apenas dados JSON locais.");
    const children = Object.entries(v);
    if (children.length > 100000 - entries) throw new Error("O rascunho excede os limites locais de estrutura; os dados anteriores foram preservados.");
    seen.add(v);for (const [key, child] of children) { if (!Array.isArray(v)) bytes += Buffer.byteLength(key) + 3;stack.push({ value: child, depth: item.depth + 1 }); }
  }
  if (Buffer.byteLength(JSON.stringify(value)) > MAX_GAME_STUDIO_DRAFT_BYTES) throw new Error("O rascunho excede 2 MiB; nenhuma solicitação foi enviada e os dados anteriores foram preservados.");
  return value === null ? null : valueSchema.parse(value);
}

/** Actual authenticated client/session supplies scope; a renderer cannot choose it. No token is stored. */
export function gameStudioDraftKey(reg: Registration, sessionId: string): string {
  return contentHash({ product: reg.product, profile: reg.profile, workspace: reg.workspace, sessionId });
}

/** Host-owned persistence with ordered compare-and-swap and replay after a lost save acknowledgment. */
export class GameStudioDraftStore {
  private lastWrite: Promise<unknown> = Promise.resolve();
  constructor(private readonly key: string, private readonly backend: { read(): Promise<unknown>; write(value: Record): Promise<void> }) {}
  /** Normal host close may wait for acknowledged writes; never reports an unconfirmed save as durable. */
  flush(): Promise<unknown> { return this.lastWrite; }
  private async read(): Promise<Record> {
    try {
      const raw = await this.backend.read();if (raw === undefined || raw === null) return { revision: 0, value: null };
      // Never overwrite malformed persisted data as though no draft existed.
      const record = recordSchema.parse(raw);parseGameStudioDraft(record.value);return structuredClone(record);
    } catch (error) {
      if (error instanceof SyntaxError || error instanceof z.ZodError) throw new Error("Os dados locais do rascunho estão inválidos ou são incompatíveis. O original foi preservado para recuperação.");
      throw error;
    }
  }
  handles(input: unknown): boolean {
    return Boolean(input && typeof input === "object" && ["draft-read", "draft-write"].includes(String((input as { action?: unknown }).action)));
  }
  dispatch(input: unknown): Promise<Record> {
    const command = commandSchema.parse(input);
    if (command.action === "draft-write") command.value = structuredClone(parseGameStudioDraft(command.value));
    const previous = queues.get(this.key) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(async () => {
      const stored = await this.read();if (command.action === "draft-read") return stored;
      const value = parseGameStudioDraft(command.value);
      if (command.expectedRevision !== stored.revision) {
        if (command.expectedRevision === stored.revision - 1 && contentHash(value) === contentHash(stored.value)) return stored;
        throw new Error("O rascunho foi alterado em outra janela. Reabra o Studio para recuperar o estado preservado antes de enviar um pedido.");
      }
      const record = { revision: stored.revision + 1, value };await this.backend.write(structuredClone(record));return record;
    });
    queues.set(this.key, next);void next.finally(() => { if (queues.get(this.key) === next) queues.delete(this.key); }).catch(() => {});
    if (command.action === "draft-write") this.lastWrite = next;
    return next;
  }
}
