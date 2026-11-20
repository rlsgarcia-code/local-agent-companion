import { TABLES } from './levels';
import { valid, stars, type State } from './simulation';
export const KEY = 'companion.reference.arco.v1';
type Progress = { version: 1; unlocked: number; best: { score: number; stars: number }[]; current: State | null; muted: boolean; reducedMotion: boolean };
type Storage = { getItem(key: string): string | null; setItem(key: string, value: string): void };
const fresh = (): Progress => ({ version: 1, unlocked: 1, best: TABLES.map(() => ({ score: 0, stars: 0 })), current: null, muted: false, reducedMotion: false });
function checked(value: unknown): value is Progress {
 if (!value || typeof value !== 'object') return false;const p = value as Progress;
 return p.version === 1 && Number.isInteger(p.unlocked) && p.unlocked >= 1 && p.unlocked <= TABLES.length &&
  Array.isArray(p.best) && p.best.length === TABLES.length && p.best.every(b => b && Number.isInteger(b.score) && b.score >= 0 && b.score <= 100000 && Number.isInteger(b.stars) && b.stars >= 0 && b.stars <= 3 && (b.stars > 0) === (b.score > 0)) &&
  p.best.slice(0, p.unlocked - 1).every(b => b.stars > 0) && typeof p.muted === 'boolean' && typeof p.reducedMotion === 'boolean' &&
  (p.current === null || (valid(p.current) && p.current.table < p.unlocked));
}
export class Save {
 value = fresh();available = true;
 constructor(private readonly storage: Storage) {
  try { const text = storage.getItem(KEY);if (text !== null) { if (text.length > 100000) throw Error('Oversized save');const parsed: unknown = JSON.parse(text);if (!checked(parsed)) throw Error('Incompatible save');this.value = parsed; } } catch { this.available = false; }
 }
 write() { if (!this.available) return;try { this.storage.setItem(KEY, JSON.stringify(this.value)); } catch { this.available = false; } }
 checkpoint(s: State) { if (!valid(s)) throw Error('Invalid checkpoint');this.value.current = JSON.parse(JSON.stringify(s)) as State;this.write(); }
 complete(s: State) {
  if (!valid(s) || s.phase !== 'won' || s.table >= this.value.unlocked) throw Error('Completion requires the played table');
  const old = this.value.best[s.table]!;this.value.best[s.table] = { score: Math.max(old.score, s.score), stars: Math.max(old.stars, stars(s)) };
  this.value.unlocked = Math.max(this.value.unlocked, Math.min(TABLES.length, s.table + 2));this.checkpoint(s);
 }
}
