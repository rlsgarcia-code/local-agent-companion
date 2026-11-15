import {pathToFileURL} from "node:url";
import path from "node:path";
import {runEnginePackageCli} from "./engine-package.mjs";
export {packageEngine,assertReleaseCheckout,runEnginePackageCli} from "./engine-package.mjs";

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)await runEnginePackageCli();
