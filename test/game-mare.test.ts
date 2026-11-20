import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { gameDocument } from "../packages/contracts/src/games";
import { checkGameBrowserRecipe } from "../packages/contracts/src/game-browser-tests";
import design from "../examples/games/mare/game.document.json";
import campaign from "../examples/games/mare/data/courses.json";
// Native GDScript rules/scene run only in the qualified isolated Godot image.
// These host tests cover contracts and independent public-PNG observations.
type Boat = { x: number; y: number; angle: number };
const observer = createRequire(__filename)(path.resolve("scripts/game-qualification/mare-visual-controller.mjs")) as {
  detectBoat(bytes: Buffer, near?: Boat): Boat | null;
  delivered(bytes: Buffer, course: typeof campaign.courses[number], index: number, boat?: Boat): boolean;
  renderedResult(bytes: Buffer): boolean;
  brightGlyphDifference(a: Buffer, b: Buffer, rect: { x: number; y: number; w: number; h: number }): { difference: number; litA: number; litB: number };
};
const png = (name: string) => readFileSync(path.resolve("test/fixtures/mare-visual", name + ".png"));

test("Maré two-player design covers twelve distinct courses and a canonical actual-input recipe", () => {
  const doc = gameDocument.parse(design);assert.equal(doc.brief.playMode, "local-coop");assert.deepEqual(doc.brief.players, { min: 2, max: 2 });
  assert.equal(campaign.courses.length, 12);assert.equal(new Set(campaign.courses.map(c => c.id)).size, 12);
  assert.equal(new Set(campaign.courses.map(c => JSON.stringify([c.start, c.docks, c.islands, c.wind, c.currents]))).size, 12);
  assert.deepEqual(doc.design!.progression.stages.map(s => s.id), campaign.courses.map(c => c.id));
  assert.ok(campaign.courses.every(c => c.docks.length === 3));
  const recipe = checkGameBrowserRecipe(readFileSync("examples/games/mare/data/playtests.json"), doc.design!.playtests);assert.equal(recipe.valid, true);
});

test("the composed-image observer finds the authored initial boat and refuses a modal-covered board", () => {
  const boat = observer.detectBoat(png("fresh-board"));assert.ok(boat);assert.ok(Math.abs(boat.x - 120) < 2);assert.ok(Math.abs(boat.y - 450) < 2);assert.ok(Math.abs(boat.angle) < .02);
  const paused = png("paused");assert.equal(observer.detectBoat(paused), null);assert.equal(observer.renderedResult(paused), true);
  assert.equal(observer.detectBoat(png("home-decorative-boat")), null, "a title-screen boat is not a playable course");
});

test("a real right-oar touch PNG turns upward; the hull shadow must not reverse its observed heading", () => {
  // This retained failure photo exposed the old observer reporting +0.96 rad
  // although the rendered copper bow points upward/right. No state is injected.
  const boat = observer.detectBoat(png("right-oar"));assert.ok(boat);assert.ok(boat.angle < -.4 && boat.angle > -1.2);assert.ok(boat.x > 260 && boat.x < 330);assert.ok(boat.y > 420 && boat.y < 470);
});

test("only the actual completed dock label is accepted in the retained 1/3-delivery frame", () => {
  const bytes = png("one-delivery"), boat = observer.detectBoat(bytes);assert.ok(boat);
  assert.equal(observer.delivered(bytes, campaign.courses[5]!, 0, boat), true);
  assert.equal(observer.delivered(bytes, campaign.courses[5]!, 1, boat), false);
  assert.equal(observer.delivered(bytes, campaign.courses[5]!, 2, boat), false);
  assert.equal(observer.delivered(bytes, campaign.courses[5]!, 0), false, "Without a rendered boat, possible oar occlusion cannot be ruled out");
});


test("real mute labels survive reload despite hover background changes; absent text never passes as equal", () => {
  const rect = { x: 60, y: 1568, w: 228, h: 60 }, on = png("mute-on");
  const changed = observer.brightGlyphDifference(png("mute-off"), on, rect);assert.ok(changed.difference > .1);
  const restored = observer.brightGlyphDifference(on, png("mute-restored"), rect);assert.equal(restored.difference, 0);assert.ok(restored.litA > 50);
  assert.throws(() => observer.brightGlyphDifference(png("fresh-board"), png("fresh-board"), { x: 0, y: 0, w: 20, h: 20 }), /rendered label/);
});
