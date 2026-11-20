import assert from "node:assert/strict";
import test from "node:test";
import { gameVectorImageOperation, vectorRecipePath } from "../packages/contracts/src/game-vector";
import { assetSources, assetOutputPaths, gameAssetSpec } from "../packages/contracts/src/game-assets";
import { gameMediaProcessRequest } from "../packages/contracts/src/game-media-worker";
import { contentHash } from "../packages/contracts/src/identity";
import { gameContentHash } from "../packages/game-design/src/project";
import { processGameMedia } from "../packages/adapter-game-assets/src/process";
import { vectorIllustrationFixture } from "./game-vector-fixtures";
import { fixtureGameDocument } from "./game-fixtures";

test("typed vector art is deterministic, self-contained and editable without prepared pixels or executable markup", () => {
  const operation = vectorIllustrationFixture(),result = processGameMedia(operation, new Map()),again = processGameMedia(operation, new Map());
  assert.deepEqual(result, again);assert.deepEqual(assetSources(operation), []);assert.deepEqual(result.files.map(file => file.path), assetOutputPaths(operation));
  const svg = Buffer.from(result.files[0]!.data).toString();assert.equal(result.files[0]!.mime, "image/svg+xml");
  assert.match(svg, /<linearGradient/);assert.match(svg, /<radialGradient/);assert.match(svg, /<path d="/);assert.match(svg, /<ellipse/);assert.match(svg, /transform="translate/);
  assert.doesNotMatch(svg, /<!|<script|<image|<text|<style|<foreignObject|href=|onload|https:|file:|data:|javascript:/i);
  assert.deepEqual(JSON.parse(Buffer.from(result.files[1]!.data).toString()), { schemaVersion: 1, operation });
  assert.equal(result.files[1]!.path, vectorRecipePath(operation.output));assert.equal(result.info.shapes, 9);
  assert.ok(result.files.reduce((sum, file) => sum + file.data.byteLength, 0) < 32 * 1024);
});

test("vector contracts reject markup, URLs, executable features, nonfinite values and unsafe paths", () => {
  const original = vectorIllustrationFixture();
  const mutations: ((value: Record<string, any>) => void)[] = [
    value => { value.svg = "<svg onload='alert(1)'/>"; },value => { value.output = "../outside.svg"; },
    value => { value.output = "assets/https:evil.svg"; },value => { value.shapes[0].fill = "url(https://example.com/secret)"; },
    value => { value.shapes[0].href = "file:///private"; },value => { value.shapes[0].kind = "text";value.shapes[0].text = "host-font"; },
    value => { value.shapes[0].style = "filter:url(https://example.com)"; },value => { value.shapes[0].onload = "forged"; },
    value => { value.shapes[0].cx = Infinity; },value => { value.shapes[0].cx = NaN; },value => { value.shapes[1].commands[0].x = "0\"/><script/>"; },
    value => { value.shapes[1].commands.push({ op: "evaluate", code: "forged" }); },value => { value.shapes[0].transform = { scaleX: 0 }; },
    value => { value.shapes[2].fill.stops.reverse(); },value => { value.shapes[0].id = "<script>"; },
  ];
  for (const mutate of mutations) { const value = structuredClone(original);mutate(value);assert.equal(gameVectorImageOperation.safeParse(value).success, false); }
});

test("vector geometry budgets and subpath boundaries remain strict without silently dropping content", () => {
  const original = vectorIllustrationFixture();
  assert.equal(gameVectorImageOperation.safeParse({ ...original, width: 4097 }).success, false);
  assert.equal(gameVectorImageOperation.safeParse({ ...original, shapes: Array.from({ length: 513 }, (_value, index) => ({ ...original.shapes[0], id: `shape-${index}` })) }).success, false);
  const path = { kind: "path", fill: "#ffffffff", id: "line", commands: [{ op: "L", x: 1, y: 1 }, { op: "Z" }] };
  assert.equal(gameVectorImageOperation.safeParse({ ...original, shapes: [path] }).success, false);
  path.commands = [{ op: "M", x: 0, y: 0 }, { op: "Z" }, { op: "L", x: 1, y: 1 }];assert.equal(gameVectorImageOperation.safeParse({ ...original, shapes: [path] }).success, false);
  const commands = [{ op: "M", x: 0, y: 0 }, ...Array.from({ length: 255 }, () => ({ op: "L", x: 1, y: 1 }))];
  assert.equal(gameVectorImageOperation.safeParse({ ...original, shapes: Array.from({ length: 17 }, (_value, index) => ({ ...path, id: `path-${index}`, commands })) }).success, false);
  assert.equal(gameVectorImageOperation.safeParse({ ...original, output: `assets/${"a".repeat(247)}.svg` }).success, false, "sidecar must also fit portable component limits");
  assert.equal(gameVectorImageOperation.safeParse({ ...original, shapes: [original.shapes[0], original.shapes[0]] }).success, false);
});

test("fixed Core media exchange refuses the new SVG format until its own protected contract is qualified", () => {
  const document = fixtureGameDocument(),spec = gameAssetSpec.parse({ processorId: "kidos-core-media-v1", target: { id: "vector", role: "Fixture", placeholder: true }, operation: vectorIllustrationFixture() });
  const parsed = gameMediaProcessRequest.safeParse({ schemaVersion: 1, requestId: "fixture", sourceHash: gameContentHash(document), recipeHash: contentHash(spec),
    toolchain: { id: "fixture", version: "1", sha256: "a".repeat(64) }, document, spec, sources: [] });
  assert.equal(parsed.success, false);if (!parsed.success) assert.match(parsed.error.message, /separately qualified Core SVG contract/);
});
