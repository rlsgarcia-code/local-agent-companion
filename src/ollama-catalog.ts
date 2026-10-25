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

export const OLLAMA_CATALOG_SNAPSHOT_DATE = "2026-10-25";

export const OLLAMA_CATALOG: readonly OllamaCatalogEntry[] = [
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
  planner: "gpt-oss:20b",
  vision: "qwen3-vl:8b",
  evaluator: "gpt-oss:20b",
  embedding: "nomic-embed-text:latest"
} as const;

export function ollamaCatalogEntry(model: string): OllamaCatalogEntry | undefined {
  const normalized = model.trim().toLowerCase();
  return OLLAMA_CATALOG.find((entry) => entry.pull.toLowerCase() === normalized);
}
