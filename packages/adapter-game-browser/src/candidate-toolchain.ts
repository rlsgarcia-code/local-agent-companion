import playwright from "playwright-core/package.json";
import versions from "../../contracts/src/version.json";
import { contentHash } from "../../contracts/src/identity";

/** Fixed worker/runtime and administratively provisioned browser, never UI fields. */
export function gameBrowserCandidateToolchain(implementationSha256: string, browserSha256: string, componentSha256?: string) {
  if (![implementationSha256, browserSha256, ...(componentSha256 === undefined ? [] : [componentSha256])].every(pin => /^[a-f0-9]{64}$/.test(pin)))
    throw new Error("Browser collection requires exact implementation and browser pins.");
  return { id: "core-browser", version: `1+playwright.${playwright.version}`,
    sha256: contentHash({ ABI: 1, node: versions.node, playwright: playwright.version,
      implementation: implementationSha256, browser: browserSha256, ...(componentSha256 === undefined ? {} : { component: componentSha256 }) }) };
}
