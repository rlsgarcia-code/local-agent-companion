import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import test from "node:test";
import { withBootstrapLock } from "../packages/client-ts/src/bootstrap-lock";
import { holdBootstrapLock } from "../packages/agent-service/src/bootstrap-lock";
void holdBootstrapLock; // Include the real child entrypoint in the compiled test fixture.
const command = { executable: process.execPath, script: path.resolve(__dirname, "../packages/agent-service/src/bootstrap-lock.js") };

test("independent clients serialize bootstrap without replacing a live owner's preparation", { timeout: 20_000 }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "engine-bootstrap-"));
  let release!: () => void, entered!: () => void, secondEntered = false;
  const working = new Promise<void>((resolve) => { release = resolve; });
  const started = new Promise<void>((resolve) => { entered = resolve; });
  const first = withBootstrapLock(command, directory, async () => { entered(); await working; return "first"; });
  let second: Promise<string> | undefined;
  try {
    await Promise.race([started, first]);
    second = withBootstrapLock(command, directory, async () => { secondEntered = true; return "second"; });
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(secondEntered, false);
    release();
    assert.deepEqual(await Promise.all([first, second]), ["first", "second"]);
  } finally { release(); await Promise.allSettled([first, ...(second ? [second] : [])]); await rm(directory, { recursive: true, force: true }); }
});

test("an abruptly terminated lock owner leaves no stale bootstrap lock", { timeout: 20_000 }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "engine-bootstrap-crash-"));
  const owner = spawn(command.executable, [command.script, directory], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  const stopped = new Promise((resolve) => owner.once("exit", resolve));
  try {
    await new Promise<void>((resolve, reject) => {
      owner.once("error", reject); owner.once("exit", () => reject(new Error("Fixture owner failed.")));
      owner.stdout.on("data", (chunk: Buffer) => { if (chunk.toString().includes("BOOTSTRAP_LOCKED")) resolve(); });
    });
    let entered = false;
    const next = withBootstrapLock(command, directory, async () => { entered = true; });
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(entered, false);
    owner.kill("SIGKILL"); await stopped;
    await next;
    assert.equal(entered, true);
  } finally { owner.kill(); await stopped; await rm(directory, { recursive: true, force: true }); }
});
