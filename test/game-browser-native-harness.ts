/** Public synthetic fixtures for the explicit Linux systemd/bwrap qualification. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { canonical, contentHash } from "../packages/contracts/src/identity";
import { gameArtifact } from "../packages/contracts/src/game-production";
import { gameBrowserProcessRequest, gameBrowserProcessResult } from "../packages/contracts/src/game-browser-worker";
import { gameBrowserCandidateToolchain } from "../packages/adapter-game-browser/src/candidate-toolchain";
import { PNG } from "pngjs";

const hash = (raw: Uint8Array) => createHash("sha256").update(raw).digest("hex");
async function main() {
  const [mode, root] = process.argv.slice(2);
  if (!["--prepare", "--inspect"].includes(mode!) || !root || !/^\/tmp\/kidos-native-browser-[a-f0-9]{32}$/.test(root))
    throw Error("Use the explicit temporary Linux browser qualification.");
  const fixture = JSON.parse(await readFile(path.join(root, "worker.json"), "utf8"));
  if (mode === "--prepare") {
    const toolchain = gameBrowserCandidateToolchain(fixture.implementation, fixture.browser, fixture.component);
    const suite = { schemaVersion: 1, viewport: { width: 640, height: 360 }, scenarios: [{ id: "keyboard-pixels", steps: [
      { action: "capture", name: "before", selector: "canvas" }, { action: "press", key: "ArrowRight" },
      { action: "expect-image", baseline: "before", comparison: "changed", threshold: 0.1, selector: "canvas" },
      { action: "expect-text", selector: "#state", value: "moved", match: "exact" },
    ] }] };
    const resources = new Map<string, Buffer>([
      ["index.html", Buffer.from('<!doctype html><html><body><canvas width="40" height="40"></canvas><p id="state">ready</p><script src="main.js"></script></body></html>')],
      ["main.js", Buffer.from('const c=document.querySelector("canvas").getContext("2d");function draw(color){c.fillStyle=color;c.fillRect(0,0,20,40);c.fillStyle="green";c.fillRect(20,0,20,40)}draw("red");addEventListener("keydown",e=>{if(e.key==="ArrowRight"){draw("blue");document.querySelector("#state").textContent="moved"}});')],
      ["data/playtests.json", Buffer.from(JSON.stringify(suite))],
    ]);
    for (const name of ["render", "flat", "tampered", "wrong-component", "cancel", "timeout"]) {
    const caseResources = new Map(resources);
    if (name === "flat") caseResources.set("main.js", Buffer.from('const c=document.querySelector("canvas").getContext("2d");c.fillStyle="red";c.fillRect(0,0,40,40);'));
    if (["cancel", "timeout"].includes(name)) caseResources.set("data/playtests.json", Buffer.from(JSON.stringify({ ...suite,
      scenarios: [{ id: "long-observation", steps: Array.from({ length: 20 }, () => ({ action: "wait", ms: 2000 })) }] })));
    const files = [...caseResources].map(([name, raw], index) => ({ path: name, size: raw.length, sha256: hash(raw), transferId: `file-${index}`,
      mime: name.endsWith("html") ? "text/html" : name.endsWith("js") ? "text/javascript" : "application/json" }));
    const sourceHash = "b".repeat(64), buildToolchain = { id: "synthetic-build", version: "1", sha256: "a".repeat(64) };
    const artifact = gameArtifact.parse({ id: "artifact", jobId: "build", projectId: "native-browser", revision: 1,
      sourceHash, engine: "phaser", adapterId: "synthetic-build", toolchain: buildToolchain, entrypoint: "index.html", files, createdAt: 0,
      artifactHash: contentHash({ sourceHash, engine: "phaser", toolchain: buildToolchain, entrypoint: "index.html",
        files: files.map(({ transferId: _id, ...file }) => file) }) });
      const directory = path.join(root, "cases", name);
      await mkdir(path.join(directory, "input", "blobs"), { recursive: true, mode: 0o700 });
      await mkdir(path.join(directory, "output"), { mode: 0o700 });
      const request = gameBrowserProcessRequest.parse({ schemaVersion: 1, requestId: name, artifact,
        toolchain: name === "wrong-component" ? gameBrowserCandidateToolchain(fixture.implementation, fixture.browser, "f".repeat(64)) : toolchain,
        testSuite: "data/playtests.json", designScenarios: [] });
      await writeFile(path.join(directory, "input", "request.json"), canonical(request), { mode: 0o600 });
      for (const raw of caseResources.values()) await writeFile(path.join(directory, "input", "blobs", hash(raw)), raw, { mode: 0o600 });
      if (name === "tampered") await writeFile(path.join(directory, "input", "blobs", files[0]!.sha256), "changed", { mode: 0o600 });
    }
  } else {
    const output = path.join(root, "cases/render/output");
    const result = gameBrowserProcessResult.parse(JSON.parse(await readFile(path.join(output, "result.json"), "utf8")));
    assert.equal(result.observations[0]!.metrics.renderedPixelsObserved, true);
    const row = result.observations.find(row => row.testCase?.id === "keyboard-pixels");
    assert.ok(row); assert.ok(row.checks.every(check => check.status === "passed"));
    const pictures = row.evidenceFiles.filter(file => file.mime === "image/png"); assert.equal(pictures.length, 2);
    const decoded = await Promise.all(pictures.map(async file => PNG.sync.read(await readFile(path.join(output, "candidate", file.sha256)))));
    assert.deepEqual([...decoded[0]!.data.subarray(0, 4)], [255, 0, 0, 255]);
    assert.deepEqual([...decoded[1]!.data.subarray(0, 4)], [0, 0, 255, 255]);
    process.stdout.write(JSON.stringify({ pixels: "red-to-blue", keyboard: "ArrowRight", observations: result.observations.length,
      scope: "automated synthetic canvas; no gameplay, GPU performance or human acceptance" }) + "\n");
  }
}
void main().catch(error => { process.stderr.write(String(error) + "\n"); process.exitCode = 1; });
