import assert from "node:assert/strict";
import test from "node:test";
import { Models } from "../packages/agent-service/src/models";
import { Store } from "../packages/agent-service/src/store";
import { namespace } from "../packages/agent-service/src/security";
import type { Registration } from "../packages/contracts/src/index";
import { modelConfiguration } from "../packages/contracts/src/models";

const reg: Registration = { id: "rollback", product: "companion-mac", profile: "fixture", workspace: "",
  providers: ["ollama", "openai"], hostTools: [] };
// The actual old binary/schema is also exercised by the isolated binary runner.
const legacySchema = modelConfiguration.omit({ webResearch: true, contextWindows: true });
const configuration = () => modelConfiguration.parse({ revision: 8, roles: { executor: "fixture" },
  webResearch: { enabled: true, allowedDomains: ["example.org"] }, contextWindows: { fixture: 8192 } });
function fixture() {
  const store = new Store(":memory:"), models = new Models(store, ".");
  const raw = () => (store.db.prepare("SELECT value FROM model_configurations WHERE namespace=?")
    .get(namespace(reg)) as { value: string } | undefined)?.value;
  const count = (table: string) => (store.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
  const seed = (value: string) => store.db.prepare("INSERT INTO model_configurations VALUES(?,?)").run(namespace(reg), value);
  return { store, models, raw, count, seed, async close() { await models.close(); store.close(); } };
}

test("rollback migration preserves the exact original and separates new settings without changing revision", async () => {
  const f = fixture(), original = JSON.stringify(configuration(), null, 2);
  try {
    f.seed(original);
    assert.deepEqual(f.models.configuration(reg), configuration());
    const projected = legacySchema.parse(JSON.parse(f.raw()!));
    assert.equal(projected.revision, 8);
    const receipt = f.store.db.prepare("SELECT source_value FROM model_configuration_migrations").get() as { source_value: string };
    assert.equal(receipt.source_value, original);
    assert.equal(f.count("model_configuration_features"), 1);
    assert.deepEqual(f.models.configuration(reg), configuration());
    assert.equal(f.count("model_configuration_migrations"), 1);
  } finally { await f.close(); }
});

test("old configuration edits remain readable and preserve new account settings on reactivation", async () => {
  const f = fixture();
  try {
    const first = f.models.configure(reg, { ...configuration(), revision: 0 });
    const legacy = legacySchema.parse(JSON.parse(f.raw()!));
    // Emulate a write by the previous engine, which only knows this strict row.
    legacy.roles.executor = "changed-by-old-engine";
    legacy.revision++;
    f.store.db.prepare("UPDATE model_configurations SET value=? WHERE namespace=?").run(JSON.stringify(legacy), namespace(reg));
    const restored = f.models.configuration(reg)!;
    assert.equal(restored.revision, first.revision + 1);
    assert.equal(restored.roles.executor, "changed-by-old-engine");
    assert.deepEqual(restored.contextWindows, first.contextWindows);
    assert.deepEqual(restored.webResearch, first.webResearch);
    const updated = f.models.configure(reg, { ...legacy, optimizationProfile: "quality" });
    assert.deepEqual(updated.webResearch, first.webResearch);
    assert.deepEqual(updated.contextWindows, first.contextWindows);
    const cleared = f.models.configure(reg, { ...updated, contextWindows: {}, webResearch: { enabled: false } });
    assert.deepEqual(cleared.contextWindows, {});
    assert.equal(cleared.webResearch.enabled, false);
    assert.doesNotThrow(() => legacySchema.parse(JSON.parse(f.raw()!)));
  } finally { await f.close(); }
});

test("feature choices are isolated by namespace, provider endpoint and account reference", async () => {
  const f = fixture();
  try {
    const first = f.models.configure(reg, { ...configuration(), revision: 0 });
    const { webResearch: _research, contextWindows: _windows, ...base } = first;
    const hosted = f.models.configure(reg, { ...base, provider: "openai", endpoint: "https://api.openai.com/v1", credentialRef: "first-account" });
    assert.equal(hosted.webResearch.enabled, false);
    assert.equal(hosted.contextWindows, undefined);
    const chosen = f.models.configure(reg, { ...hosted, webResearch: first.webResearch, contextWindows: first.contextWindows });
    const { webResearch: _r, contextWindows: _w, ...hostedBase } = chosen;
    const anotherAccount = f.models.configure(reg, { ...hostedBase, credentialRef: "second-account" });
    assert.equal(anotherAccount.webResearch.enabled, false);
    assert.equal(anotherAccount.contextWindows, undefined);
    const returned = f.models.configure(reg, { ...base, revision: anotherAccount.revision });
    assert.deepEqual(returned.webResearch, first.webResearch);
    assert.deepEqual(returned.contextWindows, first.contextWindows);
    const anotherEndpoint = f.models.configure(reg, { ...base, revision: returned.revision, endpoint: "http://localhost:11434/v1" });
    assert.equal(anotherEndpoint.webResearch.enabled, false);
    assert.equal(anotherEndpoint.contextWindows, undefined);
    for (const other of [{ ...reg, product: "companion-vscode" as const }, { ...reg, profile: "other" }, { ...reg, workspace: "/other" }]) {
      assert.equal(f.models.configuration(other), null);
      const isolated = f.models.configure(other, { revision: 0, roles: { executor: "fixture" } });
      assert.equal(isolated.webResearch.enabled, false);
      assert.equal(isolated.contextWindows, undefined);
    }
  } finally { await f.close(); }
});

test("unknown or invalid original settings are not projected, mutated or archived", async () => {
  for (const value of [{ ...configuration(), futureSetting: true }, { ...configuration(), contextWindows: { fixture: -1 } }]) {
    const f = fixture(), raw = JSON.stringify(value);
    try {
      f.seed(raw);
      assert.throws(() => f.models.configuration(reg));
      assert.equal(f.raw(), raw);
      assert.equal(f.count("model_configuration_features"), 0);
      assert.equal(f.count("model_configuration_migrations"), 0);
    } finally { await f.close(); }
  }
});

test("stale writes and storage failures roll back the entire lazy migration", async () => {
  const f = fixture(), raw = JSON.stringify(configuration());
  try {
    f.seed(raw);
    assert.throws(() => f.models.configure(reg, { revision: 0, roles: { executor: "stale" } }), /Refresh/);
    assert.equal(f.raw(), raw);
    assert.equal(f.count("model_configuration_migrations"), 0);
    f.store.db.exec(`CREATE TRIGGER fail_feature_write BEFORE INSERT ON model_configuration_features
      BEGIN SELECT RAISE(ABORT,'fixture disk failure'); END;`);
    assert.throws(() => f.models.configuration(reg), /fixture disk failure/);
    assert.equal(f.raw(), raw);
    assert.equal(f.count("model_configuration_migrations"), 0);
    assert.equal(f.count("model_configuration_features"), 0);
  } finally { await f.close(); }
});

test("KidOS cannot trigger model migration and missing base rows cannot revive orphan settings", async () => {
  const f = fixture();
  try {
    f.seed(JSON.stringify(configuration()));
    const child = { ...reg, product: "kidos" as const };
    assert.throws(() => f.models.configuration(child), /system authority/);
    assert.throws(() => f.models.configure(child, configuration()), /system authority/);
    assert.equal(f.count("model_configuration_migrations"), 0);
    f.models.configuration(reg);
    f.store.db.prepare("DELETE FROM model_configurations WHERE namespace=?").run(namespace(reg));
    assert.equal(f.models.configuration(reg), null);
    const fresh = f.models.configure(reg, { revision: 0, roles: { executor: "fixture" } });
    assert.equal(fresh.webResearch.enabled, false);
    assert.equal(fresh.contextWindows, undefined);
  } finally { await f.close(); }
});
