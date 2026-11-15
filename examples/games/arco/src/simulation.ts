import { TABLES, type Table } from './levels';
export const WIDTH = 640, HEIGHT = 720, RADIUS = 9, LAUNCH = { x: 320, y: 646 };
export type Ball = { x: number; y: number; vx: number; vy: number; age: number };
export type State = { table: number; phase: 'aim' | 'flight' | 'won' | 'lost'; lit: boolean[]; used: number; score: number; combo: number; ball: Ball | null; ticks: number; carry: number };
export type Hit = { kind: 'lamp' | 'bumper' | 'wall' | 'settled' | 'won'; x: number; y: number; index?: number; combo?: number };
export const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
export function fresh(table = 0): State {
 if (!Number.isInteger(table) || !TABLES[table]) throw Error('Unknown table');
 return { table, phase: 'aim', lit: TABLES[table]!.lamps.map(() => false), used: 0, score: 0, combo: 0, ball: null, ticks: 0, carry: 0 };
}
export function launch(s: State, angle: number, speed: number): boolean {
 if (s.phase !== 'aim' || !Number.isFinite(angle) || !Number.isFinite(speed)) return false;
 const t = TABLES[s.table]!;if (s.used >= t.shots) return false;
 const a = clamp(angle, -168, -12) * Math.PI / 180, v = clamp(speed, 320, 860);
 s.ball = { ...LAUNCH, vx: Math.cos(a) * v, vy: Math.sin(a) * v, age: 0 };s.used++;s.combo = 0;s.carry = 0;s.phase = 'flight';return true;
}
function velocity(b: Ball) { const v = Math.hypot(b.vx, b.vy);if (v > 920) { b.vx *= 920 / v;b.vy *= 920 / v; } }
function finish(s: State, hits: Hit[]) {
 const b = s.ball!;hits.push({ kind: 'settled', x: b.x, y: b.y });s.ball = null;s.carry = 0;s.phase = s.used < TABLES[s.table]!.shots ? 'aim' : 'lost';
}
/** Bounded fixed substeps prevent long frames tunnelling through lamps/pins.
 * Pausing is a caller decision: no wall-clock time or input lives in physics. */
export function step(s: State, seconds: number): Hit[] {
 const hits: Hit[] = [];if (s.phase !== 'flight' || !s.ball || !Number.isFinite(seconds) || seconds <= 0) return hits;
 s.carry += Math.min(seconds, 1 / 30);const table: Table = TABLES[s.table]!, dt = 1 / 240;
 while (s.carry + 1e-12 >= dt && s.phase === 'flight') {
  s.carry = Math.max(0, s.carry - dt);s.ticks++;const b = s.ball!;
  b.age += dt;b.vx += table.wind * dt;const drag = Math.exp(-.07 * dt);b.vx *= drag;b.vy *= drag;b.x += b.vx * dt;b.y += b.vy * dt;
  const left = 30 + RADIUS, right = WIDTH - 30 - RADIUS, top = 70 + RADIUS;
  if (b.x < left || b.x > right) { b.x = clamp(b.x, left, right);b.vx = b.x === left ? Math.abs(b.vx) * .96 : -Math.abs(b.vx) * .96;hits.push({ kind: 'wall', x: b.x, y: b.y }); }
  if (b.y < top) { b.y = top;b.vy = Math.abs(b.vy) * .96;hits.push({ kind: 'wall', x: b.x, y: b.y }); }
  for (const [index, pin] of table.bumpers.entries()) {
   const dx = b.x - pin.x, dy = b.y - pin.y, length = Math.hypot(dx, dy), boundary = pin.r + RADIUS;
   if (length >= boundary) continue;
   const nx = length > 1e-8 ? dx / length : 0, ny = length > 1e-8 ? dy / length : -1;
   b.x = pin.x + nx * (boundary + .05);b.y = pin.y + ny * (boundary + .05);
   const toward = b.vx * nx + b.vy * ny;
   if (toward < 0) { b.vx -= 2 * toward * nx;b.vy -= 2 * toward * ny;b.vx *= 1.035;b.vy *= 1.035;velocity(b);hits.push({ kind: 'bumper', x: pin.x, y: pin.y, index }); }
  }
  for (const [index, lamp] of table.lamps.entries()) if (!s.lit[index] && Math.hypot(b.x - lamp.x, b.y - lamp.y) <= RADIUS + 20) {
   s.lit[index] = true;s.combo++;s.score += 100 + 40 * (s.combo - 1);hits.push({ kind: 'lamp', x: lamp.x, y: lamp.y, index, combo: s.combo });
  }
  if (s.lit.every(Boolean)) { s.phase = 'won';s.score += (table.shots - s.used) * 150;hits.push({ kind: 'won', x: b.x, y: b.y });s.ball = null;s.carry = 0; }
  else if (b.y > HEIGHT - 18 || b.age >= 8 || Math.hypot(b.vx, b.vy) < 35) finish(s, hits);
 }
 return hits;
}
/** First segment only; a preview, not an aiming solver or completion proof. */
export function preview(table: number, angle: number, speed: number) {
 const s = fresh(table);launch(s, angle, speed);const dots: { x: number; y: number }[] = [];
 for (let i = 0; i < 20 && s.ball; i++) { step(s, 1 / 30);if (s.ball) dots.push({ x: s.ball.x, y: s.ball.y }); }
 return dots;
}
export function stars(s: State) { return s.phase !== 'won' ? 0 : s.used <= Math.ceil(TABLES[s.table]!.shots / 2) ? 3 : s.used < TABLES[s.table]!.shots ? 2 : 1; }
export function valid(s: unknown): s is State {
 if (!s || typeof s !== 'object') return false;const v = s as State, t = TABLES[v.table];
 if (!Number.isInteger(v.table) || !t || !['aim', 'flight', 'won', 'lost'].includes(v.phase) || !Array.isArray(v.lit) || v.lit.length !== t.lamps.length || v.lit.some(x => typeof x !== 'boolean')) return false;
 if (!Number.isInteger(v.used) || v.used < 0 || v.used > t.shots || !Number.isInteger(v.score) || v.score < 0 || v.score > 100000 || !Number.isInteger(v.combo) || v.combo < 0 || v.combo > t.lamps.length || !Number.isInteger(v.ticks) || v.ticks < 0 || v.ticks > 1000000 || !Number.isFinite(v.carry) || v.carry < 0 || v.carry > 1 / 240) return false;
 if ((v.phase === 'won') !== v.lit.every(Boolean) || (v.phase === 'flight') !== (v.ball !== null) || (v.phase === 'lost' && v.used !== t.shots) || (v.phase === 'aim' && v.used === t.shots)) return false;
 if (v.ball) { const b = v.ball;if (![b.x, b.y, b.vx, b.vy, b.age].every(Number.isFinite) || b.x < 0 || b.x > WIDTH || b.y < 0 || b.y > HEIGHT || b.age < 0 || b.age > 8 || Math.hypot(b.vx, b.vy) > 930 || v.used === 0) return false; }
 return true;
}
