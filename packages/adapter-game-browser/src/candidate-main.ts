import versions from "../../contracts/src/version.json";
import { processBrowserCandidate } from "./candidate";
import { loadCoreBrowser } from "./candidate-browser";

const args = process.argv.slice(2), controller = new AbortController();
process.once("SIGTERM", () => controller.abort()); process.once("SIGINT", () => controller.abort());
if (process.platform !== "linux" || process.versions.node !== versions.node || args.length !== 4 ||
    args[0] !== "/input" || args[1] !== "/output" || !/^[a-f0-9]{64}$/.test(args[2]!) || !/^[a-f0-9]{64}$/.test(args[3]!)) {
  process.stderr.write("The fixed browser candidate requires bundled Linux Node and exact broker mounts.\n"); process.exitCode = 1;
} else void loadCoreBrowser().then(browser => processBrowserCandidate({ inputDirectory: args[0]!, outputDirectory: args[1]!,
  implementationSha256: args[2]!, componentSha256: args[3]!, browser, signal: controller.signal }))
  .then(result => { process.stdout.write(JSON.stringify({ schemaVersion: 1, requestId: result.requestId, observations: result.observations.length }) + "\n"); })
  .catch(() => { process.stderr.write("Browser collection did not commit; inspect the original candidate and process unit.\n"); process.exitCode = 1; });
