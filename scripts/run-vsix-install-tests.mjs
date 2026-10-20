import * as path from "node:path";
import { access, mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { runTests, runVSCodeCommand } from "@vscode/test-electron";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requestedVsix = process.argv[2]?.trim();
if (!requestedVsix) {
  console.error("Usage: npm run test:vsix-install -- <platform-specific.vsix>");
  process.exit(2);
}

const vsixPath = path.resolve(projectRoot, requestedVsix);
if (path.extname(vsixPath).toLowerCase() !== ".vsix") {
  console.error("PACKAGED_EXTENSION_TEST_FAILED The package path must end in .vsix.");
  process.exit(2);
}

try {
  await access(vsixPath, constants.R_OK);
  if (!(await stat(vsixPath)).isFile()) throw new Error("The package path is not a regular file.");
} catch (error) {
  console.error(
    "PACKAGED_EXTENSION_TEST_FAILED",
    error instanceof Error ? error.message : String(error)
  );
  process.exit(2);
}

const version = process.env.VSCODE_TEST_VERSION?.trim() || "1.106.0";
const shortTemporaryRoot = process.platform === "win32" ? tmpdir() : "/tmp";
const profileRoot = await mkdtemp(path.join(shortTemporaryRoot, "ldc-vsix-"));
const userDataDirectory = path.join(profileRoot, "user");
const extensionsDirectory = path.join(profileRoot, "extensions");
let completed = false;

try {
  const installArgs = [
    "--install-extension",
    vsixPath,
    "--force",
    `--user-data-dir=${userDataDirectory}`,
    `--extensions-dir=${extensionsDirectory}`
  ];
  try {
    await runVSCodeCommand(installArgs, { version });
  } catch (error) {
    // Some Windows VS Code builds exit with V8 code 134 after the CLI has
    // already installed the VSIX. Continue only when the package is present
    // in the isolated extension directory; a real install failure remains fatal.
    if (process.platform !== "win32" || !(await installedExtensionPresent(extensionsDirectory))) throw error;
    console.warn("PACKAGED_EXTENSION_TEST_INSTALL_WARNING VS Code CLI crashed after installing the VSIX; continuing with the verified isolated copy.");
  }

  await runTests({
    version,
    extensionDevelopmentPath: path.join(projectRoot, "test", "fixtures", "vsix-test-harness"),
    extensionTestsPath: path.join(projectRoot, "dist-extension-tests", "index.js"),
    extensionTestsEnv: {
      LDC_EXPECTED_EXTENSION_SOURCE: "installed",
      LDC_EXPECTED_EXTENSION_ROOT: extensionsDirectory
    },
    launchArgs: [
      path.join(projectRoot, "test", "fixtures", "extension-host-workspace"),
      `--user-data-dir=${userDataDirectory}`,
      `--extensions-dir=${extensionsDirectory}`,
      ...(process.env.LDC_VSIX_TEST_VERBOSE === "1" ? ["--verbose"] : [])
    ]
  });
  completed = true;
} catch (error) {
  console.error(
    "PACKAGED_EXTENSION_TEST_FAILED",
    error instanceof Error ? error.message : String(error)
  );
  process.exitCode = 1;
} finally {
  if (completed) {
    await rm(profileRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  } else {
    console.error(`PACKAGED_EXTENSION_TEST_PROFILE_PRESERVED ${profileRoot}`);
  }
}

async function installedExtensionPresent(extensionsDirectory) {
  let entries;
  try { entries = await readdir(extensionsDirectory, { withFileTypes: true }); } catch { return false; }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const manifest = JSON.parse(await readFile(path.join(extensionsDirectory, entry.name, "package.json"), "utf8"));
      if (manifest.name === "local-agent-companion" && typeof manifest.version === "string") return true;
    } catch { /* ignore incomplete install entries */ }
  }
  return false;
}
