export type OllamaRole = "executor" | "planner" | "vision" | "evaluator" | "embedding";

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

export type OllamaRecommendationPlan = OllamaRecommendationOption & {
  schemaVersion: 2;
  source: "baseline" | "advisor";
  advisorModel?: string;
  machineSummary: string;
  installedAlternative?: OllamaRecommendationOption;
  consideredCandidates?: Partial<Record<OllamaRole, string[]>>;
  docker: DockerExecutionRecommendation;
  warnings: string[];
};

