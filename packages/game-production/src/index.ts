import type { Registration } from "../../contracts/src/index";
import type { GameDocument, GameFile } from "../../contracts/src/games";
import type { GameArtifact, GameObservation, GameProductionJob, GameProductionResources, gameToolchain } from "../../contracts/src/game-production";
import type { z } from "zod";
import type { GameAssetSpec, GameAssetOperation } from "../../contracts/src/game-assets";
import type { GameLibraryQuery,GameLibraryPage } from "../../contracts/src/game-library";

/** Process-owner ports. No RPC registration, model loop or permission delegation. */
export type ProducedGameFile = { path: string; mime: string; data: Uint8Array };
export type ProducedGameArtifact = { entrypoint: string; files: ProducedGameFile[] };
export type CollectedGameObservation = GameObservation & { evidenceFiles?: ProducedGameFile[] };
export type GameRecovery<T> = { state: "running" } | { state: "missing"; detail: string } | { state: "completed"; result: T };
/** An installed adapter may acknowledge that its failed operation has no unknown effect. */
export class GameProductionFailure extends Error {
  readonly outcome = "known-failure";
}
/** Cancellation cannot acknowledge termination when an external resource may survive. */
export class GameProductionUncertain extends Error {
  readonly outcome = "unknown";
}
export type ProductionAccess = {
  registration: Registration;
  job: GameProductionJob;
  document: GameDocument;
  signal: AbortSignal;
  readFile: (path: string) => Promise<Uint8Array>;
};
export type GameProductionAdapter = {
  id: string;
  engine: GameProductionJob["engine"];
  products: readonly Registration["product"][];
  authority: "workspace" | "kidos-core";
  toolchain: z.infer<typeof gameToolchain>;
  /** Service-owned scheduling estimate; absence reserves the entire budget. */
  resources?: GameProductionResources;
  /** Installed adapter guidance; not client-provided authority or a shell command. */
  projectGuide?: string;
  probe(registration: Registration): Promise<{ available: boolean; reason?: string }>;
  /** Installed authority hooks, persisted by the service before resource waiting. */
  admission?: {
    /** GameProductionFailure acknowledges refusal without an unknown reservation. */
    reserve(context: ProductionAccess): Promise<void>;
    /** Must fence the original request, including a lost reservation acknowledgement. */
    cancel(context: ProductionAccess): Promise<void>;
  };
  build(context: ProductionAccess): Promise<ProducedGameArtifact>;
  /** Explicit inspection after interruption; never re-execute an uncertain operation. */
  reconcile?(context: ProductionAccess): Promise<GameRecovery<ProducedGameArtifact>>;
  /** Drop disposable candidates only after the service commits a terminal result. */
  dispose?(context: ProductionAccess): Promise<void>;
};
export type GameValidationAccess = ProductionAccess & { artifact: GameArtifact };

export type GameValidationCollector = {
  id: string;
  /** Installed declaration, never RPC/model input. Enables static recipe preflight, not execution or authority. */
  testSuiteFormat?: "browser-v1";
  /** Installed format guidance only; never availability, admission or quality. */
  projectGuide?: string;
  engines: readonly GameProductionJob["engine"][];
  products: readonly Registration["product"][];
  authority: "workspace" | "kidos-core";
  toolchain: z.infer<typeof gameToolchain>;
  resources?: GameProductionResources;
  categories: readonly GameObservation["category"][];
  /** Reserve the exact build/test request before waiting for shared resources. */
  admission?: {
    reserve(context: GameValidationAccess): Promise<void>;
    cancel(context: GameValidationAccess): Promise<void>;
  };
  probe?(registration: Registration): Promise<{ available: boolean; reason?: string }>;
  validate(context: Omit<ProductionAccess, "readFile"> & {
    artifact: GameArtifact;
    readFile: (path: string) => Promise<Uint8Array>;
  }): Promise<CollectedGameObservation[]>;
  reconcile?(context: Omit<ProductionAccess, "readFile"> & {
    artifact: GameArtifact; readFile: (path: string) => Promise<Uint8Array>;
  }): Promise<GameRecovery<CollectedGameObservation[]>>;
  /** Clean private candidates only after the service commits a terminal job. */
  dispose?(context: Omit<ProductionAccess, "readFile"> & {
    artifact: GameArtifact; readFile: (path: string) => Promise<Uint8Array>;
  }): Promise<void>;
};
export type GameBlobAccess = {
  read(registration: Registration, file: GameFile): Uint8Array;
  store(registration: Registration, files: readonly ProducedGameFile[]): GameFile[];
};
export type ProcessedGameAsset = { files: ProducedGameFile[]; info: Record<string, string | number | boolean> };
export type GameAssetProcessor = {
  id: string; products: readonly Registration["product"][]; authority: "workspace" | "kidos-core";
  operations: readonly GameAssetOperation["type"][]; toolchain: z.infer<typeof gameToolchain>;
  resources?: GameProductionResources;
  projectGuide?: string;
  libraries?(query:GameLibraryQuery):Promise<GameLibraryPage>;
  admission?: GameProductionAdapter["admission"];
  probe(registration: Registration): Promise<{ available: boolean; reason?: string }>;
  process(context: ProductionAccess & { spec: GameAssetSpec }): Promise<ProcessedGameAsset>;
  reconcile?(context: ProductionAccess & { spec: GameAssetSpec }): Promise<GameRecovery<ProcessedGameAsset>>;
  dispose?(context: ProductionAccess & { spec: GameAssetSpec }): Promise<void>;
};
