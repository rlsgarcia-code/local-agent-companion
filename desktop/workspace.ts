import { mkdir, readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import * as path from "node:path";

const MAX_FILE_BYTES = 1_500_000;
const MAX_TREE_ENTRIES = 800;
const MAX_SEARCH_RESULTS = 120;
const IGNORED_DIRECTORIES = new Set([".git", "node_modules", "dist", "dist-tests", "desktop-dist", "release", ".next", "build"]);

export async function resolveReadablePath(workspaceRoot: string, requestedPath: string): Promise<string> {
  const candidate = resolveCandidate(workspaceRoot, requestedPath);
  const [root, target] = await Promise.all([realpath(workspaceRoot), realpath(candidate)]);
  assertInside(root, target);
  return target;
}

export async function resolveWritablePath(workspaceRoot: string, requestedPath: string): Promise<string> {
  const candidate = resolveCandidate(workspaceRoot, requestedPath);
  const lexicalRoot = path.resolve(workspaceRoot);
  const root = await realpath(workspaceRoot);
  let ancestor = candidate;
  while (ancestor !== path.dirname(ancestor)) {
    try {
      assertInside(root, await realpath(ancestor));
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      ancestor = path.dirname(ancestor);
    }
  }
  const relative = path.relative(lexicalRoot, candidate).split(path.sep);
  if (relative.includes(".git")) throw new Error("The .git directory cannot be modified by the desktop agent.");
  return candidate;
}

export async function readWorkspaceFile(workspaceRoot: string, requestedPath: string): Promise<string> {
  const target = await resolveReadablePath(workspaceRoot, requestedPath);
  const metadata = await stat(target);
  if (!metadata.isFile()) throw new Error("The requested path is not a file.");
  if (metadata.size > MAX_FILE_BYTES) throw new Error("The requested file exceeds the 1.5 MB local reading limit.");
  return readFile(target, "utf8");
}

export async function writeWorkspaceFile(workspaceRoot: string, requestedPath: string, content: string): Promise<void> {
  if (Buffer.byteLength(content) > MAX_FILE_BYTES) throw new Error("The requested content exceeds the 1.5 MB local writing limit.");
  const target = await resolveWritablePath(workspaceRoot, requestedPath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
}

export async function workspaceTree(workspaceRoot: string): Promise<string[]> {
  const root = await realpath(workspaceRoot);
  const output: string[] = [];
  await visit(root, "");
  return output;

  async function visit(directory: string, relative: string): Promise<void> {
    if (output.length >= MAX_TREE_ENTRIES) return;
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => Number(right.isDirectory()) - Number(left.isDirectory()) || left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (output.length >= MAX_TREE_ENTRIES) return;
      if (entry.name.startsWith(".") && entry.name !== ".local-agent") continue;
      if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) continue;
      const entryRelative = relative ? `${relative}/${entry.name}` : entry.name;
      output.push(`${entry.isDirectory() ? "d" : "f"} ${entryRelative}`);
      if (entry.isDirectory()) await visit(path.join(directory, entry.name), entryRelative);
    }
  }
}

export async function searchWorkspace(workspaceRoot: string, query: string): Promise<string[]> {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) throw new Error("Search text is required.");
  const files = (await workspaceTree(workspaceRoot)).filter((entry) => entry.startsWith("f ")).map((entry) => entry.slice(2));
  const results: string[] = [];
  for (const file of files) {
    if (results.length >= MAX_SEARCH_RESULTS) break;
    try {
      const target = await resolveReadablePath(workspaceRoot, file);
      const metadata = await stat(target);
      if (metadata.size > MAX_FILE_BYTES) continue;
      const text = await readFile(target, "utf8");
      const lines = text.split(/\r?\n/);
      for (let index = 0; index < lines.length && results.length < MAX_SEARCH_RESULTS; index += 1) {
        if (lines[index]!.toLocaleLowerCase().includes(normalized)) {
          results.push(`${file}:${index + 1}: ${lines[index]!.trim().slice(0, 500)}`);
        }
      }
    } catch {
      // Binary, inaccessible and transient files are omitted from local search.
    }
  }
  return results;
}

function resolveCandidate(workspaceRoot: string, requestedPath: string): string {
  if (!requestedPath || requestedPath.includes("\0")) throw new Error("A valid workspace-relative path is required.");
  const root = path.resolve(workspaceRoot);
  const candidate = path.resolve(root, requestedPath.replace(/^[/\\]+/, ""));
  assertInside(root, candidate);
  return candidate;
}

function assertInside(root: string, candidate: string): void {
  const relative = path.relative(root, candidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("The path escapes the selected workspace.");
}
