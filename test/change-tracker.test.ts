import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import test from "node:test";
import { ChangeTracker } from "../src/change-tracker";
import { ReviewableFilesystemBackend } from "../src/reviewable-backend";

async function withWorkspace(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), "local-companion-review-"));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("captures the original and final content across multiple edits", async () => {
  await withWorkspace(async (root) => {
    const target = path.join(root, "src", "feature.ts");
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, "before\n");
    const tracker = new ChangeTracker(root);

    await tracker.captureBefore("src/feature.ts");
    await writeFile(target, "middle\n");
    await tracker.captureAfter("src/feature.ts");
    await tracker.captureBefore("src/feature.ts");
    await writeFile(target, "after\n");
    await tracker.captureAfter("src/feature.ts");

    const result = tracker.finalize();
    assert.equal(result.omitted, 0);
    assert.equal(result.changes.length, 1);
    assert.equal(result.changes[0]?.kind, "modified");
    assert.equal(result.changes[0]?.before, "before\n");
    assert.equal(result.changes[0]?.after, "after\n");
  });
});

test("classifies created and deleted files", async () => {
  await withWorkspace(async (root) => {
    const created = path.join(root, "created.txt");
    const deleted = path.join(root, "deleted.txt");
    await writeFile(deleted, "remove me");
    const tracker = new ChangeTracker(root);

    await tracker.captureBefore("created.txt");
    await writeFile(created, "new file");
    await tracker.captureAfter("created.txt");

    await tracker.captureBefore("deleted.txt");
    await unlink(deleted);
    await tracker.captureAfter("deleted.txt");

    const result = tracker.finalize();
    assert.deepEqual(
      result.changes.map((change) => [change.path, change.kind]),
      [["created.txt", "created"], ["deleted.txt", "deleted"]]
    );
  });
});

test("ignores paths outside the workspace and unchanged files", async () => {
  await withWorkspace(async (root) => {
    const target = path.join(root, "same.txt");
    await writeFile(target, "same");
    const tracker = new ChangeTracker(root);

    assert.equal(await tracker.captureBefore("../outside.txt"), false);
    await tracker.captureBefore("same.txt");
    await tracker.captureAfter("same.txt");

    assert.deepEqual(tracker.finalize(), { changes: [], omitted: 0 });
  });
});

test("does not snapshot a symlink target outside the workspace", async (context) => {
  if (process.platform === "win32") {
    context.skip("Creating symlinks requires additional privileges on Windows.");
    return;
  }
  await withWorkspace(async (root) => {
    const outside = path.join(path.dirname(root), `${path.basename(root)}-outside.txt`);
    try {
      await writeFile(outside, "sensitive");
      await symlink(outside, path.join(root, "outside-link.txt"));
      const tracker = new ChangeTracker(root);

      assert.equal(await tracker.captureBefore("outside-link.txt"), false);
      assert.deepEqual(tracker.finalize(), { changes: [], omitted: 1 });
    } finally {
      await rm(outside, { force: true });
    }
  });
});

test("tracks Deep Agent filesystem backend writes and edits", async () => {
  await withWorkspace(async (root) => {
    await writeFile(path.join(root, "existing.txt"), "before");
    const tracker = new ChangeTracker(root);
    const backend = new ReviewableFilesystemBackend(
      { rootDir: root, virtualMode: true, maxFileSizeMb: 1.5 },
      tracker
    );

    assert.equal((await backend.write("/created.txt", "created")).error, undefined);
    assert.equal((await backend.edit("/existing.txt", "before", "after")).error, undefined);

    assert.deepEqual(
      tracker.finalize().changes.map((change) => [change.path, change.kind, change.after]),
      [
        ["created.txt", "created", "created"],
        ["existing.txt", "modified", "after"]
      ]
    );
  });
});

test("tracks paths routed through the Deep Agent /workspace composite mount", async () => {
  await withWorkspace(async (root) => {
    const tracker = new ChangeTracker(root);
    assert.equal(await tracker.captureBefore("/workspace/preview.html"), true);
    await writeFile(path.join(root, "preview.html"), "ready");
    await tracker.captureAfter("/workspace/preview.html");
    assert.deepEqual(
      tracker.finalize().changes.map((change) => [change.path, change.kind, change.after]),
      [["preview.html", "created", "ready"]]
    );
  });
});

test("Deep Agent deletion requires explicit approval", async () => {
  await withWorkspace(async (root) => {
    const target = path.join(root, "delete-me.txt");
    await writeFile(target, "recoverable");
    const tracker = new ChangeTracker(root);
    const options = { rootDir: root, virtualMode: true, maxFileSizeMb: 1.5 };
    const denied = new ReviewableFilesystemBackend(options, tracker, async () => false);

    assert.match((await denied.delete("/delete-me.txt")).error ?? "", /not approved/i);
    assert.equal(await readFile(target, "utf8"), "recoverable");

    const approved = new ReviewableFilesystemBackend(options, tracker, async () => true);
    assert.equal((await approved.delete("/delete-me.txt")).error, undefined);
    assert.deepEqual(
      tracker.finalize().changes.map((change) => [change.path, change.kind]),
      [["delete-me.txt", "deleted"]]
    );
  });
});

test("Deep Agent review mode can guard writes and edits before mutation", async () => {
  await withWorkspace(async (root) => {
    await writeFile(path.join(root, "existing.txt"), "before");
    const tracker = new ChangeTracker(root);
    const requested: string[] = [];
    const backend = new ReviewableFilesystemBackend(
      { rootDir: root, virtualMode: true, maxFileSizeMb: 1.5 },
      tracker,
      async (request) => {
        requested.push(`${request.operation}:${request.filePath}`);
        return false;
      }
    );

    assert.match((await backend.write("/created.txt", "created")).error ?? "", /not approved/i);
    assert.match((await backend.edit("/existing.txt", "before", "after")).error ?? "", /not approved/i);
    assert.equal(await readFile(path.join(root, "existing.txt"), "utf8"), "before");
    assert.deepEqual(requested, ["write:/created.txt", "edit:/existing.txt"]);
    assert.deepEqual(tracker.finalize().changes, []);
  });
});

test("Deep Agent filesystem reads redact credentials before returning tool data", async () => {
  await withWorkspace(async (root) => {
    const knownSecret = "corporate-key-123456789";
    await writeFile(
      path.join(root, "diagnostic.txt"),
      `api-key: ${knownSecret}\nAuthorization: Bearer bearer-value-that-must-not-leak\nneedle=${knownSecret}\n`
    );
    const backend = new ReviewableFilesystemBackend(
      { rootDir: root, virtualMode: true, maxFileSizeMb: 1.5 },
      new ChangeTracker(root),
      async () => true,
      [knownSecret]
    );

    const read = await backend.read("/diagnostic.txt");
    assert.equal(String(read.content).includes(knownSecret), false);
    assert.match(String(read.content), /\[REDACTED\]/);

    const raw = await backend.readRaw("/diagnostic.txt");
    assert.equal(JSON.stringify(raw.data).includes(knownSecret), false);

    const grep = await backend.grep("needle", "/");
    assert.equal(JSON.stringify(grep.matches).includes(knownSecret), false);
    assert.match(JSON.stringify(grep.matches), /\[REDACTED\]/);
  });
});

test("Deep Agent hides sensitive files until a one-time read is approved", async () => {
  await withWorkspace(async (root) => {
    const secret = "corporate-key-123456789";
    await writeFile(path.join(root, ".env"), `api-key=${secret}\n`);
    await writeFile(path.join(root, "visible.txt"), "needle is safe\n");
    const options = { rootDir: root, virtualMode: true, maxFileSizeMb: 1.5 };
    const tracker = new ChangeTracker(root);
    const denied = new ReviewableFilesystemBackend(options, tracker, async () => true, [secret]);

    assert.match((await denied.read("/.env")).error ?? "", /not approved/i);
    assert.equal((await denied.ls("/")).files?.some((file) => file.path.endsWith(".env")), false);
    assert.equal((await denied.glob("**/*")).files?.some((file) => file.path.endsWith(".env")), false);
    assert.equal((await denied.grep("api-key", "/")).matches?.some((match) => match.path.endsWith(".env")), false);

    const approved = new ReviewableFilesystemBackend(
      options,
      tracker,
      async () => true,
      [secret],
      async (filePath) => filePath === "/.env"
    );
    const result = await approved.read("/.env");
    assert.equal(result.error, undefined);
    assert.equal(String(result.content).includes(secret), false);
    assert.match(String(result.content), /\[REDACTED\]/);
  });
});

test("Deep Agent rejects brace expansion before invoking bundled glob matchers", async () => {
  await withWorkspace(async (root) => {
    await writeFile(path.join(root, "visible.ts"), "export const visible = true;\n");
    const backend = new ReviewableFilesystemBackend(
      { rootDir: root, virtualMode: true, maxFileSizeMb: 1.5 },
      new ChangeTracker(root)
    );

    assert.match((await backend.glob("**/*.{ts,tsx}")).error ?? "", /Brace expansion is disabled/);
    assert.match((await backend.grep("visible", "/", "src/{client,server}/**")).error ?? "", /Brace expansion is disabled/);
    assert.equal((await backend.glob("**/*.ts")).files?.some((file) => file.path.endsWith("visible.ts")), true);
  });
});
