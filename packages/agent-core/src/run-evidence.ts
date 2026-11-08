export type CommandEvidence = {
  command: string;
  exitCode: number;
  verification: boolean;
  detail?: string;
};

export type DiagnosticEvidence = {
  action: "current" | "baseline" | "compare";
  count?: number;
  introduced?: number;
  resolved?: number;
};

export type BrowserEvidence = {
  action: string;
  pageErrors: number;
  consoleErrors: number;
  blockedRequests: number;
  analyzed?: boolean;
  detail?: string;
};

export type ProcessEvidence = {
  action: string;
  state?: string;
  ready?: boolean;
};

export type DiffEvidence = {
  path: string;
  kind: "created" | "modified" | "deleted";
};

export type FileReadEvidence = {
  path: string;
  sha256: string;
  startLine?: number;
  endLine?: number;
};

export type McpEvidence = {
  tool: string;
  approved: boolean;
};

export type RunEvidenceSnapshot = {
  commands: CommandEvidence[];
  diagnostics: DiagnosticEvidence[];
  browser: BrowserEvidence[];
  processes: ProcessEvidence[];
  diffs?: DiffEvidence[];
  filesRead: FileReadEvidence[];
  mcp?: McpEvidence[];
  projectIndexInspected: boolean;
  playbooksRead: string[];
};

export class RunEvidenceRecorder {
  private readonly commands: CommandEvidence[] = [];
  private readonly diagnostics: DiagnosticEvidence[] = [];
  private readonly browser: BrowserEvidence[] = [];
  private readonly processes: ProcessEvidence[] = [];
  private readonly diffs: DiffEvidence[] = [];
  private readonly filesRead: FileReadEvidence[] = [];
  private readonly mcp: McpEvidence[] = [];
  private readonly playbooks = new Set<string>();
  private projectIndexInspected = false;

  public command(item: CommandEvidence): void {
    this.commands.push(item);
  }

  public diagnostic(item: DiagnosticEvidence): void {
    this.diagnostics.push(item);
  }

  public browserCheck(item: BrowserEvidence): void {
    this.browser.push(item);
  }

  public process(item: ProcessEvidence): void {
    this.processes.push(item);
  }

  public diff(item: DiffEvidence): void { this.diffs.push(item); }

  public fileRead(item: FileReadEvidence): void {
    const existing = this.filesRead.find((file) => file.path === item.path && file.sha256 === item.sha256);
    if (!existing) this.filesRead.push(item);
  }

  public mcpTool(item: McpEvidence): void { this.mcp.push(item); }

  public projectIndex(): void {
    this.projectIndexInspected = true;
  }

  public playbook(name: string): void {
    this.playbooks.add(name);
  }

  public snapshot(): RunEvidenceSnapshot {
    return {
      commands: this.commands.slice(-30),
      diagnostics: this.diagnostics.slice(-20),
      browser: this.browser.slice(-20),
      processes: this.processes.slice(-20),
      diffs: this.diffs.slice(-50),
      filesRead: this.filesRead.slice(-100),
      mcp: this.mcp.slice(-30),
      projectIndexInspected: this.projectIndexInspected,
      playbooksRead: [...this.playbooks].slice(0, 20)
    };
  }
}

export function looksLikeVerificationCommand(command: string, args: string[]): boolean {
  const text = `${command} ${args.join(" ")}`.toLowerCase();
  return /(?:^|\s)(?:test|check|lint|typecheck|type-check|build|verify|pytest|cargo test|go test)(?:\s|$|:)/.test(text);
}
