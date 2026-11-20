import { lstat, mkdir, open, rename, rm } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { flushPublishedDirectory } from "../../platform-files/src/directory-flush";
import { GameStudioDraftStore, MAX_GAME_STUDIO_DRAFT_BYTES } from "./game-studio-drafts";

/** Fixed host directory and hashed scope only. No path or filesystem operation is exposed to the renderer. */
export function fileGameStudioDraftStore(userData: string, scope: string, options: { readLegacy?(): Promise<unknown> } = {}): GameStudioDraftStore {
  if (!/^[a-f0-9]{64}$/.test(scope)) throw new Error("Invalid Studio draft scope");
  const directory = path.join(userData, "game-studio-drafts"), file = path.join(directory, `${scope}.json`);
  async function prepare() {
    await mkdir(directory, { mode: 0o700, recursive: true });const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink() || process.getuid && (info.uid !== process.getuid() || (info.mode & 0o077) !== 0)) throw new Error("O armazenamento privado dos rascunhos precisa ser reparado.");
  }
  async function inspect() {
    try { const info = await lstat(file);
      if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > MAX_GAME_STUDIO_DRAFT_BYTES + 1024 || process.getuid && (info.uid !== process.getuid() || (info.mode & 0o077) !== 0)) throw new Error("O rascunho preservado não é um arquivo privado válido.");
      return true;
    } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;throw error; }
  }
  return new GameStudioDraftStore(file, {
    async read() {
      await prepare();if (!await inspect()) return options.readLegacy ? options.readLegacy() : undefined;
      const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const info = await handle.stat();
        if (!info.isFile() || info.nlink !== 1 || info.size > MAX_GAME_STUDIO_DRAFT_BYTES + 1024 || process.getuid && (info.uid !== process.getuid() || (info.mode & 0o077) !== 0)) throw new Error("O rascunho preservado mudou durante a leitura.");
        return JSON.parse(await handle.readFile("utf8"));
      } finally { await handle.close(); }
    },
    async write(value) {
      await prepare();await inspect();const temporary = path.join(directory, `.${scope}.${randomUUID()}.tmp`);
      const handle = await open(temporary, "wx", 0o600);
      try { await handle.writeFile(JSON.stringify(value));await handle.sync(); }
      catch (error) { await handle.close();await rm(temporary, { force: true });throw error; }
      await handle.close();
      try { await rename(temporary, file);await flushPublishedDirectory(directory); }
      catch (error) { await rm(temporary, { force: true });throw error; }
    },
  });
}
