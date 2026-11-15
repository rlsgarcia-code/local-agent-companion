import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, readdir, writeFile, symlink, link, chmod, stat } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { GameStudioDraftStore, gameStudioDraftKey, parseGameStudioDraft } from "../packages/client-ts/src/game-studio-drafts";
import { desktopGameStudioDraftStore } from "../desktop/game-studio-drafts";
import { fileGameStudioDraftStore } from "../packages/client-ts/src/game-studio-file-drafts";
import type { Registration } from "../packages/contracts/src/index";

const reg: Registration = { id: "fixture-client", product: "companion-mac", profile: "parent", workspace: "fixture-workspace", providers: ["ollama"], hostTools: [] };
const draft = () => ({ schemaVersion: 1 as const, restoreEdit: {action:"restore",projectId:"project-a",revision:1,expectedRevision:2,requestId:"frozen-restore"}, libraryImport: { requestId: "frozen", projectId: "project-a", expectedRevision: 2,
  command: { action: "import-library", requestId: "frozen", spec: { fixture: "Opaque UI state, never executed by storage" } } },
  mediaEdit: { requestId: "audio-request", operation: { type: "audio.render", notes: [{ frequency: 330 }] } },
  designEdit: { projectId: "project-a", expectedRevision: 2, values: { premise: "Unsaved design" } },
  playtestEdit: { projectId: "project-a", kind: "record", frozen: true, requestId: "lost-observation", values: { notes: "Synthetic local-only observation" },
    command: { action: "record-playtest", projectId: "project-a", artifactHash: "a".repeat(64), request: { requestId: "lost-observation", studyId: "preserved-study", participantId: "preserved-code" } } } });

test("Studio drafts survive host recreation with exact frozen requests and isolated authenticated product/profile/workspace/session scopes", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "studio-draft-host-"));
  try {
    const scope = gameStudioDraftKey(reg, "session-a"), store = desktopGameStudioDraftStore(root, scope), value = draft();
    assert.deepEqual(await store.dispatch({ action: "draft-read" }), { revision: 0, value: null });
    const saved = await store.dispatch({ action: "draft-write", expectedRevision: 0, value });assert.equal(saved.revision, 1);
    assert.deepEqual(await desktopGameStudioDraftStore(root, scope).dispatch({ action: "draft-read" }), saved);
    for (const [actor, session] of [[{ ...reg, product: "companion-vscode" }, "session-a"], [{ ...reg, profile: "child" }, "session-a"], [{ ...reg, workspace: "other" }, "session-a"], [reg, "session-b"]] as [Registration, string][]) {
      assert.deepEqual(await desktopGameStudioDraftStore(root, gameStudioDraftKey(actor, session)).dispatch({ action: "draft-read" }), { revision: 0, value: null });
    }
    assert.equal(gameStudioDraftKey({ ...reg, id: "rotated-client" }, "session-a"), scope, "credential rotation never stores or needs a token");
    const files = await readdir(path.join(root, "game-studio-drafts"));assert.deepEqual(files, [scope + ".json"]);
    const bytes = await readFile(path.join(root, "game-studio-drafts", files[0]!), "utf8");assert.deepEqual(JSON.parse(bytes).value, value);
    assert.doesNotMatch(bytes, /fixture-client|fixture-workspace|providers|token/);
    if (process.platform !== "win32") assert.equal((await stat(path.join(root, "game-studio-drafts", files[0]!))).mode & 0o077, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Studio draft CAS preserves concurrent state and replays an exact lost acknowledgment without another write", async () => {
  let data: unknown, writes = 0, loseAck = true;
  const backend = { read: async () => data, write: async (next: unknown) => { data = structuredClone(next);writes++;if (loseAck) { loseAck = false;throw Error("Lost save acknowledgment after commit"); } } };
  const a = new GameStudioDraftStore("same-fixture-scope", backend), b = new GameStudioDraftStore("same-fixture-scope", backend), value = draft();
  await assert.rejects(a.dispatch({ action: "draft-write", expectedRevision: 0, value }), /Lost save/);
  const recovered = await b.dispatch({ action: "draft-write", expectedRevision: 0, value });assert.equal(recovered.revision, 1);assert.equal(writes, 1);
  const changed = draft();changed.designEdit.values.premise = "Other window";
  await assert.rejects(a.dispatch({ action: "draft-write", expectedRevision: 0, value: changed }), /outra janela/);assert.equal(writes, 1);
  const pending = a.dispatch({ action: "draft-write", expectedRevision: 1, value: changed });changed.designEdit.values.premise = "Mutation after enqueue";
  const saved = await pending;assert.equal((saved.value!.designEdit as typeof changed.designEdit).values.premise, "Other window");
  const race = await Promise.allSettled([a.dispatch({ action: "draft-write", expectedRevision: 2, value: draft() }), b.dispatch({ action: "draft-write", expectedRevision: 2, value: changed })]);
  assert.equal(race.filter(row => row.status === "fulfilled").length, 1);assert.equal(race.filter(row => row.status === "rejected").length, 1);
  assert.equal((await a.dispatch({ action: "draft-read" })).revision, 3);
});

test("editor legacy Memento remains preserved but a confirmed private-file save becomes authoritative across host recreation",async()=>{
  const root=await mkdtemp(path.join(tmpdir(),"studio-editor-durable-"));
  try{
    const scope=gameStudioDraftKey({...reg,product:"companion-vscode"},"durable-editor");
    const legacy={revision:7,value:draft()};let legacyReads=0;
    const options={readLegacy:async()=>{legacyReads++;return structuredClone(legacy);}};
    const store=fileGameStudioDraftStore(root,scope,options);
    assert.deepEqual(await store.dispatch({action:"draft-read"}),legacy);
    const next=draft();next.designEdit.values.premise="Latest unsent editor text";
    const saved=await store.dispatch({action:"draft-write",expectedRevision:7,value:next});assert.equal(saved.revision,8);
    assert.equal(legacy.revision,7);assert.equal(legacy.value.designEdit.values.premise,"Unsaved design","never delete or rewrite the legacy input");
    const reads=legacyReads;
    const reopened=fileGameStudioDraftStore(root,scope,options);assert.deepEqual(await reopened.dispatch({action:"draft-read"}),saved);assert.equal(legacyReads,reads,"Memento cannot replace the durable acknowledged state");
    const file=path.join(root,"game-studio-drafts",scope+".json");await writeFile(file,"{preserved damaged current file",{mode:0o600});
    await assert.rejects(reopened.dispatch({action:"draft-read"}));assert.equal(legacyReads,reads,"a damaged current file must not silently fall back to older notes");assert.equal(await readFile(file,"utf8"),"{preserved damaged current file");
  }finally{await rm(root,{recursive:true,force:true});}
});

test("draft storage rejects unknown scope fields, oversized/cyclic/deep/non-JSON data without overwriting preserved state", async () => {
  let value: unknown = { revision: 1, value: draft() }, writes = 0;
  const store = new GameStudioDraftStore("invalid-draft-fixture", { read: async () => value, write: async () => { writes++; } });
  await assert.rejects(async () => store.dispatch({ action: "draft-read", sessionId: "forged" }));
  await assert.rejects(async () => store.dispatch({ action: "draft-write", expectedRevision: 1, value: { ...draft(), token: "not-a-supported-field" } }));
  assert.throws(() => parseGameStudioDraft({ ...draft(), designEdit: "x".repeat(2 * 1024 * 1024) }), /2 MiB/);
  const cyclic: { cycle?: unknown } = {};cyclic.cycle = cyclic;assert.throws(() => parseGameStudioDraft({ ...draft(), mediaEdit: cyclic }), /JSON/);
  let deep: unknown = null;for (let i = 0; i < 40; i++) deep = { child: deep };
  assert.throws(() => parseGameStudioDraft({ ...draft(), mediaEdit: deep }), /estrutura/);
  assert.throws(() => parseGameStudioDraft({ ...draft(), mediaEdit: { frequency: NaN } }), /JSON/);
  assert.equal(writes, 0);
  value = { revision: -1, value: draft() };await assert.rejects(store.dispatch({ action: "draft-write", expectedRevision: 0, value: draft() }));assert.equal(writes, 0);
});

test("normal host close waits for the pending draft write and a read does not erase a failed save", async () => {
  let data: unknown, release = () => {}, started = false, fail = false;
  const store = new GameStudioDraftStore("close-flush-fixture", { read: async () => data, write: async value => {
    started = true;if (fail) throw Error("Save failed");await new Promise<void>(resolve => { release = resolve; });data = value;
  } });
  const save = store.dispatch({ action: "draft-write", expectedRevision: 0, value: draft() });
  let closed = false;const close = store.flush().then(() => { closed = true; });
  for (let i = 0; i < 20 && !started; i++) await new Promise(resolve => setTimeout(resolve, 1));
  assert.equal(started, true);assert.equal(closed, false);release();await save;await close;assert.equal(closed, true);
  fail = true;await assert.rejects(store.dispatch({ action: "draft-write", expectedRevision: 1, value: null }), /Save failed/);
  await store.dispatch({ action: "draft-read" });await assert.rejects(store.flush(), /Save failed/);
});

test("Mac draft files preserve corrupted data and refuse links or public permissions", { skip: process.platform === "win32" }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), "studio-draft-files-"));
  try {
    const scope = gameStudioDraftKey(reg, "file-guards"), store = desktopGameStudioDraftStore(root, scope);
    await store.dispatch({ action: "draft-read" });const file = path.join(root, "game-studio-drafts", scope + ".json");
    const broken = "{preserved invalid data";await writeFile(file, broken, { mode: 0o600 });
    await assert.rejects(store.dispatch({ action: "draft-write", expectedRevision: 0, value: draft() }));assert.equal(await readFile(file, "utf8"), broken);
    await rm(file);const original = path.join(root, "keep.json");await writeFile(original, "untouched", { mode: 0o600 });await symlink(original, file);
    await assert.rejects(store.dispatch({ action: "draft-read" }), /privado/);assert.equal(await readFile(original, "utf8"), "untouched");
    await rm(file);await link(original, file);await assert.rejects(store.dispatch({ action: "draft-read" }), /privado/);
    await rm(file);await writeFile(file, JSON.stringify({ revision: 1, value: draft() }), { mode: 0o600 });await chmod(file, 0o644);
    await assert.rejects(store.dispatch({ action: "draft-read" }), /privado/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
