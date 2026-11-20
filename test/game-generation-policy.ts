import { gameAgentSchemas } from "../packages/contracts/src/game-agent";

/** Explicit opt-in development harness scope. Not product or parental authority. */
export type GenerationApprovalScope = {
  runId: string;
  engine: string;
  projects: { id: string; revision: number; engine: string }[];
  jobs: { id: string; kind: string; projectId: string; revision: number; state: string }[];
};
export function generationApproval(request: { runId: string; kind: string; payload: unknown }, scope: GenerationApprovalScope): boolean {
  if (request.runId !== scope.runId || request.kind !== "approval" || !request.payload || typeof request.payload !== "object") return false;
  const payload = request.payload as { tool?: string; risk?: string; input?: unknown };
  if (payload.risk !== "standard" || !payload.input || typeof payload.input !== "object") return false;
  const schema = payload.tool === "game_build" ? gameAgentSchemas.game_build : payload.tool === "game_validate" ? gameAgentSchemas.game_validate : payload.tool === "game_process_assets" ? gameAgentSchemas.game_process_assets : undefined;
  if (!schema) return false;
  const parsed = schema.safeParse(payload.input);
  if (!parsed.success) return false;
  const input = parsed.data as Record<string, unknown>;
  const exactProject = () => scope.projects.some(project => project.id === input.projectId && project.revision === input.revision && project.engine === scope.engine);
  if (payload.tool === "game_build") return exactProject();
  if (payload.tool === "game_process_assets") {
    const spec = input.spec as { processorId?: string } | undefined;
    // Only the installed bounded image/audio worker. No provider or editor grants.
    return exactProject() && spec?.processorId === "local-media-v1";
  }
  if (payload.tool === "game_validate") {
    if (input.collectorId !== "web-browser-runtime-v1") return false;
    const build = scope.jobs.find(job => job.id === input.buildId && job.kind === "build" && job.state === "completed");
    return Boolean(build && scope.projects.some(project => project.id === build.projectId && project.revision === build.revision && project.engine === scope.engine));
  }
  // No budget renewal, credentials, generic commands, filesystem, model changes,
  // native editor authority or a second run can be approved by this harness.
  return false;
}
