import assert from "node:assert/strict";
import {createHash, generateKeyPairSync, sign} from "node:crypto";
import {createWriteStream} from "node:fs";
import {once} from "node:events";
import yazl from "yazl";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import test from "node:test";
import {
  nativePackageName,
  nativeTarget,
  packageArguments,
  packageInvocation,
  verifyProviderVariant,
  verifyPackagedEngine,
  verifyPackagedBrowserRuntime
} from "../scripts/package-native.mjs";

test("maps every supported build host to an explicit VSIX target", () => {
  for (const target of ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64", "win32-x64"]) {
    const separator = target.lastIndexOf("-");
    assert.equal(nativeTarget(target.slice(0, separator), target.slice(separator + 1)), target);
  }
});

async function engineArchive(context) {
  const root = await mkdtemp(path.join(tmpdir(), "engine-vsix-integrity-"));
  context.after(() => rm(root, {recursive:true, force:true}));
  const pair = generateKeyPairSync("ed25519");
  const payload = {node:Buffer.from("synthetic runtime; never executed"), "service.cjs":Buffer.from("// synthetic"), "bootstrap-lock.cjs":Buffer.from("// synthetic lock")};
  const manifest = {version:"fixture", target:"linux-x64", files:Object.fromEntries(Object.entries(payload).map(([name,bytes]) => [name, createHash("sha256").update(bytes).digest("hex")]))};
  const manifestBytes = Buffer.from(JSON.stringify(manifest)+"\n");
  const signatureBytes = sign(null, manifestBytes, pair.privateKey);
  const files = {...payload, "manifest.json":manifestBytes, "manifest.sig":signatureBytes};
  let counter = 0;
  const archive = async (change = entries => entries) => {
    const name = path.join(root, `${counter++}.vsix`), zip = new yazl.ZipFile();
    for (const entry of change(Object.entries(files).map(([file,bytes]) => ({file:"extension/dist/engine/"+file, bytes, mode:file==="node"?0o100755:0o100644})))) {
      if (entry.file.endsWith("/")) zip.addEmptyDirectory(entry.file, {mode:entry.mode??0o40755});
      else zip.addBuffer(entry.bytes, entry.file, {mode:entry.mode});
    }
    const output = createWriteStream(name); zip.outputStream.pipe(output); zip.end(); await once(output,"close"); return name;
  };
  return {manifest, metadata:{manifestBytes, signatureBytes, publicKey:pair.publicKey}, archive};
}

test("VSIX verification binds exact signed manifest and signature bytes, including equivalent JSON", async context => {
  const f = await engineArchive(context);
  await verifyPackagedEngine(await f.archive(),f.manifest,f.metadata);
  for (const field of ["manifest.json","manifest.sig"]) {
    const archive = await f.archive(entries => entries.map(entry => entry.file.endsWith("/"+field)
      ? {...entry, bytes:field==="manifest.json"?Buffer.from(JSON.stringify(f.manifest,null,2)):Buffer.alloc(64)} : entry));
    await assert.rejects(verifyPackagedEngine(archive,f.manifest,f.metadata),/signed engine|signature|manifest/i);
  }
});

test("VSIX verification rejects missing, duplicated, undeclared, aliased and non-regular engine entries", async context => {
  const f=await engineArchive(context);
  for(const change of [
    entries=>entries.filter(entry=>!entry.file.endsWith("/manifest.sig")),
    entries=>[...entries,entries[0]],
    entries=>[...entries,{...entries[0],file:"extension/dist/engine/extra.cjs"}],
    entries=>[...entries,{...entries[0],file:"Extension/dist/engine/node"}],
    entries=>entries.map((entry,index)=>index?entry:{...entry,mode:0o120755}),
    entries=>entries.map((entry,index)=>index?entry:{...entry,mode:0o100644}),
    entries=>[...entries,{file:"extension/dist/engine/extra/",mode:0o40755}],
    entries=>entries.map((entry,index)=>index?entry:{...entry,bytes:Buffer.from("different runtime")}),
  ])await assert.rejects(verifyPackagedEngine(await f.archive(change),f.manifest,f.metadata),/VSIX/);
});

test("VSIX verification requires a valid captured signature and binds the supplied manifest",async context=>{
  const f=await engineArchive(context),archive=await f.archive();
  await assert.rejects(verifyPackagedEngine(archive,f.manifest),/trusted signed engine/);
  await assert.rejects(verifyPackagedEngine(archive,f.manifest,{...f.metadata,publicKey:generateKeyPairSync("ed25519").publicKey}),/trusted signed engine/);
  await assert.rejects(verifyPackagedEngine(archive,{...f.manifest,version:"forged"},f.metadata),/differs from its signed bytes/);
  const result=await verifyPackagedEngine(archive,f.manifest,f.metadata);
  assert.equal(result.files,5);assert.equal(result.manifestSha256,createHash("sha256").update(f.metadata.manifestBytes).digest("hex"));
});

test("refuses to label unsupported native hosts as universal packages", () => {
  assert.throws(() => nativeTarget("win32", "arm64"), /Unsupported packaging host/);
  assert.throws(() => nativeTarget("linux", "ppc64"), /Unsupported packaging host/);
});

test("builds a versioned target-specific package command", () => {
  assert.equal(
    nativePackageName("0.11.0", "darwin-arm64"),
    "local-agent-companion-0.11.0-darwin-arm64.vsix"
  );
  assert.equal(
    nativePackageName("0.11.0", "win32-x64", "ollama"),
    "local-agent-companion-0.11.0-ollama-win32-x64.vsix"
  );
  assert.equal(
    nativePackageName("0.11.0", "linux-x64", "openai"),
    "local-agent-companion-0.11.0-openai-linux-x64.vsix"
  );
  assert.deepEqual(packageArguments("0.11.0", "win32-x64"), [
    "package",
    "--no-dependencies",
    "--target",
    "win32-x64",
    "--out",
    "local-agent-companion-0.11.0-win32-x64.vsix"
  ]);
  assert.throws(() => nativePackageName("latest", "linux-x64"), /Invalid package version/);
  assert.throws(() => nativePackageName("0.11.0", "universal"), /Unsupported VSIX target/);
  assert.throws(() => nativePackageName("0.11.0", "linux-x64", "both"), /Unsupported provider variant/);
});

test("invokes the local VSCE CLI through Node without a shell or npx shim", () => {
  const invocation = packageInvocation("0.11.0", "win32-x64", {
    nodeExecutable: "C:\\Program Files\\nodejs\\node.exe",
    vsceCli: "C:\\repo\\node_modules\\@vscode\\vsce\\vsce"
  });

  assert.equal(invocation.executable, "C:\\Program Files\\nodejs\\node.exe");
  assert.deepEqual(invocation.args, [
    "C:\\repo\\node_modules\\@vscode\\vsce\\vsce",
    "package",
    "--no-dependencies",
    "--target",
    "win32-x64",
    "--out",
    "local-agent-companion-0.11.0-win32-x64.vsix"
  ]);
  assert.doesNotMatch(invocation.args.join(" "), /npx(?:\.cmd)?/i);
});

test("requires the browser controller to be copied into the distributable", async (context) => {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "local-companion-package-"));
  context.after(() => rm(projectRoot, { recursive: true, force: true }));
  const runtimeRoot = path.join(projectRoot, "dist", "node_modules", "playwright-core");
  for (const relativePath of [
    "package.json",
    "index.js",
    "browsers.json",
    path.join("lib", "server", "browserType.js"),
    "LICENSE"
  ]) {
    const target = path.join(runtimeRoot, relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, "test", "utf8");
  }
  assert.equal(verifyPackagedBrowserRuntime(projectRoot), runtimeRoot);
  await rm(path.join(runtimeRoot, "browsers.json"));
  assert.throws(() => verifyPackagedBrowserRuntime(projectRoot), /runtime is incomplete: browsers\.json/);
});

test("refuses to mislabel a provider build as another VSIX variant", async (context) => {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "local-companion-provider-"));
  context.after(() => rm(projectRoot, { recursive: true, force: true }));
  await mkdir(path.join(projectRoot, "dist"), { recursive: true });
  await writeFile(
    path.join(projectRoot, "dist", "provider-variant.json"),
    JSON.stringify({ providerVariant: "ollama" }),
    "utf8"
  );
  assert.equal(
    verifyProviderVariant(projectRoot, "ollama"),
    path.join(projectRoot, "dist", "provider-variant.json")
  );
  assert.throws(() => verifyProviderVariant(projectRoot, "openai"), /Provider build mismatch/);
});
