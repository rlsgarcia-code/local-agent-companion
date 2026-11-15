import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, rename, unlink } from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";
import { identifier } from "../../contracts/src/schema";
import { contentHash } from "../../contracts/src/identity";
import { gameArtifact, gameObservation, gameToolchain } from "../../contracts/src/game-production";
import { gameFilePath } from "../../contracts/src/games";
import { gameTestSuitePath } from "../../contracts/src/game-browser-tests";
import type { CollectedGameObservation } from "../../game-production/src/index";
import { browserTemporary } from "./temporary";

export const digest = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const operationSchema = z.object({ schemaVersion: z.literal(1), nonce: hash, workerSha256: hash,
  temporary: browserTemporary.optional(),
  binding: z.object({ namespace: hash, jobId: identifier, sourceHash: hash, artifactHash: hash, toolchain: gameToolchain, testSuite: gameTestSuitePath.optional() }).strict(),
}).strict();
export type BrowserOperation = z.infer<typeof operationSchema>;
export const requestSchema = z.object({ artifact: gameArtifact, headless: z.boolean(),
  designScenarios: z.array(z.object({ id: identifier, category: z.string().min(1).max(100) }).strict()).max(500),
  browser: z.object({ executablePath: z.string().refine(path.isAbsolute), version: z.string().min(1).max(128), sha256: hash,
    components: z.array(z.object({ path: z.string().refine(path.isAbsolute), sha256: hash }).strict()).min(1).max(16),
  }).strict(),
}).strict();
export const preparedSchema = z.object({ operationHash: hash, requestSha256: hash }).strict();
export const leaseSchema = z.object({ operationHash: hash, pid: z.number().int().positive() }).strict();
export const receiptSchema = z.object({ operationHash: hash, pid: z.number().int().positive(),
  status: z.enum(["completed", "failed", "cancelled", "uncertain"]), detail: z.string().max(4000), resultSha256: hash.optional(),
}).strict().refine((value) => value.status !== "completed" || Boolean(value.resultSha256));
export type BrowserReceipt = z.infer<typeof receiptSchema>;
const evidenceFile = z.object({ path: gameFilePath, mime: z.string().min(1).max(300), size: z.number().int().min(0).max(64 * 1024 * 1024), sha256: hash }).strict();
const resultSchema = z.object({ observations: z.array(gameObservation.extend({ evidenceFiles: z.array(evidenceFile).max(2000).optional() })).min(1).max(100) }).strict();

/** Only service-owned directories/files. Game resource names never become host paths. */
export async function privateDirectory(directory: string): Promise<void> {
  await mkdir(directory, { mode: 0o700 });
  await checkDirectory(directory);
}
export async function checkDirectory(directory: string): Promise<void> {
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || (process.getuid && info.uid !== process.getuid()) ||
      (process.platform !== "win32" && (info.mode & 0o077))) throw new Error("Unsafe browser job directory.");
}
export async function ensureDirectory(directory: string): Promise<void> {
  try { await privateDirectory(directory); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    await checkDirectory(directory);
  }
}
export async function readPrivate(file: string, maximum: number): Promise<Buffer> {
  const before = await lstat(file);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > maximum ||
      (process.getuid && before.uid !== process.getuid()) || (process.platform !== "win32" && (before.mode & 0o077))) throw new Error("Unsafe or oversized browser job file.");
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const info = await handle.stat();
    if (info.ino !== before.ino || info.dev !== before.dev || info.size !== before.size) throw new Error("Browser job file changed while opening.");
    const data = Buffer.alloc(info.size); let offset = 0;
    while (offset < data.length) { const { bytesRead } = await handle.read(data, offset, Math.min(1024 * 1024, data.length - offset), offset); if (!bytesRead) throw new Error("Truncated browser job file."); offset += bytesRead; }
    if ((await handle.read(Buffer.alloc(1), 0, 1, offset)).bytesRead) throw new Error("Browser job file grew during reading.");
    return data;
  } finally { await handle.close(); }
}
export async function writePrivate(file: string, data: Uint8Array): Promise<void> {
  const handle = await open(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
  try { await handle.writeFile(data); await handle.sync(); } finally { await handle.close(); }
}
export async function writeJson(file: string, value: unknown): Promise<void> {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try { await writePrivate(temporary, Buffer.from(JSON.stringify(value))); await rename(temporary, file); }
  finally { await unlink(temporary).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; }); }
}
export async function json(file: string, max = 32768): Promise<unknown> { return JSON.parse((await readPrivate(file, max)).toString("utf8")); }
export function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") return false; throw error; }
}
export async function readOperation(directory: string, expected?: BrowserOperation): Promise<BrowserOperation> {
  await checkDirectory(directory);
  const operation = operationSchema.parse(await json(path.join(directory, "operation.json")));
  if (expected && contentHash(operation) !== contentHash(expected)) throw new Error("Browser operation identity differs from its pinned job/toolchain.");
  return operation;
}
export async function writeResult(directory: string, observations: CollectedGameObservation[]): Promise<string> {
  await privateDirectory(path.join(directory, "output"));
  let bytes = 0, count = 0;
  const values = [];
  for (const { evidenceFiles, ...observation } of observations) {
    gameObservation.parse(observation);
    const files = [];
    for (const file of evidenceFiles ?? []) {
      gameFilePath.parse(file.path); bytes += file.data.byteLength; count++;
      if (bytes > 64 * 1024 * 1024 || count > 2000) throw new Error("Browser evidence exceeded its durable candidate budget.");
      const sha256 = digest(file.data), destination = path.join(directory, "output", sha256);
      try { await writePrivate(destination, file.data); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
      files.push({ path: file.path, mime: file.mime, size: file.data.byteLength, sha256 });
    }
    values.push({ ...observation, ...(files.length ? { evidenceFiles: files } : {}) });
  }
  const result = Buffer.from(JSON.stringify(resultSchema.parse({ observations: values })));
  if (result.byteLength > 4 * 1024 * 1024) throw new Error("Browser report metadata exceeded its candidate budget.");
  await writePrivate(path.join(directory, "result.json"), result); return digest(result);
}
export async function readResult(directory: string, sha256: string): Promise<CollectedGameObservation[]> {
  const data = await readPrivate(path.join(directory, "result.json"), 4 * 1024 * 1024);
  if (digest(data) !== sha256) throw new Error("Browser candidate metadata hash differs from its receipt.");
  const result = resultSchema.parse(JSON.parse(data.toString("utf8"))); let bytes = 0, count = 0;
  const observations: CollectedGameObservation[] = [];
  for (const { evidenceFiles, ...observation } of result.observations) {
    const files = [];
    for (const file of evidenceFiles ?? []) {
      bytes += file.size; count++;
      if (bytes > 64 * 1024 * 1024 || count > 2000) throw new Error("Browser candidate exceeds its evidence budget.");
      const data = await readPrivate(path.join(directory, "output", file.sha256), file.size);
      if (data.byteLength !== file.size || digest(data) !== file.sha256) throw new Error("Browser candidate evidence differs from its pinned hash.");
      files.push({ path: file.path, mime: file.mime, data });
    }
    observations.push({ ...observation, ...(evidenceFiles ? { evidenceFiles: files } : {}) });
  }
  return observations;
}
