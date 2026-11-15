import { z } from "zod";
import { AgentError, errors } from "../../contracts/src/index";
import { contentHash } from "../../contracts/src/identity";
import { modelConfiguration, webResearchConfiguration, type ModelConfiguration } from "../../contracts/src/models";
import { modelContextWindows } from "../../contracts/src/model-context";
import type { Store } from "./store";

// Keep the base row readable by installed 1.0.6/1.0.7 engines. New features
// remain in the same private database, bound to the product namespace and
// exact provider/account reference. These are references, never credentials.
const featuresSchema = z.object({
  webResearch: webResearchConfiguration.optional(), contextWindows: modelContextWindows.optional(),
}).strict();
type Features = z.infer<typeof featuresSchema>;
const providerKey = (value: ModelConfiguration) => contentHash({
  provider: value.provider, endpoint: value.endpoint, credentialRef: value.credentialRef ?? null,
});
const base = ({ webResearch: _research, contextWindows: _windows, ...value }: ModelConfiguration) => value;
const ownFeatures = (value: Record<string, unknown>): Features => featuresSchema.parse({
  ...(Object.hasOwn(value, "webResearch") && value.webResearch !== undefined ? { webResearch: value.webResearch } : {}),
  ...(Object.hasOwn(value, "contextWindows") && value.contextWindows !== undefined ? { contextWindows: value.contextWindows } : {}),
});

export class ModelConfigurationStore {
  constructor(private readonly store: Store) {
    store.db.exec(`
      CREATE TABLE IF NOT EXISTS model_configurations(namespace TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS model_configuration_features(
        namespace TEXT NOT NULL,provider_key TEXT NOT NULL,value TEXT NOT NULL,PRIMARY KEY(namespace,provider_key));
      CREATE TABLE IF NOT EXISTS model_configuration_migrations(
        namespace TEXT NOT NULL,source_hash TEXT NOT NULL,source_value TEXT NOT NULL,
        projected_hash TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(namespace,source_hash));
    `);
  }
  private features(namespace: string, key: string): Features {
    const row = this.store.db.prepare("SELECT value FROM model_configuration_features WHERE namespace=? AND provider_key=?")
      .get(namespace, key) as { value: string } | undefined;
    return row ? featuresSchema.parse(JSON.parse(row.value)) : {};
  }
  private saveFeatures(namespace: string, key: string, value: Features): void {
    this.store.db.prepare(`INSERT INTO model_configuration_features VALUES(?,?,?)
      ON CONFLICT(namespace,provider_key) DO UPDATE SET value=excluded.value`)
      .run(namespace, key, JSON.stringify(featuresSchema.parse(value)));
  }
  private read(namespace: string): ModelConfiguration | null {
    const row = this.store.db.prepare("SELECT value FROM model_configurations WHERE namespace=?")
      .get(namespace) as { value: string } | undefined;
    if (!row) return null;
    const raw = JSON.parse(row.value) as Record<string, unknown>;
    // Validate the entire original before writing anything. Unknown fields and
    // corrupt settings are preserved and diagnosed, never stripped to migrate.
    const parsed = modelConfiguration.parse(raw), key = providerKey(parsed);
    const features = { ...this.features(namespace, key), ...ownFeatures(raw) };
    const merged = modelConfiguration.parse({ ...base(parsed), ...features });
    if (Object.hasOwn(raw, "webResearch") || Object.hasOwn(raw, "contextWindows")) {
      const projected = JSON.stringify(base(parsed));
      this.store.db.prepare(`INSERT OR IGNORE INTO model_configuration_migrations VALUES(?,?,?,?,?)`)
        .run(namespace, contentHash(row.value), row.value, contentHash(projected), Date.now());
      this.saveFeatures(namespace, key, features);
      this.store.db.prepare("UPDATE model_configurations SET value=? WHERE namespace=?").run(projected, namespace);
    }
    return merged;
  }
  get(namespace: string): ModelConfiguration | null {
    return this.store.db.transaction(() => this.read(namespace))();
  }
  set(namespace: string, value: ModelConfiguration, input: Record<string, unknown>): ModelConfiguration {
    return this.store.db.transaction(() => {
      const previous = this.read(namespace);
      if (value.revision !== (previous?.revision ?? 0))
        throw new AgentError(errors.conflict, "Refresh model settings before changing them.");
      // An older client may omit features. Preserve this account's choices,
      // but never inherit another provider/account's network permissions.
      const saved = previous ? this.features(namespace, providerKey(value)) : {};
      const features = { ...saved, ...ownFeatures(input) };
      const next = modelConfiguration.parse({ ...base(value), ...features, revision: value.revision + 1 });
      this.saveFeatures(namespace, providerKey(next), ownFeatures(next));
      this.store.db.prepare(`INSERT INTO model_configurations VALUES(?,?)
        ON CONFLICT(namespace) DO UPDATE SET value=excluded.value`).run(namespace, JSON.stringify(base(next)));
      return next;
    })();
  }
}
