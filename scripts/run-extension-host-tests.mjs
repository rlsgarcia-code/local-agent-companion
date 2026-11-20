import * as path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { runTests } from "@vscode/test-electron";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configuredExecutable = process.env.VSCODE_EXECUTABLE_PATH?.trim();
const shortTemporaryRoot = process.platform === "win32" ? tmpdir() : "/tmp";
const profileRoot = await mkdtemp(path.join(shortTemporaryRoot, "ldc-vscode-"));

const options = {
  extensionDevelopmentPath: projectRoot,
  extensionTestsPath: path.join(projectRoot, "dist-extension-tests", "index.js"),
  extensionTestsEnv: {
    LDC_EXPECTED_EXTENSION_SOURCE: "development",
    LDC_EXPECTED_EXTENSION_ROOT: projectRoot
  },
  launchArgs: [
    path.join(projectRoot, "test", "fixtures", "extension-host-workspace"),
    "--use-inmemory-secretstorage", "--disable-telemetry", "--disable-experiments",
    "--disable-updates", "--skip-welcome", "--skip-release-notes",
    "--disable-extensions",
    `--user-data-dir=${path.join(profileRoot, "user")}`,
    `--extensions-dir=${path.join(profileRoot, "extensions")}`
  ],
  version: process.env.VSCODE_TEST_VERSION?.trim() || "1.106.0"
};

if (configuredExecutable) options.vscodeExecutablePath = configuredExecutable;

try {
  await runTests(options);
} catch (error) {
  console.error("EXTENSION_HOST_TEST_FAILED", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await rm(profileRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
