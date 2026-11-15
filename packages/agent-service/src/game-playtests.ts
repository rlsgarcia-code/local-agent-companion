import { randomUUID } from "node:crypto";
import { AgentError, errors, type Registration } from "../../contracts/src/index";
import { contentHash } from "../../contracts/src/identity";
import { gamePlaytestCreate, gamePlaytestList, gamePlaytestRead, gamePlaytestRecord, gamePlaytestStudy, gamePlaytestInspect, gamePlaytestExportRequest,
  gamePlaytestCorrect,gamePlaytestCorrectionEntry,gamePlaytestCorrectionsRead,
  gamePlaytestResponse, gamePlaytestWithdraw, type GamePlaytestResponse, type GamePlaytestStudy, type GamePlaytestSummary } from "../../contracts/src/game-playtests";
import { namespace } from "./security";
import type { Store } from "./store";
import type { GameProjects } from "./game-projects";
import type { GameProduction } from "./game-production";
import { assessPlaytestTargets } from "../../game-design/src/playtest-targets";

type Row = { value: string };
type Mutation = { binding: string; study: string; participant: string | null };

/** Local consented operator records, deliberately outside model tools and QA
 * collectors. A software count cannot establish that people actually played. */
export class GamePlaytests {
  constructor(private readonly store: Store, private readonly projects: GameProjects, private readonly production: GameProduction) {
    store.db.exec(`
      CREATE TABLE IF NOT EXISTS game_playtest_studies(id TEXT PRIMARY KEY,namespace TEXT NOT NULL,project TEXT NOT NULL REFERENCES game_projects(id),value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS game_playtest_responses(namespace TEXT NOT NULL,study TEXT NOT NULL REFERENCES game_playtest_studies(id),participant TEXT NOT NULL,value TEXT NOT NULL,PRIMARY KEY(namespace,study,participant));
      CREATE TABLE IF NOT EXISTS game_playtest_mutations(namespace TEXT NOT NULL,request TEXT NOT NULL,binding TEXT NOT NULL,study TEXT NOT NULL,participant TEXT,PRIMARY KEY(namespace,request));
      CREATE TABLE IF NOT EXISTS game_playtest_corrections(namespace TEXT NOT NULL,study TEXT NOT NULL REFERENCES game_playtest_studies(id),participant TEXT NOT NULL,sequence INTEGER NOT NULL,value TEXT NOT NULL,PRIMARY KEY(namespace,study,participant,sequence));
    `);
  }
  private authorize(reg: Registration) {
    if (reg.product === "kidos") throw new AgentError(errors.forbidden, "KidOS playtest records require a separately qualified responsible-adult integration.");
  }
  private study(reg: Registration, id: string): GamePlaytestStudy {
    this.authorize(reg);
    const row = this.store.db.prepare("SELECT value FROM game_playtest_studies WHERE namespace=? AND id=?").get(namespace(reg), id) as Row | undefined;
    if (!row) throw new AgentError(errors.missing, "Playtest study not found in this product/profile/workspace.");
    const study = gamePlaytestStudy.parse(JSON.parse(row.value)); this.projects.get(reg, study.projectId); return study;
  }
  private previous(reg: Registration, request: string, kind: string, input: unknown): Mutation | undefined {
    const row = this.store.db.prepare("SELECT binding,study,participant FROM game_playtest_mutations WHERE namespace=? AND request=?")
      .get(namespace(reg), request) as Mutation | undefined;
    if (row && row.binding !== contentHash({ kind, input })) throw new AgentError(errors.conflict, "Playtest request identity was already used with different content.");
    return row;
  }
  private receipt(reg: Registration, request: string, kind: string, input: unknown, study: string, participant: string | null) {
    // Only identity hashes and references: withdrawal must not leave answers or
    // notes in an idempotency receipt. A replay returns the current tombstone.
    this.store.db.prepare("INSERT INTO game_playtest_mutations VALUES(?,?,?,?,?)").run(namespace(reg), request, contentHash({ kind, input }), study, participant);
  }
  inspect(reg: Registration, input: unknown) {
    this.authorize(reg); const request = gamePlaytestInspect.parse(input);
    const row = this.store.db.prepare("SELECT binding,study,participant FROM game_playtest_mutations WHERE namespace=? AND request=?")
      .get(namespace(reg), request.requestId) as Mutation | undefined;
    if (!row) return { state: "missing" as const };
    this.study(reg, row.study);
    // Kind and original content belong to the binding. The caller reconstructs
    // them from its frozen command; current withdrawal state cannot identify
    // which original operation this receipt acknowledged.
    return { state: "acknowledged" as const, bindingHash: row.binding, studyId: row.study, participantId: row.participant,
      ...(row.participant ? { withdrawn: this.response(reg, row.study, row.participant).withdrawn } : {}) };
  }
  export(reg: Registration, input: unknown) {
    this.authorize(reg); const request = gamePlaytestExportRequest.parse(input);
    return this.store.db.transaction(() => {
      const study = this.study(reg, request.studyId), current = this.projects.get(reg, study.projectId);
      return { schemaVersion: 1 as const, kind: "operator-playtest-study" as const, exportedAt: Date.now(), includeResponses: request.includeResponses,
        study, stale: current.revision !== study.revision || current.contentHash !== study.sourceHash, summary: this.summary(reg, study.id),
        responses: request.includeResponses ? (this.store.db.prepare("SELECT value FROM game_playtest_responses WHERE namespace=? AND study=? ORDER BY rowid")
          .all(namespace(reg), study.id) as Row[]).map(row => gamePlaytestResponse.parse(JSON.parse(row.value))) : [] };
    })();
  }
  private response(reg: Registration, study: string, participant: string): GamePlaytestResponse {
    const row = this.store.db.prepare("SELECT value FROM game_playtest_responses WHERE namespace=? AND study=? AND participant=?")
      .get(namespace(reg), study, participant) as Row | undefined;
    if (!row) throw new AgentError(errors.missing, "Participant record not found in this study.");
    return gamePlaytestResponse.parse(JSON.parse(row.value));
  }
  create(reg: Registration, input: unknown): GamePlaytestStudy {
    this.authorize(reg); const request = gamePlaytestCreate.parse(input);
    return this.store.db.transaction(() => {
      const old = this.previous(reg, request.requestId, "create", request);
      if (old) return this.study(reg, old.study);
      const artifact = this.production.artifact(reg, request.buildId); this.projects.get(reg, artifact.projectId);
      const count = (this.store.db.prepare("SELECT count(*) AS n FROM game_playtest_studies WHERE namespace=? AND project=?")
        .get(namespace(reg), artifact.projectId) as { n: number }).n;
      if (count >= 1000) throw new AgentError(errors.invalid, "This project has reached its 1,000-study storage limit; existing records were preserved.");
      const study = gamePlaytestStudy.parse({ id: randomUUID(), projectId: artifact.projectId, buildId: artifact.jobId,
        artifactHash: artifact.artifactHash, sourceHash: artifact.sourceHash, revision: artifact.revision, engine: artifact.engine,
        title: request.title, audience: request.audience, createdAt: Date.now(), protocolVersion: 1 });
      this.store.db.prepare("INSERT INTO game_playtest_studies VALUES(?,?,?,?)").run(study.id, namespace(reg), study.projectId, JSON.stringify(study));
      this.receipt(reg, request.requestId, "create", request, study.id, null); return study;
    }).immediate();
  }
  record(reg: Registration, input: unknown): GamePlaytestResponse {
    this.authorize(reg); const request = gamePlaytestRecord.parse(input);
    return this.store.db.transaction(() => {
      this.study(reg, request.studyId);
      const old = this.previous(reg, request.requestId, "record", request);
      if (old) return this.response(reg, old.study, old.participant!);
      if (this.store.db.prepare("SELECT 1 FROM game_playtest_responses WHERE namespace=? AND study=? AND participant=?")
        .get(namespace(reg), request.studyId, request.participantId)) throw new AgentError(errors.conflict, "This participant already has a record; a new request cannot replace it or count it twice.");
      const count = (this.store.db.prepare("SELECT count(*) AS n FROM game_playtest_responses WHERE namespace=? AND study=?")
        .get(namespace(reg), request.studyId) as { n: number }).n;
      if (count >= 1000) throw new AgentError(errors.invalid, "This study has reached its 1,000-record limit; existing records were preserved.");
      const { requestId, ...answers } = request;
      const response = gamePlaytestResponse.parse({ ...answers, recordedAt: Date.now(), withdrawn: false });
      this.store.db.prepare("INSERT INTO game_playtest_responses VALUES(?,?,?,?)").run(namespace(reg), request.studyId, request.participantId, JSON.stringify(response));
      this.receipt(reg, requestId, "record", request, request.studyId, request.participantId); return response;
    }).immediate();
  }
  withdraw(reg: Registration, input: unknown): GamePlaytestResponse {
    this.authorize(reg); const request = gamePlaytestWithdraw.parse(input);
    return this.store.db.transaction(() => {
      this.study(reg, request.studyId);
      const old = this.previous(reg, request.requestId, "withdraw", request);
      if (old) return this.response(reg, old.study, old.participant!);
      const previous = this.response(reg, request.studyId, request.participantId);
      const response = previous.withdrawn ? previous : gamePlaytestResponse.parse({ studyId: request.studyId, participantId: request.participantId,
        recordedAt: previous.recordedAt, withdrawnAt: Date.now(), withdrawn: true });
      this.store.db.prepare("UPDATE game_playtest_responses SET value=? WHERE namespace=? AND study=? AND participant=?")
        .run(JSON.stringify(response), namespace(reg), request.studyId, request.participantId);
      if(response.withdrawn){
        // Remove historical answers/reasons in the same transaction. Hashes
        // and identities remain; this is not physical SQLite/backup erasure.
        const rows=this.store.db.prepare("SELECT sequence,value FROM game_playtest_corrections WHERE namespace=? AND study=? AND participant=?")
          .all(namespace(reg),request.studyId,request.participantId) as (Row&{sequence:number})[];
        for(const row of rows){const entry=gamePlaytestCorrectionEntry.parse(JSON.parse(row.value));
          const tombstone=gamePlaytestCorrectionEntry.parse({requestId:entry.requestId,sequence:entry.sequence,correctedAt:entry.correctedAt,
            beforeHash:entry.beforeHash,afterHash:entry.afterHash,withdrawn:true,withdrawnAt:response.withdrawnAt});
          this.store.db.prepare("UPDATE game_playtest_corrections SET value=? WHERE namespace=? AND study=? AND participant=? AND sequence=?")
            .run(JSON.stringify(tombstone),namespace(reg),request.studyId,request.participantId,row.sequence);
        }
      }
      this.receipt(reg, request.requestId, "withdraw", request, request.studyId, request.participantId); return response;
    }).immediate();
  }
  correct(reg:Registration,input:unknown):GamePlaytestResponse{
    this.authorize(reg);const request=gamePlaytestCorrect.parse(input);
    return this.store.db.transaction(()=>{
      this.study(reg,request.studyId);
      const old=this.previous(reg,request.requestId,"correct",request);
      if(old)return this.response(reg,old.study,old.participant!);
      const before=this.response(reg,request.studyId,request.participantId);
      if(before.withdrawn)throw new AgentError(errors.conflict,"A withdrawn participant record cannot be corrected or restored.");
      const beforeHash=contentHash(before);
      if(beforeHash!==request.expectedResponseHash)throw new AgentError(errors.conflict,"This observation changed; read its current value before preparing another correction.");
      const count=(this.store.db.prepare("SELECT count(*) AS n FROM game_playtest_corrections WHERE namespace=? AND study=? AND participant=?")
        .get(namespace(reg),request.studyId,request.participantId) as {n:number}).n;
      if(count>=1000)throw new AgentError(errors.invalid,"This record has reached its 1,000-correction limit; existing history was preserved.");
      const after=gamePlaytestResponse.parse({...request.answers,studyId:request.studyId,participantId:request.participantId,recordedAt:before.recordedAt,withdrawn:false});
      const afterHash=contentHash(after);
      if(beforeHash===afterHash)throw new AgentError(errors.invalid,"No observation values changed; no correction was recorded.");
      const entry=gamePlaytestCorrectionEntry.parse({requestId:request.requestId,sequence:count+1,correctedAt:Date.now(),beforeHash,afterHash,
        withdrawn:false,reason:request.reason,before,after});
      this.store.db.prepare("INSERT INTO game_playtest_corrections VALUES(?,?,?,?,?)")
        .run(namespace(reg),request.studyId,request.participantId,count+1,JSON.stringify(entry));
      this.store.db.prepare("UPDATE game_playtest_responses SET value=? WHERE namespace=? AND study=? AND participant=?")
        .run(JSON.stringify(after),namespace(reg),request.studyId,request.participantId);
      this.receipt(reg,request.requestId,"correct",request,request.studyId,request.participantId);return after;
    }).immediate();
  }
  corrections(reg:Registration,input:unknown){
    this.authorize(reg);const request=gamePlaytestCorrectionsRead.parse(input);
    return this.store.db.transaction(()=>{
      this.study(reg,request.studyId);const current=this.response(reg,request.studyId,request.participantId);
      const rows=this.store.db.prepare("SELECT sequence,value FROM game_playtest_corrections WHERE namespace=? AND study=? AND participant=? AND sequence>? ORDER BY sequence LIMIT ?")
        .all(namespace(reg),request.studyId,request.participantId,request.cursor,request.limit+1) as (Row&{sequence:number})[];
      return {studyId:request.studyId,participantId:request.participantId,current,currentResponseHash:contentHash(current),
        entries:rows.slice(0,request.limit).map(row=>gamePlaytestCorrectionEntry.parse(JSON.parse(row.value))),
        cursor:rows.slice(0,request.limit).at(-1)?.sequence??request.cursor,hasMore:rows.length>request.limit};
    })();
  }
  private summary(reg: Registration, id: string): GamePlaytestSummary {
    const rows = this.store.db.prepare("SELECT value FROM game_playtest_responses WHERE namespace=? AND study=?")
      .all(namespace(reg), id) as Row[];
    let active = 0, withdrawn = 0, understood = 0, rated = 0;
    for (const row of rows) {
      const value = gamePlaytestResponse.parse(JSON.parse(row.value));
      if (value.withdrawn) { withdrawn++; continue; }
      active++;
      if (value.understoodWithoutHelp && value.actionSeconds !== null && value.actionSeconds <= 30) understood++;
      if (value.experienceScore >= 4) rated++;
    }
    return { active, withdrawn, totalRecorded: rows.length, understoodWithin30Seconds: understood, ratedAtLeastFour: rated,
      ...assessPlaytestTargets(active, understood, rated),
      source: "operator-attested", qualityApproved: false };
  }
  read(reg: Registration, input: unknown) {
    this.authorize(reg); const request = gamePlaytestRead.parse(input);
    return this.store.db.transaction(() => {
      const study = this.study(reg, request.studyId), current = this.projects.get(reg, study.projectId);
      const rows = this.store.db.prepare("SELECT rowid,value FROM game_playtest_responses WHERE namespace=? AND study=? AND rowid>? ORDER BY rowid LIMIT ?")
        .all(namespace(reg), study.id, request.cursor, request.limit + 1) as (Row & { rowid: number })[];
      return { study, stale: current.revision !== study.revision || current.contentHash !== study.sourceHash, summary: this.summary(reg, study.id),
        responses: rows.slice(0, request.limit).map(row => gamePlaytestResponse.parse(JSON.parse(row.value))),
        cursor: rows.slice(0, request.limit).at(-1)?.rowid ?? request.cursor, hasMore: rows.length > request.limit };
    })();
  }
  list(reg: Registration, input: unknown) {
    this.authorize(reg); const request = gamePlaytestList.parse(input), current = this.projects.get(reg, request.projectId);
    const rows = this.store.db.prepare("SELECT rowid,value FROM game_playtest_studies WHERE namespace=? AND project=? AND rowid>? ORDER BY rowid LIMIT ?")
      .all(namespace(reg), request.projectId, request.cursor, request.limit + 1) as (Row & { rowid: number })[];
    return { studies: rows.slice(0, request.limit).map(row => {
      const study = gamePlaytestStudy.parse(JSON.parse(row.value));
      return { study, stale: current.revision !== study.revision || current.contentHash !== study.sourceHash, summary: this.summary(reg, study.id) };
    }), cursor: rows.slice(0, request.limit).at(-1)?.rowid ?? request.cursor, hasMore: rows.length > request.limit };
  }
}
