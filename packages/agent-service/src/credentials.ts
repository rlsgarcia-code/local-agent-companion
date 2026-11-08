import { AgentError, errors, type Registration } from "../../contracts/src/index";
import { namespace } from "./security";

type Lease = { key: string; scope: string; value: string; users: Set<string>; timer: NodeJS.Timeout };

/** In-memory grants are pinned only by their actual users, including credential rotation. */
export class CredentialVault {
  private readonly grants = new Map<string, Lease>();
  private readonly active = new Map<string, Lease>();
  constructor(private readonly ttl = 300_000) {}
  grant(reg: Registration, reference: string, value: string): void {
    const key = `${reg.id}/${reference}`;
    const previous = this.grants.get(key);
    if (previous) clearTimeout(previous.timer);
    const expire = () => {
      if (this.grants.get(key) !== lease) return;
      if (lease.users.size) { lease.timer = setTimeout(expire, this.ttl); lease.timer.unref(); }
      else this.grants.delete(key);
    };
    const lease: Lease = { key, scope: namespace(reg), value, users: new Set(), timer: setTimeout(expire, this.ttl) };
    lease.timer.unref();
    this.grants.set(key, lease);
  }
  acquire(reg: Registration, reference: string, run: string): string | undefined {
    const lease = this.grants.get(`${reg.id}/${reference}`);
    if (!lease) return undefined;
    if (lease.scope !== namespace(reg)) throw new AgentError(errors.forbidden, "Credential grant belongs to another namespace.");
    const previous = this.active.get(run);
    if (previous && previous !== lease) throw new AgentError(errors.conflict, "A run already holds another credential grant.");
    lease.users.add(run);
    this.active.set(run, lease);
    return lease.value;
  }
  forRun(reg: Registration, run: string): string | undefined {
    const lease=this.active.get(run);
    if (lease && lease.scope !== namespace(reg)) throw new AgentError(errors.forbidden,"Credential belongs to another namespace.");
    return lease?.value;
  }
  release(run: string): void {
    const lease = this.active.get(run);
    if (!lease) return;
    lease.users.delete(run);
    this.active.delete(run);
    if (!lease.users.size && this.grants.get(lease.key) === lease) {
      clearTimeout(lease.timer);
      this.grants.delete(lease.key);
    }
  }
  secrets(reg: Registration): string[] {
    const scope = namespace(reg);
    return [...new Set([...this.grants.values(), ...this.active.values()].filter((lease) => lease.scope === scope).map((lease) => lease.value))];
  }
  clear(): void {
    for (const lease of this.grants.values()) clearTimeout(lease.timer);
    this.grants.clear(); this.active.clear();
  }
}
