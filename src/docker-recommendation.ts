export type DockerImageCandidate = {
  alias: string;
  architectures: string[];
  purpose: string;
};

export type DockerExecutionRecommendation = {
  image: string;
  installed: boolean;
  rationale: string;
  pullCommand: string;
  proxyImage: string;
  proxyInstalled: boolean;
  proxyPullCommand: string;
  memoryLimitGb: number;
  cpuLimit: number;
};

export const DOCKER_SANDBOX_PROXY_IMAGE = "alpine/socat:1.8.0.3";

export function dockerResourceLimits(totalMemoryGb: number, cpuCount: number): { memoryLimitGb: number; cpuLimit: number } {
  return {
    memoryLimitGb: Math.max(2, Math.min(8, Math.floor(totalMemoryGb / 2))),
    cpuLimit: Math.max(1, Math.min(4, cpuCount - 1 || 1))
  };
}

export function dockerImageRecommendationCandidates(architecture: string): DockerImageCandidate[] {
  if (architecture !== "arm64" && architecture !== "x64") return [];
  return [
    { alias: "node:22-bookworm-slim", architectures: ["arm64", "x64"], purpose: "Aplicações web JavaScript/TypeScript com preview local." },
    { alias: "python:3.13-slim", architectures: ["arm64", "x64"], purpose: "Aplicações Python e servidores HTTP locais." }
  ];
}
