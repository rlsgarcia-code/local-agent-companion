import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("keeps professional extension metadata and a valid package icon", () => {
  const manifest = JSON.parse(readFileSync("package.json", "utf8")) as {
    homepage?: string;
    bugs?: { url?: string };
    icon?: string;
    keywords?: string[];
    scripts?: Record<string, string>;
    capabilities?: {
      untrustedWorkspaces?: { supported?: boolean; description?: string };
    };
    contributes?: {
      configuration?: {
        properties?: Record<string, { default?: unknown; enum?: unknown[] }>;
      };
    };
  };
  assert.equal(manifest.homepage, "https://github.com/rlsgarcia-code/local-agent-companion#readme");
  assert.equal(manifest.bugs?.url, "https://github.com/rlsgarcia-code/local-agent-companion/issues");
  assert.equal(manifest.icon, "media/extension-icon.png");
  assert.ok(manifest.keywords?.includes("local-first"));
  assert.equal(manifest.capabilities?.untrustedWorkspaces?.supported, false);
  assert.match(manifest.capabilities?.untrustedWorkspaces?.description ?? "", /must be trusted/);
  const autonomy = manifest.contributes?.configuration?.properties?.["localAgentCompanion.autonomyMode"];
  assert.equal(autonomy?.default, "review");
  assert.deepEqual(autonomy?.enum, ["review", "execute", "plan"]);
  const provider = manifest.contributes?.configuration?.properties?.["localAgentCompanion.modelProvider"];
  assert.equal(provider?.default, "litellm");
  assert.deepEqual(provider?.enum, ["litellm", "ollama", "openai"]);
  const notifications = manifest.contributes?.configuration?.properties?.["localAgentCompanion.completionNotifications"];
  assert.equal(notifications?.default, "whenHidden");
  assert.deepEqual(notifications?.enum, ["whenHidden", "always", "never"]);
  assert.equal(
    manifest.scripts?.["test:repository"],
    "node --test test/issue-forms.test.mjs test/license-inventory.test.mjs test/native-package.test.mjs test/release-metadata.test.mjs test/security-audit.test.mjs test/release-artifacts.test.mjs test/installed-vsix.test.mjs"
  );
  assert.match(manifest.scripts?.test ?? "", /npm run test:repository/);
  assert.equal(manifest.scripts?.package, "npm run build && node scripts/package-native.mjs");
  assert.equal(manifest.scripts?.["package:ollama"], "node esbuild.mjs --provider=ollama && node scripts/package-native.mjs --provider=ollama");
  assert.equal(manifest.scripts?.["package:openai"], "node esbuild.mjs --provider=openai && node scripts/package-native.mjs --provider=openai");
  assert.equal(
    manifest.scripts?.verify,
    "npm run check && npm test && npm run build && npm run smoke:litellm && npm run smoke:chroma"
  );
  assert.equal(manifest.scripts?.["package:verified"], "npm run verify && node scripts/package-native.mjs");
  assert.doesNotMatch(manifest.scripts?.package ?? "", /test|smoke|compile|check/);
  assert.equal(manifest.scripts?.["audit:prod"], "node scripts/audit-production.mjs");
  assert.equal(
    manifest.scripts?.["test:extension-host"],
    "npm run build && npm run compile:extension-host-tests && node scripts/run-extension-host-tests.mjs"
  );
  assert.equal(
    manifest.scripts?.["test:vsix-install"],
    "npm run compile:extension-host-tests && node scripts/run-vsix-install-tests.mjs"
  );

  const icon = readFileSync(manifest.icon);
  assert.deepEqual([...icon.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(icon.readUInt32BE(16), 128);
  assert.equal(icon.readUInt32BE(20), 128);
  assert.doesNotMatch(readFileSync(".vscodeignore", "utf8"), /^media\/extension-icon\.png$/m);
  assert.doesNotMatch(readFileSync(".vscodeignore", "utf8"), /^dist\/licenses/m);
});

test("CI verifies and packages every supported native target", () => {
  const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
  for (const target of ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64", "win32-x64"]) {
    assert.match(workflow, new RegExp(`target: ${target.replace("-", "\\-")}`));
  }
  for (const command of [
    "npm ci --ignore-scripts",
    "npm run audit:prod",
    "npm run check",
    "npm test",
    "npm run smoke:litellm",
    "npm run build",
    "xvfb-run -a npm run test:extension-host",
    "npm run smoke:chroma",
    "vsce package --no-dependencies --target",
    "xvfb-run -a npm run test:vsix-install -- local-agent-companion-linux-x64.vsix"
  ]) {
    assert.ok(workflow.includes(command), `missing CI command: ${command}`);
  }
  assert.match(workflow, /permissions:\s+contents: read/);
  assert.match(workflow, /actions\/upload-artifact@[a-f0-9]{40} # v7/);
  assertWorkflowActionsPinned(workflow);
  assert.match(workflow, /if: matrix\.target == 'linux-x64'[\s\S]*xvfb-run -a npm run test:extension-host/);
  assert.match(workflow, /Verify the local packaging entrypoint on Windows\s+if: matrix\.target == 'win32-x64'\s+run: node --test test\/native-package\.test\.mjs/);
  assert.match(workflow, /if: matrix\.target == 'win32-x64'\s+run: npm run test:extension-host/);
  assert.match(workflow, /if: matrix\.target == 'win32-x64'\s+run: npm run test:vsix-install -- local-agent-companion-win32-x64\.vsix/);
});

test("tagged releases prepare a complete, immutable, checksummed native package draft for review", () => {
  const workflow = readFileSync(".github/workflows/release.yml", "utf8");
  assert.match(workflow, /tags:\s+\- "v\*\.\*\.\*"/);
  for (const target of ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64", "win32-x64"]) {
    assert.match(workflow, new RegExp(`target: ${target.replace("-", "\\-")}`));
  }
  for (const requirement of [
    "scripts/verify-release-metadata.mjs",
    "npm run audit:prod",
    "xvfb-run -a npm run test:extension-host",
    "xvfb-run -a npm run test:vsix-install --",
    "actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333 # v8",
    "SHA256SUMS.txt",
    "gh release create",
    "is already published and will not be overwritten"
  ]) {
    assert.ok(workflow.includes(requirement), `missing release safeguard: ${requirement}`);
  }
  assert.match(workflow, /publish:[\s\S]*permissions:\s+contents: write/);
  assert.match(workflow, /gh release create[\s\S]*--draft/);
  assert.doesNotMatch(workflow, /gh release edit[^\n]*--draft=false|--latest/);
  assert.match(workflow, /if: matrix\.target == 'win32-x64'\s+run: npm run test:extension-host/);
  assert.match(workflow, /if: matrix\.target == 'win32-x64'\s+run: \|[\s\S]*Get-Content package\.json[\s\S]*npm run test:vsix-install -- "release\/local-agent-companion-\$version-win32-x64\.vsix"/);
  assertWorkflowActionsPinned(workflow);
});

test("repository policy documents stay present", () => {
  const readme = readFileSync("README.md", "utf8");
  assert.match(readme, /code --install-extension .*<plataforma>\.vsix --force/);
  assert.doesNotMatch(readme, /code --install-extension local-agent-companion-0\.11\.0\.vsix/);
  assert.match(readFileSync("CONTRIBUTING.md", "utf8"), /Contrato arquitetural/);
  assert.match(readFileSync("SECURITY.md", "utf8"), /Report a vulnerability/);
  assert.match(readFileSync("docs/CORPORATE-PILOT.md", "utf8"), /Critério de aprovação/);
  assert.match(readFileSync("docs/CORPORATE-PILOT.md", "utf8"), /Não acrescente chaves/);
  const dependabot = readFileSync(".github/dependabot.yml", "utf8");
  assert.match(dependabot, /package-ecosystem: npm/);
  assert.match(dependabot, /package-ecosystem: github-actions/);
  assert.match(dependabot, /interval: weekly/);
  assert.equal((dependabot.match(/update-types:/g) ?? []).length, 2);
  assert.equal((dependabot.match(/^\s+- minor$/gm) ?? []).length, 2);
  assert.equal((dependabot.match(/^\s+- patch$/gm) ?? []).length, 2);
});

function assertWorkflowActionsPinned(workflow: string): void {
  const actionReferences = [...workflow.matchAll(/^\s*uses:\s+([^\s@]+)@([^\s#]+)(?:\s+#\s+(.+))?$/gm)];
  assert.ok(actionReferences.length > 0, "workflow must use at least one reviewed action");
  for (const [, action = "", revision = "", versionComment = ""] of actionReferences) {
    assert.match(revision, /^[a-f0-9]{40}$/, `${action} must be pinned to a full commit SHA`);
    assert.match(
      versionComment,
      /^v\d+(?:\.\d+\.\d+)?$/,
      `${action} must retain its reviewed version comment`
    );
  }
}
