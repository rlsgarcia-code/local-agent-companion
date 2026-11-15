import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";
import { AgentService } from "../packages/agent-service/src/service";
import { Store } from "../packages/agent-service/src/store";
import { LocalServer } from "../packages/agent-service/src/server";
import { ensureIdentity, createClientCredential, ipcPath } from "../packages/agent-service/src/security";
import { GAME_AGENT_TOOLS } from "../packages/agent-service/src/game-agent-tools";
import { AgentClient } from "../packages/client-ts/src/index";
import { contentHash } from "../packages/contracts/src/identity";
import { gamePlaytestRecord, type GamePlaytestStudy, type GamePlaytestRecord, type GamePlaytestResponse, type GamePlaytestSnapshot } from "../packages/contracts/src/game-playtests";
import type { Registration } from "../packages/contracts/src/index";
import type { GameProject } from "../packages/contracts/src/games";
import type { GameProductionJob, GameArtifact, GameQualityAssessment } from "../packages/contracts/src/game-production";
import type { Transfer } from "../packages/contracts/src/transfers";
import { fixtureGameDocument } from "./game-fixtures";

const reg: Registration = { id: "operator-fixture", product: "companion-mac", profile: "fixture", workspace: "", providers: ["ollama"], hostTools: [] };
const call = <T>(service: AgentService, method: string, input: unknown, identity = reg) => service.dispatch(identity, method, input, "fixture") as Promise<T>;
async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), "playtests-"));
  const file = path.join(directory, "state.sqlite");
  const create = () => new AgentService(new Store(file), directory, async () => { throw Error("No inference is allowed"); }, {}, {
    gameAdapters: [{ id: "synthetic-playtest-build", engine: "phaser", products: ["companion-mac"], authority: "workspace",
      toolchain: { id: "synthetic", version: "1", sha256: "a".repeat(64) }, probe: async () => ({ available: true }),
      build: async () => ({ entrypoint: "index.html", files: [{ path: "index.html", mime: "text/html", data: Buffer.from("<!doctype html><title>Synthetic only, no actual players</title>") }] }) }],
  });
  const service = create();
  const project = await call<GameProject>(service, "games.projects.create", { requestId: "project", document: fixtureGameDocument() });
  const build = await call<GameProductionJob>(service, "games.builds.start", { requestId: "build", projectId: project.id, revision: 1 });
  for (let i = 0; i < 200 && !["completed", "failed"].includes((await call<GameProductionJob>(service, "games.production.get", { id: build.id })).state); i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal((await call<GameProductionJob>(service, "games.production.get", { id: build.id })).state, "completed");
  return { service, directory, project, build, create, async close() { await service.close(); await rm(directory, { recursive: true, force: true }); } };
}
const observation = (studyId: string): GamePlaytestRecord => ({ requestId: randomUUID(), studyId, participantId: randomUUID(), consentConfirmed: true as const,
  distinctParticipantConfirmed: true as const, understoodWithoutHelp: true, actionSeconds: 20, experienceScore: 4,
  environment: { platform: "synthetic", device: "fixture, no person", browser: "none", input: ["keyboard" as const] }, notes: "Synthetic test only" });

test("corrections preserve prior observations, require exact current content and cannot duplicate people or become quality evidence", async () => {
  const f=await fixture();let reopened:AgentService|undefined;
  try{
    const study=await call<GamePlaytestStudy>(f.service,"games.playtests.create",{requestId:"study",buildId:f.build.id,title:"Synthetic correction",audience:"No actual people"});
    const original=observation(study.id),first=await call<GamePlaytestResponse>(f.service,"games.playtests.record",original);
    const {requestId,studyId,participantId,...answers}=original;
    const correction={requestId:"correct-1",studyId,participantId,expectedResponseHash:contentHash(first),correctionConfirmed:true,
      reason:"Synthetic transcription correction",answers:{...answers,experienceScore:2,notes:"Corrected synthetic note"}};
    const changed=await call<GamePlaytestResponse>(f.service,"games.playtests.correct",correction);
    assert.equal(changed.withdrawn,false);if(changed.withdrawn)throw Error("Unexpected tombstone");
    assert.equal(changed.recordedAt,first.recordedAt);assert.equal(changed.experienceScore,2);
    const history=await call<{current:GamePlaytestResponse;currentResponseHash:string;entries:{sequence:number;before:GamePlaytestResponse;after:GamePlaytestResponse;reason:string}[];hasMore:boolean}>(f.service,"games.playtests.corrections",{studyId,participantId});
    assert.deepEqual(history.current,changed);assert.equal(history.currentResponseHash,contentHash(changed));
    assert.equal(history.entries.length,1);assert.deepEqual(history.entries[0]!.before,first);assert.deepEqual(history.entries[0]!.after,changed);
    assert.equal(history.entries[0]!.reason,correction.reason);assert.equal(history.entries[0]!.sequence,1);
    await assert.rejects(call(f.service,"games.playtests.correct",{...correction,requestId:"stale"}),/changed/);
    await assert.rejects(call(f.service,"games.playtests.correct",{...correction,reason:"Other content"}),/identity/);
    await assert.rejects(call(f.service,"games.playtests.correct",{...correction,requestId:"unconfirmed",correctionConfirmed:false}));
    assert.deepEqual(await call(f.service,"games.playtests.correct",correction),changed);
    const summary=(await call<GamePlaytestSnapshot>(f.service,"games.playtests.read",{studyId})).summary;
    assert.equal(summary.active,1);assert.equal(summary.totalRecorded,1);assert.equal(summary.ratedAtLeastFour,0);assert.equal(summary.qualityApproved,false);
    const receipt=await call(f.service,"games.playtests.inspect",{requestId:"correct-1"});assert.doesNotMatch(JSON.stringify(receipt),/Synthetic transcription|Corrected synthetic|experienceScore/);
    for(const identity of [{...reg,profile:"other"},{...reg,product:"companion-vscode" as const},{...reg,product:"kidos" as const}]){
      await assert.rejects(call(f.service,"games.playtests.correct",correction,identity),/not found|responsible-adult/);
      await assert.rejects(call(f.service,"games.playtests.corrections",{studyId,participantId},identity),/not found|responsible-adult/);
    }
    await f.service.close();reopened=f.create();
    assert.deepEqual(await call(reopened,"games.playtests.correct",correction),changed);
    const afterRestart=await call<typeof history>(reopened,"games.playtests.corrections",{studyId,participantId});assert.equal(afterRestart.entries.length,1);
    const second=await call<GamePlaytestResponse>(reopened,"games.playtests.correct",{...correction,requestId:"correct-2",expectedResponseHash:contentHash(changed),answers:{...correction.answers,experienceScore:3}});
    const page1=await call<typeof history&{cursor:number}>(reopened,"games.playtests.corrections",{studyId,participantId,limit:1});assert.equal(page1.entries.length,1);assert.equal(page1.hasMore,true);
    const page2=await call<typeof page1>(reopened,"games.playtests.corrections",{studyId,participantId,limit:1,cursor:page1.cursor});assert.equal(page2.entries[0]!.sequence,2);assert.equal(page2.hasMore,false);
    assert.deepEqual(await call(reopened,"games.playtests.correct",correction),second,"Old receipt replays the current record without repeating the correction");
    const removed=await call<GamePlaytestResponse>(reopened,"games.playtests.withdraw",{requestId:"withdraw",studyId,participantId,consentWithdrawalConfirmed:true});
    assert.deepEqual(await call(reopened,"games.playtests.correct",correction),removed,"Lost correction acknowledgment never resurrects withdrawn data");
    const tombstones=await call<{current:GamePlaytestResponse;entries:unknown[]}>(reopened,"games.playtests.corrections",{studyId,participantId});
    assert.equal(tombstones.current.withdrawn,true);assert.equal(tombstones.entries.length,2);
    assert.doesNotMatch(JSON.stringify(tombstones),/Synthetic transcription|Corrected synthetic|Synthetic test only|experienceScore|environment/);
    assert.doesNotMatch(JSON.stringify(reopened.store.db.prepare("SELECT value FROM game_playtest_corrections").all()),/Synthetic transcription|Corrected synthetic|Synthetic test only|experienceScore|environment/);
    await assert.rejects(call(reopened,"games.playtests.correct",{...correction,requestId:"after-withdraw",expectedResponseHash:contentHash(removed)}),/withdrawn/);
    assert.equal((await call<GameProject>(reopened,"games.projects.get",{id:f.project.id})).revision,1);
    assert.equal(GAME_AGENT_TOOLS.some(t=>/playtest|participant|consent/.test(t.name)),false);
  }finally{await reopened?.close();await f.close();}
});

test("operator records bind the acknowledged build, keep all observations and do not create human quality reports or project revisions", async () => {
  const f = await fixture();
  try {
    const input = { requestId: "study", buildId: f.build.id, title: "Synthetic study", audience: "Fixture only, no actual participants" };
    const study = await call<GamePlaytestStudy>(f.service, "games.playtests.create", input);
    assert.deepEqual(await call(f.service, "games.playtests.create", input), study);
    await assert.rejects(call(f.service, "games.playtests.create", { ...input, title: "Different" }), /identity/);
    assert.equal(study.projectId, f.project.id); assert.equal(study.sourceHash, f.project.contentHash); assert.equal(study.revision, 1);
    for (let i = 0; i < 10; i++) {
      const request = observation(study.id); request.understoodWithoutHelp = i < 8; request.actionSeconds = i < 8 ? 30 : null;
      request.experienceScore = i < 7 ? 4 : 2;
      await call(f.service, "games.playtests.record", request);
    }
    const first = await call<GamePlaytestSnapshot>(f.service, "games.playtests.read", { studyId: study.id, limit: 3 });
    assert.deepEqual(first.summary, { active: 10, withdrawn: 0, totalRecorded: 10, understoodWithin30Seconds: 8, ratedAtLeastFour: 7,
      minimumParticipants: 10, requiredComprehension: 8, requiredRatings: 7, numericalTargetsMet: true, source: "operator-attested", qualityApproved: false });
    assert.equal(first.responses.length, 3); assert.equal(first.hasMore, true); assert.equal(first.stale, false);
    const second = await call<GamePlaytestSnapshot>(f.service, "games.playtests.read", { studyId: study.id, cursor: first.cursor, limit: 100 });
    assert.equal(second.responses.length, 7); assert.equal(second.hasMore, false);
    // A later poor observation remains counted; no selecting the best ten.
    await call(f.service, "games.playtests.record", { ...observation(study.id), understoodWithoutHelp: false, actionSeconds: null, experienceScore: 1 });
    const more = await call<GamePlaytestSnapshot>(f.service, "games.playtests.read", { studyId: study.id });
    assert.equal(more.summary.active, 11); assert.equal(more.summary.requiredComprehension, 9); assert.equal(more.summary.numericalTargetsMet, false);
    for(let i=0;i<9;i++)await call(f.service,"games.playtests.record",{...observation(study.id),understoodWithoutHelp:false,actionSeconds:null,experienceScore:1});
    const twenty=await call<GamePlaytestSnapshot>(f.service,"games.playtests.read",{studyId:study.id});
    assert.equal(twenty.summary.active,20);assert.equal(twenty.summary.requiredComprehension,16);assert.equal(twenty.summary.requiredRatings,14);
    assert.equal(twenty.summary.understoodWithin30Seconds,8);assert.equal(twenty.summary.ratedAtLeastFour,7);
    assert.equal(twenty.summary.numericalTargetsMet,false);assert.equal(twenty.summary.qualityApproved,false);
    const quality = await call<Transfer>(f.service, "games.quality.get", { projectId: f.project.id });
    const chunk = await call<{ data: string }>(f.service, "transfers.read", { id: quality.id, offset: 0 });
    const assessment = JSON.parse(Buffer.from(chunk.data, "base64").toString()) as GameQualityAssessment;
    assert.equal(assessment.ready, false); assert.equal(assessment.reports.length, 0);
    assert.equal((await call<GameProject>(f.service, "games.projects.get", { id: f.project.id })).revision, 1);
    assert.equal(GAME_AGENT_TOOLS.some(tool => /playtest|participant|consent/.test(tool.name)), false);
  } finally { await f.close(); }
});

test("consent, exact request bindings, namespace isolation and withdrawal survive restart without returning old notes", async () => {
  const f = await fixture(); let reopened: AgentService | undefined;
  try {
    const study = await call<GamePlaytestStudy>(f.service, "games.playtests.create", { requestId: "study", buildId: f.build.id, title: "Synthetic", audience: "No actual humans" });
    const request = observation(study.id), forbidden = [
      { ...request, consentConfirmed: false }, { ...request, distinctParticipantConfirmed: false },
      { ...request, participantId: "A person's name" }, { ...request, actionSeconds: -1 },
      { ...request, understoodWithoutHelp: false, actionSeconds: 20 }, { ...request, actionSeconds: null },
      { ...request, namespace: "other" }, { ...request, experienceScore: 6 },
    ];
    for (const input of forbidden) assert.equal(gamePlaytestRecord.safeParse(input).success, false);
    const answer = await call<GamePlaytestResponse>(f.service, "games.playtests.record", request);
    assert.deepEqual(await call(f.service, "games.playtests.record", request), answer);
    await assert.rejects(call(f.service, "games.playtests.record", { ...request, experienceScore: 2 }), /identity/);
    await assert.rejects(call(f.service, "games.playtests.record", { ...request, requestId: "replace" }), /count it twice/);
    for (const identity of [{ ...reg, profile: "other" }, { ...reg, workspace: "other" }, { ...reg, product: "companion-vscode" as const }, { ...reg, product: "kidos" as const }]) {
      await assert.rejects(call(f.service, "games.playtests.read", { studyId: study.id }, identity), /not found|responsible-adult/);
      await assert.rejects(call(f.service, "games.playtests.record", request, identity), /not found|responsible-adult/);
    }
    const withdrawal = { requestId: "withdraw", studyId: study.id, participantId: request.participantId, consentWithdrawalConfirmed: true };
    const removed = await call<GamePlaytestResponse>(f.service, "games.playtests.withdraw", withdrawal);
    assert.equal(removed.withdrawn, true); assert.equal("notes" in removed, false);
    assert.deepEqual(await call(f.service, "games.playtests.record", request), removed, "lost record acknowledgment must not recreate withdrawn answers");
    assert.equal((await call<GamePlaytestSnapshot>(f.service, "games.playtests.read", { studyId: study.id })).summary.withdrawn, 1);
    const rows = f.service.store.db.prepare("SELECT value FROM game_playtest_responses").all();
    assert.equal(JSON.stringify(rows).includes("Synthetic test only"), false, "active SQL records no longer contain notes");
    await f.service.close(); reopened = f.create();
    assert.deepEqual(await call(reopened, "games.playtests.withdraw", withdrawal), removed);
    assert.deepEqual(await call(reopened, "games.playtests.record", request), removed);
    const state = await call<GamePlaytestSnapshot>(reopened, "games.playtests.read", { studyId: study.id });
    assert.equal(state.summary.active, 0); assert.equal(state.summary.withdrawn, 1); assert.equal(state.summary.numericalTargetsMet, false);
  } finally { await reopened?.close(); await f.close(); }
});

test("source changes mark historical playtests stale without moving observations to a new build", async () => {
  const f = await fixture();
  try {
    const study = await call<GamePlaytestStudy>(f.service, "games.playtests.create", { requestId: "study", buildId: f.build.id, title: "Synthetic", audience: "No actual people" });
    const document = fixtureGameDocument(); document.title = "Changed revision";
    await call(f.service, "games.revisions.commit", { requestId: "changed", projectId: f.project.id, expectedRevision: 1, document, message: "Synthetic change" });
    await call(f.service, "games.playtests.record", observation(study.id));
    const state = await call<GamePlaytestSnapshot>(f.service, "games.playtests.read", { studyId: study.id });
    assert.equal(state.stale, true); assert.equal(state.study.revision, 1); assert.equal(state.study.buildId, f.build.id); assert.equal(state.summary.active, 1);
    await assert.rejects(call(f.service, "games.playtests.create", { requestId: "no-build", buildId: randomUUID(), title: "Synthetic", audience: "No people" }), /not found/);
  } finally { await f.close(); }
});

test("authenticated TypeScript/Python clients read the same local study without inference, reports or hidden telemetry", async () => {
  const f = await fixture(), server = new LocalServer(f.service, f.directory);
  const credential = await createClientCredential(f.directory, reg); f.service.store.register(credential);
  const identity = await ensureIdentity(f.directory); let client: AgentClient | undefined;
  try {
    await server.listen(); client = new AgentClient({ address: ipcPath(f.directory), certificate: identity.cert, credential }); await client.connect();
    const info = await client.call<{ capabilities: string[] }>("engine.info"); assert.ok(info.capabilities.includes("game-playtest-studies-v1"));
    assert.ok(info.capabilities.includes("game-playtest-studio-v1"));
    const study = await client.createGamePlaytest({ requestId: "study", buildId: f.build.id, title: "Synthetic", audience: "No actual people" });
    const operatorRequest=observation(study.id);const recorded=await client.recordGamePlaytest(operatorRequest);
    const {requestId:originalRequestId,studyId:originalStudy,participantId,...answers}=operatorRequest;
    const corrected=await client.correctGamePlaytest({requestId:"sdk-correct",studyId:study.id,participantId,expectedResponseHash:contentHash(recorded),reason:"Synthetic SDK correction",correctionConfirmed:true,answers:{...answers,experienceScore:2}});
    const correctionHistory=await client.getGamePlaytestCorrections(study.id,participantId);assert.equal(correctionHistory.entries.length,1);assert.deepEqual(correctionHistory.current,corrected);
    assert.equal((await client.getGamePlaytest(study.id)).summary.active, 1);
    assert.equal((await client.listGamePlaytests(f.project.id)).studies[0]?.study.artifactHash, study.artifactHash);
    const receipt = await client.inspectGamePlaytest("study");assert.equal(receipt.state, "acknowledged");
    const summary = await client.exportGamePlaytest(study.id);assert.equal(summary.includeResponses, false);assert.deepEqual(summary.responses, []);
    assert.equal((await client.exportGamePlaytest(study.id, true)).responses.length, 1);
    const auth = path.join(f.directory, "auth.json"), certificate = path.join(f.directory, "certificate.pem");
    await writeFile(auth, JSON.stringify(credential), { mode: 0o600 }); await writeFile(certificate, identity.cert, { mode: 0o600 });
    if (process.platform !== "win32") {
      const code = `import sys,json\nsys.path.insert(0,sys.argv[1])\nfrom pathlib import Path\nfrom companion_client import AgentClient\nc=AgentClient(sys.argv[2],Path(sys.argv[3]),Path(sys.argv[4]))\nc.connect()\ns=c.get_game_playtest(sys.argv[5])\nassert s['summary']['active']==1 and not s['summary']['qualityApproved']\nassert c.list_game_playtests(sys.argv[6])['studies'][0]['study']['id']==sys.argv[5]\nassert c.inspect_game_playtest('study')['studyId']==sys.argv[5]\nassert c.export_game_playtest(sys.argv[5])['responses']==[]\nassert len(c.export_game_playtest(sys.argv[5],True)['responses'])==1\nh=c.get_game_playtest_corrections(sys.argv[5],sys.argv[7])\nassert len(h['entries'])==1 and h['current']['experienceScore']==2\na=dict(h['current'])\nfor k in ['studyId','participantId','withdrawn','recordedAt']: a.pop(k)\na['experienceScore']=3\nr=c.correct_game_playtest({'requestId':'python-correct','studyId':sys.argv[5],'participantId':sys.argv[7],'expectedResponseHash':h['currentResponseHash'],'reason':'Synthetic Python correction','correctionConfirmed':True,'answers':a})\nassert r['experienceScore']==3\nassert len(c.get_game_playtest_corrections(sys.argv[5],sys.argv[7])['entries'])==2\nc.close()\nprint('LOCAL_PLAYTEST_SDK_OK')`;
      const result = await promisify(execFile)("python3", ["-I", "-c", code, path.resolve("packages/client-python"), ipcPath(f.directory), certificate, auth, study.id, f.project.id, participantId], { timeout: 30000 });
      assert.match(result.stdout, /LOCAL_PLAYTEST_SDK_OK/);
    }
    const artifact = await client.getGameArtifact(f.build.id) as GameArtifact; assert.equal(artifact.artifactHash, study.artifactHash);
  } finally { client?.close(); await server.close(); await f.close(); }
});

test("result-free inspection preserves content bindings and withdrawal across restart; other namespaces cannot inspect or export records", async () => {
  const f = await fixture();let reopened: AgentService | undefined;
  try {
    assert.deepEqual(await call(f.service, "games.playtests.inspect", { requestId: "not-dispatched" }), { state: "missing" });
    const create = { requestId: "study", buildId: f.build.id, title: "Synthetic", audience: "No actual people" };
    const study = await call<GamePlaytestStudy>(f.service, "games.playtests.create", create), request = observation(study.id);
    request.notes = "Private synthetic note, never in a receipt";
    await call(f.service, "games.playtests.record", request);
    const created = await call(f.service, "games.playtests.inspect", { requestId: create.requestId });
    assert.deepEqual(created, { state: "acknowledged", bindingHash: contentHash({ kind: "create", input: create }), studyId: study.id, participantId: null });
    const recorded = await call(f.service, "games.playtests.inspect", { requestId: request.requestId });
    assert.deepEqual(recorded, { state: "acknowledged", bindingHash: contentHash({ kind: "record", input: request }), studyId: study.id, participantId: request.participantId, withdrawn: false });
    assert.doesNotMatch(JSON.stringify(recorded), /notes|Private synthetic|experienceScore|environment/);
    await call(f.service, "games.playtests.withdraw", { requestId: "withdraw", studyId: study.id, participantId: request.participantId, consentWithdrawalConfirmed: true });
    await f.service.close();reopened = f.create();
    assert.deepEqual(await call(reopened, "games.playtests.inspect", { requestId: request.requestId }), { ...(recorded as object), withdrawn: true });
    for (const identity of [{ ...reg, profile: "another" }, { ...reg, product: "companion-vscode" as const }]) {
      assert.deepEqual(await call(reopened, "games.playtests.inspect", { requestId: request.requestId }, identity), { state: "missing" });
      await assert.rejects(call(reopened, "games.playtests.export", { studyId: study.id, includeResponses: true }, identity), /not found/);
    }
    for (const method of ["games.playtests.inspect", "games.playtests.export"]) {
      await assert.rejects(call(reopened, method, method.endsWith("inspect") ? { requestId: "study" } : { studyId: study.id, includeResponses: false }, { ...reg, product: "kidos" }), /responsible-adult/);
    }
  } finally { await reopened?.close();await f.close(); }
});

test("full exports include all pages and tombstones, while summary exports contain no individual observations", async () => {
  const f = await fixture(), server = new LocalServer(f.service, f.directory);let client: AgentClient | undefined;
  try {
    const identity = await ensureIdentity(f.directory), credential = await createClientCredential(f.directory, reg);f.service.store.register(credential);
    await server.listen();client = new AgentClient({ address: ipcPath(f.directory), certificate: identity.cert, credential });await client.connect();
    const study = await client.createGamePlaytest({ requestId: "study", buildId: f.build.id, title: "Synthetic only", audience: "No human acceptance" });
    const requests = Array.from({ length: 101 }, () => observation(study.id));
    for (const request of requests) await client.recordGamePlaytest(request);
    await client.withdrawGamePlaytest({ requestId: "withdraw", studyId: study.id, participantId: requests[0]!.participantId, consentWithdrawalConfirmed: true });
    const summary = await client.exportGamePlaytest(study.id);
    assert.equal(summary.summary.totalRecorded, 101);assert.deepEqual(summary.responses, []);assert.equal(summary.summary.qualityApproved, false);
    assert.doesNotMatch(JSON.stringify(summary), /participantId|notes|environment|Synthetic test only/);
    const full = await client.exportGamePlaytest(study.id, true);
    assert.equal(full.responses.length, 101);assert.equal(full.responses[0]!.withdrawn, true);assert.equal("notes" in full.responses[0]!, false);
    assert.equal(full.summary.active, 100);assert.equal(full.summary.withdrawn, 1);
    assert.equal(new Set(full.responses.map(value => value.participantId)).size, 101);
    assert.equal((await client.getGameProject(f.project.id)).revision, 1);
  } finally { client?.close();await server.close();await f.close(); }
});
