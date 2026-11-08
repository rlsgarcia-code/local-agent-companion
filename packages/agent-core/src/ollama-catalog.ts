/**
 * Curated Ollama snapshot for the local companion setup wizard.
 *
 * This is intentionally a small, versioned recommendation list rather than a
 * runtime catalogue. Local availability is still verified with /api/tags and
 * /api/show before a model is selected.
 */
export type OllamaRole = "executor" | "planner" | "vision" | "evaluator" | "embedding";

export type OllamaCatalogEntry = {
  pull: string;
  label: string;
  size: string;
  context: string;
  capabilities: readonly string[];
  roles: readonly OllamaRole[];
  description: string;
};

export const OLLAMA_CATALOG_SNAPSHOT_DATE = "2026-11-03";

export const OLLAMA_CATALOG: readonly OllamaCatalogEntry[] = [
  {
    pull: "qwen2.5-coder:7b",
    label: "Qwen2.5 Coder 7B",
    size: "4.7 GB",
    context: "32K",
    capabilities: ["tools", "coding"],
    roles: ["executor", "planner"],
    description: "Compact tool-capable coding executor for machines that cannot comfortably run the 30B baseline."
  },
  {
    pull: "qwen3-coder:30b",
    label: "Qwen3 Coder 30B",
    size: "19 GB",
    context: "256K",
    capabilities: ["tools", "coding", "long context"],
    roles: ["executor", "planner"],
    description: "Primary local executor for repository work and tool-driven coding tasks."
  },
  {
    pull: "qwen3-vl:8b",
    label: "Qwen3 VL 8B",
    size: "6.2 GB",
    context: "256K",
    capabilities: ["vision", "tools", "OCR"],
    roles: ["vision"],
    description: "Browser screenshots, pasted images and visual/OCR inspection."
  },
  {
    pull: "qwen3-vl:32b",
    label: "Qwen3 VL 32B",
    size: "21 GB",
    context: "256K",
    capabilities: ["vision", "tools", "OCR"],
    roles: ["vision", "planner"],
    description: "Higher-quality visual reasoning when latency and memory allow it."
  },
  {
    pull: "gpt-oss:20b",
    label: "GPT-OSS 20B",
    size: "14 GB",
    context: "128K",
    capabilities: ["tools", "thinking", "structured output"],
    roles: ["planner", "evaluator"],
    description: "Planning and conservative goal-evaluation model."
  },
  {
    pull: "qwen3:30b",
    label: "Qwen3 30B",
    size: "19 GB",
    context: "256K",
    capabilities: ["tools", "thinking", "general"],
    roles: ["planner", "evaluator"],
    description: "General-purpose reasoning alternative."
  },
  {
    pull: "deepseek-r1:32b",
    label: "DeepSeek R1 32B",
    size: "20 GB",
    context: "128K",
    capabilities: ["thinking", "structured output", "long context"],
    roles: ["planner", "evaluator"],
    description: "Reasoning-focused planner and independent evaluator for machines with ample unified memory."
  },
  {
    pull: "deepseek-r1:14b",
    label: "DeepSeek R1 14B",
    size: "9 GB",
    context: "128K",
    capabilities: ["thinking", "structured output"],
    roles: ["planner", "evaluator"],
    description: "Lighter reasoning model for planning and evidence review."
  },
  {
    pull: "deepseek-coder-v2:16b",
    label: "DeepSeek Coder V2 16B",
    size: "8.9 GB",
    context: "160K",
    capabilities: ["coding", "long context"],
    roles: ["planner", "evaluator"],
    description: "Code-oriented analysis model; use as executor only when the installed build verifies tool support."
  },
  {
    pull: "nomic-embed-text:latest",
    label: "Nomic Embed Text",
    size: "0.3 GB",
    context: "8K",
    capabilities: ["embeddings"],
    roles: ["embedding"],
    description: "Local semantic-memory embeddings."
  }
];

export const OLLAMA_RECOMMENDED_SETUP = {
  executor: "qwen3-coder:30b",
  planner: "deepseek-r1:32b",
  vision: "qwen3-vl:8b",
  evaluator: "gpt-oss:20b",
  embedding: "nomic-embed-text:latest"
} as const;

export function ollamaCatalogEntry(model: string): OllamaCatalogEntry | undefined {
  const normalized = model.trim().toLowerCase();
  return OLLAMA_CATALOG.find((entry) => entry.pull.toLowerCase() === normalized);
}
