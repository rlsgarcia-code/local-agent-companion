import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";
import { contentHash } from "../../contracts/src/identity";
import { gameFilePath } from "../../contracts/src/games";
import { GameProductionFailure, GameProductionUncertain, type GameProductionAdapter, type ProductionAccess, type ProducedGameArtifact } from "../../game-production/src/index";
import lock from "../toolchain.lock.json";
import { readGameTar } from "./archive";
import { dockerCommand } from "./process";

export const godotProvision = z.object({ schemaVersion: z.literal(1), engineVersion: z.literal(lock.version), architecture: z.enum(["arm64", "x64"]),
  imageId: z.string().regex(/^sha256:[a-f0-9]{64}$/), recipeSha256: z.string().regex(/^[a-f0-9]{64}$/), driverSha256: z.string().regex(/^[a-f0-9]{64}$/), dockerExecutable: z.string().min(1).refine(path.isAbsolute),
}).strict();
type Provision = z.infer<typeof godotProvision>;
const settings = z.object({ schemaVersion: z.literal(1), engineVersion: z.literal(lock.version) }).strict();
const sha = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");
const recipe = (config: Provision) => contentHash({ lock, architecture: config.architecture, driverSha256: config.driverSha256, imagePolicy: 1 });
const label = "org.companion.game-job";
const exportPolicy = "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self'; connect-src 'self'; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";

export async function createGodotGameAdapter(options: { stateDirectory: string; driverSha256: string; implementationSha256?: string; configPath?: string }): Promise<GameProductionAdapter> {
  let provision: Provision | undefined;
  try {
    const file = options.configPath ?? path.join(options.stateDirectory, "toolchains/godot.json"), info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 16384 || (process.getuid && info.uid !== process.getuid() && info.uid !== 0)) throw new Error("Unsafe Godot provisioning record");
    provision = godotProvision.parse(JSON.parse(await readFile(file, "utf8")));
    if (provision.architecture !== process.arch || provision.driverSha256 !== options.driverSha256 || recipe(provision) !== provision.recipeSha256) provision = undefined;
  } catch { /* Missing/invalid provisioning is an explicit unavailable capability, never an installer. */ }
  const toolchain = { id: "godot-web-isolated", version: `${lock.version}.adapter.1`, sha256: contentHash({ provision: provision ?? null, adapterABI: 1, implementation: options.implementationSha256 ?? "development-unreleased" }) };
  const jobDirectory = (access: ProductionAccess) => {
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(access.job.id)) throw new GameProductionFailure("Invalid production job identity");
    return path.join(options.stateDirectory, "game-editor-jobs", access.job.id);
  };
  const binding = (access: ProductionAccess) => ({ jobId: access.job.id, sourceHash: access.job.sourceHash, toolchain, imageId: provision!.imageId });
  const name = (access: ProductionAccess) => `companion-godot-${contentHash(binding(access)).slice(0, 40)}`;
  const command = (args: string[], opts?: Parameters<typeof dockerCommand>[2]) => dockerCommand(provision!.dockerExecutable, args, opts);
  async function inspectContainer(access: ProductionAccess) {
    // Listing succeeds even if this exact container is absent; daemon failures are not absence.
    const listed = (await command(["container", "ls", "--all", "--no-trunc", "--filter", `name=^/${name(access)}$`, "--format", "{{.ID}}"])).toString().trim();
    if (!listed) return undefined;
    const [container] = JSON.parse((await command(["container", "inspect", listed])).toString());
    if (container.Config?.Labels?.[label] !== contentHash(binding(access)) || container.Image !== provision!.imageId)
      throw new GameProductionUncertain("The build container identity differs from its durable operation. No unrelated container was changed.");
    return container as { Id: string; State: { Running: boolean } };
  }
  async function cleanup(access: ProductionAccess) {
    const container = await inspectContainer(access);
    if (container) await command(["container", "rm", "--force", container.Id]);
    if (await inspectContainer(access)) throw new Error("The isolated build has not stopped.");
  }
  async function probe() {
    if (!provision) return { available: false, reason: "Provision the exact Godot editor/templates and isolated build image administratively, then restart the engine. No engine or image is downloaded automatically." };
    try {
      const local = (host: string) => /^(?:unix:\/\/\/|npipe:\/\/)/.test(host);
      if (process.env.DOCKER_HOST && !local(process.env.DOCKER_HOST)) throw new Error("Remote Docker endpoints are not permitted");
      const [context] = JSON.parse((await command(["context", "inspect"])).toString());
      if (!local(context.Endpoints?.docker?.Host ?? "")) throw new Error("Docker must use a local IPC endpoint");
      const [image] = JSON.parse((await command(["image", "inspect", provision.imageId])).toString());
      if (image.Id !== provision.imageId || image.Config?.Labels?.["org.companion.game-godot.recipe"] !== provision.recipeSha256 || image.Architecture !== (process.arch === "x64" ? "amd64" : "arm64")) throw new Error();
      return { available: true };
    } catch { return { available: false, reason: "The pinned Godot image or local isolation service is unavailable. Repair the provisioned toolchain; no alternate editor is used." }; }
  }
  function output(archive: Buffer): ProducedGameArtifact {
    const files = readGameTar(archive);
    for (const required of ["index.html", "index.js", "index.wasm", "index.pck", "engine/GODOT-LICENSE.txt", "engine/GODOT-COPYRIGHT.txt"])
      if (!files.some((file) => file.path === required)) throw new Error(`Incomplete Godot web output: ${required}`);
    for (const [name, expected] of Object.entries({ ...lock.runtimeFiles,
      "engine/GODOT-LICENSE.txt": lock.licenses["LICENSE.txt"], "engine/GODOT-COPYRIGHT.txt": lock.licenses["COPYRIGHT.txt"],
    })) {
      const file = files.find((item) => item.path === name);
      if (!file || sha(file.data) !== expected) throw new Error(`Godot runtime/license output differs from the pinned template: ${name}`);
    }
    if (Buffer.from(files.find((file) => file.path === "index.pck")!.data).subarray(0, 4).toString() !== "GDPC") throw new Error("Invalid Godot resource pack");
    // The fixed Godot shell contains inline bootstrap scripts. Externalize them so
    // browsers need WASM support but never arbitrary inline scripts or unsafe-eval.
    const html = files.find((file) => file.path === "index.html")!;
    let index = 0;
    const sourceHtml = Buffer.from(html.data).toString();
    if (!/<head>/i.test(sourceHtml)) throw new Error("The fixed Godot HTML shell is missing its head element");
    html.data = Buffer.from(sourceHtml.replace(/<head>/i, `<head><meta http-equiv="Content-Security-Policy" content="${exportPolicy}">`).replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, (match, attributes: string, body: string) => {
      if (/\bsrc\s*=/i.test(attributes)) return match;
      const script = `companion-bootstrap-${index++}.js`;
      if (files.some((file) => file.path.toLowerCase() === script)) throw new Error("Godot bootstrap output path conflict");
      files.push({ path: script, mime: "text/javascript", data: Buffer.from(body) });
      return `<script src="${script}"></script>`;
    }));
    return { entrypoint: "index.html", files };
  }
  return { id: "godot-web-isolated-v1", engine: "godot", products: ["companion-mac", "companion-vscode"], authority: "workspace", toolchain, probe,
    resources: { memoryMiB: 4096, cpuSlots: 2, exclusiveGroups: ["godot-editor"] },
    projectGuide: `Save game.godot.json with {schemaVersion:1,engineVersion:"${lock.version}"}, native project.godot, scenes/resources, GDScript and local assets. Set run/main_scene and Compatibility rendering (gl_compatibility) in project.godot. The controlled exporter uses single-thread web, no PWA, C#, native extensions, custom shell or remote dependencies. Do not upload .godot caches. Source budget 256 MiB. data/ is also packaged outside the PCK for runtime recipes (data/playtests.json or named suites). Build runs offline in a bounded disposable container, never on the personal filesystem. Missing toolchain requires administrative provisioning; plan approval does not grant it.`,
    async build(access) {
      access.signal.throwIfAborted();
      if (!(await probe()).available || !provision) throw new GameProductionFailure("The qualified Godot build toolchain is unavailable.");
      const directory = jobDirectory(access), source = path.join(directory, "source");
      if (source.includes(",")) throw new GameProductionFailure("The isolated editor state directory cannot contain commas in its bind-mount path.");
      let containerAttempted = false, archive: Buffer | undefined, error: unknown;
      try {
        const metadata = access.document.files.find((file) => file.path === "game.godot.json");
        if (!metadata || metadata.size > 16384) throw new Error("A bounded game.godot.json configuration (up to 16 KiB) is required.");
        const configuration = await access.readFile("game.godot.json");
        if (configuration.byteLength > 16384) throw new Error("Godot project configuration exceeds 16 KiB.");
        settings.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(configuration)));
        if (!access.document.files.some((file) => file.path === "project.godot")) throw new Error("A native editable project.godot is required.");
        if (access.document.files.some((file) => /(?:^|\/)\.godot(?:\/|$)|\.(?:cs|gdextension)$/i.test(file.path))) throw new Error("Use GDScript sources without generated editor caches or native extensions for this web toolchain.");
        await mkdir(directory, { recursive: true, mode: 0o700 });
        // Exclusive operation record: retries never overwrite evidence or start another editor.
        await writeFile(path.join(directory, "operation.json"), JSON.stringify(binding(access)), { flag: "wx", mode: 0o600 });
        await mkdir(source, { mode: 0o755 });
        let bytes = 0;
        for (const file of access.document.files) {
          if(/\.blend[0-9]*$/i.test(file.path))continue; // Editable source stays in project/export; runtime imports use GLB.
          access.signal.throwIfAborted(); gameFilePath.parse(file.path);
          const data = await access.readFile(file.path); bytes += data.byteLength;
          if (bytes > 256 * 1024 * 1024) throw new Error("The isolated editor source budget is 256 MiB; preserve the source and reduce the imported working set explicitly.");
          const destination = path.join(source, file.path); await mkdir(path.dirname(destination), { recursive: true, mode: 0o755 });
          await writeFile(destination, data, { flag: "wx", mode: 0o444 });
        }
        const uid = process.getuid?.() || 1000, gid = process.getgid?.() || 1000;
        containerAttempted = true;
        await command(["create", "--name", name(access), "--label", `${label}=${contentHash(binding(access))}`, "--pull=never", "--network", "none", "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--memory", "3g", "--memory-swap", "3g", "--cpus", "2", "--pids-limit", "256", "--log-driver", "none", "--user", `${uid}:${gid}`, "--tmpfs", `/work:rw,noexec,nosuid,size=768m,uid=${uid},gid=${gid},mode=0700`, "--tmpfs", "/tmp:rw,noexec,nosuid,size=128m,mode=1777", "--mount", `type=bind,src=${source},dst=/source,readonly`, "--env", "HOME=/tmp/home", "--env", "XDG_DATA_HOME=/tmp/data", "--env", "XDG_CONFIG_HOME=/tmp/config", "--env", "XDG_CACHE_HOME=/tmp/cache", "--entrypoint", "/bin/sleep", provision.imageId, "infinity"], { signal: access.signal });
        await command(["start", name(access)], { signal: access.signal });
        await command(["exec", name(access), "/usr/local/bin/node", "/opt/godot/build.mjs"], { signal: access.signal, timeout: 240000, maxBytes: 4 * 1024 * 1024 });
        // Docker cp cannot reliably read a tmpfs mount. Stream from the bounded
        // isolated filesystem instead; validate every byte/path before accepting
        // this immutable snapshot. No output directory is mounted on the host.
        archive = await command(["exec", name(access), "/bin/tar", "--format=pax", "-C", "/work/output", "-cf", "-", "."], { signal: access.signal, timeout: 60000, maxBytes: 288 * 1024 * 1024 });
        output(archive); // Validate before a process-owner acknowledgment is recorded.
        await writeFile(path.join(directory, "candidate.tar"), archive, { flag: "wx", mode: 0o600 });
        await writeFile(path.join(directory, "receipt.tmp"), JSON.stringify({ binding: binding(access), sha256: sha(archive) }), { flag: "wx", mode: 0o600 });
        await rename(path.join(directory, "receipt.tmp"), path.join(directory, "receipt.json"));
      } catch (caught) { error = caught; }
      finally {
        if (containerAttempted) try { await cleanup(access); }
        catch { throw new GameProductionUncertain("The isolated editor may still be running. Restore the isolation service and reconcile this exact operation before starting another build."); }
      }
      access.signal.throwIfAborted();
      if (error) throw new GameProductionFailure(error instanceof Error ? error.message : "Godot export failed.");
      return output(archive!);
    },
    async reconcile(access) {
      if (!provision || !(await probe()).available) throw new GameProductionUncertain("Restore the original Godot toolchain and isolation service to inspect this build.");
      const directory = jobDirectory(access);
      let operation: unknown;
      try { operation = JSON.parse(await readFile(path.join(directory, "operation.json"), "utf8")); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      if (operation && contentHash(operation) !== contentHash(binding(access))) throw new GameProductionUncertain("The saved editor operation identity differs; no process was changed.");
      try { await cleanup(access); } catch { throw new GameProductionUncertain("The original isolated build could not be stopped and verified."); }
      try {
        const receipt = JSON.parse(await readFile(path.join(directory, "receipt.json"), "utf8"));
        if (contentHash(receipt.binding) !== contentHash(binding(access))) throw new Error("Build receipt identity mismatch");
        if ((await stat(path.join(directory, "candidate.tar"))).size > 288 * 1024 * 1024) throw new Error("Candidate exceeds its limit");
        const archive = await readFile(path.join(directory, "candidate.tar"));
        if (sha(archive) !== receipt.sha256) throw new Error("Build candidate integrity mismatch");
        return { state: "completed", result: output(archive) };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        return { state: "missing", detail: "The original isolated editor was stopped. No acknowledged candidate survived; source revisions are unchanged. Request a new build explicitly." };
      }
    },
    async dispose(access) {
      if (!provision) return;
      const directory = jobDirectory(access);
      try {
        const operation = JSON.parse(await readFile(path.join(directory, "operation.json"), "utf8"));
        if (contentHash(operation) !== contentHash(binding(access))) throw new Error("Refusing to remove a different editor operation");
      } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
      if (await inspectContainer(access)) throw new Error("Refusing to remove recovery data while the isolated editor exists");
      await rm(directory, { recursive: true, force: true });
    },
  };
}
