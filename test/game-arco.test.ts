import assert from 'node:assert/strict';
import test from 'node:test';
import { TABLES } from '../examples/games/arco/src/levels';
import { fresh, launch, step, valid, preview, stars, type State } from '../examples/games/arco/src/simulation';
import { Save, KEY } from '../examples/games/arco/src/save';
import { gameDocument } from '../packages/contracts/src/games';
import { gameBrowserTestSuite } from '../packages/contracts/src/game-browser-tests';
import design from '../examples/games/arco/game.document.json';
import recipe from '../examples/games/arco/data/playtests.json';

function finishShot(s: State) {
 let count = 0;
 while (s.phase === 'flight') { assert.ok(count++ < 250);step(s, 1 / 30);assert.ok(valid(s)); }
}

test('Arco twelve distinct tables are completable within their launch budgets through the public physics input', () => {
 assert.equal(TABLES.length, 12);assert.equal(new Set(TABLES.map(t => t.id)).size, 12);
 assert.equal(new Set(TABLES.map(t => JSON.stringify([t.lamps, t.bumpers, t.wind]))).size, 12);
 for (const [index, table] of TABLES.entries()) {
  // This search is test-only. It supplies ordinary angle/speed launches; no
  // target, position, collision, quota or completion field is changed.
  const candidates: { angle: number; speed: number; hit: boolean[] }[] = [];
  for (let angle = -168; angle <= -12; angle += 3) for (const speed of [350, 520, 700, 860]) {
   const candidate = fresh(index);assert.ok(launch(candidate, angle, speed));finishShot(candidate);candidates.push({ angle, speed, hit: candidate.lit });
  }
  const s = fresh(index), route: number[][] = [];
  while (s.phase === 'aim') {
   const best = candidates.map(c => ({ c, count: c.hit.filter((lit, i) => lit && !s.lit[i]).length })).sort((a, b) => b.count - a.count)[0]!;
   assert.ok(best.count > 0, `${table.id}: some lantern cannot be reached with ordinary launches`);
   route.push([best.c.angle, best.c.speed]);assert.ok(launch(s, best.c.angle, best.c.speed));finishShot(s);
  }
  assert.equal(s.phase, 'won', `${table.id}: insufficient launches (${JSON.stringify(route)})`);assert.equal(s.lit.filter(Boolean).length, table.lamps.length);assert.ok(stars(s) >= 1);assert.ok(s.score >= table.lamps.length * 100);assert.ok(valid(s));
 }
});

test('Arco rejects double launches and invalid inputs, bounds long frames and does not simulate while waiting', () => {
 const s = fresh();assert.ok(valid(s));assert.equal(launch(s, NaN, 500), false);assert.equal(s.used, 0);assert.deepEqual(step(s, 99), []);
 const before = JSON.stringify(s);preview(0, -90, 500);assert.equal(JSON.stringify(s), before);
 assert.ok(launch(s, -90, 500));assert.equal(launch(s, -90, 500), false);const age = s.ball!.age;step(s, 5000);assert.ok(s.ball!.age - age <= 1 / 30 + 1e-8);assert.ok(valid(s));
 const a = JSON.stringify(s);for (const dt of [NaN, Infinity, -1, 0]) assert.deepEqual(step(s, dt), []);assert.equal(JSON.stringify(s), a);
 finishShot(s);const score = s.score, mask = [...s.lit];for (let i = 0; i < 10; i++) step(s, 1 / 30);assert.equal(s.score, score);assert.deepEqual(s.lit, mask);
 assert.throws(() => fresh(-1));assert.throws(() => fresh(12));assert.throws(() => fresh(.5));
});

test('Arco disc impacts reflect the actual ball, drains settle shots and exhausted launches lose without fabricated progress', () => {
 const s = fresh(1);assert.ok(launch(s, -90, 700));let hit = false;
 while (s.phase === 'flight') for (const e of step(s, 1 / 30)) if (e.kind === 'bumper') hit = true;
 assert.ok(hit);assert.ok(valid(s));
 const miss = fresh(0);while (miss.phase === 'aim') { launch(miss, -168, 320);finishShot(miss); }
 assert.equal(miss.phase, 'lost');assert.equal(stars(miss), 0);assert.equal(miss.used, TABLES[0]!.shots);assert.ok(valid(miss));
 assert.equal(valid({ ...miss, phase: 'won' }), false);assert.equal(valid({ ...fresh(), phase: 'flight' }), false);assert.equal(valid({ ...fresh(), lit: [false] }), false);
});

test('Arco preserves a partial flight and preferences; malformed, incompatible and unavailable storage never overwrites the original', () => {
 let text: string | null = null, writes = 0;
 const storage = { getItem(key: string) { assert.equal(key, KEY);return text; }, setItem(key: string, value: string) { assert.equal(key, KEY);text = value;writes++; } };
 const save = new Save(storage), s = fresh();launch(s, -90, 700);step(s, 1 / 30);save.value.muted = true;save.value.reducedMotion = true;save.checkpoint(s);
 const restored = new Save(storage);assert.ok(restored.available);assert.deepEqual(restored.value, save.value);assert.ok(valid(restored.value.current));
 const input = text!, old = writes;for (const malformed of ['null','not-json','{"version":99}',JSON.stringify({ ...save.value, current: { ...s, ball: { ...s.ball, x: 1e20 } } }),JSON.stringify({ ...save.value, unlocked: 12 })]) {
  text = malformed;const bad = new Save(storage);assert.equal(bad.available, false);bad.checkpoint(fresh());assert.equal(writes, old);assert.equal(text, malformed);
 }
 text = input;const failing = new Save({ getItem() { throw Error('denied'); }, setItem() { throw Error('denied'); } });assert.equal(failing.available, false);failing.checkpoint(fresh());assert.ok(valid(failing.value.current));
 assert.throws(() => restored.complete(s), /played table/);assert.equal(stars(s), 0);
});

test('Arco design, twelve content identities and browser recipe obey the shared contracts', () => {
 gameDocument.parse(design);gameBrowserTestSuite.parse(recipe);
 assert.deepEqual(design.design.progression.stages.map(stage => stage.id), TABLES.map(table => table.id));
 assert.deepEqual(design.design.content.map(content => content.id), TABLES.map(table => table.id));
});

test('the same launch follows the same fixed physics ticks across regular and uneven render frames', () => {
 const results = [];
 for (const pattern of [[1 / 30], [1 / 60], [1 / 59, 1 / 78, 1 / 33, 1 / 75]]) {
  const s = fresh(3);launch(s, -150, 700);let frame = 0;
  while (s.phase === 'flight') { step(s, pattern[frame++ % pattern.length]!);assert.ok(frame < 3000);assert.ok(valid(s)); }
  results.push(s);
 }
 assert.equal(results[0]!.phase, 'won');assert.deepEqual(results[1], results[0]);assert.deepEqual(results[2], results[0]);
});
