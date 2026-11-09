import { existsSync, lstatSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { z } from "zod";
import { AgentError, errors, type Registration } from "../../contracts/src/index";
import { contentHash } from "../../contracts/src/identity";

const POLICY = "/etc/kidos/agent-policy.json";
export const provisioningPolicy = z.object({
  schema: z.literal(1),
  clients: z.array(z.object({
    uid: z.number().int().nonnegative(),
    id: z.string().min(1).max(128),
    registrationSha256: z.string().regex(/^[a-f0-9]{64}$/),
  }).strict()).max(4096),
}).strict();

export function authorizeProvisionedClient(
  reg: Registration,
  policy: z.infer<typeof provisioningPolicy>,
  uid: number,
): void {
  if (!policy.clients.some((entry) => entry.uid === uid && entry.id === reg.id &&
    entry.registrationSha256 === contentHash(reg)))
    throw new AgentError(errors.forbidden, "Client identity, product, profile or adapter was not provisioned for this OS user.");
}

/** A KidOS installation never trusts an enrollment policy supplied by the child. */
export function enforceSystemProvisioning(reg: Registration): void {
  if (process.platform !== "linux") return;
  const installed = existsSync("/usr/share/kidos/guardian-release.json") || existsSync("/usr/lib/kidos");
  if (!installed && !existsSync(POLICY)) return;
  try {
    for (let item = POLICY; item !== path.dirname(item); item = path.dirname(item)) {
      const stat = lstatSync(item);
      if (stat.isSymbolicLink() || stat.uid !== 0 || (stat.mode & 0o022) !== 0)
        throw new Error("Unsafe system policy path.");
      if (item === POLICY && (!stat.isFile() || stat.size > 1024 * 1024))
        throw new Error("Invalid system policy.");
    }
    const policy = provisioningPolicy.parse(JSON.parse(readFileSync(POLICY, "utf8")));
    authorizeProvisionedClient(reg, policy, process.getuid!());
  } catch (error) {
    if (error instanceof AgentError) throw error;
    throw new AgentError(errors.forbidden, "KidOS engine registration requires the protected system provisioning policy. Repair the installation with the administrator account.");
  }
}
