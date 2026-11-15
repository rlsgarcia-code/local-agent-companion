import { createHash } from "node:crypto";
import { z } from "zod";
import { AgentError, errors, type Registration, type ToolSpec } from "../../contracts/src/index";
import { gameAgentSchemas, gameAgentDescriptions, type GameAgentToolName } from "../../contracts/src/game-agent";
import type { GameProject, GameDocument } from "../../contracts/src/games";
import { gameProductionModule } from "../../game-design/src/production";
import { namespace } from "./security";
import type { Store } from "./store";
import type { GameProjects } from "./game-projects";
import type { GameProduction } from "./game-production";
import type { GameBlobAccess } from "../../game-production/src/index";
import type { GameCompletionEvidence } from "../../contracts/src/game-agent";
import type { GameWorkflows } from "./game-workflows";
import { checkGameBrowserRecipe, gameBrowserRecipeSizeCheck } from "../../contracts/src/game-browser-tests";
import { MAX_GAME_EDIT_TEXT_BYTES } from "../../contracts/src/game-text-edits";
import { applyGameTextEdits, GameTextEditError } from "../../game-production/src/text-edits";
import { gameReportPage, readGameReportText, MAX_REPORT_TEXT_BYTES, GameReportViewError } from "../../game-production/src/report-views";
import {prepareGameReviewImage} from "../../game-production/src/image-review";
import type {GameImageReview} from "../../contracts/src/game-image-review";
import type { GameValidationReport } from "../../contracts/src/game-production";
import {MAX_GAME_SOURCE_VIEW_BYTES} from '../../contracts/src/game-source-views';
import {readGameSourceText,GameSourceViewError} from '../../game-production/src/source-views';

const read = new Set<GameAgentToolName>(["game_studio", "game_projects", "game_project", "game_design", "game_assets", "game_libraries", "game_read_file", "game_check_tests", "game_job", "game_jobs", "game_reports", "game_report", "game_read_report_file", "game_quality", "game_asset_result", "game_workflow", "game_review_image"]);
function reportHeader(report: GameValidationReport) {
  return { id: report.id, jobId: report.jobId, buildId: report.buildId, projectId: report.projectId, revision: report.revision,
    sourceHash: report.sourceHash, artifactHash: report.artifactHash, collectorId: report.collectorId, toolchain: report.toolchain,
    category: report.category, environment: report.environment, createdAt: report.createdAt, ...(report.testCase ? { testCase: report.testCase } : {}),
    counts: { checks: report.checks.length, passed: report.checks.filter(check => check.status === "passed").length,
      failed: report.checks.filter(check => check.status === "failed").length, unverified: report.checks.filter(check => check.status === "unverified").length,
      evidence: report.evidence?.length ?? 0, metrics: Object.keys(report.metrics).length,
      contentCoverage: report.coverage?.contentIds.length ?? 0, scenarioCoverage: report.coverage?.scenarioIds.length ?? 0 }, coverageDeclared: report.coverage !== undefined };
}
function reportView<T>(read: () => T): T {
  try { return read(); } catch (error) { if (error instanceof GameReportViewError) throw new AgentError(errors.invalid, error.message);throw error; }
}
export const GAME_AGENT_TOOLS: readonly ToolSpec[] = Object.entries(gameAgentSchemas).map(([name, schema]) => ({
  name, description: gameAgentDescriptions[name as GameAgentToolName], schema: z.toJSONSchema(schema, { io: "input" }) as Record<string, unknown>,
  effect: read.has(name as GameAgentToolName) ? "read" : ["game_build", "game_validate", "game_process_assets"].includes(name) ? "external" : "write",
  host: "service-game", evidenceKind: read.has(name as GameAgentToolName) || ["game_select", "game_advance_stage"].includes(name) ? "note" : ["game_build", "game_validate", "game_process_assets"].includes(name) ? "command" : "diff",
}));
export function gameAgentDefinition(name: string): ToolSpec | undefined { return GAME_AGENT_TOOLS.find((tool) => tool.name === name); }

/** Game domain operations only. No process, shell, arbitrary filesystem or public registration. */
export class GameAgentTools {
  constructor(private readonly store: Store, private readonly projects: GameProjects, private readonly production: GameProduction, private readonly blobs: GameBlobAccess, private readonly workflows: GameWorkflows) {
    store.db.exec("CREATE TABLE IF NOT EXISTS game_session_projects(namespace TEXT NOT NULL,session TEXT NOT NULL REFERENCES sessions(id),project TEXT NOT NULL REFERENCES game_projects(id),PRIMARY KEY(namespace,session));");
  }
  private link(reg: Registration, sessionId: string, project: GameProject) {
    this.store.db.prepare("INSERT INTO game_session_projects VALUES(?,?,?) ON CONFLICT(namespace,session) DO UPDATE SET project=excluded.project")
      .run(namespace(reg), sessionId, project.id);
  }
  linked(reg: Registration, sessionId: string) {
    this.store.session(reg, sessionId);
    const row = this.store.db.prepare("SELECT project FROM game_session_projects WHERE namespace=? AND session=?").get(namespace(reg), sessionId) as { project: string } | undefined;
    return row ? this.projects.get(reg, row.project) : null;
  }
  select(reg: Registration, sessionId: string, projectId: string) {
    this.store.session(reg, sessionId);
    const project = this.projects.get(reg, projectId);
    this.link(reg, sessionId, project);
    return project;
  }
  prepare(name: string, input: unknown) {
    const schema = gameAgentSchemas[name as GameAgentToolName];
    if (!schema) throw new AgentError(errors.forbidden, "This game tool is not installed.");
    return schema.parse(input);
  }
  /** Pure installed-target checks, before consent; never probe, reserve or run a collector. */
  preflight(reg: Registration, name: string, input: unknown): void {
    if (name === "game_validate") this.production.preflightValidation(reg, this.prepare(name, input) as z.infer<typeof gameAgentSchemas.game_validate>);
  }
  reviewImage(reg:Registration,sessionId:string,input:unknown){
    if(reg.product==="kidos")throw new AgentError(errors.forbidden,"KidOS image review requires its protected Core adapter.");
    this.store.session(reg,sessionId);const request=this.prepare("game_review_image",input) as GameImageReview;
    const source=request.source;
    let file:import('../../contracts/src/games').GameFile,binding:Omit<import('../../contracts/src/game-image-review').GameImageBinding,'file'|'width'|'height'>;
    if(source.kind==="project"){
      const revision=this.projects.revision(reg,source.projectId,source.revision),found=revision.document.files.find(file=>file.path===source.path);
      if(!found)throw new AgentError(errors.missing,"Image is not present in the exact game revision.");
      file=found;binding={projectId:revision.projectId,revision:revision.revision,sourceHash:revision.contentHash};
    }else{
      const report=this.production.report(reg,source.reportId);file=this.production.reportFile(reg,report.id,source.path);
      binding={projectId:report.projectId,revision:report.revision,sourceHash:report.sourceHash,reportId:report.id,buildId:report.buildId,artifactHash:report.artifactHash};
    }
    try{return prepareGameReviewImage(file,()=>this.blobs.read(reg,file),binding);}
    catch{throw new AgentError(errors.invalid,"Image review requires an exact supported PNG within the byte/pixel limits. Original data was preserved.");}
  }
  async invoke(reg: Registration, sessionId: string, key: string, name: string, input: unknown): Promise<unknown> {
    if (reg.product === "kidos") throw new AgentError(errors.forbidden, "KidOS game production requires its protected Core adapter.");
    this.store.session(reg, sessionId);
    const args = this.prepare(name, input);
    switch (name as GameAgentToolName) {
      case "game_review_image": throw new AgentError(errors.unavailable,"The private engine vision reviewer is required; raw images cannot be returned as tool text.");
      case "game_studio": return { module: { id: gameProductionModule.id, version: gameProductionModule.version, schemaVersion: 2 },
        guide: gameProductionModule.guide, project: this.linked(reg, sessionId), capabilities: await this.production.capabilities(reg),
        note: "Production and quality are separate; no publication, host file export or approval is implied." };
      case "game_libraries":return this.production.libraries(reg,args);
      case "game_workflow": {
        const request = args as z.infer<typeof gameAgentSchemas.game_workflow>, state = this.workflows.snapshot(reg, request.projectId);
        const index = state.workflow ? state.gates.findIndex((gate) => gate.stage === state.workflow!.stage) : 0;
        const blockers = state.gates.slice(0, index + 1).flatMap((gate) => gate.blockers);
        return { ...state, gates: state.gates.map(({ stage, ready, blockers }) => ({ stage, ready, blockersCount: blockers.length })),
          blockers: blockers.slice(request.cursor, request.cursor + request.limit), cursor: request.cursor + Math.min(request.limit, Math.max(0, blockers.length - request.cursor)), hasMore: request.cursor + request.limit < blockers.length };
      }
      case "game_advance_stage": return this.workflows.advance(reg, { requestId: key, ...args });
      case "game_projects": return this.projects.list(reg, (args as z.infer<typeof gameAgentSchemas.game_projects>).cursor, 20);
      case "game_select": return this.select(reg, sessionId, (args as { projectId: string }).projectId);
      case "game_project": {
        const { projectId, fileCursor, limit } = args as z.infer<typeof gameAgentSchemas.game_project>;
        const snapshot = this.projects.snapshot(reg, projectId), { files, design, assets, ...document } = snapshot.revision.document;
        return { ...snapshot, revision: { ...snapshot.revision, document: { ...document,
          design: Buffer.byteLength(JSON.stringify(design)) <= 64000 ? design : { schemaVersion: 2, message: "Read complete sections through game_design; original design is preserved." },
          files: files.slice(fileCursor, fileCursor + limit), assets: assets.slice(0, limit) } },
          files: { cursor: fileCursor + Math.min(limit, Math.max(0, files.length - fileCursor)), hasMore: fileCursor + limit < files.length, total: files.length },
          assetCount: assets.length };
      }
      case "game_design": {
        const { projectId, section, cursor, limit } = args as z.infer<typeof gameAgentSchemas.game_design>;
        const revision = this.projects.revision(reg, projectId), design = revision.document.design;
        if (!design) return { design: null, revision: revision.revision };
        const value = design[section];
        return { revision: revision.revision, section, value: Array.isArray(value) ? value.slice(cursor, cursor + limit) : value,
          ...(Array.isArray(value) ? { cursor: cursor + Math.min(limit, Math.max(0, value.length - cursor)), hasMore: cursor + limit < value.length } : {}) };
      }
      case "game_read_file": {
        const request = args as z.infer<typeof gameAgentSchemas.game_read_file>,page=request.textPage;
        if(page&&request.revision!==undefined&&request.revision!==page.revision)throw new AgentError(errors.invalid,'Outer revision must match the pinned source page revision.');
        const revision = this.projects.revision(reg, request.projectId, page?.revision??request.revision);
        const file = revision.document.files.find((file) => file.path === request.path);
        if (!file) throw new AgentError(errors.missing, "The file is not in this game revision.");
        if(page){
          if(page.sha256!==file.sha256)throw new AgentError(errors.conflict,'Source file hash does not match the pinned revision.');
          const binding={projectId:request.projectId,revision:revision.revision,sourceHash:revision.contentHash,file};
          if(file.size>MAX_GAME_SOURCE_VIEW_BYTES)return {...binding,kind:'sdk-download-required',message:'Source exceeds the text page limit; download its complete original bytes through the authenticated SDK.'};
          try{return {...binding,kind:'text-source-page',...readGameSourceText(file,this.blobs.read(reg,file),page)};}
          catch(error){if(error instanceof GameSourceViewError)throw new AgentError(errors.invalid,error.message);throw error;}
        }
        if (file.size > 256 * 1024) return { error: "file-requires-sdk-download", file, message: "File preserved; use authenticated SDK transfer rather than truncating it into model context." };
        const data = this.blobs.read(reg, file);
        try { return { file, encoding: "utf-8", content: new TextDecoder("utf-8", { fatal: true }).decode(data) }; }
        catch { return { file, encoding: "base64", content: Buffer.from(data).toString("base64") }; }
      }
      case "game_assets": {
        const { projectId, cursor, limit } = args as z.infer<typeof gameAgentSchemas.game_assets>;
        const revision = this.projects.revision(reg, projectId), assets = revision.document.assets;
        return { revision: revision.revision, assets: assets.slice(cursor, cursor + limit), total: assets.length,
          cursor: cursor + Math.min(limit, Math.max(0, assets.length - cursor)), hasMore: cursor + limit < assets.length };
      }
      case "game_check_tests": {
        const request = args as z.infer<typeof gameAgentSchemas.game_check_tests>, revision = this.projects.revision(reg, request.projectId, request.revision);
        const file = revision.document.files.find(file => file.path === request.path);
        if (!file) throw new AgentError(errors.missing, "The test recipe is not in this game revision.");
        const base = { projectId: request.projectId, revision: revision.revision, sourceHash: revision.contentHash, path: file.path, fileHash: file.sha256,
          scope: "Recipe format and design references only; no build, browser execution or quality approval." };
        const result = gameBrowserRecipeSizeCheck(file.size) ?? checkGameBrowserRecipe(this.blobs.read(reg, file), revision.document.design?.playtests ?? []);
        if (!result.valid) return { ...base, ...result };
        return { ...base, valid: true, scenarioCount: result.suite.scenarios.length,
          stepCount: result.suite.scenarios.reduce((count, scenario) => count + scenario.steps.length, 0), issues: [], omittedIssues: 0 };
      }
      case "game_create": return this.store.db.transaction(() => {
        const request = args as z.infer<typeof gameAgentSchemas.game_create>;
        const project = this.projects.create(reg, { requestId: key, document: request.document });
        this.workflows.ensure(reg, project.id);
        this.link(reg, sessionId, project); return project;
      })();
      case "game_update_design": {
        const request = args as z.infer<typeof gameAgentSchemas.game_update_design>, revision = this.projects.revision(reg, request.projectId);
        return this.projects.commit(reg, { requestId: key, projectId: request.projectId, expectedRevision: request.expectedRevision,
          document: { ...revision.document, design: request.design, ...(request.assets ? { assets: request.assets } : {}) }, message: "Game design revised through the shared agent" });
      }
      case "game_write_file": return this.store.db.transaction(() => {
        const request = args as z.infer<typeof gameAgentSchemas.game_write_file>, revision = this.projects.revision(reg, request.projectId);
        if (request.expectedRevision !== revision.revision) throw new AgentError(errors.conflict, "Refresh the game revision before editing its file.");
        const data = Buffer.from(request.content, request.encoding === "base64" ? "base64" : "utf-8");
        if (request.encoding === "base64" && data.toString("base64") !== request.content) throw new AgentError(errors.invalid, "Binary game content requires canonical base64.");
        const file = this.blobs.store(reg, [{ path: request.path, mime: request.mime, data }])[0]!;
        const files = [...revision.document.files.filter((file) => file.path !== request.path), file];
        const document: GameDocument = { ...revision.document, files };
        return this.projects.commit(reg, { requestId: key, projectId: request.projectId, expectedRevision: request.expectedRevision, document,
          message: `Edit ${request.path}`.slice(0, 300) });
      })();
      case "game_edit_file": return this.store.db.transaction(() => {
        const request = args as z.infer<typeof gameAgentSchemas.game_edit_file>, revision = this.projects.revision(reg, request.projectId);
        if (request.expectedRevision !== revision.revision) throw new AgentError(errors.conflict, "Refresh the game revision before editing its file.");
        const original = revision.document.files.find(file => file.path === request.path);
        if (!original) throw new AgentError(errors.missing, "The file is not in this game revision.");
        if (original.sha256 !== request.baseSha256) throw new AgentError(errors.conflict, "The file hash changed; read the current file before editing.");
        if (original.size > MAX_GAME_EDIT_TEXT_BYTES) throw new AgentError(errors.invalid, "The text exceeds the 8 MiB editing limit; use the SDK. The original file is preserved.");
        const data = this.blobs.read(reg, original);
        let source: string;
        try { source = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(data); }
        catch { throw new AgentError(errors.invalid, "The file cannot be decoded as UTF-8; its bytes were preserved."); }
        let result: string;
        try { result = applyGameTextEdits(source, request.edits); }
        catch (error) { if (error instanceof GameTextEditError) throw new AgentError(errors.invalid, error.message); throw error; }
        const file = this.blobs.store(reg, [{ path: original.path, mime: original.mime, data: Buffer.from(result, "utf8") }])[0]!;
        return this.projects.commit(reg, { requestId: key, projectId: request.projectId, expectedRevision: request.expectedRevision,
          document: { ...revision.document, files: revision.document.files.map(value => value.path === original.path ? file : value) },
          message: `Edit text in ${request.path}`.slice(0, 300) });
      })();
      case "game_build": {
        const request = args as z.infer<typeof gameAgentSchemas.game_build>;
        return this.production.startBuild(reg, { requestId: key, ...request });
      }
      case "game_process_assets":return this.production.startAssets(reg,{requestId:key,...args});
      case "game_asset_result":return this.production.assetResults.get(reg,(args as {id:string}).id);
      case "game_apply_assets":return this.production.applyAssets(reg,{requestId:key,...args});
      case "game_validate": {
        const request = args as z.infer<typeof gameAgentSchemas.game_validate>;
        return this.production.startValidation(reg, { requestId: key, ...request });
      }
      case "game_job": return this.production.job(reg, (args as { id: string }).id);
      case "game_jobs": return this.store.db.transaction(() => {
        const request = args as z.infer<typeof gameAgentSchemas.game_jobs>, project = this.projects.get(reg, request.projectId);
        const page = this.production.list(reg, project.id, request.cursor, request.limit, "desc");
        return { projectId: project.id, revision: project.revision, sourceHash: project.contentHash, cursor: page.cursor, hasMore: page.hasMore,
          jobs: page.jobs.map(job => ({ id: job.id, kind: job.kind, state: job.state, revision: job.revision, sourceHash: job.sourceHash,
            matchesSource: job.sourceHash === project.contentHash, engine: job.engine, adapterId: job.adapterId,
            createdAt: job.createdAt, updatedAt: job.updatedAt, ...(job.error ? { error: job.error.slice(0, 800) } : {}) })) };
      })();
      case "game_quality": {
        const request = args as z.infer<typeof gameAgentSchemas.game_quality>;
        return this.production.quality(reg, request.projectId, request.revision);
      }
      case "game_reports": return this.store.db.transaction(() => {
        const request = args as z.infer<typeof gameAgentSchemas.game_reports>, build = this.production.job(reg, request.buildId);
        if (build.kind !== "build") throw new AgentError(errors.invalid, "Use the build job ID, not a validation, media or artifact ID.");
        const source = this.production.reportPage(reg, build.id, request.cursor, request.limit);
        const page = reportView(() => gameReportPage(source.reports.map(reportHeader), 0, request.limit)), cursor = request.cursor + page.items.length;
        return { build: { id: build.id, projectId: build.projectId, revision: build.revision, sourceHash: build.sourceHash, state: build.state },
          reports: page.items, cursor, hasMore: cursor < source.total, total: source.total };
      })();
      case "game_report": {
        const request = args as z.infer<typeof gameAgentSchemas.game_report>, report = this.production.report(reg, request.reportId);
        const items: unknown[] = request.section === "checks" ? report.checks : request.section === "evidence" ? report.evidence ?? [] :
          request.section === "metrics" ? Object.entries(report.metrics).map(([name, value]) => ({ name, value })) :
          request.section === "content-coverage" ? report.coverage?.contentIds ?? [] : report.coverage?.scenarioIds ?? [];
        return { report: reportHeader(report), section: request.section, ...reportView(() => gameReportPage(items, request.cursor, request.limit)) };
      }
      case "game_read_report_file": {
        const request = args as z.infer<typeof gameAgentSchemas.game_read_report_file>, report = this.production.report(reg, request.reportId), file = this.production.reportFile(reg, report.id, request.path);
        const binding = { report: reportHeader(report), file };
        if (!["application/json", "text/plain"].includes(file.mime) || file.size > MAX_REPORT_TEXT_BYTES)
          return { ...binding, kind: "sdk-download-required", reason: "Binary/unsupported or oversized evidence remains available through the authenticated SDK; no bytes were truncated or converted." };
        const data = this.blobs.read(reg, file);
        return { ...binding, kind: "text-evidence", ...reportView(() => readGameReportText(data, request.cursor, request.limit)) };
      }
    }
  }
  bounded(value: unknown): unknown {
    if (Buffer.byteLength(JSON.stringify(value)) <= 128 * 1024) return value;
    return { error: "game-result-requires-sdk-download", sha256: createHash("sha256").update(JSON.stringify(value)).digest("hex"),
      message: "The complete result is preserved in the project API. Read file references or use SDK transfers; do not invent or truncate missing project data." };
  }
  evidence(reg: Registration, runId: string, sessionId: string): GameCompletionEvidence {
    const changes: GameCompletionEvidence["changes"] = [];
    const ids = new Set<string>();
    const linked = this.linked(reg, sessionId);
    if (linked) ids.add(linked.id);
    const rows = this.store.db.prepare(`SELECT r.value FROM receipts r JOIN operation_identities i ON i.id=r.id
      WHERE r.namespace=? AND r.run=? AND r.status IN ('completed','reconciled') AND i.tool IN ('game_create','game_update_design','game_write_file','game_edit_file','game_apply_assets') ORDER BY r.rowid`)
      .all(namespace(reg), runId) as { value: string }[];
    for (const row of rows) {
      const result = JSON.parse(row.value) as Partial<GameProject>;
      if (!result.id || !result.revision) continue;
      const revision = this.projects.revision(reg, result.id, result.revision);
      if (revision.parentHash === revision.contentHash) continue;
      const before = revision.revision > 1 ? this.projects.revision(reg, result.id, revision.revision - 1) : undefined;
      const previousFiles = new Map(before?.document.files.map((file) => [file.path, file.sha256]) ?? []);
      const filesChanged = revision.document.files.filter((file) => previousFiles.get(file.path) !== file.sha256).map((file) => file.path);
      changes.push({ projectId: result.id, revision: revision.revision, beforeHash: revision.parentHash, sourceHash: revision.contentHash, filesChanged });
      ids.add(result.id);
    }
    const denied = this.store.db.prepare(`SELECT r.id FROM receipts r JOIN operation_identities i ON i.id=r.id
      WHERE r.namespace=? AND r.run=? AND r.status IN ('completed','reconciled') AND i.tool LIKE 'game_%' AND json_extract(r.value,'$.denied')=1 LIMIT 1`)
      .get(namespace(reg), runId);
    return { changes, approvalWasDenied: Boolean(denied), projects: [...ids].map((projectId) => {
      const state = this.workflows.snapshot(reg, projectId), accepted = state.workflow?.lastAccepted;
      const completed = state.workflow?.state === "completed" && accepted?.workflowId === state.workflow.id &&
        accepted.revision === state.revision && accepted.sourceHash === state.sourceHash;
      const blockers = [...new Set([...state.gates.flatMap((gate) => gate.blockers), ...(completed ? [] : ["production-cycle-incomplete"])])];
      return { projectId, revision: state.revision, ready: completed && state.qualityReady && blockers.length === 0, blockers };
    }) };
  }
}
