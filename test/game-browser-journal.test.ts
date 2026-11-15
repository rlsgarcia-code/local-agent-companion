import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile, readFile, link, symlink, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { contentHash } from "../packages/contracts/src/identity";
import { digest, readOperation, readPrivate, writePrivate, writeJson, writeResult, readResult, operationSchema } from "../packages/adapter-game-browser/src/journal";
import type { CollectedGameObservation } from "../packages/game-production/src/index";
import { GameProductionUncertain, GameProductionFailure, type GameValidationCollector } from "../packages/game-production/src/index";
import { gameArtifact } from "../packages/contracts/src/game-production";
import { durableBrowser } from "../packages/adapter-game-browser/src/durable";
import { fixtureGameDocument } from "./game-fixtures";

const observation = (): CollectedGameObservation => ({ category: "runtime", environment: { platform: "fixture", device: "journal fixture", browser: "none", input: [], scope: "automated" },
  checks: [{ id: "storage", status: "unverified", detail: "This fixture checks durable bytes, not a game." }], metrics: {},
  evidenceFiles: [{ path: "trace.json", mime: "application/json", data: Buffer.from('{"fixture":true}') }] });
async function temporary() { const directory = await mkdtemp(path.join(tmpdir(), "browser-journal-")); return { directory, close: () => rm(directory, { recursive: true, force: true }) }; }

test("browser journal preserves exact observation/evidence and rejects metadata or payload tampering", async () => {
  const f = await temporary(); try {
    const input = observation(), hash = await writeResult(f.directory, [input]);
    assert.deepEqual(await readResult(f.directory, hash), [input]);
    await assert.rejects(readResult(f.directory, "0".repeat(64)), /metadata hash/);
    const payload = path.join(f.directory, "output", digest(input.evidenceFiles![0]!.data));
    await writeFile(payload, Buffer.from('{"fixture":false}'), { mode: 0o600 });
    await assert.rejects(readResult(f.directory, hash), /oversized|pinned hash/);
    await assert.rejects(writeResult(f.directory, [observation()]), /EEXIST/, "another candidate cannot overwrite this operation");
  } finally { await f.close(); }
});

test("browser journal refuses oversized, linked, public and symbolic files without following them", async (t) => {
  const f = await temporary(); try {
    const original = path.join(f.directory, "original"), alias = path.join(f.directory, "alias");
    await writePrivate(original, Buffer.from("private"));
    await assert.rejects(readPrivate(original, 3), /oversized/);
    await link(original, alias); await assert.rejects(readPrivate(alias, 100), /Unsafe/); await rm(alias);
    if (process.platform !== "win32") {
      await symlink(original, alias); await assert.rejects(readPrivate(alias, 100), /Unsafe/); await rm(alias);
      const publicFile = path.join(f.directory, "public"); await writeFile(publicFile, "public", { mode: 0o600 }); await chmod(publicFile, 0o644); await assert.rejects(readPrivate(publicFile, 100), /Unsafe/);
    } else t.diagnostic("Symlink creation/DACL verification needs native Windows qualification; hard links and bounds were exercised.");
    assert.equal((await readPrivate(original, 100)).toString(), "private");
  } finally { await f.close(); }
});

test("operation records bind namespace, original toolchain and nonce; mismatched identities cannot be inspected as equivalent", async () => {
  const f = await temporary(); try {
    const operation = operationSchema.parse({ schemaVersion: 1, nonce: "a".repeat(64), workerSha256: "b".repeat(64),
      binding: { namespace: "c".repeat(64), jobId: "fixture", sourceHash: "d".repeat(64), artifactHash: "e".repeat(64), toolchain: { id: "fixture", version: "1", sha256: "f".repeat(64) } } });
    await writePrivate(path.join(f.directory, "operation.json"), Buffer.from(JSON.stringify(operation)));
    assert.deepEqual(await readOperation(f.directory, operation), operation);
    for (const changed of [{ ...operation, nonce: "0".repeat(64) }, { ...operation, binding: { ...operation.binding, namespace: "0".repeat(64) } },
      { ...operation, binding: { ...operation.binding, toolchain: { ...operation.binding.toolchain, version: "2" } } }])
      await assert.rejects(readOperation(f.directory, changed), /identity differs/);
    await writeJson(path.join(f.directory, "checkpoint.json"), { operationHash: contentHash(operation) });
    assert.equal(JSON.parse((await readPrivate(path.join(f.directory, "checkpoint.json"), 1024)).toString()).operationHash, contentHash(operation));
  } finally { await f.close(); }
});

test("supervisor loss cannot be mistaken for shutdown; worker credentials/environment are not inherited and recovery never relaunches", async () => {
  const previous = process.env.COMPANION_BROWSER_SECRET_CANARY;
  process.env.COMPANION_BROWSER_SECRET_CANARY = "synthetic-environment-canary";
  try {
    for (const receipt of [false, true]) {
      const f = await temporary(); try {
        const workerPath = path.join(f.directory, "fixture-worker.cjs");
        await writeFile(workerPath, `const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const directory=process.argv[2],operation=JSON.parse(fs.readFileSync(path.join(directory,'operation.json')));
// Canonical hash comes from the installed journal module; this fixture never launches a browser.
const identity=require(${JSON.stringify(path.resolve("dist-tests/packages/contracts/src/identity.js"))});
fs.writeFileSync(path.join(directory,'environment.json'),JSON.stringify({canary:process.env.COMPANION_BROWSER_SECRET_CANARY??null,home:process.env.HOME}),{mode:0o600});
fs.writeFileSync(path.join(directory,'launch-count'),'1',{mode:0o600});
process.on('message',message=>{if(message.nonce!==operation.nonce)return;if(message.kind==='start'){
${receipt ? "fs.writeFileSync(path.join(directory,'receipt.json'),JSON.stringify({operationHash:identity.contentHash(operation),pid:process.pid,status:'failed',detail:'Fixture confirmed that no browser was launched'}),{mode:0o600});" : ""}
process.exit(12);}});process.send({kind:'ready',nonce:operation.nonce});`, { mode: 0o600 });
        const workerSha256 = digest(await readFile(workerPath)), toolchain = { id: "fixture-supervisor", version: "1", sha256: workerSha256 };
        const data = Buffer.from("<title>Fixture</title>"), file = { path: "index.html", size: data.byteLength, sha256: digest(data), mime: "text/html", transferId: "fixture-blob" };
        const artifact = gameArtifact.parse({ id: "fixture-artifact", jobId: "fixture-build", projectId: "fixture-project", revision: 1, sourceHash: "a".repeat(64),
          engine: "phaser", adapterId: "fixture-build", toolchain, entrypoint: file.path, files: [file], artifactHash: "b".repeat(64), createdAt: 1 });
        const context: Parameters<GameValidationCollector["validate"]>[0] = { registration: { id: "fixture", product: "companion-mac", profile: "test", workspace: "", providers: ["ollama"], hostTools: [] },
          job: { id: "fixture-observation", kind: "validate", projectId: artifact.projectId, revision: 1, sourceHash: artifact.sourceHash, engine: "phaser", adapterId: "fixture-supervisor", toolchain, state: "running", createdAt: 1, updatedAt: 1 },
          artifact, document: fixtureGameDocument(), signal: new AbortController().signal, readFile: async () => data };
        const runtime = durableBrowser({ stateDirectory: f.directory, workerPath, workerSha256, headless: true,
          browser: { executablePath: workerPath, sha256: workerSha256, version: "Fixture browser never launched", components: [{ path: workerPath, sha256: workerSha256 }] } });
        await assert.rejects(runtime.validate(context), receipt ? GameProductionFailure : GameProductionUncertain);
        const directory = path.join(f.directory, "game-browser-jobs", context.job.id), environment = JSON.parse(await readFile(path.join(directory, "environment.json"), "utf8"));
        assert.equal(environment.canary, null); assert.equal(environment.home, path.join(directory, "home"));
        if (receipt) assert.equal((await runtime.recover(context)).state, "missing");
        else await assert.rejects(runtime.recover(context), /without a shutdown acknowledgment/);
        await assert.rejects(runtime.recover({ ...context, registration: { ...context.registration, product: "companion-vscode" } }), /exact namespace/);
        assert.equal(await readFile(path.join(directory, "launch-count"), "utf8"), "1");
      } finally { await f.close(); }
    }
  } finally { if (previous === undefined) delete process.env.COMPANION_BROWSER_SECRET_CANARY; else process.env.COMPANION_BROWSER_SECRET_CANARY = previous; }
});
