import type { LaunchOptions } from "playwright-core";

export type LocalBrowserChannel = "auto" | "msedge" | "chrome";

export function normalizeBrowserUrl(value: string, allowExternal: boolean): string {
  if (!allowExternal) return normalizeLocalBrowserUrl(value);
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 2_048 || /[\r\n\0]/.test(trimmed)) throw new Error("Browser URL must be a bounded single-line URL.");
  let url: URL;
  try { url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`); }
  catch { throw new Error("Enter a valid HTTPS URL."); }
  if (url.protocol !== "https:" || url.username || url.password || isPrivateHost(url.hostname)) {
    throw new Error("External browser access requires a credential-free HTTPS URL on a public host.");
  }
  return url.toString();
}

export function normalizeLocalBrowserUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 2_048 || /[\r\n\0]/.test(trimmed)) {
    throw new Error("Browser URL must be a bounded single-line localhost URL.");
  }
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error("Enter a valid localhost URL, for example http://localhost:3000.");
  }
  if (!isHttpLoopbackUrl(url) || url.username || url.password) {
    throw new Error("Browser access is restricted to credential-free http(s) loopback URLs.");
  }
  if (url.hostname === "0.0.0.0") url.hostname = "127.0.0.1";
  if (url.hostname === "[::]") url.hostname = "[::1]";
  return url.toString();
}

export function isAllowedLocalBrowserResource(value: string): boolean {
  if (value === "about:blank" || value.startsWith("data:")) return true;
  if (value.startsWith("blob:")) return isAllowedLocalBrowserResource(value.slice("blob:".length));
  try {
    const url = new URL(value);
    return ["http:", "https:", "ws:", "wss:"].includes(url.protocol)
      && isLoopbackHostname(url.hostname)
      && !url.username
      && !url.password;
  } catch {
    return false;
  }
}

export function isAllowedBrowserResource(value: string, allowExternal: boolean, approvedHosts: ReadonlySet<string>): boolean {
  if (value === "about:blank" || value.startsWith("data:")) return true;
  if (value.startsWith("blob:")) return isAllowedBrowserResource(value.slice(5), allowExternal, approvedHosts);
  try {
    const url = new URL(value);
    if (!url.username && !url.password && ["http:", "https:", "ws:", "wss:"].includes(url.protocol)) {
      if (isLoopbackHostname(url.hostname)) return true;
      return allowExternal && url.protocol === "https:" && approvedHosts.has(url.hostname.toLowerCase());
    }
  } catch { return false; }
  return false;
}

export function browserLaunchAttempts(
  channel: LocalBrowserChannel,
  executablePath?: string,
  platform = process.platform
): Array<{ label: string; options: LaunchOptions }> {
  const explicit = executablePath?.trim();
  if (explicit) return [{ label: "configured Chromium browser", options: { executablePath: explicit } }];
  const channels = channel === "auto"
    ? platform === "win32" ? ["msedge", "chrome"] as const : ["chrome", "msedge"] as const
    : [channel];
  return channels.map((candidate) => ({
    label: candidate === "msedge" ? "Microsoft Edge" : "Google Chrome",
    options: { channel: candidate }
  }));
}

function isHttpLoopbackUrl(url: URL): boolean {
  return (url.protocol === "http:" || url.protocol === "https:") && isLoopbackHostname(url.hostname);
}

function isLoopbackHostname(hostname: string): boolean {
  return ["localhost", "127.0.0.1", "[::1]", "0.0.0.0", "[::]"].includes(hostname.toLowerCase());
}

function isPrivateHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  if (isLoopbackHostname(normalized) || normalized.endsWith(".local") || normalized.endsWith(".internal")) return true;
  if (/^(10|127)\./.test(normalized) || /^192\.168\./.test(normalized)) return true;
  const match = /^172\.(\d+)\./.exec(normalized);
  return Boolean(match && Number(match[1]) >= 16 && Number(match[1]) <= 31);
}
