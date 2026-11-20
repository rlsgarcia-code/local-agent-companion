import { randomBytes,createHash } from "node:crypto";
import { createServer, type ServerResponse } from "node:http";
import { gameFilePath } from "../../contracts/src/games";
import type { GameArtifact } from "../../contracts/src/game-production";
import { artifactEncoder } from "./encoding";

/** Private immutable resources may also describe an installed model viewer.
 * This projection is not a production artifact, build receipt or QA claim. */
export type PinnedBrowserResources=Pick<GameArtifact,"engine"|"entrypoint">&{
  files:readonly Omit<GameArtifact["files"][number],"transferId">[];
};

export const gameBrowserPolicy = "sandbox allow-scripts allow-same-origin allow-pointer-lock; default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self'; connect-src 'self'; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
export function artifactPolicy(artifact: PinnedBrowserResources): string {
  // AudioWorklet modules use script-src; web exports need WebAssembly but no
  // arbitrary inline scripts, unsafe-eval, workers, PWA or external origins.
  return (artifact.engine === "godot" || artifact.engine === "unity") ? gameBrowserPolicy.replace("script-src 'self'", "script-src 'self' 'wasm-unsafe-eval'") : gameBrowserPolicy;
}
export function resourceName(url: URL): string {
  if (url.username || url.password || /%(?:2f|5c|2e)/i.test(url.pathname)) throw new Error("Invalid artifact URL");
  return gameFilePath.parse(decodeURIComponent(url.pathname.slice(1)));
}
export function artifactHeaders(artifact: PinnedBrowserResources, mime: string): Record<string, string> {
  return { "Content-Type": mime, "Content-Security-Policy": artifactPolicy(artifact), "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store", "Cross-Origin-Resource-Policy": "same-origin", "Referrer-Policy": "no-referrer", "Permissions-Policy": "camera=(), microphone=(), display-capture=(), geolocation=()" };
}
export async function verifiedArtifactResource(artifact:PinnedBrowserResources,readFile:(name:string)=>Promise<Uint8Array>,name:string):Promise<Buffer>{
  const file=artifact.files.find((file)=>file.path===name);if(!file)throw new Error("Resource is not part of the pinned build.");
  const data=Buffer.from(await readFile(name));if(data.byteLength!==file.size||createHash("sha256").update(data).digest("hex")!==file.sha256)throw new Error("Resource bytes differ from the pinned build hash.");return data;
}

/** Private disposable artifact transport, not Agent API. Worklets bypass Playwright
 * routing, so serve only this build on a random loopback port, with a fresh HttpOnly
 * capability. No file paths, RPC, mutation, credentials, directory listing or proxy. */
export async function serveArtifactResources(options: { artifact: PinnedBrowserResources; readFile(path: string): Promise<Uint8Array>; signal: AbortSignal }) {
  const token = randomBytes(32).toString("hex"), cookieName = `companion-game-${randomBytes(8).toString("hex")}`;
  const encoder = artifactEncoder();
  const active = new Set<ServerResponse>(); let origin = "", closed = false;
  const server = createServer((request, response) => {
    void (async () => {
      if (closed || options.signal.aborted || active.size >= 16 || request.headers.host !== new URL(origin).host || request.method !== "GET" ||
          !request.headers.cookie?.split(/;\s*/).includes(`${cookieName}=${token}`) ||
          (request.headers.origin && request.headers.origin !== origin)) { response.writeHead(403); response.end(); return; }
      const url = new URL(request.url ?? "/", origin), name = resourceName(url);
      if (url.origin !== origin) { response.writeHead(403); response.end(); return; }
      const file = options.artifact.files.find((item) => item.path === name);
      if (!file) { response.writeHead(404); response.end(); return; }
      active.add(response); response.once("close", () => active.delete(response));
      const data = await verifiedArtifactResource(options.artifact,options.readFile,name);
      if (closed || options.signal.aborted) { response.destroy(); return; }
      const encoded = await encoder.encode(data, file.mime, file.sha256, request.headers["accept-encoding"]);
      if (closed || options.signal.aborted || response.destroyed) { response.destroy(); return; }
      if (!encoded) { response.writeHead(406, { ...artifactHeaders(options.artifact, file.mime), Vary: "Accept-Encoding" }); response.end(); return; }
      response.writeHead(200, { ...artifactHeaders(options.artifact, file.mime), Vary: "Accept-Encoding",
        "Content-Length": encoded.data.byteLength, ...(encoded.gzip ? { "Content-Encoding": "gzip" } : {}) }); response.end(encoded.data);
    })().catch(() => { if (!response.headersSent) response.writeHead(400); response.end(); });
  });
  server.requestTimeout = 10000; server.headersTimeout = 10000; server.keepAliveTimeout = 1000; server.maxConnections = 32;
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", () => { server.removeListener("error", reject); resolve(); }); });
  const address = server.address(); if (!address || typeof address === "string") throw new Error("The artifact resource listener did not bind loopback");
  origin = `http://127.0.0.1:${address.port}`;
  let closing: Promise<void> | undefined;
  const close = () => closing ??= (async () => {
    closed = true; for (const response of active) response.destroy(); server.closeAllConnections();
    await Promise.all([encoder.close(), new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))]);
  })();
  const stop = () => { void close().catch(() => {}); };
  options.signal.addEventListener("abort", stop, { once: true });
  if (options.signal.aborted) { await close(); options.signal.throwIfAborted(); }
  return { origin, cookie: { name: cookieName, value: token, url: origin, httpOnly: true, sameSite: "Strict" as const },
    async close() { options.signal.removeEventListener("abort", stop); await close(); } };
}
