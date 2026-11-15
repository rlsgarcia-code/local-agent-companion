import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import test from "node:test";
import { AgentService } from "../packages/agent-service/src/service";
import { Store } from "../packages/agent-service/src/store";
import { LocalServer } from "../packages/agent-service/src/server";
import { createClientCredential, ensureIdentity, ipcPath } from "../packages/agent-service/src/security";
import { AgentClient } from "../packages/client-ts/src/index";
import type { GameProject, GameProjectSnapshot } from "../packages/contracts/src/games";
import type { Transfer } from "../packages/contracts/src/transfers";
import type { Registration } from "../packages/contracts/src/index";
import { fixtureGameDocument } from "./game-fixtures";

const registration: Registration = { id: "games-mac", product: "companion-mac", profile: "default", workspace: "", providers: ["ollama"], hostTools: [] };
const request = (service: AgentService, method: string, params: unknown, reg = registration) => service.dispatch(reg, method, params, "game-fixture");

test("game metadata survives service restart, keeps all revisions, and isolates products/profiles/workspaces", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "game-project-store-")), file = path.join(directory, "metadata.sqlite");
  let service = new AgentService(new Store(file), directory);
  try {
    const document = fixtureGameDocument();
    const created = await request(service, "games.projects.create", { requestId: "create", document }) as GameProject;
    const next = { ...document, title: "Garden with new art" };
    const edited = await request(service, "games.revisions.commit", { projectId: created.id, requestId: "edit", expectedRevision: 1, document: next, message: "Change visual direction" }) as GameProject;
    assert.equal(edited.revision, 2);
    assert.deepEqual(await request(service, "games.projects.create", { requestId: "create", document }), created);
    await assert.rejects(request(service, "games.projects.create", { requestId: "create", document: next }), /different content/);
    await assert.rejects(request(service, "games.revisions.commit", { projectId: created.id, requestId: "stale", expectedRevision: 1, document, message: "Stale write" }), /Refresh/);
    for (const other of [{ ...registration, product: "companion-vscode" as const }, { ...registration, profile: "other" }, { ...registration, workspace: "/other" }]) {
      await assert.rejects(request(service, "games.projects.get", { id: created.id }, other), /not found/);
      const list = await request(service, "games.projects.list", {}, other) as { projects: unknown[] };
      assert.deepEqual(list.projects, []);
    }
    await assert.rejects(request(service, "games.projects.create", { requestId: "forged", document: { ...document, published: true, approvals: ["parent"] } }));
    await service.close();
    service = new AgentService(new Store(file), directory);
    assert.deepEqual(await request(service, "games.projects.get", { id: created.id }), edited);
    const history = await request(service, "games.revisions.list", { projectId: created.id }) as { revisions: { revision: number }[] };
    assert.deepEqual(history.revisions.map((row) => row.revision), [1, 2]);
    const first = await request(service, "games.events.read", { projectId: created.id, limit: 1 }) as { events: unknown[]; cursor: number; hasMore: boolean };
    assert.equal(first.events.length, 1);
    assert.equal(first.hasMore, true);
    const rest = await request(service, "games.events.read", { projectId: created.id, cursor: first.cursor }) as { events: unknown[] };
    assert.equal(rest.events.length, 1);
    assert.equal((service.store.db.prepare("SELECT count(*) AS n FROM runs").get() as { n: number }).n, 0);
    assert.equal((service.store.db.prepare("SELECT count(*) AS n FROM receipts").get() as { n: number }).n, 0);
  } finally { await service.close(); await rm(directory, { recursive: true, force: true }); }
});

test("concurrent project commits have one winner and failed transactions do not leave partial revisions", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "game-project-race-")), file = path.join(directory, "metadata.sqlite");
  const first = new AgentService(new Store(file), directory), second = new AgentService(new Store(file), directory);
  try {
    const document = fixtureGameDocument();
    const created = await request(first, "games.projects.create", { requestId: "create", document }) as GameProject;
    const results = await Promise.allSettled([first, second].map((service, i) => request(service, "games.revisions.commit", {
      projectId: created.id, requestId: `race-${i}`, expectedRevision: 1, document: { ...document, title: `Winner ${i}` }, message: "Concurrent edit",
    })));
    assert.equal(results.filter((row) => row.status === "fulfilled").length, 1);
    assert.equal(results.filter((row) => row.status === "rejected").length, 1);
    first.store.db.exec("CREATE TRIGGER fail_game_event BEFORE INSERT ON game_project_events BEGIN SELECT RAISE(ABORT, 'fixture-event-failure'); END;");
    const retry = { projectId: created.id, requestId: "atomic", expectedRevision: 2, document, message: "Atomic commit" };
    await assert.rejects(request(first, "games.revisions.commit", retry), /fixture-event-failure/);
    assert.equal((await request(second, "games.projects.get", { id: created.id }) as GameProject).revision, 2);
    assert.equal((first.store.db.prepare("SELECT count(*) AS n FROM game_revisions WHERE project=?").get(created.id) as { n: number }).n, 2);
    first.store.db.exec("DROP TRIGGER fail_game_event");
    assert.equal((await request(second, "games.revisions.commit", retry) as GameProject).revision, 3);
    await assert.rejects(request(first, "games.revisions.commit", { ...retry, requestId: "engine-switch", expectedRevision: 3, document: { ...document, engine: "godot" } }), /cannot change implicitly/);
  } finally { await first.close(); await second.close(); await rm(directory, { recursive: true, force: true }); }
});

test("authenticated SDKs transfer large source files and preserve complete project history across import", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "game-project-sdk-"));
  const store = new Store(path.join(directory, "metadata.sqlite"));
  const credential = await createClientCredential(directory, registration); store.register(credential);
  const other = { ...registration, id: "games-editor", product: "companion-vscode" as const };
  const otherCredential = await createClientCredential(directory, other); store.register(otherCredential);
  const identity = await ensureIdentity(directory), service = new AgentService(store, directory), server = new LocalServer(service, directory);
  let client: AgentClient | undefined, target: AgentClient | undefined;
  try {
    await server.listen();
    client = new AgentClient({ address: ipcPath(directory), certificate: identity.cert, credential });
    target = new AgentClient({ address: ipcPath(directory), certificate: identity.cert, credential: otherCredential });
    await client.connect(); await target.connect();
    const bytes = Buffer.alloc(9 * 1024 * 1024, 42), file = await client.uploadGameFile("assets/landscape.bin", bytes, "application/octet-stream");
    const document = fixtureGameDocument(); document.files = [file];
    const project = await client.createGameProject("sdk-create", document);
    const linkedSession = await client.call<{ id: string }>("sessions.create", { title: "Game continuation" });
    assert.equal(await client.linkedGameProject(linkedSession.id), null);
    assert.equal((await client.selectGameProject(linkedSession.id, project.id)).id, project.id);
    assert.equal((await client.linkedGameProject(linkedSession.id))!.id, project.id);
    await client.commitGameRevision(project.id, "sdk-edit", 1, { ...document, title: "Second revision" }, "Refine game");
    assert.deepEqual(await client.downloadGameFile(project.id, file.path, 1), bytes);
    await assert.rejects(target.getGameProject(project.id), /not found/);
    await assert.rejects(target.createGameProject("forged-transfer", document), /not found/);
    await assert.rejects(client.createGameProject("wrong-digest", { ...document, files: [{ ...file, sha256: "0".repeat(64) }] }), /matching/);
    const archive = await client.exportGameProject(project.id);
    assert.equal(archive.revisions.length, 2);
    const imported = await target.importGameProject("sdk-import", archive, new Map([[file.sha256, bytes]]));
    assert.equal(imported.revision, 2);
    assert.equal(imported.contentHash, archive.revisions[1]!.contentHash);
    assert.deepEqual(await target.importGameProject("sdk-import", archive, new Map([[file.sha256, bytes]])), imported);
    assert.deepEqual(await target.downloadGameFile(imported.id, file.path, 1), bytes);
    assert.notEqual((await target.getGameRevision(imported.id, 1)).document.files[0]!.transferId, file.transferId);
    assert.throws(() => store.db.prepare("DELETE FROM transfers WHERE id=?").run(file.transferId), /FOREIGN KEY/);
    const broken = structuredClone(archive); broken.revisions[1]!.document.title = "Unacknowledged edit";
    await assert.rejects(target.importGameProject("tampered", broken, new Map([[file.sha256, bytes]])), /content hash/);
    assert.equal((await target.listGameProjects()).projects.length, 1);

    // A request larger than the SDK inline threshold must use existing chunked transfers.
    const many = fixtureGameDocument();
    const small = await client.uploadGameFile("fixture.txt", Buffer.from("fixture"), "text/plain");
    many.files = Array.from({ length: 2500 }, (_, i) => ({ ...small, path: `assets/${String(i).padStart(5, "0")}-${"landscape".repeat(16)}.txt` }));
    const large = await client.createGameProject("large-metadata", many);
    assert.equal((await client.snapshotGameProject(large.id)).revision.document.files.length, 2500);
    assert.equal((await client.readGameEvents(large.id)).events.length, 1);

    if (process.platform !== "win32") {
      const certificate = path.join(directory, "fixture.crt"), credentials = path.join(directory, "python-client.json");
      await writeFile(certificate, identity.cert, { mode: 0o600 });
      await writeFile(credentials, JSON.stringify(credential), { mode: 0o600 });
      const code = `import sys,json\nsys.path.insert(0,sys.argv[1])\nfrom companion_client import AgentClient\nfrom pathlib import Path\nc=AgentClient(sys.argv[2],Path(sys.argv[3]),Path(sys.argv[4]))\nc.connect()\na=c.export_game_project(sys.argv[5])\ndata=c.download_game_file(sys.argv[5],a['revisions'][0]['document']['files'][0]['path'],1)\nassert len(data)==9*1024*1024\np=c.import_game_project('python-import',a,{a['revisions'][0]['document']['files'][0]['sha256']:data})\nassert p['revision']==2\nassert c.snapshot_game_project(p['id'])['revision']['document']['title']=='Second revision'\nc.close()\nprint(json.dumps({'sdk':'python','history':p['revision'],'fileBytes':len(data)}))`;
      const linkedCode = code.replace("c.close()", "assert c.linked_game_project(sys.argv[6])['id']==sys.argv[5]\nassert c.select_game_project(sys.argv[6],p['id'])['id']==p['id']\nc.close()");
      const result = await promisify(execFile)("python3", ["-I", "-c", linkedCode, path.resolve("packages/client-python"), ipcPath(directory), certificate, credentials, project.id, linkedSession.id], { timeout: 90000 });
      assert.deepEqual(JSON.parse(result.stdout), { sdk: "python", history: 2, fileBytes: bytes.length });
    }
    const snapshotTransfer = await request(service, "games.projects.snapshot", { id: project.id }) as Transfer;
    const snapshot = JSON.parse((await client.download(snapshotTransfer.id)).toString()) as GameProjectSnapshot;
    assert.equal(snapshot.project.revision, snapshot.revision.revision);
  } finally { client?.close(); target?.close(); await server.close(); await rm(directory, { recursive: true, force: true }); }
});
