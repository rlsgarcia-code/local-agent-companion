import { randomUUID } from "node:crypto";
import { AgentError, errors, type Registration } from "../../contracts/src/index";
import { contentHash } from "../../contracts/src/identity";
import {
  gameDocument, gameProjectArchive, gameProjectCreate, gameRevisionCommit,
  gameMutationInspect, gameMutationInspection, type GameMutationInspection,
  type GameDocument, type GameFile, type GameProject, type GameProjectArchive,
  type GameProjectEvent, type GameRevision,
} from "../../contracts/src/games";
import { gameContentHash } from "../../game-design/src/project";
import {compareGameRevisions} from "../../game-design/src/comparison";
import {gameRevisionCompare} from "../../contracts/src/game-comparison";
import {gameFileCompare} from '../../contracts/src/game-file-comparison';
import {compareGameFile,FileComparisonError} from '../../game-design/src/file-comparison';
import type { z } from "zod";
import type { Store } from "./store";
import { namespace } from "./security";

const MAX_DOCUMENT_BYTES = 32 * 1024 * 1024;
type Row = { value: string };
type FileVerifier = (registration: Registration, file: GameFile) => void;

/** Domain metadata only. No project paths, commands, production authority or model calls. */
export class GameProjects {
  constructor(private readonly store: Store, private readonly verifyFile: FileVerifier) {
    store.db.exec(`
      CREATE TABLE IF NOT EXISTS game_projects(id TEXT PRIMARY KEY,namespace TEXT NOT NULL,value TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS game_projects_namespace ON game_projects(namespace);
      CREATE TABLE IF NOT EXISTS game_revisions(project TEXT NOT NULL REFERENCES game_projects(id),revision INTEGER NOT NULL,value TEXT NOT NULL,PRIMARY KEY(project,revision));
      CREATE TABLE IF NOT EXISTS game_project_mutations(namespace TEXT NOT NULL,id TEXT NOT NULL,hash TEXT NOT NULL,value TEXT NOT NULL,PRIMARY KEY(namespace,id));
      CREATE TABLE IF NOT EXISTS game_project_events(sequence INTEGER PRIMARY KEY AUTOINCREMENT,namespace TEXT NOT NULL,project TEXT NOT NULL REFERENCES game_projects(id),value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS game_file_references(transfer TEXT NOT NULL REFERENCES transfers(id),project TEXT NOT NULL REFERENCES game_projects(id),revision INTEGER NOT NULL,path TEXT NOT NULL,PRIMARY KEY(project,revision,path));
    `);
  }

  private mutation<T>(reg: Registration, requestId: string, input: unknown, apply: () => T): T {
    return this.store.db.transaction(() => {
      const ns = namespace(reg), digest = contentHash(input);
      const old = this.store.db.prepare("SELECT hash,value FROM game_project_mutations WHERE namespace=? AND id=?")
        .get(ns, requestId) as { hash: string; value: string } | undefined;
      if (old) {
        if (old.hash !== digest) throw new AgentError(errors.conflict, "Game request identity was used for different content.");
        return JSON.parse(old.value) as T;
      }
      const result = apply();
      this.store.db.prepare("INSERT INTO game_project_mutations VALUES(?,?,?,?)").run(ns, requestId, digest, JSON.stringify(result));
      return result;
    }).immediate();
  }

  private validate(reg: Registration, input: GameDocument): GameDocument {
    const document = gameDocument.parse(input);
    if (Buffer.byteLength(JSON.stringify(document)) > MAX_DOCUMENT_BYTES)
      throw new AgentError(errors.invalid, "Game metadata exceeds 32 MiB; original project data was preserved.");
    for (const file of document.files) this.verifyFile(reg, file);
    return document;
  }

  get(reg: Registration, id: string): GameProject {
    const row = this.store.db.prepare("SELECT value FROM game_projects WHERE namespace=? AND id=?").get(namespace(reg), id) as Row | undefined;
    if (!row) throw new AgentError(errors.missing, "Game project not found in this product/profile/workspace.");
    return JSON.parse(row.value) as GameProject;
  }

  inspectMutation(reg: Registration, input: unknown): GameMutationInspection {
    const request = gameMutationInspect.parse(input);this.get(reg, request.projectId);
    const row = this.store.db.prepare("SELECT hash,value FROM game_project_mutations WHERE namespace=? AND id=?")
      .get(namespace(reg), request.requestId) as { hash: string; value: string } | undefined;
    const missing = { ...request, state: "missing" as const };
    if (!row) return missing;
    const project = JSON.parse(row.value) as GameProject;
    if (project.id !== request.projectId) return missing;
    // This acknowledges only an atomic domain mutation, not tools, approvals,
    // current selection or game quality. Consumers must compare the original binding.
    return gameMutationInspection.parse({ ...request, state: "acknowledged", bindingHash: row.hash, revision: project.revision, contentHash: project.contentHash });
  }

  list(reg: Registration, cursor = 0, limit = 30): { projects: GameProject[]; cursor: number; hasMore: boolean } {
    const rows = this.store.db.prepare("SELECT rowid,value FROM game_projects WHERE namespace=? AND rowid>? ORDER BY rowid LIMIT ?")
      .all(namespace(reg), cursor, limit + 1) as (Row & { rowid: number })[];
    return { projects: rows.slice(0, limit).map((row) => JSON.parse(row.value) as GameProject),
      cursor: rows.slice(0, limit).at(-1)?.rowid ?? cursor, hasMore: rows.length > limit };
  }

  revision(reg: Registration, projectId: string, revision?: number): GameRevision {
    const project = this.get(reg, projectId);
    const row = this.store.db.prepare("SELECT value FROM game_revisions WHERE project=? AND revision=?")
      .get(projectId, revision ?? project.revision) as Row | undefined;
    if (!row) throw new AgentError(errors.missing, "Game revision not found.");
    return JSON.parse(row.value) as GameRevision;
  }

  revisions(reg: Registration, projectId: string, cursor = 0, limit = 100,order:"asc"|"desc"="asc"): {
    revisions: Omit<GameRevision, "document">[]; cursor: number; hasMore: boolean;
  } {
    this.get(reg, projectId);
    const descending=order==="desc";
    const rows = this.store.db.prepare(`SELECT value FROM game_revisions WHERE project=? AND revision${descending?"<":">"}? ORDER BY revision ${descending?"DESC":"ASC"} LIMIT ?`)
      .all(projectId,descending?(cursor||Number.MAX_SAFE_INTEGER):cursor, limit + 1) as Row[];
    const revisions = rows.slice(0, limit).map((row) => {
      const { document: _document, ...metadata } = JSON.parse(row.value) as GameRevision;
      return metadata;
    });
    return { revisions, cursor: revisions.at(-1)?.revision ?? cursor, hasMore: rows.length > limit };
  }

  compare(reg:Registration,input:unknown){
    const request=gameRevisionCompare.parse(input);
    return this.store.db.transaction(()=>compareGameRevisions(this.revision(reg,request.projectId,request.baseRevision),this.revision(reg,request.projectId,request.targetRevision),request))();
  }
  compareFile(reg:Registration,input:unknown,read:(file:GameFile)=>Uint8Array){
    const request=gameFileCompare.parse(input);
    try{return this.store.db.transaction(()=>compareGameFile(this.revision(reg,request.projectId,request.baseRevision),this.revision(reg,request.projectId,request.targetRevision),request,read))();}
    catch(error){if(error instanceof FileComparisonError)throw new AgentError(errors[error.kind],error.message);throw error;}
  }

  events(reg: Registration, projectId: string, cursor = 0, limit = 100): {
    events: GameProjectEvent[]; cursor: number; hasMore: boolean;
  } {
    this.get(reg, projectId);
    const rows = this.store.db.prepare("SELECT sequence,value FROM game_project_events WHERE namespace=? AND project=? AND sequence>? ORDER BY sequence LIMIT ?")
      .all(namespace(reg), projectId, cursor, limit + 1) as (Row & { sequence: number })[];
    const events = rows.slice(0, limit).map((row) => ({ ...JSON.parse(row.value), sequence: row.sequence } as GameProjectEvent));
    return { events, cursor: events.at(-1)?.sequence ?? cursor, hasMore: rows.length > limit };
  }

  private append(reg: Registration, revision: GameRevision, type: GameProjectEvent["type"]): void {
    const event = { projectId: revision.projectId, type, revision: revision.revision,
      contentHash: revision.contentHash, createdAt: revision.createdAt };
    this.store.db.prepare("INSERT INTO game_project_events(namespace,project,value) VALUES(?,?,?)")
      .run(namespace(reg), revision.projectId, JSON.stringify(event));
  }

  private pinFiles(revision: GameRevision): void {
    const insert = this.store.db.prepare("INSERT INTO game_file_references VALUES(?,?,?,?)");
    for (const file of revision.document.files) insert.run(file.transferId, revision.projectId, revision.revision, file.path);
  }

  private insert(reg: Registration, document: GameDocument, origin: GameRevision["origin"]): GameProject {
    const id = randomUUID(), now = Date.now(), digest = gameContentHash(document);
    const project: GameProject = { id, title: document.title, engine: document.engine,
      dimension: document.brief.dimension, revision: 1, contentHash: digest, createdAt: now, updatedAt: now };
    this.store.db.prepare("INSERT INTO game_projects VALUES(?,?,?)").run(id, namespace(reg), JSON.stringify(project));
    const revision: GameRevision = { projectId: id, revision: 1, contentHash: digest, parentHash: null,
      document, message: origin === "imported" ? "Imported domain; requires explicit continuation" : "Project created",
      createdAt: now, origin };
    this.store.db.prepare("INSERT INTO game_revisions VALUES(?,?,?)").run(id, 1, JSON.stringify(revision));
    this.pinFiles(revision);
    this.append(reg, revision, origin === "imported" ? "project.imported" : "project.created");
    return project;
  }

  create(reg: Registration, input: z.infer<typeof gameProjectCreate>): GameProject {
    const request = gameProjectCreate.parse(input);
    return this.mutation(reg, request.requestId, { method: "create", ...request }, () => this.insert(reg, this.validate(reg, request.document), "created"));
  }

  commit(reg: Registration, input: z.infer<typeof gameRevisionCommit>): GameProject {
    const request = gameRevisionCommit.parse(input);
    return this.mutation(reg, request.requestId, { method: "commit", ...request }, () => {
      const previous = this.get(reg, request.projectId);
      if (request.expectedRevision !== previous.revision)
        throw new AgentError(errors.conflict, "Game project changed. Refresh before committing a revision.");
      const document = this.validate(reg, request.document);
      if (document.engine !== previous.engine || document.brief.dimension !== previous.dimension)
        throw new AgentError(errors.conflict, "Engine and dimension cannot change implicitly. Create an explicit new project for conversion.");
      const now = Date.now(), digest = gameContentHash(document);
      const revision: GameRevision = { projectId: previous.id, revision: previous.revision + 1,
        contentHash: digest, parentHash: previous.contentHash, document, message: request.message, createdAt: now, origin: "edited" };
      this.store.db.prepare("INSERT INTO game_revisions VALUES(?,?,?)").run(previous.id, revision.revision, JSON.stringify(revision));
      this.pinFiles(revision);
      const project = { ...previous, title: document.title, revision: revision.revision, contentHash: digest, updatedAt: now };
      this.store.db.prepare("UPDATE game_projects SET value=? WHERE id=?").run(JSON.stringify(project), previous.id);
      this.append(reg, revision, "project.revised");
      return project;
    });
  }

  snapshot(reg: Registration, id: string) {
    return this.store.db.transaction(() => {
      const project = this.get(reg, id), revision = this.revision(reg, id, project.revision);
      const row = this.store.db.prepare("SELECT max(sequence) AS cursor FROM game_project_events WHERE namespace=? AND project=?")
        .get(namespace(reg), id) as { cursor: number | null };
      return { project, revision, cursor: row.cursor ?? 0 };
    })();
  }

  export(reg: Registration, id: string): GameProjectArchive {
    return this.store.db.transaction(() => {
      this.get(reg, id);
      const rows = this.store.db.prepare("SELECT value FROM game_revisions WHERE project=? ORDER BY revision").all(id) as Row[];
      return gameProjectArchive.parse({ schemaVersion: 2, kind: "companion-game-project", revisions: rows.map((row) => {
        const { projectId: _project, ...revision } = JSON.parse(row.value) as GameRevision;
        return revision;
      }) });
    })();
  }

  /** Import is domain-only. Source transfer IDs never authorize access in the target namespace. */
  import(reg: Registration, requestId: string, input: unknown, blobs: { sha256: string; transferId: string }[]): GameProject {
    const archive = gameProjectArchive.parse(input);
    const mapping = new Map(blobs.map((blob) => [blob.sha256, blob.transferId]));
    if (mapping.size !== blobs.length) throw new AgentError(errors.invalid, "Imported blob identities must be unique.");
    return this.mutation(reg, requestId, { method: "import", archive, blobs }, () => {
      const revisions: GameRevision[] = [];
      let parentHash: string | null = null;
      const firstDocument = archive.revisions[0]!.document;
      const neededBlobs = new Set(archive.revisions.flatMap((row) => row.document.files.map((file) => file.sha256)));
      if (mapping.size !== neededBlobs.size || [...mapping.keys()].some((sha) => !neededBlobs.has(sha)))
        throw new AgentError(errors.invalid, "Imported blobs must match the complete project history.");
      for (const [index, row] of archive.revisions.entries()) {
        if (row.revision !== index + 1 || row.parentHash !== parentHash || row.contentHash !== gameContentHash(row.document))
          throw new AgentError(errors.invalid, "Imported game history is incomplete or its content hash does not match.");
        if (row.document.engine !== firstDocument.engine || row.document.brief.dimension !== firstDocument.brief.dimension)
          throw new AgentError(errors.invalid, "Imported history cannot silently change engine or dimension.");
        const document = this.validate(reg, { ...row.document, files: row.document.files.map((file) => {
          const transferId = mapping.get(file.sha256);
          if (!transferId) throw new AgentError(errors.invalid, "An imported game file is missing its verified target blob.");
          return { ...file, transferId };
        }) });
        revisions.push({ ...row, document, projectId: "", origin: "imported" });
        parentHash = row.contentHash;
      }
      const first = revisions[0]!, project = this.insert(reg, first.document, "imported");
      // Preserve domain history and its times; imported records are never live approvals or evidence.
      for (const revision of revisions) {
        revision.projectId = project.id;
        this.store.db.prepare("INSERT INTO game_revisions VALUES(?,?,?) ON CONFLICT(project,revision) DO UPDATE SET value=excluded.value")
          .run(project.id, revision.revision, JSON.stringify(revision));
        if (revision.revision > 1) {
          this.pinFiles(revision);
          this.append(reg, revision, "project.imported");
        }
      }
      const last = revisions.at(-1)!;
      const imported: GameProject = { ...project, title: last.document.title, revision: last.revision, contentHash: last.contentHash };
      this.store.db.prepare("UPDATE game_projects SET value=? WHERE id=?").run(JSON.stringify(imported), project.id);
      return imported;
    });
  }
}
