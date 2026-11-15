import type { CDPSession, Page } from "playwright-core";

/** Diagnostic request conditions, not measured physical RTT or quality evidence.
 * No client/recipe chooses values and navigator state is never falsified. */
export const coldNetworkProfile = Object.freeze({ megabitsPerSecond: 20, bytesPerSecond: 2_500_000,
  minimumRequestLatencyMs: 100, browserCacheDisabled: true, serviceWorkerBypass: true });
type Request = { id: string; file: string | null; type?: string; started?: number; finished?: number; status?: number;
  encodedBytes?: number; contentEncoding?: string; fromDiskCache?: boolean; fromServiceWorker?: boolean;
  servedFromCache?: boolean; appliedRuleId?: string; failed?: boolean };

/** Native protocol observations only. Never stores cookies/headers, bodies,
 * query strings, unregistered URL paths, source code or model/host state. */
export async function prepareColdNetworkMeasurement(page: Page, origin: string, files: readonly { path: string }[]) {
  const allowed = new Set(files.map(file => file.path));
  const session: CDPSession = await page.context().newCDPSession(page);
  const requests = new Map<string, Request>();let overflow = false, active = true;
  const entry = (id: string) => {
    if (!active) return;
    const old = requests.get(id);if (old) return old;
    if (requests.size >= 24000) { overflow = true;return; }
    const row: Request = { id, file: null };requests.set(id, row);return row;
  };
  const request = (event: { requestId: string; timestamp: number; type?: string; request: { url: string } }) => {
    const row = entry(event.requestId);if (!row) return;
    let file: string | null = null;
    try { const url = new URL(event.request.url), name = decodeURIComponent(url.pathname.slice(1));if (url.origin === origin && allowed.has(name)) file = name; } catch { /* Unregistered paths are never persisted. */ }
    Object.assign(row, { file, started: event.timestamp, type: event.type?.slice(0, 100) });
  };
  const extra = (event: { requestId: string; appliedNetworkConditionsId?: string }) => {
    const row = entry(event.requestId);if (row && event.appliedNetworkConditionsId) row.appliedRuleId = event.appliedNetworkConditionsId.slice(0, 128);
  };
  const response = (event: { requestId: string; response: { status: number; fromDiskCache?: boolean; fromServiceWorker?: boolean; headers: { [key: string]: string } } }) => {
    const row = entry(event.requestId);if (!row) return;
    const encoding = Object.entries(event.response.headers).find(([name]) => name.toLowerCase() === "content-encoding")?.[1];
    Object.assign(row, { status: event.response.status, fromDiskCache: Boolean(event.response.fromDiskCache), fromServiceWorker: Boolean(event.response.fromServiceWorker), ...(encoding ? { contentEncoding: encoding.slice(0, 32) } : {}) });
  };
  const cached = (event: { requestId: string }) => { const row = entry(event.requestId);if (row) row.servedFromCache = true; };
  const finished = (event: { requestId: string; timestamp: number; encodedDataLength: number }) => { const row = entry(event.requestId);if (row) Object.assign(row, { finished: event.timestamp, encodedBytes: event.encodedDataLength }); };
  const failed = (event: { requestId: string; timestamp: number }) => { const row = entry(event.requestId);if (row) Object.assign(row, { finished: event.timestamp, failed: true }); };
  session.on("Network.requestWillBeSent", request);session.on("Network.requestWillBeSentExtraInfo", extra);
  session.on("Network.responseReceived", response);session.on("Network.requestServedFromCache", cached);
  session.on("Network.loadingFinished", finished);session.on("Network.loadingFailed", failed);
  try {
    await session.send("Network.enable");
    await session.send("Network.clearBrowserCache");
    await session.send("Network.setCacheDisabled", { cacheDisabled: true });
    await session.send("Network.setBypassServiceWorker", { bypass: true });
    // No deprecated/less restricted fallback if this protocol is unavailable.
    const rules = await session.send("Network.emulateNetworkConditionsByRule", { offline: false,
      matchedNetworkConditions: [{ urlPattern: "", latency: coldNetworkProfile.minimumRequestLatencyMs,
        downloadThroughput: coldNetworkProfile.bytesPerSecond, uploadThroughput: coldNetworkProfile.bytesPerSecond }] });
    if (rules.ruleIds.length !== 1) throw new Error("The browser did not acknowledge the exact network condition rule.");
    return {
      profile: coldNetworkProfile, ruleId: rules.ruleIds[0]!, session,
      snapshot() {
        if (overflow) throw new Error("Network measurement exceeded 24,000 requests; the diagnostic is incomplete.");
        return { profile: coldNetworkProfile, ruleId: rules.ruleIds[0]!, requests: [...requests.values()].map(row => ({ ...row,
          ...(row.started !== undefined && row.finished !== undefined ? { durationMs: (row.finished - row.started) * 1000 } : {}) })) };
      },
      async close() {
        active = false;session.off("Network.requestWillBeSent", request);session.off("Network.requestWillBeSentExtraInfo", extra);
        session.off("Network.responseReceived", response);session.off("Network.requestServedFromCache", cached);
        session.off("Network.loadingFinished", finished);session.off("Network.loadingFailed", failed);
        await session.detach().catch(() => {});
      },
    };
  } catch (error) { active = false;await session.detach().catch(() => {});throw error; }
}
