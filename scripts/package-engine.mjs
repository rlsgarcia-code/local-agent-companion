import { createHash, sign } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import * as path from "node:path";

const directory = path.resolve("engine-dist"),
  manifest = JSON.parse(
    await readFile(path.join(directory, "manifest.json"), "utf8"),
  );
const signingKey = process.env.COMPANION_RELEASE_SIGNING_KEY;
if (!signingKey)
  throw new Error(
    "A release requires the Companion Ed25519 publishing key; unsigned builds remain development artifacts.",
  );
delete manifest.development;
manifest.commit =
  process.env.GITHUB_SHA ||
  execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const bytes = Buffer.from(JSON.stringify(manifest, null, 2) + "\n");
await writeFile(path.join(directory, "manifest.json"), bytes);
await writeFile(
  path.join(directory, "manifest.sig"),
  sign(null, bytes, signingKey),
);
await mkdir("release/engine", { recursive: true });
const file = path.resolve(
  "release/engine",
  `companion-engine-${manifest.version}-${manifest.target}.tar.gz`,
);
execFileSync(
  "tar",
  ["-czf", file, "-C", path.dirname(directory), path.basename(directory)],
  { stdio: "inherit" },
);
const hash = createHash("sha256")
  .update(await readFile(file))
  .digest("hex");
await writeFile(`${file}.sha256`, `${hash}  ${path.basename(file)}\n`);
console.log(`SIGNED_ENGINE_READY ${file}`);
