import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { readGameTar } from "../packages/adapter-game-godot/src/archive";
import { createGodotGameAdapter } from "../packages/adapter-game-godot/src/index";
import type { Registration } from "../packages/contracts/src/index";

function archive(name: string, type = "0", contents = Buffer.from("example")): Buffer {
  const header = Buffer.alloc(512);
  header.write(name, 0, 100); header.write("0000644\0", 100); header.write("0000000\0", 108); header.write("0000000\0", 116);
  header.write(contents.length.toString(8).padStart(11, "0") + "\0", 124); header.write("00000000000\0", 136);
  header.fill(32, 148, 156); header.write(type, 156); header.write("ustar\0", 257);
  header.write(header.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, "0") + "\0 ", 148);
  return Buffer.concat([header, contents, Buffer.alloc((512 - contents.length % 512) % 512), Buffer.alloc(1024)]);
}

test("isolated editor archive accepts regular portable output and rejects links, traversal, duplicates and truncation", () => {
  assert.equal(readGameTar(archive("./index.html"))[0]!.mime, "text/html");
  assert.equal(readGameTar(archive("index.wasm"))[0]!.mime, "application/wasm");
  assert.equal(readGameTar(archive("\ufeffindex.html"))[0]!.path,"\ufeffindex.html","Do not silently promote a BOM-prefixed path to the entrypoint");
  for (const name of ["../secrets", "/etc/passwd", "folder/../../outside", "CON.txt", "a\\b", "bad%2fpath"])
    assert.throws(() => readGameTar(archive(name)));
  for (const type of ["1", "2", "3", "4", "6", "L", "g"]) assert.throws(() => readGameTar(archive("index.html", type)), /forbidden/);
  const duplicate = Buffer.concat([archive("Index.html").subarray(0, -1024), archive("index.html")]);
  assert.throws(() => readGameTar(duplicate), /Duplicate/);
  const truncated = archive("index.html").subarray(0, 600); assert.throws(() => readGameTar(truncated), /Truncated/);
  const tampered = archive("index.html"); tampered[8] = 67; assert.throws(() => readGameTar(tampered), /checksum/);
  assert.throws(() => readGameTar(archive("index.html").subarray(0, -1024)), /terminator/);
  for (const paths of [["assets", "assets/texture.png"], ["assets/texture.png", "assets"], ["Art/a.png", "art/b.png"]]) {
    const data = Buffer.concat(paths.map((name, index) => index ? archive(name) : archive(name).subarray(0, -1024)));
    assert.throws(() => readGameTar(data), /directory|capitalization/);
  }
});

test("editor TAR supports bounded extended paths without accepting link or size overrides", () => {
  const record = (key: string, value: string) => {
    const body = ` ${key}=${value}\n`; let size = body.length + 1;
    while (String(size).length + body.length !== size) size = String(size).length + body.length;
    return Buffer.from(`${size}${body}`);
  };
  const extended = (key: string, value: string) => Buffer.concat([archive("PaxHeader", "x", record(key, value)).subarray(0, -1024), archive("fallback.txt")]);
  const long = `assets/${"a".repeat(120)}.txt`;
  assert.equal(readGameTar(extended("path", long))[0]!.path, long);
  assert.throws(() => readGameTar(extended("path", "../../outside")));
  for (const key of ["linkpath", "size"]) assert.throws(() => readGameTar(extended(key, "100")), /override/);
});

test("Godot capability is unavailable until exact administrative provisioning; the factory never installs or starts project code", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "godot-config-"));
  const reg = { id: "test", product: "companion-mac", profile: "default", workspace: "", providers: ["ollama"], hostTools: [] } as Registration;
  try {
    const options = { stateDirectory: directory, driverSha256: "0".repeat(64), configPath: path.join(directory, "toolchain.json") };
    assert.equal((await (await createGodotGameAdapter(options)).probe(reg)).available, false);
    await writeFile(options.configPath, " ".repeat(16385));
    assert.equal((await (await createGodotGameAdapter(options)).probe(reg)).available, false);
    await writeFile(options.configPath, JSON.stringify({ schemaVersion: 1, engineVersion: "latest", dockerExecutable: "/untrusted" }));
    assert.equal((await (await createGodotGameAdapter(options)).probe(reg)).available, false);
    await writeFile(options.configPath, JSON.stringify({ schemaVersion: 1, engineVersion: "4.7.2", architecture: process.arch, imageId: `sha256:${"a".repeat(64)}`, recipeSha256: "b".repeat(64), driverSha256: options.driverSha256, dockerExecutable: "/untrusted" }));
    const adapter = await createGodotGameAdapter(options);
    assert.equal((await adapter.probe(reg)).available, false);
    assert.deepEqual(adapter.products, ["companion-mac", "companion-vscode"]);
    assert.equal(adapter.authority, "workspace");
  } finally { await rm(directory, { recursive: true, force: true }); }
});
