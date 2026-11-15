import { safeStorage } from "electron";
import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import * as path from "node:path";

type StoredCredentials = { openai?: string };

/** Credentials are encrypted with Electron safeStorage (Keychain on macOS). */
export class DesktopCredentialStore {
  public constructor(private readonly filePath: string) {}

  public async hasOpenAiKey(): Promise<boolean> {
    return Boolean((await this.read()).openai);
  }

  public async openAiKey(): Promise<string | undefined> {
    const encrypted = (await this.read()).openai;
    if (!encrypted) return undefined;
    if (!safeStorage.isEncryptionAvailable()) throw new Error("O Keychain do macOS não está disponível para descriptografar a chave OpenAI.");
    return safeStorage.decryptString(Buffer.from(encrypted, "base64"));
  }

  public async saveOpenAiKey(value: string): Promise<void> {
    const key = value.trim();
    if (!key || key.length > 16_384) throw new Error("Informe uma chave OpenAI válida.");
    if (!safeStorage.isEncryptionAvailable()) throw new Error("O Keychain do macOS não está disponível para proteger a chave OpenAI.");
    const state = await this.read();
    state.openai = safeStorage.encryptString(key).toString("base64");
    await this.write(state);
  }

  public async clearOpenAiKey(): Promise<void> {
    const state = await this.read();
    delete state.openai;
    if (!Object.keys(state).length) {
      await unlink(this.filePath).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
      return;
    }
    await this.write(state);
  }

  private async read(): Promise<StoredCredentials> {
    try {
      const value = JSON.parse(await readFile(this.filePath, "utf8")) as StoredCredentials;
      return value && typeof value === "object" ? value : {};
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw error;
    }
  }

  private async write(value: StoredCredentials): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    const temporary = `${this.filePath}.tmp`;
    await writeFile(temporary, `${JSON.stringify(value)}\n`, { encoding: "utf8", mode: 0o600 });
    await chmod(temporary, 0o600);
    await rename(temporary, this.filePath);
  }
}
