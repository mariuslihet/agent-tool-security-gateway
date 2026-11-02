import { assert, digest, idPattern, toolPattern, open, seal } from './util.js';
import { redact } from './scanners.js';

const isId = value => typeof value === 'string' && idPattern.test(value);
const validReason = value => typeof value === 'string' && value.trim().length >= 3 && value.length <= 500 && !value.includes('\0');
// Reference deployment bounds: consistent with existing list and tenant pause limits.
export const CONTAINMENT_LIMITS = Object.freeze({ maxTargets: 100, maxDurationMinutes: 1440 });
export class ScopedContainment {
  constructor(store, registry, clock = Date.now) { this.store = store; this.registry = registry; this.clock = clock; }
  #target(tenant, kind, target) {
    assert(isId(tenant) && ['session', 'tool'].includes(kind) && typeof target === 'string', 'INVALID_CONTAINMENT');
    if (kind === 'session') { assert(isId(target), 'INVALID_CONTAINMENT'); assert(this.store.session(target)?.tenant === tenant, 'SESSION_NOT_FOUND'); }
    else assert(toolPattern.test(target) && this.registry.get(target), 'UNKNOWN_TOOL');
  }
  #read(tenant, kind, target) {
    const row = this.store.db.prepare('SELECT * FROM scoped_holds WHERE tenant=? AND kind=? AND target=?').get(tenant, kind, target);
    if (!row) return { tenant, kind, target, revision: 0, enabled: false, expires: null };
    const r = open(this.store.encryptionKey, row.data);
    assert(r.tenant === tenant && r.kind === kind && r.target === target, 'STORAGE_INTEGRITY_FAILURE'); return r;
  }
  #public(r) {
    const active = r.enabled && r.expires > this.clock();
    return { ...r, active, state: active ? 'active' : r.enabled ? 'expired' : r.revision ? 'released' : 'clear', reason: redact(r.reason ?? ''), releaseReason: redact(r.releaseReason ?? '') };
  }
  #save(r) { this.store.db.prepare('INSERT INTO scoped_holds VALUES (?,?,?,?) ON CONFLICT(tenant,kind,target) DO UPDATE SET data=excluded.data').run(r.tenant, r.kind, r.target, seal(this.store.encryptionKey, r)); }
  get(tenant, kind, target) { this.#target(tenant, kind, target); return this.#public(this.#read(tenant, kind, target)); }
  list(tenant) {
    assert(isId(tenant), 'INVALID_CONTAINMENT');
    const rows = this.store.db.prepare('SELECT kind,target FROM scoped_holds WHERE tenant=? ORDER BY rowid DESC LIMIT ?').all(tenant, CONTAINMENT_LIMITS.maxTargets + 1);
    assert(rows.length <= CONTAINMENT_LIMITS.maxTargets, 'STORAGE_INTEGRITY_FAILURE');
    return { items: rows.map(row => this.#public(this.#read(tenant, row.kind, row.target))), limits: CONTAINMENT_LIMITS };
  }
  hold(identity, { kind, target, expectedRevision, durationMinutes, reason }) {
    assert(isId(identity?.actor) && validReason(reason) && Number.isSafeInteger(expectedRevision) && expectedRevision >= 0
      && Number.isSafeInteger(durationMinutes) && durationMinutes >= 1 && durationMinutes <= CONTAINMENT_LIMITS.maxDurationMinutes, 'INVALID_CONTAINMENT');
    return this.store.transaction(() => {
      this.#target(identity.tenant, kind, target); const previous = this.#read(identity.tenant, kind, target);
      assert(previous.revision === expectedRevision, 'VERSION_CONFLICT');
      if (!previous.revision) assert(this.list(identity.tenant).items.length < CONTAINMENT_LIMITS.maxTargets, 'CONTAINMENT_LIMIT');
      const now = this.clock(), r = { tenant: identity.tenant, kind, target, revision: previous.revision + 1, enabled: true, actor: identity.actor, created: now, expires: now + durationMinutes * 60000, reason };
      this.#save(r); this.store.append({ type: 'containment.held', tenant: r.tenant, actor: identity.actor, targetKind: kind, target, revision: r.revision, expires: r.expires, reasonHash: digest(reason) });
      return this.#public(r);
    });
  }
  release(identity, { kind, target, expectedRevision, reason }) {
    assert(isId(identity?.actor) && validReason(reason) && Number.isSafeInteger(expectedRevision) && expectedRevision > 0, 'INVALID_CONTAINMENT');
    return this.store.transaction(() => {
      this.#target(identity.tenant, kind, target); const r = this.#read(identity.tenant, kind, target);
      assert(r.revision === expectedRevision, 'VERSION_CONFLICT'); assert(r.enabled, 'HOLD_NOT_ACTIVE');
      r.enabled = false; r.revision++; r.releasedAt = this.clock(); r.releasedBy = identity.actor; r.releaseReason = reason; this.#save(r);
      this.store.append({ type: 'containment.released', tenant: r.tenant, actor: identity.actor, targetKind: kind, target, revision: r.revision, reasonHash: digest(reason) });
      return this.#public(r);
    });
  }
  // Called during the same write transaction as reservation. The host supplies the validated lineage.
  check(tenant, chain, tool) {
    for (const [kind, target] of [...chain.map(s => ['session', s.id]), ...(tool ? [['tool', tool]] : [])]) {
      const r = this.#read(tenant, kind, target);
      if (r.enabled && r.expires > this.clock()) return { code: kind === 'session' ? 'SESSION_QUARANTINED' : 'TOOL_PAUSED', kind, target, revision: r.revision, expires: r.expires };
    }
    return null;
  }
}
