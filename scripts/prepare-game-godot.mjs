// Administrative, offline provisioning. This is never called by the inference service.
// Inputs must be downloaded explicitly from the official release first.
import { createHash } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { chmod, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argument = (name, fallback) => { const index = process.argv.indexOf(name); return index < 0 ? fallback : process.argv[index + 1]; };
const inputs = path.resolve(argument("--inputs", path.join(root, ".cache/game-editor-inputs")));
const destination = path.resolve(argument("--output", path.join(root, ".cache/game-toolchains/godot.json")));
const docker = argument("--docker", process.platform === "darwin" ? "/usr/local/bin/docker" : "/usr/bin/docker");
const lock = JSON.parse(await readFile(path.join(root, "packages/adapter-game-godot/toolchain.lock.json"), "utf8"));
const local = (host) => /^(?:unix:\/\/\/|npipe:\/\/)/.test(host);
if (process.env.DOCKER_HOST && !local(process.env.DOCKER_HOST)) throw new Error("Only a local Docker IPC endpoint may provision game toolchains");
const [dockerContext] = JSON.parse(execFileSync(docker, ["context", "inspect"], { encoding: "utf8" }));
if (!local(dockerContext.Endpoints?.docker?.Host ?? "")) throw new Error("Docker must use a local IPC endpoint");
const editor = lock.editors[process.arch];
if (!editor) throw new Error("No pinned Godot editor for this architecture.");
const hash = (data) => createHash("sha256").update(data).digest("hex");
const canonical = (value) => JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]])) : item);
async function verify(file, expected) {
  const digest = createHash("sha256"); for await (const chunk of createReadStream(file)) digest.update(chunk);
  if (digest.digest("hex") !== expected) throw new Error(`Toolchain integrity mismatch: ${path.basename(file)}`);
}
await verify(path.join(inputs, editor.asset), editor.sha256);
await verify(path.join(inputs, lock.templates.asset), lock.templates.sha256);
for (const [name, sha] of Object.entries(lock.licenses)) await verify(path.join(inputs, `GODOT-${name}`), sha);
const driver = await readFile(path.join(root, "packages/adapter-game-godot/image/build.mjs"));
const recipeSha256 = hash(canonical({ lock, architecture: process.arch, driverSha256: hash(driver), imagePolicy: 1 }));
const context = path.join(inputs, `image-${recipeSha256}`);
await mkdir(context, { recursive: true, mode: 0o700 });
async function extract(archive, entry, output, limit) {
  const child = spawn("/usr/bin/unzip", ["-p", path.join(inputs, archive), entry], { stdio: ["ignore", "pipe", "inherit"] });
  const done = new Promise((resolve, reject) => { child.once("error", reject); child.once("close", (code) => code === 0 ? resolve() : reject(new Error("Pinned ZIP entry extraction failed"))); });
  let size = 0;
  try {
    await pipeline(child.stdout, new Transform({ transform(data, _encoding, callback) { size += data.length; callback(size > limit ? new Error("ZIP entry exceeds its extraction limit") : null, data); } }), createWriteStream(path.join(context, output), { mode: 0o600 }));
    await done;
  } catch (error) { child.kill(); await done.catch(() => {}); throw error; }
}
await extract(editor.asset, editor.entry, "godot", 180 * 1024 * 1024);
await extract(lock.templates.asset, lock.templates.entry, "web-release.zip", 32 * 1024 * 1024);
await verify(path.join(context, "web-release.zip"), lock.templates.entrySha256);
await chmod(path.join(context, "godot"), 0o555);
await writeFile(path.join(context, "build.mjs"), driver);
for (const name of Object.keys(lock.licenses)) await copyFile(path.join(inputs, `GODOT-${name}`), path.join(context, name));
await writeFile(path.join(context, "Dockerfile"), `FROM ${lock.baseImage}\nLABEL org.companion.game-godot.recipe="${recipeSha256}"\nCOPY --chmod=0555 godot /opt/godot/godot\nCOPY --chmod=0444 web-release.zip build.mjs LICENSE.txt COPYRIGHT.txt /opt/godot/\nENTRYPOINT ["/usr/local/bin/node", "/opt/godot/build.mjs"]\n`);
// Require the exact base locally. Do not authenticate, pull, or access a registry here.
execFileSync(docker, ["image", "inspect", lock.baseImage], { stdio: "ignore" });
const tag = `companion-godot:${lock.version}-${process.arch}-${recipeSha256.slice(0, 12)}`;
execFileSync(docker, ["build", "--network", "none", "--pull=false", "--tag", tag, context], { stdio: "inherit" });
const [image] = JSON.parse(execFileSync(docker, ["image", "inspect", tag], { encoding: "utf8" }));
if (!/^sha256:[a-f0-9]{64}$/.test(image.Id) || image.Config.Labels["org.companion.game-godot.recipe"] !== recipeSha256) throw new Error("Provisioned image identity mismatch");
const version = execFileSync(docker, ["run", "--rm", "--pull=never", "--network", "none", "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--memory", "1g", "--pids-limit", "64", "--user", "1000:1000", "--entrypoint", "/opt/godot/godot", image.Id, "--headless", "--version"], { encoding: "utf8", timeout: 30000 });
if (!version.trim().startsWith(`${lock.version}.stable.official.`)) throw new Error("Unexpected editor version");
await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
await writeFile(destination, JSON.stringify({ schemaVersion: 1, engineVersion: lock.version, architecture: process.arch, imageId: image.Id, recipeSha256, driverSha256: hash(driver), dockerExecutable: docker }, null, 2), { mode: 0o600 });
console.log(`GODOT_TOOLCHAIN_PROVISIONED ${lock.version} ${image.Id} ${destination}`);
