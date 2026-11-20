import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { realpath, stat, readdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as path from "node:path";
import { contentHash } from "../../contracts/src/identity";

export type QualifiedBrowser = { executablePath: string; version: string; sha256: string; components: { path: string; sha256: string }[] };
export async function browserDigest(file: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}
export async function qualifyBrowser(explicit?: string, platform: NodeJS.Platform = process.platform): Promise<QualifiedBrowser | null> {
  const candidates = explicit ? [explicit] : platform === "darwin"
    ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"]
    : platform === "win32" ? [path.join(process.env.PROGRAMFILES ?? "C:\\Program Files", "Google/Chrome/Application/chrome.exe"), path.join(process.env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)", "Microsoft/Edge/Application/msedge.exe")]
    : ["/opt/google/chrome/chrome", "/usr/bin/google-chrome-stable", "/usr/bin/google-chrome", "/usr/bin/microsoft-edge"];
  for (const candidate of candidates) {
    try {
      const executablePath = await realpath(candidate);
      if (!(await stat(executablePath)).isFile()) continue;
      // Chrome on Windows may open the personal browser instead of printing a
      // version. Inspect its installed version directory; only an explicitly
      // requested disposable launch later verifies the running version.
      const version = platform === "win32" ? await windowsInstalledVersion(executablePath)
        : (await promisify(execFile)(executablePath, ["--version"], { timeout: 5000, maxBuffer: 4096, windowsHide: true })).stdout.trim();
      if (!/^(?:Google Chrome|Microsoft Edge|Chromium)\s[\d.]+/.test(version)) continue;
      const components = [{ path: executablePath, sha256: await browserDigest(executablePath) }];
      const number = /\d+(?:\.\d+)+/.exec(version)![0];
      const framework = version.startsWith("Microsoft Edge") ? "Microsoft Edge Framework" : "Google Chrome Framework";
      const companion = platform === "darwin" ? path.join(path.dirname(path.dirname(executablePath)), "Frameworks", `${framework}.framework`, "Versions", number, framework)
        : platform === "win32" ? path.join(path.dirname(executablePath), number, version.startsWith("Microsoft Edge") ? "msedge.dll" : "chrome.dll")
        : path.join(path.dirname(executablePath), "chrome");
      if (companion !== executablePath) {
        try { if ((await stat(companion)).isFile()) components.push({ path: companion, sha256: await browserDigest(companion) }); }
        catch { if (platform === "darwin") continue; }
      }
      return { executablePath, version, components, sha256: contentHash(components.map((file) => ({ name: path.basename(file.path), sha256: file.sha256 }))) };
    } catch { /* An absent/unsupported browser remains explicitly unavailable. */ }
  }
  return null;
}
async function windowsInstalledVersion(executablePath: string): Promise<string> {
  const edge = path.basename(executablePath).toLowerCase() === "msedge.exe";
  const versions = (await readdir(path.dirname(executablePath), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && /^\d+(?:\.\d+){3}$/.test(entry.name)).map((entry) => entry.name)
    .sort((a, b) => {
      const av = a.split(".").map(Number), bv = b.split(".").map(Number);
      for (let i = 0; i < 4; i++) if (av[i] !== bv[i]) return bv[i]! - av[i]!;
      return 0;
    });
  for (const version of versions) {
    try {
      if ((await stat(path.join(path.dirname(executablePath), version, edge ? "msedge.dll" : "chrome.dll"))).isFile())
        return `${edge ? "Microsoft Edge" : "Google Chrome"} ${version}`;
    } catch { /* Incomplete updates are not qualified. */ }
  }
  throw new Error("The browser version directory is unavailable.");
}
