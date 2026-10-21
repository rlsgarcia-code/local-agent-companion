import { Agent as UndiciAgent, fetch as undiciFetch } from "undici";

const GATEWAY_CALL_INTERVAL_MS = 400;
const GATEWAY_429_BACKOFF_MS = 1_200;
type GatewayPacingState = { nextAt: number; tail: Promise<void> };
const gatewayPacing = new Map<string, GatewayPacingState>();

function delayWithSignal(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (milliseconds <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error("The provider request was cancelled."));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(signal?.reason ?? new Error("The provider request was cancelled."));
    };
    const done = () => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    };
    const timer = setTimeout(done, milliseconds);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function waitForGatewaySlot(allowedUrl: string, signal?: AbortSignal): Promise<void> {
  let state = gatewayPacing.get(allowedUrl);
  if (!state) {
    state = { nextAt: 0, tail: Promise.resolve() };
    gatewayPacing.set(allowedUrl, state);
  }
  let release!: () => void;
  const previous = state.tail;
  state.tail = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try {
    await delayWithSignal(Math.max(0, state.nextAt - Date.now()), signal);
    state.nextAt = Date.now() + GATEWAY_CALL_INTERVAL_MS;
  } finally {
    release();
  }
}

function recordGatewayResponse(allowedUrl: string, status: number): void {
  const state = gatewayPacing.get(allowedUrl);
  if (state && status === 429) {
    state.nextAt = Math.max(state.nextAt, Date.now() + GATEWAY_429_BACKOFF_MS);
  }
}

export type GatewayTransport = (
  input: RequestInfo | URL,
  init?: RequestInit & { dispatcher?: UndiciAgent }
) => Promise<Response>;

export function combinedAbortSignal(
  requestSignal?: AbortSignal | null,
  runSignal?: AbortSignal
): AbortSignal | undefined {
  const signals = [requestSignal, runSignal]
    .filter((signal): signal is AbortSignal => Boolean(signal));
  if (!signals.length) return undefined;
  if (signals.length === 1 || signals[0] === signals[1]) return signals[0];
  return AbortSignal.any(signals);
}

export function gatewayFetch(
  allowedUrl: string,
  stripAuthorization: boolean,
  dispatcher: UndiciAgent | undefined,
  runSignal?: AbortSignal,
  transport: GatewayTransport = undiciFetch as unknown as GatewayTransport,
  allowedMethods: readonly string[] = ["POST"]
): typeof globalThis.fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (allowedMethods.length === 1 && allowedMethods[0] === "POST") {
      validateGatewayRequest(input, init, allowedUrl);
    } else {
      validateGatewayRequest(input, init, allowedUrl, allowedMethods);
    }
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined)
    );
    const requestSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    const signal = combinedAbortSignal(requestSignal, runSignal);
    await waitForGatewaySlot(allowedUrl, signal);
    if (stripAuthorization) headers.delete("authorization");
    const response = await transport(input, {
      ...init,
      headers,
      redirect: "manual",
      ...(signal ? { signal } : {}),
      ...(dispatcher ? { dispatcher } : {})
    });
    if (response.status >= 300 && response.status < 400) {
      throw new Error("The configured model route returned a redirect. Configure its final URL; redirects are disabled.");
    }
    recordGatewayResponse(allowedUrl, response.status);
    return response;
  }) as typeof globalThis.fetch;
}

export function validateGatewayRequest(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  allowedUrl: string,
  allowedMethods: readonly string[] = ["POST"]
): void {
  const target = new URL(input instanceof Request ? input.url : input.toString());
  const allowed = new URL(allowedUrl);
  const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
  const allowedProtocol = allowed.protocol === "https:"
    || (allowed.protocol === "http:" && loopbackHosts.has(allowed.hostname));
  if (
    !allowedProtocol ||
    target.protocol !== allowed.protocol ||
    target.username ||
    target.password ||
    target.search ||
    target.hash ||
    target.href !== allowed.href
  ) {
    throw new Error("Blocked a provider request outside the exact configured model route.");
  }
  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  if (!allowedMethods.includes(method)) {
    if (allowedMethods.length === 1 && allowedMethods[0] === "POST") {
      throw new Error("Blocked a non-POST request to the configured model route.");
    }
    throw new Error(`Blocked a ${method} request to the configured model route.`);
  }
}
