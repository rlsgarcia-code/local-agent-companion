import type { Browser, BrowserContext, Page } from "playwright-core";
import { resourceName, serveArtifactResources,type PinnedBrowserResources } from "./resources";

export async function openGameArtifactPage(browser: Browser, access: { artifact: PinnedBrowserResources; readFile(path: string): Promise<Uint8Array> }, viewport: { width: number; height: number }, errors: string[], blocked: string[], signal: AbortSignal, resources: Awaited<ReturnType<typeof serveArtifactResources>>, beforeNavigation?: (page: Page) => Promise<void>): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport, hasTouch: true, acceptDownloads: false, serviceWorkers: "block", permissions: [] });
  const origin = resources.origin;
  try {
    await context.addCookies([resources.cookie]);
    await context.routeWebSocket("**/*", (socket) => { if (blocked.length < 100) blocked.push("websocket blocked"); socket.close(); });
    await context.route("**/*", async (route) => {
      try {
        signal.throwIfAborted(); const request = route.request(), url = new URL(request.url());
        if (url.origin !== origin || request.method() !== "GET" || url.username || url.password || /%(?:2f|5c|2e)/i.test(url.pathname)) {
          if (blocked.length < 100) blocked.push(`${url.protocol}//${url.host}${url.pathname}`.slice(0, 300)); await route.abort(); return;
        }
        const name = resourceName(url), file = access.artifact.files.find((file) => file.path === name);
        if (!file) { if (errors.length < 100) errors.push(`Missing packaged resource: ${name}`); await route.fulfill({ status: 404, body: "Not in this game build" }); return; }
        // The same authenticated listener verifies original bytes and negotiates
        // their wire encoding for pages, WASM and AudioWorklets. Fulfilling here
        // bypassed HTTP compression (and realistic network measurements).
        await route.continue();
      } catch { await route.abort().catch(() => {}); }
    });
    await context.addInitScript(() => {
      // Block UDP channels and device APIs; HTTP resources are brokered from exact build blobs.
      for (const name of ["RTCPeerConnection", "webkitRTCPeerConnection"]) Object.defineProperty(globalThis, name,
        { configurable: false, writable: false, value: function () { throw new Error("Peer networking is not available in game validation."); } });
      for (const name of ["showOpenFilePicker", "showSaveFilePicker", "showDirectoryPicker"]) Object.defineProperty(globalThis, name,
        { configurable: false, writable: false, value: async function () { throw new Error("Host file access is not available in game validation."); } });
      if (typeof MediaDevices !== "undefined") for (const name of ["getUserMedia", "getDisplayMedia"]) Object.defineProperty(MediaDevices.prototype, name,
        { configurable: false, writable: false, value: async function () { throw new Error("Microphone, camera and screen capture are not available in game validation."); } });
    });
    const page = await context.newPage();
    context.on("page", (popup) => { if (popup !== page) { if (blocked.length < 100) blocked.push("popup blocked"); void popup.close(); } });
    page.on("console", (message) => { if (message.type() === "error" && errors.length < 100) errors.push(message.text().slice(0, 1000)); });
    page.on("pageerror", (error) => { if (errors.length < 100) errors.push(error.message.slice(0, 1000)); });
    page.on("dialog", (dialog) => { void dialog.dismiss(); });
    // Trusted host instrumentation only, never a recipe/RPC callback. All
    // resource/device/popup guards are already active; navigation stays bounded.
    await beforeNavigation?.(page);
    signal.throwIfAborted();
    await page.goto(`${origin}/${access.artifact.entrypoint}`, { waitUntil: "load", timeout: 5000 });
    return { context, page };
  } catch (error) { await context.close(); throw error; }
}
