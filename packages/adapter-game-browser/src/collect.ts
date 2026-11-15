import { chromium, type Browser } from "playwright-core";
import playwrightPackage from "playwright-core/package.json";
import { checkGameBrowserRecipe, gameBrowserRecipeSizeCheck, gameBrowserRecipeFailureMessage, type GameBrowserTestSuite } from "../../contracts/src/game-browser-tests";
import type { GameArtifact, GameObservation } from "../../contracts/src/game-production";
import { GameProductionFailure, GameProductionUncertain, type CollectedGameObservation, type ProducedGameFile } from "../../game-production/src/index";
import type { QualifiedBrowser } from "./browser";
import { hasRenderedPixels, imageDifference } from "./pixels";
import { serveArtifactResources } from "./resources";
import { openGameArtifactPage as openCase } from "./isolation";
export type CollectionAccess = { job: { id: string; testSuite?: string }; artifact: GameArtifact;
  designScenarios: { id: string; category: string }[]; signal: AbortSignal; readFile(path: string): Promise<Uint8Array> };
type Trace = { action: unknown; status: "passed" | "failed"; elapsedMs: number; detail?: string; changedRatio?: number };
const detail = (error: unknown) => {
  const message = error instanceof Error ? error.message : "Browser observation failed";
  // Playwright prints a long fixed command before browser stderr. Keep the
  // actual launch reason inside the same bound, rather than only its flags.
  const lines = message.split(/\r?\n/);
  const stderr = lines.filter(line => /^\[pid=\d+\]\[err\]/.test(line));
  return (stderr.length ? [lines[0], ...stderr].join("\n") : message).slice(0, 2000);
};

export async function collect(access: CollectionAccess, qualified: QualifiedBrowser, headless: boolean, onStopped: () => Promise<void>, onLaunched: (browser: Browser, origin: string) => Promise<void>): Promise<CollectedGameObservation[]> {
  const suitePath = access.job.testSuite ?? "data/playtests.json";
  const suiteFile = access.artifact.files.find((file) => file.path === suitePath);
  let suite: GameBrowserTestSuite | undefined;
  if (suiteFile) {
    const result = gameBrowserRecipeSizeCheck(suiteFile.size) ?? checkGameBrowserRecipe(await access.readFile(suitePath), access.designScenarios);
    if (!result.valid) throw new GameProductionFailure(gameBrowserRecipeFailureMessage(result));
    suite = result.suite;
  } else if (access.job.testSuite) throw new GameProductionFailure("The requested test suite is not packaged in this exact build.");
  let browser: Browser | undefined;
  let launchAttempted = false;
  let collectionFailure: unknown;
  let resources: Awaited<ReturnType<typeof serveArtifactResources>> | undefined;
  const signal = AbortSignal.any([access.signal, AbortSignal.timeout(120000)]);
  const stop = () => { void browser?.close().catch(() => {}); };
  signal.addEventListener("abort", stop, { once: true });
  const reports: CollectedGameObservation[] = [], blocked: string[] = [], errors: string[] = [];
  let bytes = 0, screenshots = 0;
  const environment: GameObservation["environment"] = { platform: process.platform, device: "Isolated automated desktop viewport", browser: qualified.version, input: [], scope: "automated" };
  const evidence = (files: ProducedGameFile[], path: string, data: Buffer, mime = "image/png") => {
    if (bytes + data.byteLength > 64 * 1024 * 1024 || (mime === "image/png" && screenshots >= 100)) throw new Error("Collector evidence budget reached; split this suite into smaller named suites.");
    bytes += data.byteLength; if (mime === "image/png") screenshots++;
    files.push({ path, data, mime });
  };
  try {
    signal.throwIfAborted();
    resources = await serveArtifactResources({ artifact: access.artifact, readFile: access.readFile, signal });
    launchAttempted = true;
    browser = await chromium.launch({ executablePath: qualified.executablePath, headless, chromiumSandbox: true, timeout: 10000,
      args: ["--force-webrtc-ip-handling-policy=disable_non_proxied_udp", "--webrtc-ip-handling-policy=disable_non_proxied_udp"] });
    if (!qualified.version.includes(browser.version())) throw new Error("The running browser differs from its qualified version.");
    await onLaunched(browser, resources.origin);
    const viewport = suite?.viewport ?? { width: 960, height: 540 };
    const bootFiles: ProducedGameFile[] = [];
    const boot = await openCase(browser, access, viewport, errors, blocked, signal, resources);
    let rendered = false;
    try {
      const canvas = boot.page.locator("canvas").first();
      for (let i = 0; i < 20; i++) {
        signal.throwIfAborted();
        try {
          const shot = await canvas.screenshot({ timeout: 1500 });
          if (hasRenderedPixels(shot)) { rendered = true; evidence(bootFiles, "boot.png", shot); break; }
        } catch { /* Still waiting for the initial canvas; no game-provided readiness signal. */ }
        await delay(100, signal);
      }
      if (!rendered) evidence(bootFiles, "boot.png", await boot.page.screenshot({ timeout: 1500 }));
    } finally { await boot.context.close(); }
    const root: CollectedGameObservation = { category: "runtime", environment, metrics: { renderedPixelsObserved: rendered, testSuitePresent: Boolean(suite) },
      checks: [{ id: "boots", status: rendered ? "passed" : "failed", detail: rendered ? "Browser-composited canvas contains rendered pixels; screenshot attached. This does not prove gameplay completeness." : "No rendered game canvas was observed." }], evidenceFiles: bootFiles };
    reports.push(root);
    if (suite) for (const [index, scenario] of suite.scenarios.entries()) {
      signal.throwIfAborted();
      const files: ProducedGameFile[] = [], trace: Trace[] = [], baselines = new Map<string, Buffer>();
      const beforeErrors = errors.length;
      const opened = await openCase(browser, access, viewport, errors, blocked, signal, resources);
      const held=new Set<string>();
      let passed = true;
      try {
        for (const [stepIndex, step] of scenario.steps.entries()) {
          signal.throwIfAborted(); const started = Date.now();
          try {
            let changedRatio: number | undefined;
            if (step.action === "press") await opened.page.keyboard.press(step.key);
            else if(step.action==="key-down"){await opened.page.keyboard.down(step.key);held.add(step.key);}
            else if(step.action==="key-up"){await opened.page.keyboard.up(step.key);held.delete(step.key);}
            else if (step.action === "click") { const size = opened.page.viewportSize()!; await opened.page.mouse.click(step.x * size.width, step.y * size.height, { button: step.button }); }
            else if (step.action === "tap") { const size = opened.page.viewportSize()!; await opened.page.touchscreen.tap(step.x * size.width, step.y * size.height); }
            else if (step.action === "wait") await delay(step.ms, signal);
            else if (step.action === "resize") await opened.page.setViewportSize({ width: step.width, height: step.height });
            else if (step.action === "reload") await opened.page.reload({ waitUntil: "load", timeout: 5000 });
            else if (step.action === "expect-visible") await opened.page.locator(`css=${step.selector}`).first().waitFor({ state: "visible", timeout: 2000 });
            else if (step.action === "expect-text") {
              const locator = opened.page.locator(`css=${step.selector}`).first();
              let found = false;
              for (let i = 0; i < 20; i++) {
                const text = await locator.textContent({ timeout: 2000 });
                if (step.match === "exact" ? text === step.value : text?.includes(step.value)) { found = true; break; }
                await delay(100, signal);
              }
              if (!found) throw new Error("The externally observed DOM text did not match the saved expectation.");
            } else {
              const shot = await opened.page.locator(`css=${step.selector}`).first().screenshot({ timeout: 2000 });
              evidence(files, `step-${String(stepIndex).padStart(2, "0")}.png`, shot);
              if (step.action === "capture") baselines.set(step.name, shot);
              else {
                changedRatio = imageDifference(baselines.get(step.baseline)!, shot);
                if (step.comparison === "changed" ? changedRatio <= step.threshold : changedRatio > step.threshold)
                  throw new Error(`Observed pixel difference ${changedRatio.toFixed(6)} did not meet ${step.comparison} threshold ${step.threshold}.`);
              }
            }
            trace.push({ action: step, status: "passed", elapsedMs: Date.now() - started, ...(changedRatio === undefined ? {} : { changedRatio }) });
          } catch (error) { passed = false; trace.push({ action: step, status: "failed", elapsedMs: Date.now() - started, detail: detail(error) }); break; }
        }
      } finally {try{for(const key of held)await opened.page.keyboard.up(key).catch(()=>{});}finally{await opened.context.close();} }
      passed &&= errors.length === beforeErrors;
      evidence(files, "trace.json", Buffer.from(JSON.stringify({ suite: suitePath, scenarioId: scenario.id, trace,
        errors: errors.slice(beforeErrors), observation: "DOM/input/pixel observations; not semantic certification or human acceptance" }, null, 2)), "application/json");
      reports.push({ category: "runtime", environment: { ...environment, input: [...new Set(scenario.steps.flatMap((step) => ["press","key-down","key-up"].includes(step.action) ? ["keyboard" as const] : step.action === "click" ? ["pointer" as const] : step.action === "tap" ? ["touch" as const] : []))] },
        testCase: { suite: suitePath, id: scenario.id }, checks: [{ id: "scenario", status: passed ? "passed" : "failed", detail: passed ? "Saved actions and external assertions were observed; trace/screenshots attached." : "The observed browser actions/assertions or runtime errors failed; see the attached trace." }],
        metrics: { observedSteps: trace.length, scenarioIndex: index, ...(scenario.designScenarioId ? { declaredDesignScenario: scenario.designScenarioId } : {}) }, evidenceFiles: files,
        // A recipe names its intended scenario, but generic DOM/pixel checks do
        // not independently establish that scenario's gameplay semantics.
        coverage: { contentIds: [], scenarioIds: [] } });
    }
    root.checks.push({ id: "console", status: errors.length || blocked.length ? "failed" : "passed", detail: errors.length || blocked.length ? `${errors.length} runtime/resource errors and ${blocked.length} blocked requests were observed.` : "No page errors, console errors or missing/blocked resources were observed." });
    evidence(bootFiles, "runtime.json", Buffer.from(JSON.stringify({ errors, blockedRequests: blocked, screenshots, evidenceBytes: bytes, playwright: playwrightPackage.version }, null, 2)), "application/json");
    return reports;
  } catch (error) {
    collectionFailure = error;
    access.signal.throwIfAborted();
    throw new GameProductionFailure(`Disposable browser collection stopped: ${detail(error)}`);
  } finally {
    signal.removeEventListener("abort", stop);
    try {
      try { await browser?.close(); } finally { await resources?.close(); }
      if (launchAttempted && !browser) throw new Error("Browser launch was not acknowledged.");
      await onStopped();
    } catch {
      const launchDetail = launchAttempted && !browser && collectionFailure
        ? ` Original browser launch failed: ${detail(collectionFailure)}` : "";
      throw new GameProductionUncertain("Browser/resource shutdown was not confirmed. Preserve this job for reconciliation before repeating its observation." + launchDetail);
    }
  }
}

async function delay(ms: number, signal: AbortSignal) {
  signal.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const aborted = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", aborted); resolve(); }, ms);
    signal.addEventListener("abort", aborted, { once: true });
  });
}
