import * as path from "node:path";
import { access, mkdtemp, rm, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { runTests, downloadAndUnzipVSCode } from "@vscode/test-electron";

import { runBoundedCli } from "./editor-test-cli.mjs";
import { installedVSIXDirectory } from "./verify-installed-vsix.mjs";

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
const configuredExecutable = process.env.VSCODE_EXECUTABLE_PATH?.trim();
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
  const vscodeExecutable=configuredExecutable || await downloadAndUnzipVSCode({version});
  const cli=path.join(path.dirname(vscodeExecutable),process.platform==='darwin'?'../Resources/app/out/cli.js':'resources/app/out/cli.js');
  await access(cli,constants.R_OK);
  try {
    await runBoundedCli(vscodeExecutable,[cli,...installArgs],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'}});
  } catch (error) {
    // Electron 1.106 may abort after a successful CLI install on Mac/Windows.
    // Accept only that known crash and only a byte-verified payload; activation still runs below.
    const diagnostic=[error?.message,error?.stdout,error?.stderr].filter(value=>typeof value==='string').join('\n');
    if(!/v8::ToLocalChecked Empty MaybeLocal/.test(diagnostic)||!(await installedVSIXDirectory(vsixPath,extensionsDirectory)))throw error;
    console.warn("PACKAGED_EXTENSION_TEST_INSTALL_WARNING Known VS Code CLI shutdown crash; the exact installed payload was verified.");
  }

  if(!(await installedVSIXDirectory(vsixPath,extensionsDirectory)))throw new Error("The installed copy does not match the exact VSIX.");

  await runTests({
    version,
    vscodeExecutablePath: vscodeExecutable,
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
