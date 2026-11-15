import { spawn } from "node:child_process";

/** Shared fixed-argument container CLI, never a host shell or a project-supplied executable. */
export function dockerCommand(executable: string, args: string[], options: { signal?: AbortSignal; timeout?: number; maxBytes?: number } = {}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const env: NodeJS.ProcessEnv = {};
    for (const name of ["PATH", "HOME", "USERPROFILE", "SystemRoot", "WINDIR", "DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_CONFIG"])
      if (process.env[name] !== undefined) env[name] = process.env[name];
    const child = spawn(executable, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true, env });
    const chunks: Buffer[] = []; let bytes = 0, stderr = "", failure: Error | undefined;
    const stop = (error: Error) => { failure ??= error; child.kill("SIGKILL"); };
    const aborted = () => stop(new Error("The isolated build operation was interrupted."));
    const timer = setTimeout(() => stop(new Error("The isolated build operation timed out.")), options.timeout ?? 15000);
    options.signal?.addEventListener("abort", aborted, { once: true });
    if (options.signal?.aborted) aborted();
    child.stdout.on("data", (data: Buffer) => { bytes += data.length; if (bytes > (options.maxBytes ?? 1024 * 1024)) stop(new Error("The isolated build output exceeded its limit.")); else chunks.push(data); });
    child.stderr.on("data", (data: Buffer) => { if (stderr.length < 8192) stderr += data.toString().slice(0, 8192 - stderr.length); });
    child.once("error", (error) => { failure ??= error; });
    child.once("close", (code) => {
      clearTimeout(timer); options.signal?.removeEventListener("abort", aborted);
      if (failure) reject(failure);
      else if (code !== 0) reject(new Error(`Isolated build tool exited ${code}: ${stderr.slice(0, 1500)}`));
      else resolve(Buffer.concat(chunks));
    });
  });
}
