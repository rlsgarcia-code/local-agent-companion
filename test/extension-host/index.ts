import assert from "node:assert/strict";
import * as path from "node:path";
import * as vscode from "vscode";

const EXTENSION_ID = "local.local-agent-companion";
const EXPECTED_COMMANDS = [
  "localAgentCompanion.open",
  "localAgentCompanion.newThread",
  "localAgentCompanion.addSelection",
  "localAgentCompanion.addFileContext",
  "localAgentCompanion.remember",
  "localAgentCompanion.configureLiteLlm",
  "localAgentCompanion.clearLiteLlmKey"
] as const;

async function completesWithin<T>(label: string, operation: PromiseLike<T>, timeoutMs = 10_000): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label} did not complete within ${timeoutMs} ms`)), timeoutMs);
      })
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function run(): Promise<void> {
  assert.equal(vscode.workspace.isTrusted, true, "the integration fixture must run as a trusted workspace");
  assert.equal(vscode.workspace.workspaceFolders?.length, 1, "the test must open exactly one isolated workspace");

  const extension = vscode.extensions.getExtension(EXTENSION_ID);
  assert.ok(extension, `${EXTENSION_ID} must be discoverable by the Extension Host`);
  const expectedSource = process.env.LDC_EXPECTED_EXTENSION_SOURCE;
  const expectedRoot = process.env.LDC_EXPECTED_EXTENSION_ROOT;
  assert.ok(
    expectedSource === "development" || expectedSource === "installed",
    "the integration launcher must declare the expected extension source"
  );
  assert.ok(expectedRoot, "the integration launcher must declare the expected extension root");
  const actualExtensionPath = path.resolve(extension.extensionPath);
  const resolvedExpectedRoot = path.resolve(expectedRoot);
  if (expectedSource === "development") {
    assert.equal(actualExtensionPath, resolvedExpectedRoot, "the source-mode test must load the checkout");
  } else {
    const relativeInstalledPath = path.relative(resolvedExpectedRoot, actualExtensionPath);
    assert.ok(
      relativeInstalledPath && !relativeInstalledPath.startsWith("..") && !path.isAbsolute(relativeInstalledPath),
      "the packaged test must load the copy installed from the VSIX"
    );
  }
  assert.equal(extension.packageJSON.main, "./dist/extension.js");
  assert.equal(extension.packageJSON.capabilities?.untrustedWorkspaces?.supported, false);

  await completesWithin("extension activation", extension.activate(), 15_000);
  assert.equal(extension.isActive, true, "the extension must remain active after activation");

  const registeredCommands = new Set(await vscode.commands.getCommands(true));
  for (const command of EXPECTED_COMMANDS) {
    assert.ok(registeredCommands.has(command), `${command} must be registered after activation`);
  }

  const configuration = vscode.workspace.getConfiguration("localAgentCompanion");
  assert.equal(configuration.get("agentRuntime"), "standard");
  assert.equal(configuration.get("localBrowserToolsEnabled"), false);
  assert.equal(configuration.get("localBrowserChannel"), "auto");
  assert.equal(configuration.get("localBrowserOpenPreview"), true);
  assert.equal(configuration.get("finalReviewMode"), "changes");
  assert.equal(configuration.get("autonomyMode"), "review");
  assert.equal(configuration.get("completionNotifications"), "whenHidden");

  await completesWithin(
    "opening the Local Agent Companion view",
    vscode.commands.executeCommand("localAgentCompanion.open")
  );
  const coldSignedEngine = process.env.LDC_EXPECT_SIGNED_ENGINE === "1";
  const coldStart = Date.now();
  await completesWithin(
    coldSignedEngine ? "creating the first thread including cold signed-engine verification/startup" : "creating a new local thread",
    vscode.commands.executeCommand("localAgentCompanion.newThread"),
    coldSignedEngine ? 30_000 : 10_000
  );
  if (coldSignedEngine) {
    console.log("PACKAGED_ENGINE_FIRST_THREAD_MS", Date.now() - coldStart);
    const warmStart = Date.now();
    await completesWithin("creating a thread with the initialized engine", vscode.commands.executeCommand("localAgentCompanion.newThread"), 10_000);
    console.log("PACKAGED_ENGINE_WARM_THREAD_MS", Date.now() - warmStart);
  }
  await completesWithin(
    "opening the LiteLLM settings surface",
    vscode.commands.executeCommand("localAgentCompanion.configureLiteLlm")
  );

  assert.equal(extension.isActive, true, "sidebar commands must not deactivate or crash the extension");
  console.log(
    expectedSource === "installed"
      ? "VSCODE_PACKAGED_EXTENSION_INSTALL_AND_ACTIVATION_OK"
      : "VSCODE_EXTENSION_HOST_ACTIVATION_AND_COMMANDS_OK"
  );
}
