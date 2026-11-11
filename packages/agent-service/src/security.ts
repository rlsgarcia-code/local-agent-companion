import "reflect-metadata";
import { X509CertificateGenerator } from "@peculiar/x509";
import {
  createHash,
  randomBytes,
  timingSafeEqual,
  webcrypto,
  X509Certificate,
} from "node:crypto";
import { chmod, lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir, tmpdir, userInfo } from "node:os";
import * as path from "node:path";
import {
  AgentError,
  errors,
  toolSpec,
  type ClientCredential,
  type Registration,
} from "../../contracts/src/index";

export function defaultStateDirectory(): string {
  return process.platform === "win32"
    ? path.join(process.env.LOCALAPPDATA || homedir(), "Companion", "engine")
    : path.join(homedir(), ".local", "state", "companion-engine");
}
export function ipcPath(directory: string): string {
  const hash = createHash("sha256")
    .update(path.resolve(directory))
    .digest("hex")
    .slice(0, 24);
  return process.platform === "win32"
    ? `\\\\.\\pipe\\companion-${hash}`
    : path.join(
        directory.length < 65
          ? directory
          : path.join(
              tmpdir(),
              `companion-${process.getuid?.() ?? "user"}-${hash}`,
            ),
        "agent.sock",
      );
}
export async function privateDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await lstat(directory);
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    (process.getuid && info.uid !== process.getuid())
  )
    throw new Error("Unsafe engine state directory.");
  if (process.platform !== "win32") await chmod(directory, 0o700);
}
export async function privateWrite(
  file: string,
  value: string | Buffer,
): Promise<void> {
  await writeFile(file, value, { mode: 0o600, flag: "wx" });
}
export async function ensureIdentity(
  directory: string,
): Promise<{ key: string; cert: string; fingerprint: string }> {
  await privateDirectory(directory);
  const keyPath = path.join(directory, "server.key"),
    certPath = path.join(directory, "server.crt");
  try {
    const [key, cert] = await Promise.all([
      readFile(keyPath, "utf8"),
      readFile(certPath, "utf8"),
    ]);
    return { key, cert, fingerprint: new X509Certificate(cert).fingerprint256 };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const keys = await webcrypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const cert = await X509CertificateGenerator.createSelfSigned(
    {
      serialNumber: randomBytes(16).toString("hex"),
      name: "CN=Companion Local Engine",
      notBefore: new Date(Date.now() - 60_000),
      notAfter: new Date(Date.now() + 10 * 365 * 86400_000),
      signingAlgorithm: { name: "ECDSA", hash: "SHA-256" },
      keys,
    },
    webcrypto as unknown as Crypto,
  );
  const der = Buffer.from(
    await webcrypto.subtle.exportKey("pkcs8", keys.privateKey),
  );
  const key = `-----BEGIN PRIVATE KEY-----\n${der
    .toString("base64")
    .match(/.{1,64}/g)!
    .join("\n")}\n-----END PRIVATE KEY-----\n`;
  const pem = cert.toString("pem");
  await privateWrite(keyPath, key);
  await privateWrite(certPath, pem);
  return {
    key,
    cert: pem,
    fingerprint: new X509Certificate(pem).fingerprint256,
  };
}
export function tokenDigest(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
export function tokenMatches(token: string, digest: string): boolean {
  const left = Buffer.from(tokenDigest(token), "hex"),
    right = Buffer.from(digest, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}
export function namespace(registration: Registration): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        process.getuid?.() ?? userInfo().username,
        registration.product,
        registration.profile,
        registration.workspace,
      ]),
    )
    .digest("hex");
}
/** Bootstrap is a filesystem operation by the installer, never an unauthenticated RPC. */
export function validateProductRegistration(registration: Registration): void {
  if (
    !registration ||
    !["companion-mac", "companion-vscode", "kidos"].includes(
      registration.product,
    ) ||
    typeof registration.id !== "string" ||
    !/^[a-zA-Z0-9_.:-]{1,128}$/.test(registration.id) ||
    typeof registration.profile !== "string" ||
    !registration.profile ||
    registration.profile.length > 128 ||
    typeof registration.workspace !== "string" ||
    registration.workspace.includes("\0") ||
    !Array.isArray(registration.providers) ||
    !registration.providers.every((provider) =>
      ["ollama", "litellm", "openai", "kidos-gateway"].includes(provider),
    ) ||
    !Array.isArray(registration.hostTools) ||
    registration.hostTools.length > 200 ||
    !registration.hostTools.every(
      (name) =>
        typeof name === "string" && /^[a-zA-Z0-9_.:-]{1,128}$/.test(name),
    )
  )
    throw new AgentError(errors.forbidden, "Invalid product registration.");
  if (registration.toolCatalog) {
    const catalog = registration.toolCatalog.map((entry) => toolSpec.parse(entry));
    if (catalog.length > 200 || new Set(catalog.map((entry) => entry.name)).size !== catalog.length ||
      catalog.some((entry) => !registration.hostTools.includes(entry.name)))
      throw new AgentError(errors.forbidden, "Invalid installed adapter catalog.");
  }
  if (
    registration.product === "companion-mac" &&
    registration.providers.some((p) => p !== "ollama" && p !== "openai")
  )
    throw new AgentError(
      errors.forbidden,
      "The Mac product permits only Ollama and the fixed OpenAI provider.",
    );
  if (
    registration.product === "kidos" &&
    (registration.providers.some((p) => p !== "kidos-gateway") ||
      registration.hostTools.some((t) => !t.startsWith("kidos_")))
  )
    throw new AgentError(
      errors.forbidden,
      "KidOS requires its protected gateway and Core adapter.",
    );
  if (
    registration.product === "companion-vscode" &&
    registration.providers.includes("ollama") &&
    registration.providers.includes("openai")
  )
    throw new AgentError(
      errors.forbidden,
      "A VSIX cannot enable both optional providers.",
    );
}

export async function createClientCredential(
  directory: string,
  registration: Registration,
): Promise<ClientCredential> {
  validateProductRegistration(registration);
  await privateDirectory(directory);
  return { registration, token: randomBytes(32).toString("base64url") };
}
