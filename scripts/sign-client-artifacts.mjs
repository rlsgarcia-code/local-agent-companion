import { createReadStream } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { createHash, sign } from "node:crypto";
import * as path from "node:path";

const target = process.argv[2];
if (!["darwin-arm64", "darwin-x64"].includes(target)) throw new Error("Select an exact Mac target.");
const key = process.env.COMPANION_RELEASE_SIGNING_KEY, commit = process.env.GITHUB_SHA;
if (!key || !/^[a-f0-9]{40}$/.test(commit || "")) throw new Error("Signing requires the publication key and exact build commit.");
const version = JSON.parse(await readFile("package.json", "utf8")).version;
const versions = JSON.parse(await readFile("packages/contracts/src/version.json", "utf8"));
const directory = path.resolve("release/desktop"), files = {};
for (const extension of ["zip", "dmg"]) {
  const name = `Local-Companion-${version}-${target.split("-")[1]}.${extension}`;
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(path.join(directory, name))) digest.update(chunk);
  files[name] = digest.digest("hex");
}
const manifest = Buffer.from(JSON.stringify({ schema: 1, kind: "companion-mac", version,
  engine: versions.engine, protocol: versions.protocol, node: versions.node, commit, target,
  appleSigning: "not-distribution-signed-or-notarized", files }, null, 2) + "\n");
const name = path.join(directory, `Local-Companion-${version}-${target}.manifest`);
await writeFile(`${name}.json`, manifest);
await writeFile(`${name}.sig`, sign(null, manifest, key));
