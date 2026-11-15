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

/** Compare the archive with metadata captured before VSCE runs, not metadata
 * re-read from a staging tree it could have changed. The caller first uses the
 * product bootstrap verifier for compatibility and the pinned release key. */
export async function verifyPackagedEngine(archive,manifest,metadata){
  const {createHash,verify}=await import("node:crypto"),yauzl=require("yauzl");
  const {manifestBytes,signatureBytes,publicKey}=metadata??{};
  if(!Buffer.isBuffer(manifestBytes)||!manifestBytes.length||manifestBytes.length>8*1024*1024||
      !Buffer.isBuffer(signatureBytes)||signatureBytes.length!==64||!publicKey||!verify(null,manifestBytes,publicKey,signatureBytes))
    throw Error("The VSIX requires the exact trusted signed engine metadata.");
  if(JSON.stringify(JSON.parse(manifestBytes.toString("utf8")))!==JSON.stringify(manifest)||!manifest.files||typeof manifest.files!=="object"||Array.isArray(manifest.files))
    throw Error("The expected engine manifest differs from its signed bytes.");
  const sha=bytes=>createHash("sha256").update(bytes).digest("hex"),expected=new Map(),directories=new Set([""]);
  for(const [name,digest]of Object.entries(manifest.files)){
    if(!name||name.includes("\\")||name.includes(":")||name.split("/").some(part=>!part||part==="."||part==="..")||
        ["manifest.json","manifest.sig"].includes(name)||!/^[a-f0-9]{64}$/.test(digest))throw Error("Unsafe signed engine manifest entry.");
    expected.set(name,digest);const parts=name.split("/");while(parts.length>1){parts.pop();directories.add(parts.join("/")+"/");}
  }
  expected.set("manifest.json",sha(manifestBytes));expected.set("manifest.sig",sha(signatureBytes));
  const seen=new Set(),seenDirectories=new Set();let payloadBytes=0;
  await new Promise((resolve,reject)=>yauzl.open(archive,{lazyEntries:true,strictFileNames:true},(error,zip)=>{
    if(error)return reject(error);
    let settled=false,active;
    const fail=error=>{if(settled)return;settled=true;active?.destroy();zip.close();reject(error);};
    zip.on("error",fail);zip.on("end",()=>{
      if(seen.size!==expected.size)return fail(Error("The VSIX omitted signed engine files."));
      settled=true;resolve();
    });
    zip.on("entry",entry=>{
      const prefix="extension/dist/engine/",file=entry.fileName;
      if(file.toLowerCase().startsWith(prefix)&&!file.startsWith(prefix))return fail(Error("The VSIX contains an aliased signed engine path."));
      if(file.toLowerCase()==="extension/dist/engine")return fail(Error("The VSIX contains an invalid engine root entry."));
      if(!file.startsWith(prefix))return zip.readEntry();
      const name=file.slice(prefix.length),mode=(entry.externalFileAttributes>>>16)&0xffff,type=mode&0o170000;
      if(entry.generalPurposeBitFlag&1)return fail(Error("The VSIX contains an encrypted engine entry."));
      if(file.endsWith("/")){
        if(!directories.has(name)||seenDirectories.has(name)||(type&&type!==0o040000))return fail(Error("The VSIX contains an undeclared/invalid engine directory."));
        seenDirectories.add(name);return zip.readEntry();
      }
      if(!expected.has(name)||seen.has(name)||(type&&type!==0o100000))return fail(Error("The VSIX contains an undeclared/duplicate/invalid signed engine entry."));
      if(name==="node"&&!String(manifest.target).startsWith("win32-")&&!(mode&0o111))return fail(Error("The VSIX removed the signed engine Node executable mode."));
      seen.add(name);
      zip.openReadStream(entry,(error,stream)=>{
        if(error)return fail(error);active=stream;
        void (async()=>{
          const hash=createHash("sha256");for await(const chunk of stream){hash.update(chunk);payloadBytes+=chunk.length;}
          active=undefined;
          if(hash.digest("hex")!==expected.get(name))throw Error("The VSIX changed a signed engine file, manifest or signature.");
          if(!settled)zip.readEntry();
        })().catch(fail);
      });
    });zip.readEntry();
  }));
  return {files:seen.size,bytes:payloadBytes,manifestSha256:sha(manifestBytes),signatureSha256:sha(signatureBytes)};
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
  const manifestBytes=readFileSync(path.join(destination,"manifest.json"));
  const signatureBytes=readFileSync(path.join(destination,"manifest.sig"));
  const expectedManifest=JSON.parse(manifestBytes.toString("utf8"));
  const invocation = packageInvocation(version, target, { providerVariant });
  const result = spawnSync(invocation.executable, invocation.args, {
    cwd: projectRoot,
    stdio: "inherit",
    shell: false
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status ?? 1;
  else {await verifyPackagedEngine(path.join(projectRoot,output),expectedManifest,{manifestBytes,signatureBytes,publicKey:key});process.stdout.write(`NATIVE_VSIX_READY ${target} ${path.join(projectRoot, output)}\n`);}
}
