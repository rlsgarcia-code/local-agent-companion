import type { OllamaRoleConfiguration } from "../src/ollama-recommendation";

export type HostedModelProfile = "quality" | "balanced" | "speed";

const EMBEDDING_MODEL = /embedding/i;

/**
 * The signed 1.0.6 engine intentionally exposes the direct OpenAI provider
 * through Chat Completions only.  GET /v1/models also returns Responses-only
 * aliases (Codex and the newer reasoning families), so catalog membership by
 * itself is not enough to make a model safe for the current runtime.
 */
export function isDirectOpenAiChatModel(model: string): boolean {
  const normalized = model.trim().toLowerCase();
  return /^(?:gpt-4\.1(?:-(?:mini|nano))?|gpt-4o(?:-mini)?|gpt-4-turbo|gpt-4(?:-32k)?|gpt-3\.5-turbo)(?:-|$)/.test(normalized)
    && !/(?:audio|realtime|transcribe|tts|search|image)/.test(normalized);
}

export function directOpenAiDesktopCatalog(models: readonly string[]): string[] {
  return models.filter((model) => isDirectOpenAiChatModel(model) || EMBEDDING_MODEL.test(model));
}

export function recommendHostedRoles(
  models: readonly string[],
  profile: HostedModelProfile,
  current: OllamaRoleConfiguration
): OllamaRoleConfiguration {
  const chat = models.filter(isDirectOpenAiChatModel);
  const embeddings = models.filter((model) => EMBEDDING_MODEL.test(model));
  const embedding = [...embeddings].sort((left, right) => {
    const score = (model: string) => /text-embedding-3-large/i.test(model) ? (profile === "speed" ? 1 : 3)
      : /text-embedding-3-small/i.test(model) ? (profile === "speed" ? 3 : 2) : 0;
    return score(right) - score(left) || right.localeCompare(left);
  })[0];
  const score = (model: string, role: "executor" | "planner" | "evaluator" | "vision"): number => {
    let value = 0;
    if (/gpt/i.test(model)) value += 10;
    if (/gpt-4\.1/i.test(model)) value += role === "executor" || role === "planner" || role === "evaluator" ? 12 : 5;
    if (/gpt-4o/i.test(model)) value += role === "vision" ? 18 : 5;
    if (/preview|latest/i.test(model)) value += 2;
    if (/mini/i.test(model)) value += profile === "balanced" ? 9 : profile === "speed" ? 14 : -4;
    if (/nano/i.test(model)) value += profile === "speed" ? 18 : profile === "balanced" ? 2 : -10;
    if (profile === "quality" && !/(mini|nano)/i.test(model)) value += 12;
    return value;
  };
  const choose = (role: "executor" | "planner" | "evaluator" | "vision") => [...chat]
    .sort((left, right) => score(right, role) - score(left, role) || right.localeCompare(left))[0];
  const executor = choose("executor") ?? current.executor;
  return {
    executor,
    ...(choose("planner") ? { planner: choose("planner") } : current.planner ? { planner: current.planner } : {}),
    ...(choose("evaluator") ? { evaluator: choose("evaluator") } : current.evaluator ? { evaluator: current.evaluator } : {}),
    ...(choose("vision") ? { vision: choose("vision") } : current.vision ? { vision: current.vision } : {}),
    ...(embedding ? { embedding } : current.embedding ? { embedding: current.embedding } : {})
  };
}

export function reconcileHostedRoles(
  models: readonly string[],
  profile: HostedModelProfile,
  requested: OllamaRoleConfiguration
): OllamaRoleConfiguration {
  const canonical = new Map(models.map((model) => [model.toLowerCase(), model]));
  const recommended = recommendHostedRoles(models, profile, requested);
  const chatModel = (model: string | undefined): string | undefined => {
    if (!model) return undefined;
    const match = canonical.get(model.toLowerCase());
    return match && isDirectOpenAiChatModel(match) ? match : undefined;
  };
  const embeddingModel = (model: string | undefined): string | undefined => {
    if (!model) return undefined;
    const match = canonical.get(model.toLowerCase());
    return match && EMBEDDING_MODEL.test(match) ? match : undefined;
  };
  const executor = chatModel(requested.executor) ?? recommended.executor;
  if (!executor || !canonical.has(executor.toLowerCase())) {
    throw new Error("O catálogo da OpenAI não contém um modelo compatível com Chat Completions e function calling.");
  }
  const planner = chatModel(requested.planner) ?? recommended.planner ?? executor;
  const evaluator = chatModel(requested.evaluator) ?? recommended.evaluator ?? executor;
  const vision = chatModel(requested.vision) ?? recommended.vision ?? executor;
  const embedding = embeddingModel(requested.embedding) ?? recommended.embedding;
  return {
    executor,
    ...(planner ? { planner } : {}),
    ...(evaluator ? { evaluator } : {}),
    ...(vision ? { vision } : {}),
    ...(embedding ? { embedding } : {})
  };
}
