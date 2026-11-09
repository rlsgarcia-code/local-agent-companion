import { spawn } from "node:child_process";

/** The helper uses the verified bundled Node/SQLite, never the Electron or global Node ABI. */
export async function withBootstrapLock<T>(command: { executable: string; script: string }, directory: string,
  action: () => Promise<T>): Promise<T> {
  const child = spawn(command.executable, [command.script, directory], {
    stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
  });
  let lost = false;
  const exited = new Promise<void>((resolve) => child.once("exit", () => { lost = true; resolve(); }));
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Another client is preparing the engine. Reconnect after it finishes.")), 65_000);
      let output = "";
      const failed = () => { clearTimeout(timeout); reject(new Error("The engine bootstrap lock could not be acquired.")); };
      child.once("error", failed); child.once("exit", failed);
      child.stderr.on("data", () => { /* Never forward environment or helper diagnostics to a public event. */ });
      child.stdout.on("data", (chunk: Buffer) => {
        output += chunk.toString();
        if (output === "BOOTSTRAP_LOCKED\n") {
          clearTimeout(timeout); child.off("error", failed); child.off("exit", failed); resolve();
        } else if (output.length > 128) failed();
      });
    });
    if (lost) throw new Error("The engine bootstrap lock was lost.");
    const result = await action();
    if (lost) throw new Error("The engine bootstrap lock was lost during preparation. Reconnect to verify the service.");
    return result;
  } finally {
    child.stdin.on("error", () => {});
    child.stdin.end();
    const timer = setTimeout(() => child.kill(), 5000); timer.unref();
    // A failed spawn emits error but may not emit exit.
    if (child.pid) await exited;
    clearTimeout(timer);
  }
}
