import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const json = async (file) => JSON.parse(await readFile(file, "utf8"));

test("application adapter contract stays aligned with versions, capabilities and both SDKs", async () => {
  const [contract, versions, contracts, guide, readme, contributing, tsClient, brokerClient, pythonClient, example, sdkBuild] = await Promise.all([
    json("docs/application-adapter-contract.json"),
    json("packages/contracts/src/version.json"),
    readFile("packages/contracts/src/index.ts", "utf8"),
    readFile("docs/APPLICATION_ADAPTERS.md", "utf8"),
    readFile("README.md", "utf8"),
    readFile("CONTRIBUTING.md", "utf8"),
    readFile("packages/client-ts/src/index.ts", "utf8"),
    readFile("packages/client-ts/src/interface-broker.ts", "utf8"),
    readFile("packages/client-python/companion_client/__init__.py", "utf8"),
    readFile("examples/application-adapter/adapter.mjs", "utf8"),
    readFile("scripts/build-sdks.mjs", "utf8"),
  ]);

  assert.equal(contract.engine, versions.engine);
  assert.equal(contract.protocol, versions.protocol);
  assert.equal(contract.sdkArtifact, `companion-sdks-${versions.engine}.tar.gz`);
  assert.match(contracts, /"companion-app"/);
  assert.equal(contract.applicationProduct, "companion-app");

  const sourceCapabilities = contracts.match(/export const engineCapabilities = \[([\s\S]*?)\] as const;/)?.[1]
    ?.match(/"([^"]+)"/g)?.map((value) => value.slice(1, -1));
  assert.deepEqual(contract.requiredEngineCapabilities, sourceCapabilities);
  for (const capability of contract.requiredEngineCapabilities) {
    assert.match(guide, new RegExp("`" + capability + "`"));
    assert.match(example, new RegExp(`"${capability}"`));
  }
  for (const method of contract.requiredTypeScriptMethods)
    assert.match(tsClient, new RegExp(`\\b${method}\\s*\\(`), `TypeScript SDK must expose ${method}`);
  for (const method of contract.requiredBrokerMethods)
    assert.match(brokerClient, new RegExp(`\\b${method}\\s*\\(`), `Interface broker SDK must expose ${method}`);
  for (const method of contract.requiredPythonMethods)
    assert.match(pythonClient, new RegExp(`\\bdef ${method}\\s*\\(`), `Python SDK must expose ${method}`);

  assert.match(readme, /docs\/APPLICATION_ADAPTERS\.md/);
  assert.match(contributing, /APPLICATION_ADAPTERS\.md/);
  assert.match(sdkBuild, /application-adapter-contract\.json/);
  assert.match(sdkBuild, /examples\/application-adapter/);
  assert.match(guide, /não copi[ae] o runtime/i);
  assert.match(guide, /feature gating/i);
});
