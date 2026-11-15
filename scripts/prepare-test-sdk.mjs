import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const target = path.resolve("dist-tests/node_modules/@companion/client-sdk");
await mkdir(target, { recursive: true });

const entries = {
  "index.js": "../../../packages/client-ts/src/index.js",
  "bootstrap.js": "../../../packages/client-ts/src/bootstrap.js",
  "contracts.js": "../../../packages/contracts/src/index.js",
  "desktop.js": "../../../packages/contracts/src/desktop.js",
};
for (const [file, source] of Object.entries(entries))
  await writeFile(path.join(target, file), `module.exports = require(${JSON.stringify(source)});\n`);

await writeFile(
  path.join(target, "package.json"),
  `${JSON.stringify({
    name: "@companion/client-sdk",
    private: true,
    exports: {
      ".": "./index.js",
      "./bootstrap": "./bootstrap.js",
      "./contracts": "./contracts.js",
      "./desktop": "./desktop.js",
    },
  }, null, 2)}\n`,
);
