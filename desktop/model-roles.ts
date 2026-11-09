import type { OllamaRecommendationPlan, OllamaRoleConfiguration } from "../src/ollama-recommendation";
import type { OllamaModel } from "./contracts";

export type InstalledModelRoleResolution = {
  roles: OllamaRoleConfiguration;
  ready: boolean;
  missing: string[];
  notices: string[];
};

export function resolveInstalledModelRoles(
  configured: OllamaRoleConfiguration,
  models: readonly OllamaModel[],
  recommendation?: OllamaRecommendationPlan
): InstalledModelRoleResolution {
  const installed = new Map(models.map((model) => [model.name.toLowerCase(), model]));
  const canonical = (name: string | undefined): string | undefined => name ? installed.get(name.toLowerCase())?.name : undefined;
  const alternative = recommendation?.installedAlternative?.roles;
  const missing = unique(Object.values(configured).filter((name): name is string => Boolean(name) && !canonical(name)));
  const notices: string[] = [];

  const executor = canonical(configured.executor) ?? canonical(alternative?.executor);
  if (!executor) {
    return {
      roles: configured,
      ready: false,
      missing,
      notices: missing.length
        ? [`A configuração ativa referencia modelos ausentes: ${missing.join(", ")}. A recomendação permanece pendente até o download ou a seleção de uma configuração instalada.`]
        : ["Nenhum executor Ollama instalado está selecionado."]
    };
  }
  if (executor.toLowerCase() !== configured.executor.toLowerCase()) {
    notices.push(`Executor ausente substituído pela alternativa instalada ${executor}.`);
  }

  const fallbackRole = (role: "planner" | "evaluator"): string => {
    const selected = configured[role];
    const resolved = canonical(selected) ?? canonical(alternative?.[role]) ?? executor;
    if (selected && !canonical(selected)) notices.push(`${roleLabel(role)} ${selected} ainda não está instalado; usando ${resolved}.`);
    return resolved;
  };
  const vision = canonical(configured.vision)
    ?? canonical(alternative?.vision)
    ?? (models.find((model) => model.name.toLowerCase() === executor.toLowerCase())?.capabilities?.includes("vision") ? executor : undefined);
  if (configured.vision && !canonical(configured.vision)) {
    notices.push(vision
      ? `Vision ${configured.vision} ainda não está instalado; usando ${vision}.`
      : `Vision ${configured.vision} ainda não está instalado; o papel ficará desativado.`);
  }
  const embedding = canonical(configured.embedding) ?? canonical(alternative?.embedding);
  if (configured.embedding && !canonical(configured.embedding)) {
    notices.push(embedding
      ? `Embedding ${configured.embedding} ainda não está instalado; usando ${embedding}.`
      : `Embedding ${configured.embedding} ainda não está instalado; o papel ficará desativado.`);
  }

  return {
    roles: {
      executor,
      planner: fallbackRole("planner"),
      evaluator: fallbackRole("evaluator"),
      ...(vision ? { vision } : {}),
      ...(embedding ? { embedding } : {})
    },
    ready: true,
    missing,
    notices
  };
}

export function sameModelRoles(left: OllamaRoleConfiguration, right: OllamaRoleConfiguration): boolean {
  return ["executor", "planner", "evaluator", "vision", "embedding"].every((role) =>
    left[role as keyof OllamaRoleConfiguration] === right[role as keyof OllamaRoleConfiguration]
  );
}

function roleLabel(role: "planner" | "evaluator"): string {
  return role === "planner" ? "Planner" : "Evaluator";
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
