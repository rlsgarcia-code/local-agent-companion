import assert from "node:assert/strict";
import test from "node:test";
import type { GameProject, GameRevision } from "../packages/contracts/src/games";
import type { GameArtifact, GameValidationReport } from "../packages/contracts/src/game-production";
import { gameQualityCategories } from "../packages/contracts/src/game-production";
import { assessGameQuality, gameQualityChecks } from "../packages/game-design/src/quality";
import { fixtureGameDocument } from "./game-fixtures";
import { assessPlaytestTargets } from "../packages/game-design/src/playtest-targets";

// Synthetic collector observations exercise policy; they are not game-acceptance evidence.
function evidence() {
  const sourceHash = "a".repeat(64), artifactHash = "b".repeat(64), toolchain = { id: "fixture", version: "test", sha256: "c".repeat(64) };
  const project: GameProject = { id: "game", title: "Fixture", engine: "phaser", dimension: "2d", revision: 1, contentHash: sourceHash, createdAt: 1, updatedAt: 1 };
  const revision: GameRevision = { projectId: project.id, revision: 1, contentHash: sourceHash, parentHash: null,
    document: fixtureGameDocument(), message: "Fixture", createdAt: 1, origin: "created" };
  const artifact: GameArtifact = { id: "artifact", jobId: "build", projectId: project.id, revision: 1, sourceHash, artifactHash,
    toolchain, engine: "phaser", adapterId: "fixture", entrypoint: "index.html", files: [], createdAt: 2 };
  const reports: GameValidationReport[] = gameQualityCategories.map((category, i): GameValidationReport => ({ id: `report-${i}`, jobId: `inspection-${i}`, buildId: artifact.jobId,
    projectId: project.id, revision: 1, sourceHash, artifactHash, collectorId: "fixture", toolchain, createdAt: 3,
    category, checks: gameQualityChecks[category].map((id) => ({ id, status: "passed", detail: "Synthetic test observation" })),
    environment: { platform: "fixture", browser: "fixture", device: "fixture", input: ["keyboard"], scope: category === "human" ? "human" : category === "license" ? "static" : "physical" },
    metrics: category === "human" ? { participants: 10, understoodWithin30Seconds: 8, ratedAtLeastFour: 7, consent: true }
      : category === "performance" ? { deviceClass: "desktop", sustainedFps: 60, playableSeconds: 9, networkMbps: 20, networkRttMs: 100, cacheCold: true } : {},
    coverage: { contentIds: ["island"], scenarioIds: ["anchor"] },
  }));
  const mobile = structuredClone(reports.find((row) => row.category === "performance")!);
  mobile.id = "mobile"; mobile.environment.device = "mobile"; mobile.metrics.deviceClass = "mobile"; mobile.metrics.sustainedFps = 30;
  reports.push(mobile);
  return { project, revision, artifact, reports };
}

test("quality needs the exact build, full category coverage, physical performance and consented human results", () => {
  const f = evidence(), assess = () => assessGameQuality(f.project, f.revision, f.artifact, f.reports);
  assert.equal(assess().ready, true);
  assert.equal(assessGameQuality(f.project, f.revision, null, f.reports).ready, false);
  f.reports[0]!.artifactHash = "0".repeat(64);
  assert.ok(assess().blockers.includes("missing-runtime-assessment"));
  f.reports[0]!.artifactHash = f.artifact.artifactHash;
  f.reports[0]!.environment.scope = "static";
  assert.ok(assess().blockers.includes("missing-runtime-assessment"));
  f.reports[0]!.environment.scope = "automated";
  f.project.revision = 2;
  assert.equal(assess().stale, true);
  assert.equal(assess().ready, false);
});

test("one self-declared pass per category cannot replace required checks, content or scenario observations", () => {
  const f = evidence();
  f.reports.forEach((report) => { report.checks = [{ id: "looks-good", status: "passed", detail: "Fixture" }]; delete report.coverage; });
  const result = assessGameQuality(f.project, f.revision, f.artifact, f.reports);
  assert.ok(result.blockers.includes("missing-runtime-controls"));
  assert.ok(result.blockers.includes("unverified-content:island"));
  assert.ok(result.blockers.includes("unverified-scenario:anchor"));
  assert.equal(result.ready, false);
});

test("failed repeat supersedes a prior pass and another environment cannot erase its failure", () => {
  const f = evidence(), repeat = structuredClone(f.reports[0]!);
  repeat.id = "repeat"; repeat.createdAt = 4; repeat.checks[0]!.status = "failed";
  f.reports.push(repeat);
  const other = structuredClone(f.reports[0]!); other.environment.device = "other"; f.reports.push(other);
  assert.ok(assessGameQuality(f.project, f.revision, f.artifact, f.reports).blockers.includes("unresolved-runtime-checks"));
  f.reports.push({ ...structuredClone(f.reports[0]!), id: "corrected", createdAt: 5 });
  assert.equal(assessGameQuality(f.project, f.revision, f.artifact, f.reports).ready, true);
});

test("simulated mobile measurements, invalid human counts and missing local multiplayer fail acceptance", () => {
  const f = evidence();
  const human = f.reports.find((r) => r.category === "human")!;
  for (const metrics of [{ participants: 9 }, { participants: 10.5 }, { understoodWithin30Seconds: 11 }, { ratedAtLeastFour: 7.5 }, { consent: false }]) {
    const changed = structuredClone(f.reports);
    Object.assign(changed.find((r) => r.id === human.id)!.metrics, metrics);
    assert.ok(assessGameQuality(f.project, f.revision, f.artifact, changed).blockers.includes("human-playtest-targets-unverified"));
  }
  f.reports.at(-1)!.environment.scope = "automated";
  assert.ok(assessGameQuality(f.project, f.revision, f.artifact, f.reports).blockers.includes("unverified-mobile-performance"));
  f.revision.document.brief.playMode = "local-coop";
  assert.ok(assessGameQuality(f.project, f.revision, f.artifact, f.reports).blockers.includes("local-multiplayer-unverified"));
});

test("a passing case or another named suite cannot erase a failing case from the same build", () => {
  const f = evidence();
  const failed = { ...structuredClone(f.reports[0]!), id: "case-failed", testCase: { suite: "data/playtests/one.json", id: "movement" },
    checks: [{ id: "scenario", status: "failed" as const, detail: "Observed movement failed" }] };
  const other = { ...structuredClone(failed), id: "another-suite", testCase: { suite: "data/playtests/two.json", id: "movement" }, checks: [{ id: "scenario", status: "passed" as const, detail: "A different case passed" }] };
  f.reports.push(failed, other);
  assert.ok(assessGameQuality(f.project, f.revision, f.artifact, f.reports).blockers.includes("unresolved-runtime-checks"));
  f.reports.push({ ...structuredClone(failed), id: "corrected-case", checks: [{ id: "scenario", status: "passed", detail: "The same case was rerun successfully" }] });
  assert.equal(assessGameQuality(f.project, f.revision, f.artifact, f.reports).ready, true);
});

test("human targets scale with the whole cohort instead of selecting eight and seven favorable observations",()=>{
  for(const [participants,understoodWithin30Seconds,ratedAtLeastFour,expected] of [
    [10,8,7,true],[11,8,7,false],[11,9,8,true],
    [20,8,7,false],[20,15,14,false],[20,16,13,false],[20,16,14,true],
    [21,16,15,false],[21,17,14,false],[21,17,15,true],
  ] as const){
    const f=evidence();f.reports.find(r=>r.category==='human')!.metrics={participants,understoodWithin30Seconds,ratedAtLeastFour,consent:true};
    const result=assessGameQuality(f.project,f.revision,f.artifact,f.reports);
    assert.equal(result.ready,expected,JSON.stringify({participants,understoodWithin30Seconds,ratedAtLeastFour}));
    assert.equal(result.blockers.includes('human-playtest-targets-unverified'),!expected);
  }
});

test("whole-person targets round upward and invalid counts never satisfy the numerical policy",()=>{
  for(const count of [...Array.from({length:1001},(_,i)=>i),Number.MAX_SAFE_INTEGER]){
    const expectedComprehension=Number((BigInt(count)*8n+9n)/10n),expectedRatings=Number((BigInt(count)*7n+9n)/10n);
    const result=assessPlaytestTargets(count,expectedComprehension,expectedRatings);
    assert.equal(result.requiredComprehension,expectedComprehension);assert.equal(result.requiredRatings,expectedRatings);
    assert.equal(result.numericalTargetsMet,count>=10);
  }
  for(const counts of [[10,8.5,7],[10,8,11],[10,-1,7],[10,8,-1],[NaN,8,7],[Infinity,8,7],[Number.MAX_SAFE_INTEGER+1,8,7],[-10,8,7]])
    assert.equal(assessPlaytestTargets(counts[0]!,counts[1]!,counts[2]!).numericalTargetsMet,false);
});
