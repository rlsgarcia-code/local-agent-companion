import * as vscode from "vscode";
import { MAX_GOALS, createGoalDraft, normalizeGoal, type GoalRecord } from "./goal-state";

const GOALS_DIRECTORY = ".local-agent/goals";

export class GoalStore {
  public constructor(private readonly context: vscode.ExtensionContext) {}

  public async list(): Promise<GoalRecord[]> {
    const directory = this.directoryUri();
    let entries: [string, vscode.FileType][];
    try {
      entries = await vscode.workspace.fs.readDirectory(directory);
    } catch {
      return [];
    }
    const goals: GoalRecord[] = [];
    for (const [name, type] of entries) {
      if (goals.length >= MAX_GOALS || type & vscode.FileType.SymbolicLink || type & vscode.FileType.Directory || !name.endsWith(".json")) continue;
      try {
        const uri = vscode.Uri.joinPath(directory, name);
        const parsed = normalizeGoal(JSON.parse(new TextDecoder().decode(await vscode.workspace.fs.readFile(uri))));
        if (parsed) goals.push(parsed);
      } catch {
        // Ignore malformed optional goal files; the next save will not overwrite them.
      }
    }
    return goals.sort((left, right) => right.updatedAt - left.updatedAt);
  }

  public async get(id: string): Promise<GoalRecord | undefined> {
    if (!isSafeGoalId(id)) return undefined;
    try {
      const uri = this.goalUri(id);
      const stat = await vscode.workspace.fs.stat(uri);
      if (stat.type & vscode.FileType.SymbolicLink) return undefined;
      return normalizeGoal(JSON.parse(new TextDecoder().decode(await vscode.workspace.fs.readFile(uri))), id);
    } catch {
      return undefined;
    }
  }

  public async create(input: Parameters<typeof createGoalDraft>[0]): Promise<GoalRecord> {
    const goal = createGoalDraft(input);
    await this.save(goal);
    return goal;
  }

  public async save(goal: GoalRecord): Promise<void> {
    if (!isSafeGoalId(goal.id)) throw new Error("The goal identifier is invalid.");
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) throw new Error("Open a workspace before creating a goal.");
    const directory = this.directoryUri();
    await vscode.workspace.fs.createDirectory(directory);
    const destination = this.goalUri(goal.id);
    const temporary = vscode.Uri.joinPath(directory, `.${goal.id}.${String(crypto.randomUUID())}.tmp`);
    const content = `${JSON.stringify(goal, null, 2)}\n`;
    await vscode.workspace.fs.writeFile(temporary, new TextEncoder().encode(content));
    try {
      await vscode.workspace.fs.rename(temporary, destination, { overwrite: true });
    } catch (error) {
      try { await vscode.workspace.fs.delete(temporary, { useTrash: false }); } catch { /* best effort cleanup */ }
      throw error;
    }
  }

  public async open(goal: GoalRecord): Promise<void> {
    await vscode.window.showTextDocument(this.goalUri(goal.id), { preview: false });
  }

  private directoryUri(): vscode.Uri {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) throw new Error("Open a workspace before managing goals.");
    return vscode.Uri.joinPath(folder.uri, ".local-agent", "goals");
  }

  private goalUri(id: string): vscode.Uri {
    return vscode.Uri.joinPath(this.directoryUri(), `${id}.json`);
  }
}

function isSafeGoalId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value);
}
