import assert from "node:assert/strict";
import test from "node:test";
import { CredentialVault } from "../packages/agent-service/src/credentials";
import type { Registration } from "../packages/contracts/src/index";

const reg: Registration = { id: "client-a", product: "companion-vscode", profile: "default", workspace: "/fixture", providers: ["litellm"], hostTools: [] };

test("credential rotation keeps active secrets redacted and never discards a newer grant", () => {
  const vault = new CredentialVault();
  try {
    vault.grant(reg, "provider", "old-fixture");
    assert.equal(vault.acquire(reg, "provider", "old-run"), "old-fixture");
    vault.grant(reg, "provider", "new-fixture");
    assert.deepEqual(vault.secrets(reg).sort(), ["new-fixture", "old-fixture"]);
    vault.release("old-run");
    assert.equal(vault.acquire(reg, "provider", "new-run"), "new-fixture");
    vault.release("new-run");
    assert.equal(vault.acquire(reg, "provider", "later"), undefined);
    assert.deepEqual(vault.secrets(reg), []);
  } finally { vault.clear(); }
});

test("registered clients in the same namespace share redaction without sharing grants", () => {
  const vault = new CredentialVault();
  const peer = { ...reg, id: "client-b" };
  try {
    vault.grant(peer, "provider", "peer-secret-fixture");
    assert.equal(vault.acquire(reg, "provider", "wrong-client"), undefined);
    assert.deepEqual(vault.secrets(reg), ["peer-secret-fixture"]);
    assert.deepEqual(vault.secrets({ ...reg, product: "companion-mac" }), []);
  } finally { vault.clear(); }
});

test("unused grants expire while an active execution retains its grant until completion", async () => {
  const vault = new CredentialVault(5);
  try {
    vault.grant(reg, "unused", "unused-fixture");
    vault.grant(reg, "active", "active-fixture");
    assert.equal(vault.acquire(reg, "active", "run"), "active-fixture");
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(vault.acquire(reg, "unused", "unused-run"), undefined);
    assert.deepEqual(vault.secrets(reg), ["active-fixture"]);
    vault.release("run");
    assert.deepEqual(vault.secrets(reg), []);
  } finally { vault.clear(); }
});
