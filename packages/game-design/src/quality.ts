import type { GameProject, GameRevision } from "../../contracts/src/games";
import { gameQualityCategories, type GameArtifact, type GameQualityAssessment, type GameValidationReport } from "../../contracts/src/game-production";
import { assessPlaytestTargets } from "./playtest-targets";

export const gameQualityChecks = {
  runtime: ["boots", "controls", "pause", "restart", "resize", "save", "focus", "console"],
  content: ["scope", "progression", "completion"],
  visual: ["coherence", "animation", "readability", "composition"],
  audio: ["music", "effects", "mute", "mix"],
  performance: ["frame-rate", "loading"],
  license: ["provenance", "licenses"],
  human: ["onboarding", "enjoyment"],
} as const;

/** Conservative assessment of trusted collector reports, not model self-evaluation. */
export function assessGameQuality(project: GameProject, revision: GameRevision, artifact: GameArtifact | null, reports: readonly GameValidationReport[]): GameQualityAssessment {
  const blockers: string[] = [];
  const stale = project.revision !== revision.revision || project.contentHash !== revision.contentHash || Boolean(artifact &&
    (artifact.projectId !== project.id || artifact.revision !== revision.revision || artifact.sourceHash !== revision.contentHash));
  if (stale) blockers.push("stale-source-revision");
  if (!artifact) blockers.push("build-not-produced");
  if (!revision.document.design) blockers.push("design-missing");
  if (revision.document.legacy?.reviewRequired) blockers.push("legacy-design-review-required");
  if (revision.document.assets.some((asset) => asset.placeholder)) blockers.push("placeholder-assets");
  const matched = artifact ? reports.filter((report) => report.projectId === project.id && report.revision === revision.revision &&
    report.sourceHash === revision.contentHash && report.artifactHash === artifact.artifactHash && report.buildId === artifact.jobId &&
    (report.category === "license" || report.environment.scope !== "static") &&
    (report.category !== "human" || report.environment.scope === "human")) : [];
  const latest = new Map<string, GameValidationReport>();
  for (const report of matched) latest.set(JSON.stringify([report.collectorId, report.category, report.environment, report.testCase ?? null]), report);
  const applicable = [...latest.values()];
  for (const category of gameQualityCategories) {
    const selected = applicable.filter((report) => report.category === category);
    if (!selected.length) blockers.push(`missing-${category}-assessment`);
    if (selected.some((report) => report.checks.some((check) => check.status !== "passed"))) blockers.push(`unresolved-${category}-checks`);
    for (const id of gameQualityChecks[category]) if (!selected.some((report) => report.checks.some((check) => check.id === id && check.status === "passed")))
      blockers.push(`missing-${category}-${id}`);
  }
  if (revision.document.brief.playMode !== "single-player" && !applicable.some((report) => report.category === "runtime" &&
    report.checks.some((check) => check.id === "local-multiplayer" && check.status === "passed"))) blockers.push("local-multiplayer-unverified");
  for (const item of revision.document.design?.content ?? []) if (!applicable.some((report) => report.category === "content" &&
    report.environment.scope !== "static" && report.coverage?.contentIds.includes(item.id))) blockers.push(`unverified-content:${item.id}`);
  const categories = { gameplay: "runtime", technical: "runtime", visual: "visual", audio: "audio", performance: "performance", accessibility: "runtime", human: "human" } as const;
  for (const scenario of revision.document.design?.playtests ?? []) if (!applicable.some((report) => report.category === categories[scenario.category] &&
    report.environment.scope !== "static" && report.coverage?.scenarioIds.includes(scenario.id))) blockers.push(`unverified-scenario:${scenario.id}`);
  // Device performance and human experience are separate acceptance, never implied by a build.
  const performance = applicable.filter((report) => report.category === "performance" && report.environment.scope === "physical");
  for (const device of ["desktop", "mobile"]) {
    if (!performance.some((report) => report.metrics.deviceClass === device &&
      typeof report.metrics.sustainedFps === "number" && report.metrics.sustainedFps >= (device === "desktop" ? 60 : 30) &&
      typeof report.metrics.playableSeconds === "number" && report.metrics.playableSeconds <= 10 &&
      report.metrics.networkMbps === 20 && report.metrics.networkRttMs === 100 && report.metrics.cacheCold === true))
      blockers.push(`unverified-${device}-performance`);
  }
  const human = applicable.filter((report) => report.category === "human" && report.environment.scope === "human");
  if (!human.some((report) => typeof report.metrics.participants === "number" &&
    typeof report.metrics.understoodWithin30Seconds === "number" && typeof report.metrics.ratedAtLeastFour === "number" &&
    report.metrics.consent === true && assessPlaytestTargets(report.metrics.participants,
      report.metrics.understoodWithin30Seconds, report.metrics.ratedAtLeastFour).numericalTargetsMet))
    blockers.push("human-playtest-targets-unverified");
  return { projectId: project.id, revision: revision.revision, sourceHash: revision.contentHash,
    buildId: artifact?.jobId ?? null, artifactHash: artifact?.artifactHash ?? null,
    ready: blockers.length === 0, stale, blockers, reports: [...applicable] };
}
