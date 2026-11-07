import * as os from "node:os";
import { statfs } from "node:fs/promises";
import { z } from "zod";
import { OLLAMA_RECOMMENDED_SETUP, type OllamaCatalogEntry, type OllamaRole } from "./ollama-catalog";
import {
  dockerImageRecommendationCandidates,
  dockerResourceLimits,
  DOCKER_SANDBOX_PROXY_IMAGE,
  type DockerExecutionRecommendation,
  type DockerImageCandidate
} from "./docker-recommendation";

export type MachineProfile = {
  platform: NodeJS.Platform;
  architecture: string;
  totalMemoryGb: number;
  cpuCount: number;
  availableDiskGb: number;
  acceleration: "apple-metal" | "cuda" | "cpu" | "unknown";
  ollamaVersion?: string;
};

export type OllamaModelCandidate = {
  alias: string;
  label: string;
  sizeBytes: number;
  contextTokens: number;
  capabilities: string[];
  roles: OllamaRole[];
  source: "bundled" | "public" | "installed";
  installed: boolean;
};

export type OllamaRoleConfiguration = {
  executor: string;
  planner?: string;
  evaluator?: string;
  vision?: string;
  embedding?: string;
};

export type OllamaRecommendationOption = {
  roles: OllamaRoleConfiguration;
  requiredPulls: string[];
  downloadBytes: number;
  fitness: "comfortable" | "borderline";
  rationaleByRole: Partial<Record<OllamaRole, string>>;
};

export const OLLAMA_RECOMMENDATION_SCHEMA_VERSION = 2 as const;

export type OllamaRecommendationPlan = OllamaRecommendationOption & {
  schemaVersion: typeof OLLAMA_RECOMMENDATION_SCHEMA_VERSION;
  source: "baseline" | "advisor";
  advisorModel?: string;
  machineSummary: string;
  installedAlternative?: OllamaRecommendationOption;
  consideredCandidates?: Partial<Record<OllamaRole, string[]>>;
  docker: DockerExecutionRecommendation;
  warnings: string[];
};

export type InstalledOllamaModel = {
  name: string;
  size?: number;
  capabilities?: string[];
  contextLength?: number;
};

const publicEntrySchema = z.object({
  alias: z.string().min(1).max(128),
  label: z.string().min(1).max(160),
  sizeBytes: z.number().int().positive().max(2_000_000_000_000),
  contextTokens: z.number().int().positive().max(4_000_000),
  capabilities: z.array(z.string().min(1).max(64)).max(20),
  roles: z.array(z.enum(["executor", "planner", "vision", "evaluator", "embedding"])).min(1).max(5)
}).strict();

export const publicOllamaCatalogSchema = z.object({
  version: z.literal(1),
  updatedAt: z.string().max(40),
  models: z.array(publicEntrySchema).max(500)
}).strict();

const recommendationResponseSchema = z.object({
  roles: z.object({
    executor: z.string().min(1).max(128),
    planner: z.string().max(128).optional(),
    evaluator: z.string().max(128).optional(),
    vision: z.string().max(128).optional(),
    embedding: z.string().max(128).optional()
  }).strict(),
  installedRoles: z.object({
    executor: z.string().min(1).max(128),
    planner: z.string().max(128).optional(),
    evaluator: z.string().max(128).optional(),
    vision: z.string().max(128).optional(),
    embedding: z.string().max(128).optional()
  }).strict(),
  dockerImage: z.string().max(256).optional(),
  dockerRationale: z.string().max(600).optional(),
  rationaleByRole: z.record(z.string(), z.string().max(600)).default({}),
  installedRationaleByRole: z.record(z.string(), z.string().max(600)).default({}),
  warnings: z.array(z.string().max(600)).max(10).default([])
}).strict();

export async function detectMachineProfile(diskPath: string, ollamaVersion?: string): Promise<MachineProfile> {
  let availableDiskGb = 0;
  try {
    const disk = await statfs(diskPath);
    availableDiskGb = roundGb(Number(disk.bavail) * Number(disk.bsize));
  } catch { /* A missing disk estimate must not block setup. */ }
  return {
    platform: process.platform,
    architecture: process.arch,
    totalMemoryGb: roundGb(os.totalmem()),
    cpuCount: os.cpus().length,
    availableDiskGb,
    acceleration: detectAcceleration(process.platform, process.arch, process.env.CUDA_VISIBLE_DEVICES),
    ...(ollamaVersion?.trim() ? { ollamaVersion: ollamaVersion.trim().slice(0, 80) } : {})
  };
}

export function detectAcceleration(platform: NodeJS.Platform, architecture: string, cudaVisibleDevices?: string): MachineProfile["acceleration"] {
  if (platform === "darwin" && architecture === "arm64") return "apple-metal";
  if (cudaVisibleDevices?.trim() && cudaVisibleDevices.trim() !== "-1") return "cuda";
  return os.cpus().length ? "cpu" : "unknown";
}

export function mergeOllamaCandidates(options: {
  bundled: readonly OllamaCatalogEntry[];
  publicCatalog?: unknown;
  installed?: readonly InstalledOllamaModel[];
}): OllamaModelCandidate[] {
  const merged = new Map<string, OllamaModelCandidate>();
  for (const entry of options.bundled) {
    merged.set(normalizeAlias(entry.pull), {
      alias: entry.pull,
      label: entry.label,
      sizeBytes: parseSize(entry.size),
      contextTokens: parseContext(entry.context),
      capabilities: [...entry.capabilities],
      roles: [...entry.roles],
      source: "bundled",
      installed: false
    });
  }
  if (options.publicCatalog !== undefined) {
    const catalog = publicOllamaCatalogSchema.parse(options.publicCatalog);
    for (const entry of catalog.models) {
      merged.set(normalizeAlias(entry.alias), { ...entry, source: "public", installed: false });
    }
  }
  for (const installed of options.installed ?? []) {
    const key = normalizeAlias(installed.name);
    const existing = merged.get(key);
    merged.set(key, {
      alias: installed.name,
      label: existing?.label ?? installed.name,
      sizeBytes: installed.size && installed.size > 0 ? installed.size : existing?.sizeBytes ?? 0,
      contextTokens: installed.contextLength ?? existing?.contextTokens ?? 0,
      capabilities: unique(installed.capabilities?.length ? installed.capabilities : existing?.capabilities ?? []),
      roles: existing?.roles ?? inferRoles(installed.capabilities ?? []),
      source: "installed",
      installed: true
    });
  }
  return [...merged.values()].filter((candidate) => candidate.roles.length > 0).sort((a, b) => a.alias.localeCompare(b.alias));
}

export class OllamaRecommendationEngine {
  public async recommend(options: {
    machine: MachineProfile;
    candidates: readonly OllamaModelCandidate[];
    supportedRoles: readonly OllamaRole[];
    advisorModel?: string;
    invokeAdvisor?: (prompt: string) => Promise<string>;
    installedDockerImages?: readonly string[];
  }): Promise<OllamaRecommendationPlan> {
    const eligible = eligibleCandidates(options.machine, options.candidates, options.supportedRoles);
    const dockerCandidates = dockerImageRecommendationCandidates(options.machine.architecture);
    const baseline = baselineRecommendation(options.machine, eligible, options.supportedRoles, dockerCandidates, options.installedDockerImages ?? []);
    if (!options.advisorModel || !options.invokeAdvisor || !eligible.some((candidate) => candidate.installed && sameAlias(candidate.alias, options.advisorModel!))) {
      return baseline;
    }
    try {
      const response = await options.invokeAdvisor(advisorPrompt(options.machine, eligible, options.supportedRoles, dockerCandidates, options.installedDockerImages ?? []));
      const parsed = recommendationResponseSchema.parse(JSON.parse(extractJson(response)) as unknown);
      validateIdealCatalogBreadth(parsed, eligible, options.supportedRoles);
      return validateAdvisorPlan(parsed, options.machine, eligible, options.supportedRoles, options.advisorModel, dockerCandidates, options.installedDockerImages ?? []);
    } catch (error) {
      return {
        ...baseline,
        warnings: [...baseline.warnings, `A análise local não pôde ser validada; a estimativa inicial foi preservada (${singleLine(error)}).`]
      };
    }
  }
}

function baselineRecommendation(machine: MachineProfile, candidates: readonly OllamaModelCandidate[], supportedRoles: readonly OllamaRole[], dockerCandidates: readonly DockerImageCandidate[], installedDockerImages: readonly string[]): OllamaRecommendationPlan {
  const roles: Partial<Record<OllamaRole, string>> = {};
  const rationale: Partial<Record<OllamaRole, string>> = {};
  const installedRoles: Partial<Record<OllamaRole, string>> = {};
  const installedRationale: Partial<Record<OllamaRole, string>> = {};
  for (const role of supportedRoles) {
    const preferredAliases = baselinePreferences(role);
    const chosen = preferredAliases
      .map((alias) => candidates.find((candidate) => candidate.roles.includes(role) && sameAlias(candidate.alias, alias)))
      .find(Boolean)
      ?? candidates.find((candidate) => candidate.roles.includes(role));
    if (chosen) {
      roles[role] = chosen.alias;
      rationale[role] = chosen.installed
        ? "Melhor estimativa incorporada para este papel; o modelo já está instalado."
        : "Melhor estimativa incorporada para este papel, independentemente do estado de instalação.";
    }
    const installed = preferredAliases
      .map((alias) => candidates.find((candidate) => candidate.roles.includes(role) && candidate.installed && sameAlias(candidate.alias, alias)))
      .find(Boolean)
      ?? candidates.find((candidate) => candidate.roles.includes(role) && candidate.installed);
    if (installed) {
      installedRoles[role] = installed.alias;
      installedRationale[role] = "Melhor alternativa compatível entre os modelos já instalados.";
    }
  }
  if (!roles.executor) throw new Error("Nenhum executor Ollama compatível foi encontrado no catálogo.");
  return finalizePlan(
    "baseline",
    machine,
    roles as OllamaRoleConfiguration,
    candidates,
    rationale,
    ["Estimativa inicial; use Reanalyze with local model para comparar qualidade e complementaridade."],
    selectDockerImage(machine, dockerCandidates, installedDockerImages),
    installedRoles.executor ? { roles: installedRoles as OllamaRoleConfiguration, rationaleByRole: installedRationale } : undefined
  );
}

function validateAdvisorPlan(
  value: z.infer<typeof recommendationResponseSchema>,
  machine: MachineProfile,
  candidates: readonly OllamaModelCandidate[],
  supportedRoles: readonly OllamaRole[],
  advisorModel: string,
  dockerCandidates: readonly DockerImageCandidate[],
  installedDockerImages: readonly string[]
): OllamaRecommendationPlan {
  const roles = validateRoleSelection(value.roles, candidates, supportedRoles, false, "ideal");
  const installedRoles = validateRoleSelection(value.installedRoles, candidates, supportedRoles, true, "instalada");
  if (!roles.executor) throw new Error("O advisor não escolheu um executor válido.");
  if (!installedRoles.executor) throw new Error("O advisor não escolheu um executor instalado válido.");
  const rationale = Object.fromEntries(Object.entries(value.rationaleByRole).filter(([role]) => supportedRoles.includes(role as OllamaRole))) as Partial<Record<OllamaRole, string>>;
  const installedRationale = Object.fromEntries(Object.entries(value.installedRationaleByRole).filter(([role]) => supportedRoles.includes(role as OllamaRole))) as Partial<Record<OllamaRole, string>>;
  const docker = selectDockerImage(machine, dockerCandidates, installedDockerImages, value.dockerImage, value.dockerRationale);
  return {
    ...finalizePlan("advisor", machine, roles, candidates, rationale, value.warnings, docker, {
      roles: installedRoles,
      rationaleByRole: installedRationale
    }),
    advisorModel
  };
}

function validateRoleSelection(
  selection: Partial<Record<OllamaRole, string>>,
  candidates: readonly OllamaModelCandidate[],
  supportedRoles: readonly OllamaRole[],
  installedOnly: boolean,
  label: string
): OllamaRoleConfiguration {
  const roles: Partial<Record<OllamaRole, string>> = {};
  for (const role of supportedRoles) {
    const alias = selection[role];
    if (!alias) continue;
    const candidate = candidates.find((item) => sameAlias(item.alias, alias));
    if (!candidate || !candidate.roles.includes(role) || (installedOnly && !candidate.installed)) {
      throw new Error(`O advisor escolheu um modelo incompatível para a configuração ${label} em ${role}.`);
    }
    roles[role] = candidate.alias;
  }
  return roles as OllamaRoleConfiguration;
}

function finalizePlan(
  source: "baseline" | "advisor",
  machine: MachineProfile,
  roles: OllamaRoleConfiguration,
  candidates: readonly OllamaModelCandidate[],
  rationaleByRole: Partial<Record<OllamaRole, string>>,
  warnings: string[],
  docker: DockerExecutionRecommendation,
  installedAlternativeInput?: { roles: OllamaRoleConfiguration; rationaleByRole: Partial<Record<OllamaRole, string>> }
): OllamaRecommendationPlan {
  const primary = buildRecommendationOption(machine, roles, candidates, rationaleByRole);
  const installedAlternative = installedAlternativeInput
    ? buildRecommendationOption(machine, installedAlternativeInput.roles, candidates, installedAlternativeInput.rationaleByRole)
    : undefined;
  if (installedAlternative?.requiredPulls.length) throw new Error("A alternativa instalada contém modelos ausentes.");
  const selected = unique([
    ...Object.values(primary.roles),
    ...Object.values(installedAlternative?.roles ?? {})
  ].filter((value): value is string => Boolean(value)));
  const consideredCandidates = consideredByRole(roles, candidates);
  return {
    schemaVersion: OLLAMA_RECOMMENDATION_SCHEMA_VERSION,
    source,
    machineSummary: `${machine.architecture} · ${machine.totalMemoryGb} GB RAM · ${accelerationLabel(machine.acceleration)}${machine.ollamaVersion ? ` · Ollama ${machine.ollamaVersion}` : ""}`,
    ...primary,
    ...(installedAlternative ? { installedAlternative } : {}),
    consideredCandidates,
    docker,
    warnings: unique([...warnings, ...compatibilityWarnings(machine, selected, candidates, primary.downloadBytes)].map((warning) => warning.trim()).filter(Boolean)).slice(0, 10)
  };
}

function buildRecommendationOption(machine: MachineProfile, roles: OllamaRoleConfiguration, candidates: readonly OllamaModelCandidate[], rationaleByRole: Partial<Record<OllamaRole, string>>): OllamaRecommendationOption {
  const aliases = unique(Object.values(roles).filter((value): value is string => Boolean(value)));
  const selected = aliases.map((alias) => candidates.find((candidate) => sameAlias(candidate.alias, alias))!).filter(Boolean);
  const missing = selected.filter((candidate) => !candidate.installed);
  const largest = Math.max(0, ...selected.map((candidate) => candidate.sizeBytes));
  const comfortableBytes = machine.totalMemoryGb * 1024 ** 3 * 0.58;
  const downloadBytes = missing.reduce((total, candidate) => total + candidate.sizeBytes, 0);
  return { roles, requiredPulls: missing.map((candidate) => candidate.alias), downloadBytes, fitness: largest <= comfortableBytes ? "comfortable" : "borderline", rationaleByRole };
}

function compatibilityWarnings(machine: MachineProfile, selectedAliases: readonly string[], candidates: readonly OllamaModelCandidate[], downloadBytes: number): string[] {
  const largest = Math.max(0, ...selectedAliases.map((alias) => candidates.find((candidate) => sameAlias(candidate.alias, alias))?.sizeBytes ?? 0));
  const comfortableBytes = machine.totalMemoryGb * 1024 ** 3 * 0.58;
  return [
    ...(largest > comfortableBytes ? ["A maior seleção pode operar perto do limite de memória; os papéis serão executados sequencialmente."] : []),
    ...(machine.availableDiskGb > 0 && downloadBytes > machine.availableDiskGb * 1024 ** 3 ? ["O espaço livre detectado é menor que o total estimado dos downloads ausentes."] : [])
  ];
}

function consideredByRole(roles: OllamaRoleConfiguration, candidates: readonly OllamaModelCandidate[]): Partial<Record<OllamaRole, string[]>> {
  const consideredCandidates = Object.fromEntries((["executor", "planner", "evaluator", "vision", "embedding"] as const).flatMap((role) => {
    const selectedAlias = roles[role];
    const roleCandidates = candidates.filter((candidate) => candidate.roles.includes(role));
    const selected = roleCandidates.filter((candidate) => sameAlias(candidate.alias, selectedAlias ?? ""));
    const installed = roleCandidates.filter((candidate) => candidate.installed && !sameAlias(candidate.alias, selectedAlias ?? "")).slice(0, 4);
    const available = roleCandidates.filter((candidate) => !candidate.installed && !sameAlias(candidate.alias, selectedAlias ?? "")).slice(0, 8);
    const aliases = unique([...selected, ...installed, ...available].map((candidate) => candidate.alias)).slice(0, 12);
    return aliases.length ? [[role, aliases]] : [];
  })) as Partial<Record<OllamaRole, string[]>>;
  return consideredCandidates;
}

function eligibleCandidates(machine: MachineProfile, candidates: readonly OllamaModelCandidate[], supportedRoles: readonly OllamaRole[]): OllamaModelCandidate[] {
  const maxBytes = machine.totalMemoryGb * 1024 ** 3 * 0.72;
  return candidates.filter((candidate) => candidate.roles.some((role) => supportedRoles.includes(role))
    && (candidate.roles.includes("embedding") || candidate.sizeBytes <= maxBytes || candidate.sizeBytes === 0));
}

function advisorPrompt(machine: MachineProfile, candidates: readonly OllamaModelCandidate[], supportedRoles: readonly OllamaRole[], dockerCandidates: readonly DockerImageCandidate[], installedDockerImages: readonly string[]): string {
  return [
    "Recommend two balanced local Ollama model compositions for a coding agent.",
    "Choose aliases only from candidates. Do not invent facts or aliases.",
    "For roles, choose the best-quality composition that fits the detected machine, regardless of whether models are installed. Downloads are allowed in this ideal composition.",
    "For installedRoles, choose the best composition using only candidates whose installed field is true. This alternative must require zero downloads.",
    "Optimize role quality within the detected machine limits, not download convenience. Models run sequentially, so do not assume simultaneous memory use.",
    "For planner and evaluator, compare reasoning-specialized candidates and prefer complementary specialists when they materially improve planning or independent review.",
    "DeepSeek catalog entries are intentional candidates, not examples. Explicitly compare every compatible DeepSeek candidate for planner and evaluator instead of omitting the family because it is not installed.",
    "When compatible non-installed reasoning specialists exist, the ideal composition must use at least one of them; the installedRoles composition already represents the zero-download alternative.",
    "In the ideal roles, use installed status only as a tiebreaker when role quality is genuinely comparable; explain when one model is intentionally reused across roles.",
    "Also choose one general Docker execution image from Docker candidates. Installed status is a tiebreaker; do not invent an alias.",
    "Return JSON only: {roles:{executor,planner?,evaluator?,vision?,embedding?},installedRoles:{executor,planner?,evaluator?,vision?,embedding?},dockerImage?,dockerRationale?,rationaleByRole:{...},installedRationaleByRole:{...},warnings:[...]}",
    `Machine: ${JSON.stringify(machine)}`,
    `Supported roles: ${JSON.stringify(supportedRoles)}`,
    `Candidates: ${JSON.stringify(candidates.map(({ alias, label, sizeBytes, contextTokens, capabilities, roles, installed }) => ({ alias, label, sizeBytes, contextTokens, capabilities, roles, installed })))}`,
    `Docker candidates: ${JSON.stringify(dockerCandidates.map((candidate) => ({ ...candidate, installed: installedDockerImages.some((image) => sameAlias(image, candidate.alias)) })))}`
  ].join("\n").slice(0, 80_000);
}

function validateIdealCatalogBreadth(
  value: z.infer<typeof recommendationResponseSchema>,
  candidates: readonly OllamaModelCandidate[],
  supportedRoles: readonly OllamaRole[]
): void {
  if (!supportedRoles.includes("planner") && !supportedRoles.includes("evaluator")) return;
  const nonInstalledSpecialists = candidates.filter((candidate) => !candidate.installed
    && !candidate.roles.includes("executor")
    && (candidate.roles.includes("planner") || candidate.roles.includes("evaluator"))
    && candidate.capabilities.some((capability) => capability === "thinking" || capability === "structured output"));
  if (!nonInstalledSpecialists.length) return;
  const selected = [value.roles.planner, value.roles.evaluator].filter((alias): alias is string => Boolean(alias));
  const includesSpecialist = selected.some((alias) => nonInstalledSpecialists.some((candidate) => sameAlias(candidate.alias, alias)));
  if (!includesSpecialist) {
    throw new Error("O advisor ignorou especialistas de raciocínio compatíveis na configuração ideal.");
  }
}

function baselinePreferences(role: OllamaRole): readonly string[] {
  const preferences: Record<OllamaRole, readonly string[]> = {
    executor: [OLLAMA_RECOMMENDED_SETUP.executor, "qwen2.5-coder:7b"],
    planner: [OLLAMA_RECOMMENDED_SETUP.planner, "deepseek-r1:14b", "gpt-oss:20b", "qwen3:30b"],
    evaluator: [OLLAMA_RECOMMENDED_SETUP.evaluator, "deepseek-r1:32b", "deepseek-r1:14b", "qwen3:30b"],
    vision: [OLLAMA_RECOMMENDED_SETUP.vision, "qwen3-vl:32b"],
    embedding: [OLLAMA_RECOMMENDED_SETUP.embedding]
  };
  return preferences[role];
}

function selectDockerImage(machine: MachineProfile, candidates: readonly DockerImageCandidate[], installedImages: readonly string[], requested?: string, rationale?: string): DockerExecutionRecommendation {
  const limits = dockerResourceLimits(machine.totalMemoryGb, machine.cpuCount);
  if (!candidates.length) {
    return {
      image: "unavailable",
      installed: false,
      rationale: "Nenhuma imagem de execução incorporada oferece suporte à arquitetura detectada.",
      pullCommand: "",
      proxyImage: DOCKER_SANDBOX_PROXY_IMAGE,
      proxyInstalled: installedImages.some((image) => sameAlias(image, DOCKER_SANDBOX_PROXY_IMAGE)),
      proxyPullCommand: `docker pull ${DOCKER_SANDBOX_PROXY_IMAGE}`,
      ...limits
    };
  }
  let selected: DockerImageCandidate | undefined;
  if (requested) {
    selected = candidates.find((candidate) => sameAlias(candidate.alias, requested));
    if (!selected) throw new Error("O advisor escolheu uma imagem Docker ausente do catálogo incorporado.");
  }
  selected ??= candidates.find((candidate) => installedImages.some((image) => sameAlias(image, candidate.alias))) ?? candidates[0];
  if (!selected) throw new Error("Nenhuma imagem Docker compatível foi encontrada.");
  const installed = installedImages.some((image) => sameAlias(image, selected.alias));
  return {
    image: selected.alias,
    installed,
    rationale: rationale?.trim() || `${selected.purpose} Compatível com ${selected.architectures.join(" e ")}.`,
    pullCommand: `docker pull ${selected.alias}`,
    proxyImage: DOCKER_SANDBOX_PROXY_IMAGE,
    proxyInstalled: installedImages.some((image) => sameAlias(image, DOCKER_SANDBOX_PROXY_IMAGE)),
    proxyPullCommand: `docker pull ${DOCKER_SANDBOX_PROXY_IMAGE}`,
    ...limits
  };
}

function inferRoles(capabilities: readonly string[]): OllamaRole[] {
  const normalized = capabilities.map((value) => value.toLowerCase());
  if (normalized.includes("embedding")) return ["embedding"];
  const roles: OllamaRole[] = ["planner", "evaluator"];
  if (normalized.some((value) => value === "tools" || value.includes("tool"))) roles.unshift("executor");
  if (normalized.some((value) => value === "vision" || value.includes("image"))) roles.push("vision");
  return unique(roles);
}

function extractJson(value: string): string {
  const trimmed = value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Advisor returned no JSON object.");
  return trimmed.slice(start, end + 1);
}

function normalizeAlias(value: string): string { return value.trim().toLowerCase(); }
function sameAlias(left: string, right: string): boolean { return normalizeAlias(left) === normalizeAlias(right); }
function unique<T>(values: readonly T[]): T[] { return [...new Set(values)]; }
function roundGb(bytes: number): number { return Math.round(bytes / 1024 ** 3); }
function parseSize(value: string): number { const match = /([\d.]+)\s*(GB|MB)/i.exec(value); return match ? Number(match[1]) * (match[2]!.toUpperCase() === "GB" ? 1024 ** 3 : 1024 ** 2) : 0; }
function parseContext(value: string): number { const match = /([\d.]+)\s*([KM]?)/i.exec(value); if (!match) return 0; return Math.round(Number(match[1]) * (match[2]!.toUpperCase() === "K" ? 1_000 : match[2]!.toUpperCase() === "M" ? 1_000_000 : 1)); }
function singleLine(error: unknown): string { return (error instanceof Error ? error.message : String(error)).replace(/[\r\n\t]+/g, " ").slice(0, 180); }
function accelerationLabel(value: MachineProfile["acceleration"]): string { return ({ "apple-metal": "Apple Metal", cuda: "CUDA", cpu: "CPU", unknown: "acceleration unknown" })[value]; }
