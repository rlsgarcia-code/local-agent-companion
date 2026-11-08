export type CommandRisk = {
  level: "standard" | "destructive";
  warning?: string;
};

const NETWORK_CLIENTS = new Set([
  "curl", "wget", "ssh", "scp", "sftp", "ftp", "telnet", "nc", "ncat", "socat"
]);
const SHELLS = new Set([
  "sh", "bash", "zsh", "dash", "ksh", "fish", "cmd", "powershell", "pwsh", "nu"
]);
const COMMAND_WRAPPERS = new Set([
  "env", "xargs", "timeout", "nohup", "sudo", "doas", "osascript", "wscript", "cscript"
]);
const DESTRUCTIVE_EXECUTABLES = new Set([
  "rm", "rmdir", "del", "erase", "unlink", "shred", "truncate", "dd"
]);

export function evaluateCommandPolicy(command: string, args: string[]): CommandRisk {
  const executable = normalizeExecutable(command);
  const subcommand = args[0]?.toLowerCase();

  if (NETWORK_CLIENTS.has(executable)) {
    throw new Error("Network client commands are disabled; model traffic is allowed only through the configured provider client.");
  }
  if (SHELLS.has(executable)) {
    throw new Error("Shell interpreters are disabled. Run the intended executable directly instead.");
  }
  if (COMMAND_WRAPPERS.has(executable)) {
    throw new Error(`${command} is disabled because it can launch a second, unreviewed command.`);
  }
  rejectInlineCode(executable, args);
  rejectRemoteUrls(args);
  rejectNetworkedPackageOperation(executable, subcommand);
  rejectNetworkedGitOperation(executable, subcommand);

  if (isDestructive(executable, args)) {
    return {
      level: "destructive",
      warning: "This command can remove, replace, or discard workspace data. Review every argument before approving it."
    };
  }
  return { level: "standard" };
}

function normalizeExecutable(command: string): string {
  return command.toLowerCase().replace(/\.(?:exe|cmd|bat)$/i, "");
}

function rejectInlineCode(executable: string, args: string[]): void {
  const blockedFlags: Record<string, Set<string>> = {
    node: new Set(["-e", "--eval", "-p", "--print"]),
    python: new Set(["-c"]),
    python3: new Set(["-c"]),
    py: new Set(["-c"]),
    ruby: new Set(["-e"]),
    perl: new Set(["-e"]),
    php: new Set(["-r"])
  };
  const flags = blockedFlags[executable];
  if (flags && args.some((argument) => flags.has(argument.toLowerCase()))) {
    throw new Error("Inline code execution is disabled. Run a reviewed workspace script instead.");
  }
}

function rejectRemoteUrls(args: string[]): void {
  for (const argument of args) {
    const matches = argument.matchAll(/https?:\/\/[^\s"']+/gi);
    for (const match of matches) {
      try {
        const hostname = new URL(match[0]).hostname.toLowerCase();
        if (!["localhost", "127.0.0.1", "::1"].includes(hostname)) {
          throw new Error("Remote URLs are disabled for local commands. Use only the configured model provider connection.");
        }
      } catch (error) {
        if (error instanceof Error && /Remote URLs are disabled/.test(error.message)) throw error;
      }
    }
  }
}

function rejectNetworkedPackageOperation(executable: string, subcommand: string | undefined): void {
  if (executable === "npx") {
    throw new Error("npx is disabled because it may download and execute packages. Use an installed workspace script instead.");
  }
  const blocked = new Set(["install", "add", "update", "upgrade", "publish", "exec", "dlx", "x"]);
  if (["npm", "pnpm", "yarn", "bun"].includes(executable) && blocked.has(subcommand ?? "")) {
    throw new Error("Package download and publish commands are disabled for the local agent runtime.");
  }
  if (executable === "yarn" && !subcommand) {
    throw new Error("Bare yarn may install packages and is disabled. Run a named local script instead.");
  }
}

function rejectNetworkedGitOperation(executable: string, subcommand: string | undefined): void {
  if (executable !== "git") return;
  if (["clone", "fetch", "pull", "push", "ls-remote", "submodule"].includes(subcommand ?? "")) {
    throw new Error("Networked Git commands are disabled for the local agent runtime.");
  }
}

function isDestructive(executable: string, args: string[]): boolean {
  if (DESTRUCTIVE_EXECUTABLES.has(executable)) return true;
  if (executable === "find" && args.some((argument) => ["-delete", "-exec", "-execdir"].includes(argument))) {
    return true;
  }
  if (["npm", "pnpm", "yarn", "bun"].includes(executable) && ["remove", "uninstall"].includes(args[0]?.toLowerCase() ?? "")) {
    return true;
  }
  if (executable !== "git") return false;
  const subcommand = args[0]?.toLowerCase();
  if (["clean", "restore"].includes(subcommand ?? "")) return true;
  if (subcommand === "reset" && args.some((argument) => ["--hard", "--merge", "--keep"].includes(argument))) return true;
  if (subcommand === "checkout" && args.some((argument) => argument === "--" || argument === "-f" || argument === "--force")) return true;
  if (subcommand === "branch" && args.some((argument) => argument === "-d" || argument === "-D")) return true;
  if (subcommand === "stash" && ["drop", "clear"].includes(args[1]?.toLowerCase() ?? "")) return true;
  return subcommand === "worktree" && args[1]?.toLowerCase() === "remove";
}
