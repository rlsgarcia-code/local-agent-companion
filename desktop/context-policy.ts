import { normalizeBrowserUrl, normalizeLocalBrowserUrl } from "../src/browser-policy";

export type DesktopContextTarget = {
  kind: "local" | "web" | "search";
  url: string;
  initialTitle: string;
};

const LOOPBACK_INPUT = /^(?:https?:\/\/)?(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[?::1\]?)(?::\d+)?(?:[/?#].*)?$/i;
const DOMAIN_INPUT = /^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?\.[a-z]{2,63}(?::\d+)?(?:[/?#].*)?$/i;

export function resolveDesktopContextTarget(value: string): DesktopContextTarget {
  const input = value.trim();
  if (!input || input.length > 2_048 || /[\r\n\0]/.test(input)) {
    throw new Error("Informe uma URL, localhost ou pesquisa em uma única linha.");
  }
  if (LOOPBACK_INPUT.test(input)) {
    const url = normalizeLocalBrowserUrl(input);
    return { kind: "local", url, initialTitle: new URL(url).host };
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(input) || DOMAIN_INPUT.test(input)) {
    const url = normalizeBrowserUrl(input, true);
    return { kind: "web", url, initialTitle: new URL(url).hostname };
  }
  if (input.length > 500) throw new Error("A pesquisa deve ter no máximo 500 caracteres.");
  return {
    kind: "search",
    url: `https://duckduckgo.com/?q=${encodeURIComponent(input)}`,
    initialTitle: `Busca: ${input.slice(0, 80)}`
  };
}

export function isLoopbackContextUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return ["localhost", "127.0.0.1", "0.0.0.0", "[::1]", "[::]"].includes(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}
