import assert from "node:assert/strict";
import test from "node:test";
import type { GameArtifact } from "../packages/contracts/src/game-production";
import { artifactPolicy, resourceName, serveArtifactResources } from "../packages/adapter-game-browser/src/resources";
import { hasRenderedPixels } from "../packages/adapter-game-browser/src/pixels";
import { PNG } from "pngjs";
import { createHash } from "node:crypto";
import { get } from "node:http";
import { gunzipSync } from "node:zlib";
import { artifactEncoder } from "../packages/adapter-game-browser/src/encoding";

test("canvas observation accepts flat pixel art but rejects uniform or barely changed background", () => {
  const png = new PNG({ width: 100, height: 100 }); png.data.fill(255);
  assert.equal(hasRenderedPixels(PNG.sync.write(png)), false);
  png.data[0] = 0;
  assert.equal(hasRenderedPixels(PNG.sync.write(png)), false);
  for (let i = 0; i < 400; i += 4) png.data[i] = 0;
  assert.equal(hasRenderedPixels(PNG.sync.write(png)), true);
});

test("artifact content negotiation honors explicit refusals, quality and identity without encoding media", async () => {
  const encoder = artifactEncoder(), bytes = Buffer.from("original immutable game bytes\n".repeat(512));
  const hash = createHash("sha256").update(bytes).digest("hex");
  try {
    for (const header of [undefined, "", "gzip;q=0", "br", "*;q=0, identity;q=1", "gzip;q=0, *;q=1", "gzip;q=0.2, identity;q=0.8", "gzip;q=1, gzip;q=0", "gzip;q=2", "gzip;q=no"]) {
      const value = await encoder.encode(bytes, "application/wasm", hash, header);
      assert.equal(value?.gzip, false, header); assert.deepEqual(value?.data, bytes);
    }
    for (const header of ["gzip", "GZIP;Q=1.000", "*", "*;q=0, gzip", "gzip;q=0.8, identity;q=0.1", "gzip, identity;q=0"]) {
      const value = await encoder.encode(bytes, "application/wasm", hash, header);
      assert.equal(value?.gzip, true, header); assert.deepEqual(gunzipSync(value!.data), bytes);
    }
    for (const header of ["*;q=0", "br, identity;q=0", "gzip;q=0, identity;q=0"]) assert.equal(await encoder.encode(bytes, "application/wasm", hash, header), undefined, header);
    assert.equal((await encoder.encode(bytes, "image/png", hash, "gzip"))?.gzip, false);
    assert.equal(await encoder.encode(bytes, "image/png", hash, "gzip, identity;q=0"), undefined);
    assert.equal((await encoder.encode(Buffer.from("tiny"), "text/html", "tiny", "gzip"))?.gzip, false);
  } finally { await encoder.close(); }
  assert.equal(await encoder.encode(bytes, "application/wasm", hash, "gzip"), undefined, "a closed listener cannot resume compression");
});

test("encoded artifact HTTP bytes round-trip exactly and cache never bypasses source re-verification", async () => {
  const original = Buffer.from("\0asm original pinned WASM representation\n".repeat(32768));
  let current = original, reads = 0;
  const file = { path: "game.wasm", mime: "application/wasm", size: original.length, sha256: createHash("sha256").update(original).digest("hex") };
  const artifact = { engine: "godot", entrypoint: "game.wasm", files: [file] } as GameArtifact;
  const abort = new AbortController();
  const broker = await serveArtifactResources({ artifact, signal: abort.signal, readFile: async () => { reads++; return current; } });
  const wire = (encoding: string) => new Promise<{ status: number; headers: import("node:http").IncomingHttpHeaders; bytes: Buffer }>((resolve, reject) => {
    get(`${broker.origin}/game.wasm`, { headers: { cookie: `${broker.cookie.name}=${broker.cookie.value}`, "accept-encoding": encoding } }, (response) => {
      const chunks: Buffer[] = []; response.on("data", (chunk: Buffer) => chunks.push(chunk)); response.on("error", reject);
      response.on("end", () => resolve({ status: response.statusCode!, headers: response.headers, bytes: Buffer.concat(chunks) }));
    }).on("error", reject);
  });
  try {
    const results = await Promise.all(Array.from({ length: 6 }, () => wire("gzip")));
    for (const response of results) {
      assert.equal(response.status, 200); assert.equal(response.headers["content-encoding"], "gzip");
      assert.equal(Number(response.headers["content-length"]), response.bytes.length);
      assert.equal(response.headers.vary, "Accept-Encoding"); assert.equal(response.headers["content-type"], "application/wasm");
      assert.match(String(response.headers["content-security-policy"]), /wasm-unsafe-eval/);
      assert.equal(response.headers["cache-control"], "no-store");
      assert.deepEqual(gunzipSync(response.bytes), original); assert.ok(response.bytes.length < original.length / 10);
    }
    assert.equal(reads, 6, "coalesced/cache hits must still read and hash each source request");
    const identity = await wire("gzip;q=0"); assert.equal(identity.headers["content-encoding"], undefined); assert.deepEqual(identity.bytes, original);
    assert.equal((await wire("*;q=0")).status, 406);
    current = Buffer.alloc(original.length, 42);
    assert.equal((await wire("gzip")).status, 400, "cached gzip must not conceal a changed original");
    abort.abort(); await broker.close(); await assert.rejects(wire("gzip"));
  } finally { await broker.close(); }
});

test("closing artifact encoder waits for bounded outstanding compression without publishing after closure", async () => {
  const encoder = artifactEncoder(), bytes = Buffer.alloc(4 * 1024 * 1024, 17);
  const work = encoder.encode(bytes, "application/wasm", createHash("sha256").update(bytes).digest("hex"), "gzip");
  await encoder.close(); assert.equal(await work, undefined);
});

test("temporary artifact resource broker requires its private capability and serves only exact immutable build files", async () => {
  const module=Buffer.from("/* pinned module */");
  const artifact = { engine: "godot", files: [{ path: "engine/audio worklet.js", mime: "text/javascript",size:module.length,sha256:createHash("sha256").update(module).digest("hex") }] } as GameArtifact;
  const signal = new AbortController(); let reads = 0;
  const broker = await serveArtifactResources({ artifact, signal: signal.signal, readFile: async (name) => { reads++; assert.equal(name, "engine/audio worklet.js"); return Buffer.from("/* pinned module */"); } });
  const headers = { cookie: `${broker.cookie.name}=${broker.cookie.value}` };
  try {
    assert.equal((await fetch(`${broker.origin}/engine/audio%20worklet.js`)).status, 403);
    assert.equal((await fetch(`${broker.origin}/engine/audio%20worklet.js`, { headers: { cookie: `${broker.cookie.name}=forged` } })).status, 403);
    assert.equal((await fetch(`${broker.origin}/engine/audio%20worklet.js`, { headers, method: "POST" })).status, 403);
    assert.equal((await fetch(`${broker.origin}/engine/audio%20worklet.js`, { headers: { ...headers, origin: "https://other.invalid" } })).status, 403);
    assert.equal((await fetch(`${broker.origin}/private.sqlite`, { headers })).status, 404);
    assert.equal(reads, 0);
    const response = await fetch(`${broker.origin}/engine/audio%20worklet.js`, { headers });
    assert.equal(await response.text(), "/* pinned module */"); assert.equal(response.status, 200);
    assert.match(response.headers.get("content-security-policy")!, /wasm-unsafe-eval/);
    assert.doesNotMatch(response.headers.get("content-security-policy")!, /'unsafe-eval'/);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("cross-origin-resource-policy"), "same-origin");
    assert.equal(reads, 1);
    artifact.files[0]!.sha256="0".repeat(64);
    assert.equal((await fetch(`${broker.origin}/engine/audio%20worklet.js`,{headers})).status,400,"changed bytes/metadata must never be served as the pinned build");
    for (const suffix of ["/%2fetc/passwd", "/%2e%2e%2fetc/passwd", "/a%5cb.js", "/a%25file.js"])
      assert.throws(() => resourceName(new URL(broker.origin + suffix)));
    assert.doesNotMatch(artifactPolicy({ ...artifact, engine: "phaser" }), /wasm-unsafe-eval/);
    signal.abort(); await broker.close();
    await assert.rejects(fetch(`${broker.origin}/engine/audio%20worklet.js`, { headers }));
  } finally { await broker.close(); }
});
