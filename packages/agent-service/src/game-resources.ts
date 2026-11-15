import { availableParallelism, totalmem } from "node:os";
import { gameProductionBudget, gameProductionResources, type GameProductionBudget, type GameProductionResources } from "../../contracts/src/game-production";

type Waiter = { id: string; resources: GameProductionResources; signal: AbortSignal; resolve: () => void; reject: (error: unknown) => void; abort: () => void };

/** One admission queue per service/user. Does not execute tools or enforce OS limits. */
export class GameResources {
  readonly budget: GameProductionBudget;
  private readonly active = new Map<string, GameProductionResources>();
  private readonly waiting: Waiter[] = [];
  constructor(budget?: GameProductionBudget) {
    this.budget = gameProductionBudget.parse(budget ?? {
      memoryMiB: Math.min(8192, Math.max(1, Math.floor(totalmem() / (2 * 1024 * 1024)))),
      cpuSlots: Math.min(4, Math.max(1, availableParallelism() - 1)),
      maxConcurrent: 2, maxQueued: 128,
    });
  }
  requirements(resources?: GameProductionResources): GameProductionResources {
    return gameProductionResources.parse(resources ?? {
      memoryMiB: this.budget.memoryMiB, cpuSlots: this.budget.cpuSlots, exclusiveGroups: ["legacy-production"],
    });
  }
  unavailable(resources: GameProductionResources): string | undefined {
    return resources.memoryMiB > this.budget.memoryMiB || resources.cpuSlots > this.budget.cpuSlots
      ? "The installed production tool requires more scheduling resources than this service budget permits. Administrative configuration is required; no alternate toolchain is selected."
      : undefined;
  }
  /** Recovery may exceed a reduced budget. Unknown resources must never be forgotten. */
  hold(id: string, resources?: GameProductionResources): void {
    if (this.active.has(id)) return;
    this.active.set(id, this.requirements(resources));
  }
  acquire(id: string, resources: GameProductionResources, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    const request = this.requirements(resources), unavailable = this.unavailable(request);
    if (unavailable) return Promise.reject(new Error(unavailable));
    if (this.active.has(id) || this.waiting.some((item) => item.id === id)) return Promise.reject(new Error("Duplicate resource reservation."));
    return new Promise<void>((resolve, reject) => {
      const waiter: Waiter = { id, resources: request, signal, resolve, reject, abort: () => {
        const index = this.waiting.indexOf(waiter);
        if (index < 0) return;
        this.waiting.splice(index, 1); signal.removeEventListener("abort", waiter.abort);
        reject(signal.reason); this.drain();
      } };
      this.waiting.push(waiter); signal.addEventListener("abort", waiter.abort, { once: true });
      if (signal.aborted) waiter.abort();
      else this.drain();
    });
  }
  release(id: string): void { this.active.delete(id); this.drain(); }
  private drain(): void {
    // FIFO intentionally prevents small new jobs starving an older editor build.
    while (this.waiting.length && this.active.size < this.budget.maxConcurrent) {
      const next = this.waiting[0]!;
      let memory = next.resources.memoryMiB, cpu = next.resources.cpuSlots;
      const groups = new Set<string>();
      for (const held of this.active.values()) { memory += held.memoryMiB; cpu += held.cpuSlots; held.exclusiveGroups.forEach((group) => groups.add(group)); }
      if (memory > this.budget.memoryMiB || cpu > this.budget.cpuSlots || next.resources.exclusiveGroups.some((group) => groups.has(group))) break;
      this.waiting.shift(); next.signal.removeEventListener("abort", next.abort);
      this.active.set(next.id, next.resources); next.resolve();
    }
  }
}
