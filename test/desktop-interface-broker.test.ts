import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { startInterfaceBroker } from "../desktop/interface-broker";

test("the interface broker shares settings and leases without exposing credentials", async () => {
  const descriptorPath = path.join(tmpdir(), `companion-interface-broker-${process.pid}.json`);
  let leased = 0;
  let delegatedTarget = "";
  let settings = {
    provider: "ollama" as const,
    selectionMode: "optimized" as const,
    optimizationProfile: "balanced" as const,
    assignments: { executor: "qwen3.5:latest" },
    hasApiKey: true,
  };
  const broker = await startInterfaceBroker({
    descriptorPath,
    configuration: async () => settings,
    configure: async (input) => {
      settings = { ...settings, ...input } as typeof settings;
      return settings;
    },
    leaseOpenAi: async (targetClientId) => { leased += 1; delegatedTarget = targetClientId ?? ""; },
    openSettings: () => undefined,
  });
  try {
    const descriptor = JSON.parse(await readFile(descriptorPath, "utf8")) as { baseUrl: string; token: string };
    const headers = { authorization: `Bearer ${descriptor.token}`, "content-type": "application/json" };
    const configuration = await fetch(`${descriptor.baseUrl}/v1/model-configuration`, { headers });
    assert.equal(configuration.status, 200);
    assert.equal((await configuration.json() as { provider: string }).provider, "ollama");
    const lease = await fetch(`${descriptor.baseUrl}/v1/credentials/openai/lease`, {
      method: "POST", headers, body: JSON.stringify({ targetClientId: "medgraph-interface" }),
    });
    assert.equal(lease.status, 202);
    assert.equal(leased, 1);
    assert.equal(delegatedTarget, "medgraph-interface");
    assert.equal(JSON.stringify(await lease.json()).includes("key"), false);
    const denied = await fetch(`${descriptor.baseUrl}/v1/model-configuration`);
    assert.equal(denied.status, 401);
  } finally {
    await broker.close();
    await rm(descriptorPath, { force: true });
  }
});
