import pngPackage from "pngjs/package.json";
import versions from "../../contracts/src/version.json";
import { contentHash } from "../../contracts/src/identity";

export const MEDIA_PROCESSOR_ID="kidos-core-media-v1";
/** Administrative implementation pin; never a user-selected tool or command. */
export function gameMediaToolchain(implementationSha256:string) {
  if(!/^[a-f0-9]{64}$/.test(implementationSha256))throw new Error("The media worker requires its exact implementation hash.");
  return {id:"core-media",version:`1+pngjs.${pngPackage.version}`,
    sha256:contentHash({ABI:1,node:versions.node,pngjs:pngPackage.version,implementation:implementationSha256})};
}
