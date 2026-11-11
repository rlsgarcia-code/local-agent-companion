// Actual renderer HTML/CSS/script with a fixture host bridge, never personal settings or inference.
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");
const { LITELLM_MODEL_CAPABILITIES } = require("../dist-tests/src/litellm.js");
const { LITELLM_MODEL_CATALOG } = require("../dist-tests/packages/agent-core/src/litellm-catalog.js");
const { parseIncomingMessage } = require("../dist-tests/src/webview-protocol.js");
const source = await readFile("src/webview.ts", "utf8");
const htmlStart = source.indexOf("return `<!doctype html>") + "return `".length;
const htmlEnd = source.indexOf("</html>`;", htmlStart) + "</html>".length;
assert.ok(htmlStart > 8 && htmlEnd > htmlStart);
const styles = /const styles = String.raw`([\s\S]*?)\n`;/u.exec(source)?.[1];
assert.ok(styles);
let script = source.slice(source.indexOf("const script = String.raw`") + "const script = String.raw`".length, source.lastIndexOf("\n`;"));
script = script.replace("${JSON.stringify(LITELLM_MODEL_CAPABILITIES)}", () => JSON.stringify(LITELLM_MODEL_CAPABILITIES))
  .replace("${JSON.stringify(LITELLM_MODEL_CATALOG)}", () => JSON.stringify(LITELLM_MODEL_CATALOG));
const html = source.slice(htmlStart, htmlEnd).replaceAll("${nonce}", "connectionfixture").replaceAll("${webview.cspSource}", "'self'")
  .replace("${styles}", () => styles).replace("${script}", () => `globalThis.__hostMessages=[]; globalThis.acquireVsCodeApi=()=>({getState:()=>({}),setState:()=>{},postMessage:m=>globalThis.__hostMessages.push(m)});\n${script}`);
const directory = path.resolve("output/playwright/connection-settings", `${new Date().toISOString().replaceAll(":", "-")}-${randomUUID().slice(0, 8)}`);
await mkdir(directory, { recursive: true });
const file = path.join(directory, "fixture.html");
await writeFile(file, html);
const executablePath = [
  process.env.CONNECTION_TEST_BROWSER,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser",
  ...[process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA]
    .filter(Boolean).flatMap(folder => [path.join(folder, "Google/Chrome/Application/chrome.exe"), path.join(folder, "Microsoft/Edge/Application/msedge.exe")]),
].find(file => file && existsSync(file));
assert.ok(executablePath, "An installed Chrome/Edge is required; no browser is downloaded.");
const browser = await chromium.launch({ executablePath, headless: true, chromiumSandbox: true });
const results = [];
try {
  for (const provider of ["litellm", "openai", "ollama"]) {
    const page = await browser.newPage({ viewport: { width: 760, height: 1000 } });
    page.setDefaultTimeout(5000);
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(pathToFileURL(file).href);
    const snapshot = { provider, availableProviders: ["litellm", "openai", "ollama"], endpoint: provider === "ollama" ? "http://127.0.0.1:11434/v1" : "https://gateway.invalid/v1", model: "gpt-5.4", hasApiKey: true };
    await page.evaluate(liteLlm => window.dispatchEvent(new MessageEvent("message", { data: { type: "openConnectionSettings", liteLlm } })), snapshot);
    await page.locator('[data-setup-step-target="2"]').click();
    assert.equal(await page.locator("#litellm-model").isVisible(), true);
    assert.equal(await page.locator("#vision-model").isVisible(), true);
    assert.equal(await page.locator("#model-feature-fields").isVisible(), provider !== "ollama");
    assert.equal(await page.locator("#ollama-planner-model").isVisible(), provider === "ollama");
    if (provider !== "ollama") {
      const checks = page.locator("[data-model-capability]");
      assert.equal(await checks.count(), 8);
      for (const input of await checks.all()) await input.check();
      await page.locator("#litellm-model").fill("Corporate-EXACT/Other");
      await page.locator("#litellm-model").blur();
      assert.equal(await page.locator('[data-model-capability="vision"]').isChecked(), false);
      await page.locator('[data-model-capability="functionCalling"]').check();
      await page.locator("#litellm-model").fill("gpt-5.4");
      await page.locator("#litellm-model").blur();
      for (const input of await checks.all()) assert.equal(await input.isChecked(), true);
      assert.doesNotMatch(await page.locator("#model-compatibility").innerText(), /Not compatible with this agent/);
      if (provider !== "openai") {
        await page.locator("#advanced-settings > summary").click();
        await page.locator("#litellm-model-api").selectOption("chat_completions");
      }
      await page.locator('[data-setup-step-target="3"]').click();
      await page.locator("#litellm-test").click();
      const message = await page.evaluate(() => globalThis.__hostMessages.filter(message => message.type === "testLiteLlm").at(-1));
      assert.ok(parseIncomingMessage(message));
      assert.equal(message.model, "gpt-5.4");
      assert.equal(message.capabilities.pdfInput, true);
      assert.equal(message.capabilityDeclarations["Corporate-EXACT/Other"].vision, false);
      const testId = randomUUID();
      await page.evaluate(testId => window.dispatchEvent(new MessageEvent("message", { data: { type: "connectionTested", testId, logAvailable: true, diagnostics: [{ id: "chat", label: "Chat Completions", status: "failed", detail: "404 model not found", durationMs: 120, failureKind: "model_not_found", httpStatus: 404, testId }] } })), testId);
      assert.match(await page.locator("#connection-diagnostics").innerText(), /model_not_found.*HTTP 404/s);
      assert.match(await page.locator("#connection-test-reference").innerText(), new RegExp(testId));
      await page.locator("#connection-open-log").click();
      assert.equal(await page.evaluate(() => globalThis.__hostMessages.at(-1).type), "openConnectionLog");
      await page.locator("#litellm-save").click();
      const saved = await page.evaluate(() => globalThis.__hostMessages.filter(message => message.type === "saveLiteLlm").at(-1));
      assert.ok(parseIncomingMessage(saved));
      const reopened = { ...snapshot, modelProfiles: { "gpt-5.4": { api: saved.modelApi, capabilities: saved.capabilities } } };
      await page.evaluate(liteLlm => window.dispatchEvent(new MessageEvent("message", { data: { type: "liteLlmSaved", liteLlm, message: "Saved in fixture host" } })), reopened);
      await page.evaluate(liteLlm => window.dispatchEvent(new MessageEvent("message", { data: { type: "openConnectionSettings", liteLlm } })), reopened);
      await page.locator('[data-setup-step-target="2"]').click();
      for (const input of await checks.all()) assert.equal(await input.isChecked(), true);
      await page.locator('[data-model-capability="reasoning"]').uncheck();
      assert.equal(await page.locator("#litellm-reasoning-effort").isDisabled(), true);
      assert.equal(await page.locator("#litellm-reasoning-effort").inputValue(), "omit");
      if (provider === "litellm") await page.screenshot({ path: path.join(directory, "litellm-declarations.png") });
    }
    assert.deepEqual(errors, []);
    results.push({ provider, visible: true, checked: provider === "ollama" ? "legacy controls preserved" : "eight features, alias isolation, transport payload, reopen and diagnostic log action" });
    await page.close();
  }
  await writeFile(path.join(directory, "evidence.json"), JSON.stringify({ environment: "Actual Chromium renderer with simulated VS Code bridge, not an installed Windows client", browser: await browser.version(), results }, null, 2));
  console.log("CONNECTION_SETTINGS_SMOKE_OK", directory);
} finally { await browser.close(); }
