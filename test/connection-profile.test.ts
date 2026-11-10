import assert from "node:assert/strict";
import test from "node:test";
import {
  CONNECTION_PROFILE_KIND,
  createConnectionProfile,
  parseConnectionProfile,
  serializeConnectionProfile
} from "../src/connection-profile";

function validProfile() {
  return createConnectionProfile({
    gateway: {
      endpoint: "https://gateway.example.com/v1/",
      modelsEndpoint: "https://gateway.example.com/models/",
      authHeader: "api-key",
      requiresKey: true,
      requiresCorporateCa: true
    },
    models: {
      chat: "company-model",
      embedding: "company-embedding",
      semanticMemoryEnabled: true,
      profiles: {
        "company-model": { preset: "custom", reasoningEffort: "medium" }
      }
    },
    workspace: { runtime: "deep", autonomyMode: "review" }
  }, new Date("2026-10-15T12:00:00.000Z"));
}

test("creates a normalized versioned connection profile without credentials", () => {
  const profile = validProfile();
  assert.equal(profile.kind, CONNECTION_PROFILE_KIND);
  assert.equal(profile.version, 1);
  assert.equal(profile.gateway.endpoint, "https://gateway.example.com/v1");
  assert.equal(profile.gateway.modelsEndpoint, "https://gateway.example.com/models");
  const serialized = serializeConnectionProfile(profile);
  assert.doesNotMatch(serialized, /apiKey|password|certificate|pem/i);
  assert.deepEqual(parseConnectionProfile(JSON.parse(serialized)), profile);
});

test("rejects credentials and unknown fields anywhere in an imported profile", () => {
  const profile = validProfile() as unknown as Record<string, unknown>;
  assert.throws(
    () => parseConnectionProfile({ ...profile, apiKey: "secret" }),
    /must not contain secrets/
  );
  assert.throws(
    () => parseConnectionProfile({ ...profile, unexpected: true }),
    /Unsupported profile field/
  );
});

test("rejects incompatible versions, unsafe URLs, and invalid model parameters", () => {
  const profile = validProfile();
  assert.throws(() => parseConnectionProfile({ ...profile, version: 2 }), /Unsupported/);
  assert.throws(
    () => parseConnectionProfile({ ...profile, gateway: { ...profile.gateway, endpoint: "http://gateway.example.com" } }),
    /must use HTTPS/
  );
  assert.throws(
    () => parseConnectionProfile({
      ...profile,
      models: {
        ...profile.models,
        profiles: { "company-model": { preset: "custom", temperature: 0.2, topP: 0.9 } }
      }
    }),
    /must not configure both/
  );
});

test("requires the key to remain a separate Secret Storage concern", () => {
  const profile = validProfile();
  assert.throws(
    () => parseConnectionProfile({ ...profile, gateway: { ...profile.gateway, requiresKey: false } }),
    /separate Secret Storage key/
  );
});

test("bounds aliases and the number of imported model profiles", () => {
  const profile = validProfile();
  assert.throws(
    () => parseConnectionProfile({ ...profile, models: { ...profile.models, chat: "m".repeat(257) } }),
    /Maximum length is 256/
  );
  const profiles = Object.fromEntries(Array.from({ length: 501 }, (_, index) => [`model-${index}`, {}]));
  assert.throws(
    () => parseConnectionProfile({ ...profile, models: { ...profile.models, profiles } }),
    /too many model profiles/
  );
});


test("legacy auto profiles keep Chat Completions and roundtrip without catalog metadata", () => {
  const value = validProfile();
  value.models.profiles["company-model"] = { preset: "custom", api: "auto" };
  assert.deepEqual(parseConnectionProfile(JSON.parse(serializeConnectionProfile(value))).models.profiles["company-model"], { preset: "custom", api: "auto" });
});
