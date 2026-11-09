import * as path from "node:path";

const PRIVATE_KEY_EXTENSIONS = new Set([
  ".key", ".pem", ".p12", ".pfx", ".jks", ".keystore", ".kdbx"
]);
const SENSITIVE_BASENAMES = new Set([
  ".npmrc", ".pypirc", ".netrc", "_netrc", ".git-credentials",
  "id_rsa", "id_dsa", "id_ecdsa", "id_ed25519",
  "credentials.json", "application_default_credentials.json",
  "kubeconfig", "secrets.json", "secrets.yaml", "secrets.yml", "secrets.toml"
]);
const SAFE_ENV_TEMPLATES = new Set([
  ".env.example", ".env.sample", ".env.template", ".env.defaults"
]);

/** Returns true for workspace files that commonly contain live credentials. */
export function isSensitiveWorkspacePath(value: string): boolean {
  const normalized = value.replaceAll("\\", "/").replace(/^\/+/, "").toLowerCase();
  const segments = normalized.split("/").filter(Boolean);
  const basename = segments.at(-1) ?? "";
  const extension = path.posix.extname(basename);

  if ((basename === ".env" || basename.startsWith(".env.")) && !SAFE_ENV_TEMPLATES.has(basename)) {
    return true;
  }
  if (PRIVATE_KEY_EXTENSIONS.has(extension) || SENSITIVE_BASENAMES.has(basename)) return true;
  if (basename.endsWith(".tfvars") || basename.endsWith(".tfvars.json")) return true;
  if (/^(?:service[-_]?account|serviceaccount).+\.json$/.test(basename)) return true;
  if (basename === "credentials" && segments.includes(".aws")) return true;
  if (basename === "config.json" && segments.includes(".docker")) return true;
  if (basename === "auth.json" && segments.some((segment) => segment === ".composer" || segment === "composer")) {
    return true;
  }
  return false;
}
