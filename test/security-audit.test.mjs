import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  evaluateAuditReport,
  npmAuditInvocation,
  validateAuditPolicy,
  validateAuditReport
} from "../scripts/audit-production.mjs";

const report = {
  vulnerabilities: {
    braces: {
      severity: "high",
      via: [{
        name: "braces",
        severity: "high",
        url: "https://github.com/advisories/GHSA-vfj7-8cjw-p6xm"
      }]
    },
    micromatch: { severity: "high", via: ["braces"] },
    deepagents: { severity: "high", via: ["micromatch"] }
  }
};

const exception = {
  advisory: "GHSA-vfj7-8cjw-p6xm",
  package: "braces",
  severity: "high",
  expires: "2027-01-31",
  rationale: "No patched release.",
  mitigation: "Reject brace expansion.",
  verification: "test/glob-policy.test.ts and test/change-tracker.test.ts"
};

test("accepts a current advisory exception only with checked mitigation evidence", () => {
  const result = evaluateAuditReport(report, { exceptions: [exception] }, new Date("2026-10-15T00:00:00Z"));
  assert.deepEqual(result.blocking, []);
  assert.deepEqual(result.accepted.map((entry) => entry.package), ["braces", "micromatch", "deepagents"]);
  assert.deepEqual(result.staleExceptions, []);
});

test("keeps repository policy valid without retaining resolved advisory exceptions", () => {
  const policy = JSON.parse(readFileSync("security-audit-exceptions.json", "utf8"));
  assert.equal(validateAuditPolicy(policy, new Date()), undefined);
  assert.equal(policy.version, 1);
});

test("blocks missing, expired, mismatched, or unverifiable exceptions", () => {
  assert.equal(evaluateAuditReport(report, { exceptions: [] }).blocking.length, 3);
  assert.equal(evaluateAuditReport(report, { exceptions: [{ ...exception, expires: "2026-01-01" }] }, new Date("2026-10-15T00:00:00Z")).blocking.length, 3);
  assert.equal(evaluateAuditReport(report, { exceptions: [{ ...exception, package: "other" }] }).blocking.length, 3);
  assert.equal(evaluateAuditReport(report, { exceptions: [{ ...exception, verification: "test/missing.test.ts" }] }).blocking.length, 3);
});

test("fails closed when npm audit returns an error or incomplete report", () => {
  assert.match(validateAuditReport({
    message: "request failed",
    error: { summary: "registry unavailable", detail: "" }
  }) ?? "", /registry unavailable/);
  assert.match(validateAuditReport({ vulnerabilities: {} }) ?? "", /metadata/);
  assert.match(validateAuditReport({ metadata: { vulnerabilities: {} } }) ?? "", /vulnerabilities object/);
  assert.equal(validateAuditReport({
    auditReportVersion: 2,
    vulnerabilities: {},
    metadata: { vulnerabilities: { high: 0, critical: 0, total: 0 } }
  }), undefined);
});

test("reports stale exceptions when the audited advisory is no longer present", () => {
  const result = evaluateAuditReport({ vulnerabilities: {} }, { exceptions: [exception] });
  assert.deepEqual(result.blocking, []);
  assert.deepEqual(result.accepted, []);
  assert.deepEqual(result.staleExceptions, ["GHSA-vfj7-8cjw-p6xm"]);
});

test("rejects malformed, duplicated, expired, and unverifiable policy entries", () => {
  const current = new Date("2026-10-15T00:00:00Z");
  assert.equal(validateAuditPolicy({ version: 1, exceptions: [exception] }, current), undefined);
  assert.match(validateAuditPolicy({ version: 2, exceptions: [] }, current) ?? "", /version 1/);
  assert.match(validateAuditPolicy({ version: 1, exceptions: [{ ...exception, extra: true }] }, current) ?? "", /unknown field/);
  assert.match(validateAuditPolicy({ version: 1, exceptions: [exception, exception] }, current) ?? "", /duplicate/);
  assert.match(validateAuditPolicy({ version: 1, exceptions: [{ ...exception, expires: "2026-01-01" }] }, current) ?? "", /expired/);
  assert.match(validateAuditPolicy({ version: 1, exceptions: [{ ...exception, verification: "test/missing.test.ts" }] }, current) ?? "", /missing verification/);
});

test("invokes npm audit without a shell on Windows and Unix", () => {
  assert.deepEqual(npmAuditInvocation({
    npmExecutable: "C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js",
    nodeExecutable: "C:\\Program Files\\nodejs\\node.exe",
    platform: "win32"
  }), {
    command: "C:\\Program Files\\nodejs\\node.exe",
    args: [
      "C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js",
      "audit",
      "--omit=dev",
      "--ignore-scripts",
      "--json"
    ]
  });
  assert.deepEqual(npmAuditInvocation({ npmExecutable: "", platform: "linux" }), {
    command: "npm",
    args: ["audit", "--omit=dev", "--ignore-scripts", "--json"]
  });
});
