import { accessSync, constants, statSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

type ExecutableResolutionOptions = {
  platform?: NodeJS.Platform;
  environment?: NodeJS.ProcessEnv;
  homeDirectory?: string;
  isExecutable?: (candidate: string) => boolean;
};

export function resolveDockerExecutable(
  options: ExecutableResolutionOptions = {},
): string {
  const platform = options.platform ?? process.platform;
  const environment = options.environment ?? process.env;
  const homeDirectory = options.homeDirectory ?? os.homedir();
  const isExecutable = options.isExecutable ?? executableFile;
  const executableName = platform === "win32" ? "docker.exe" : "docker";
  const configured = environment.LOCAL_COMPANION_DOCKER_PATH?.trim();
  const fromPath = (environment.PATH ?? "")
    .split(path.delimiter)
    .filter(Boolean)
    .map((directory) => path.join(directory, executableName));
  const known =
    platform === "darwin"
      ? [
          "/usr/local/bin/docker",
          "/opt/homebrew/bin/docker",
          "/Applications/Docker.app/Contents/Resources/bin/docker",
          path.join(homeDirectory, ".docker", "bin", "docker"),
        ]
      : platform === "win32"
        ? [
            path.join(
              environment.ProgramFiles ?? "C:\\Program Files",
              "Docker",
              "Docker",
              "resources",
              "bin",
              "docker.exe",
            ),
            path.join(
              environment.LOCALAPPDATA ?? "",
              "Docker",
              "resources",
              "bin",
              "docker.exe",
            ),
          ]
        : ["/usr/bin/docker", "/usr/local/bin/docker", "/snap/bin/docker"];
  for (const candidate of unique([configured, ...fromPath, ...known])) {
    if (candidate && isExecutable(candidate)) return candidate;
  }
  throw new Error(
    "Docker está habilitado, mas o executável local não foi encontrado. Instale/inicie o Docker Desktop ou informe LOCAL_COMPANION_DOCKER_PATH ao abrir o aplicativo.",
  );
}

function executableFile(candidate: string): boolean {
  try {
    if (!statSync(candidate).isFile()) return false;
    accessSync(
      candidate,
      process.platform === "win32" ? constants.F_OK : constants.X_OK,
    );
    return true;
  } catch {
    return false;
  }
}

function unique(values: Array<string | undefined>): string[] {
  return [
    ...new Set(values.filter((value): value is string => Boolean(value))),
  ];
}
