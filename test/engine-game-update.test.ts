import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { AgentService } from "../packages/agent-service/src/service";
import { Store } from "../packages/agent-service/src/store";
import type { EngineUpdateStatus, Registration } from "../packages/contracts/src/index";

const registration: Registration = { id: "update-fixture", product: "companion-mac", profile: "test", workspace: "", providers: ["ollama"], hostTools: [] };

for (const operation of ["game", "reconciliation"] as const) {
  test(`engine activation preserves active ${operation} work independently of a conversation`, async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "game-update-"));
    const service = new AgentService(new Store(path.join(directory, "metadata.sqlite")), directory);
    const internals = service as unknown as {
      gameProduction: object;
      toolInspections: Map<string, { controller: AbortController; promise: Promise<unknown> }>;
    };
    let busy = operation === "game";
    Object.defineProperty(internals.gameProduction, "busy", { configurable: true, get: () => busy });
    if (operation === "reconciliation") internals.toolInspections.set("unknown-effect", { controller: new AbortController(), promise: Promise.resolve({}) });
    const call = (method: string) => service.dispatch(registration, method, {}, "fixture");
    try {
      const status = await call("engine.updateStatus") as EngineUpdateStatus;
      assert.equal(status.ready, false);
      assert.equal(status.blockers.activeRuns, 0);
      assert.equal(operation === "game" ? status.blockers.gameOperations : status.blockers.toolInspections, 1);
      for (const method of ["engine.stopManagedResourcesForUpdate", "engine.quiesceIfIdle", "engine.shutdownIfIdle"]) {
        assert.equal((await call(method) as { accepted: boolean }).accepted, false, method);
        assert.equal((await call("engine.updateStatus") as EngineUpdateStatus).quiescing, false);
      }
      busy = false;
      internals.toolInspections.clear();
      assert.equal((await call("engine.updateStatus") as EngineUpdateStatus).ready, true);
      assert.equal((await call("engine.quiesceIfIdle") as { accepted: boolean }).accepted, true);
    } finally {
      busy = false; internals.toolInspections.clear();
      await service.close(); await rm(directory, { recursive: true, force: true });
    }
  });
}
