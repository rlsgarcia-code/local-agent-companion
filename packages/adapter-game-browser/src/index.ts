import { lstat } from "node:fs/promises";
import * as path from "node:path";
import playwrightPackage from "playwright-core/package.json";
import versions from "../../contracts/src/version.json";
import { contentHash } from "../../contracts/src/identity";
import { gameBrowserTestGuide } from "../../contracts/src/game-browser-tests";
import { GameProductionFailure, GameProductionUncertain, type GameValidationCollector } from "../../game-production/src/index";
import { browserDigest, qualifyBrowser } from "./browser";
import { durableBrowser } from "./durable";
import { checkDirectory } from "./journal";
// Administrative instrumentation only; this export does not register a collector,
// accept a transport option or turn automated timings into physical QA reports.
export { prepareColdNetworkMeasurement, coldNetworkProfile } from "./loading";

/** Installed process-owner port. The helper owns only one pinned observation. */
export async function createBrowserGameCollector(options: { stateDirectory: string; workerPath?: string; executablePath?: string; headless?: boolean; implementationSha256?: string }): Promise<GameValidationCollector> {
  const browser = await qualifyBrowser(options.executablePath);
  const workerPath = options.workerPath ?? path.join(__dirname, "worker.js");
  let workerSha256: string | undefined;
  try { const info = await lstat(workerPath); if (info.isFile() && !info.isSymbolicLink()) workerSha256 = await browserDigest(workerPath); } catch { /* Unavailable, never a direct-process fallback. */ }
  const toolchain = { id: "web-browser-runtime", version: `${playwrightPackage.version}+${browser?.version ?? "unavailable"}.supervisor.1`,
    sha256: contentHash({ collectorABI: 4, implementation: options.implementationSha256 ?? "development-unreleased", workerSha256: workerSha256 ?? null, node: process.versions.node,
      playwright: playwrightPackage.version, browser: browser ? { version: browser.version, sha256: browser.sha256 } : null }) };
  const runtime = browser && workerSha256 ? durableBrowser({ stateDirectory: options.stateDirectory, workerPath, workerSha256, browser, headless: options.headless ?? true }) : undefined;
  async function probe() {
    if (!browser) return { available: false, reason: "Install a supported Chromium browser and restart the engine to qualify it. No browser is downloaded automatically." };
    if (!runtime || process.versions.node !== versions.node) return { available: false, reason: "The exact packaged Node/browser supervisor is unavailable. Repair the engine installation; no in-process fallback is used." };
    try {
      await checkDirectory(options.stateDirectory);
      const info = await lstat(workerPath);
      if (!info.isFile() || info.isSymbolicLink() || await browserDigest(workerPath) !== workerSha256) throw new Error();
      for (const component of browser.components) if (await browserDigest(component.path) !== component.sha256)
        return { available: false, reason: "The qualified browser changed; restart the engine before collecting evidence." };
      return { available: true };
    } catch { return { available: false, reason: "The qualified browser/supervisor or private state directory is missing or changed." }; }
  }
  return { id: "web-browser-runtime-v1", engines: ["phaser", "babylon", "godot"], products: ["companion-mac", "companion-vscode"], authority: "workspace",
    projectGuide: gameBrowserTestGuide, testSuiteFormat: "browser-v1",
    resources: { memoryMiB: 2048, cpuSlots: 1, exclusiveGroups: ["game-browser"] }, categories: ["runtime"], toolchain, probe,
    async validate(access) { if (!(await probe()).available || !runtime) throw new GameProductionFailure("The qualified browser supervisor is unavailable."); return runtime.validate(access); },
    async reconcile(access) { if (!runtime) throw new GameProductionUncertain("Restore the original browser supervisor before reconciliation."); return runtime.recover(access); },
    async dispose(access) { await runtime?.dispose(access); },
  };
}
