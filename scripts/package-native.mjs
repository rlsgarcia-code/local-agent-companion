import { existsSync, readFileSync, cpSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { RELEASE_TARGETS } from "./verify-release-metadata.mjs";

const require = createRequire(import.meta.url);

const TARGET_BY_HOST = new Map([
  ["darwin-arm64", "darwin-arm64"],
  ["darwin-x64", "darwin-x64"],
  ["linux-arm64", "linux-arm64"],
  ["linux-x64", "linux-x64"],
  ["win32-x64", "win32-x64"]
]);

export function nativeTarget(platform = process.platform, architecture = process.arch) {
  const host = `${platform}-${architecture}`;
  const target = TARGET_BY_HOST.get(host);
  if (!target || !RELEASE_TARGETS.includes(target)) {
    throw new Error(
      `Unsupported packaging host ${host}. Supported hosts: ${[...TARGET_BY_HOST.keys()].join(", ")}.`
    );
  }
  return target;
}

export function nativePackageName(version, target, providerVariant = "litellm") {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`Invalid package version: ${version || "<empty>"}`);
  }
  if (!RELEASE_TARGETS.includes(target)) {
    throw new Error(`Unsupported VSIX target: ${target}`);
  }
  if (!["litellm", "ollama", "openai"].includes(providerVariant)) {
    throw new Error(`Unsupported provider variant: ${providerVariant}`);
  }
  const suffix = providerVariant === "litellm" ? "" : `-${providerVariant}`;
  return `local-agent-companion-${version}${suffix}-${target}.vsix`;
}

export function packageArguments(version, target, providerVariant = "litellm") {
  return [
    "package",
    "--no-dependencies",
    "--target",
    target,
    "--out",
    nativePackageName(version, target, providerVariant)
  ];
}

export function packageInvocation(version, target, options = {}) {
  const executable = options.nodeExecutable ?? process.execPath;
  const vsceCli = options.vsceCli ?? require.resolve("@vscode/vsce/vsce");
  return {
    executable,
    args: [vsceCli, ...packageArguments(version, target, options.providerVariant ?? "litellm")]
  };
}

export function verifyPackagedBrowserRuntime(projectRoot) {
  const runtimeRoot = path.join(projectRoot, "dist", "node_modules", "playwright-core");
  const requiredFiles = [
    "package.json",
    "index.js",
    "browsers.json",
    path.join("lib", "server", "browserType.js"),
    "LICENSE"
  ];
  const missing = requiredFiles.filter((relativePath) => !existsSync(path.join(runtimeRoot, relativePath)));
  if (missing.length) {
    throw new Error(`Packaged local-browser runtime is incomplete: ${missing.join(", ")}. Run npm run build again.`);
  }
  return runtimeRoot;
}

export function verifyProviderVariant(projectRoot, expectedVariant) {
  const markerPath = path.join(projectRoot, "dist", "provider-variant.json");
  let marker;
  try {
    marker = JSON.parse(readFileSync(markerPath, "utf8"));
  } catch {
    throw new Error("Provider build marker is missing or invalid. Run the matching package script again.");
  }
  if (marker?.providerVariant !== expectedVariant) {
    throw new Error(
      `Provider build mismatch: dist contains ${String(marker?.providerVariant ?? "unknown")}, requested ${expectedVariant}.`
    );
  }
  return markerPath;
}

export async function verifyPackagedEngine(archive,manifest){
  const {createHash}=await import("node:crypto");const yauzl=require("yauzl");
  const expected=new Set([...Object.keys(manifest.files),"manifest.json","manifest.sig"]);const seen=new Set();
  await new Promise((resolve,reject)=>yauzl.open(archive,{lazyEntries:true},(error,zip)=>{
    if(error)return reject(error);zip.on("error",reject);zip.on("end",()=>{if(seen.size!==expected.size)return reject(new Error("The VSIX omitted signed engine files."));resolve();});
    zip.on("entry",entry=>{
      const prefix="extension/dist/engine/";if(!entry.fileName.startsWith(prefix)||entry.fileName.endsWith("/"))return zip.readEntry();
      const name=entry.fileName.slice(prefix.length);if(!expected.has(name)||seen.has(name))return reject(new Error("The VSIX contains an undeclared engine entry."));seen.add(name);
      zip.openReadStream(entry,(error,stream)=>{if(error)return reject(error);const hash=createHash("sha256");stream.on("data",chunk=>hash.update(chunk));stream.on("error",reject);stream.on("end",()=>{
        const digest=hash.digest("hex");if(manifest.files[name]&&digest!==manifest.files[name])return reject(new Error("The VSIX changed a signed engine file."));zip.readEntry();});});
    });zip.readEntry();
  }));
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const manifest = JSON.parse(readFileSync(path.join(projectRoot, "package.json"), "utf8"));
  const version = String(manifest.version ?? "").trim();
  const target = nativeTarget();
  const providerArgument = process.argv.find((argument) => argument.startsWith("--provider="));
  const providerVariant = providerArgument?.slice("--provider=".length) || "litellm";
  const output = nativePackageName(version, target, providerVariant);
  const bundle=process.env.COMPANION_ENGINE_BUNDLE;
  if(!bundle)throw new Error("Set COMPANION_ENGINE_BUNDLE to the exact signed native engine before packaging this client.");
  const {buildSync}=require("esbuild");
  const verified=buildSync({entryPoints:[path.join(projectRoot,"packages/client-ts/src/bootstrap.ts")],bundle:true,platform:"node",format:"cjs",write:false});
  const verifier={exports:{}};new Function("module","exports","require",verified.outputFiles[0].text)(verifier,verifier.exports,require);
  const key=readFileSync(path.join(projectRoot,"release-keys/companion-ed25519.pub"),"utf8");
  await verifier.exports.verifyBundle(path.resolve(bundle),key,false,target);
  const destination=path.join(projectRoot,"dist/engine");rmSync(destination,{recursive:true,force:true});cpSync(path.resolve(bundle),destination,{recursive:true,dereference:false});
  await verifier.exports.verifyBundle(destination,key,false,target);
  verifyPackagedBrowserRuntime(projectRoot);
  verifyProviderVariant(projectRoot, providerVariant);
  const invocation = packageInvocation(version, target, { providerVariant });
  const result = spawnSync(invocation.executable, invocation.args, {
    cwd: projectRoot,
    stdio: "inherit",
    shell: false
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status ?? 1;
  else {await verifyPackagedEngine(path.join(projectRoot,output),JSON.parse(readFileSync(path.join(destination,"manifest.json"),"utf8")));process.stdout.write(`NATIVE_VSIX_READY ${target} ${path.join(projectRoot, output)}\n`);}
}
