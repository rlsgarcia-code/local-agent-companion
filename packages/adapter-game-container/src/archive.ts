import { gameFilePath, gameFileTreeConflict } from "../../contracts/src/games";
import type { ProducedGameFile } from "../../game-production/src/index";

const limit = 256 * 1024 * 1024;
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
function field(data: Buffer) { return decoder.decode(data.subarray(0, data.indexOf(0) < 0 ? data.length : data.indexOf(0))); }
function number(data: Buffer) {
  const text = field(data).trim();
  if (!/^[0-7]+$/.test(text)) throw new Error("Invalid TAR numeric field");
  const value = Number.parseInt(text, 8);
  if (!Number.isSafeInteger(value) || value > limit) throw new Error("TAR entry exceeds its limit");
  return value;
}
export function gameMime(name: string): string {
  const extension = name.split(".").pop()!.toLowerCase();
  return ({ html: "text/html", js: "text/javascript", css: "text/css", json: "application/json", wasm: "application/wasm", png: "image/png", svg: "image/svg+xml", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", ogg: "audio/ogg", mp3: "audio/mpeg", wav: "audio/wav", txt: "text/plain" } as Record<string, string>)[extension] ?? "application/octet-stream";
}

/** Container output is untrusted TAR bytes. Never extract links or write any archive path to disk. */
export function readGameTar(data: Buffer): ProducedGameFile[] {
  if (data.length > limit + 32 * 1024 * 1024) throw new Error("Build archive exceeds its transport limit");
  const files: ProducedGameFile[] = [], seen = new Set<string>();
  let offset = 0, bytes = 0, entries = 0, pax: Record<string, string> = {};
  while (offset + 512 <= data.length) {
    const header = data.subarray(offset, offset + 512); offset += 512;
    if (header.every((byte) => byte === 0)) {
      if (data.length - offset < 512 || data.subarray(offset).some((byte) => byte !== 0) || Object.keys(pax).length) throw new Error("Invalid TAR terminator");
      const conflict = gameFileTreeConflict(files.map((file) => file.path));
      if (conflict) throw new Error(conflict.message);
      return files;
    }
    if (++entries > 40000) throw new Error("Too many build archive entries");
    const checksum = number(header.subarray(148, 156));
    const sum = header.reduce((total, byte, index) => total + (index >= 148 && index < 156 ? 32 : byte), 0);
    if (sum !== checksum) throw new Error("Invalid TAR checksum");
    const type = String.fromCharCode(header[156]!), size = number(header.subarray(124, 136));
    if (offset + Math.ceil(size / 512) * 512 > data.length) throw new Error("Truncated build archive");
    const body = data.subarray(offset, offset + size); offset += Math.ceil(size / 512) * 512;
    if (type === "x") {
      if (size > 65536 || Object.keys(pax).length) throw new Error("Invalid extended archive metadata");
      let index = 0;
      while (index < body.length) {
        const space = body.indexOf(32, index), lengthText = body.subarray(index, space).toString("ascii");
        if (space < index || !/^[1-9][0-9]{0,5}$/.test(lengthText)) throw new Error("Invalid extended archive record");
        const length = Number(lengthText), end = index + length;
        if (end > body.length || end <= space + 2 || body[end - 1] !== 10) throw new Error("Invalid extended archive length");
        const record = decoder.decode(body.subarray(space + 1, end - 1)), equal = record.indexOf("=");
        if (equal < 1) throw new Error("Invalid extended archive value");
        const key = record.slice(0, equal);
        if (["linkpath", "size"].includes(key) || key in pax) throw new Error("Unsupported extended archive override");
        pax[key] = record.slice(equal + 1); index = end;
      }
      continue;
    }
    const prefix = field(header.subarray(345, 500));
    const raw = pax.path ?? [prefix, field(header.subarray(0, 100))].filter(Boolean).join("/"); pax = {};
    const name = raw.replace(/^\.\//, "").replace(/\/$/, "");
    if (type === "5" && (name === "." || name === "")) continue;
    gameFilePath.parse(name);
    if (type === "5") { if (size) throw new Error("Directory has archive contents"); continue; }
    if (type !== "0" && type !== "\0") throw new Error("Links and special build archive entries are forbidden");
    bytes += size;
    if (bytes > limit || files.length >= 20000 || seen.has(name.toLowerCase())) throw new Error("Duplicate or oversized build output");
    seen.add(name.toLowerCase()); files.push({ path: name, mime: gameMime(name), data: Buffer.from(body) });
  }
  throw new Error("Build archive has no complete terminator");
}
