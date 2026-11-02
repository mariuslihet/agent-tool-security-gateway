import { randomUUID } from 'node:crypto';
import { assert, digest, idPattern, open, seal } from './util.js';
import { redact } from './scanners.js';

const signals = {
  SENSITIVE_EGRESS_DENIED: ['high', 'Sensitive data export blocked'],
  SECRET_EGRESS_DENIED: ['high', 'Credential export blocked'],
  PII_EGRESS_DENIED: ['medium', 'Personal data export blocked'],
  UNTRUSTED_EGRESS_DENIED: ['medium', 'Untrusted data followed by an outbound action'],
  EXECUTION_TIMEOUT: ['high', 'Tool execution timed out'],
  EXECUTION_UNCERTAIN: ['high', 'External effect needs reconciliation'],
  IDEMPOTENCY_CONFLICT: ['high', 'Request identifier reused with different arguments'],
};
const isId = value => typeof value === 'string' && idPattern.test(value);
function note(value) { assert(typeof value === 'string' && value.trim().length >= 3 && value.length <= 500 && !value.includes('\0'), 'INVALID_REASON'); }
function actorIdentity(identity) { assert(isId(identity.tenant) && isId(identity.actor), 'INVALID_IDENTITY'); }

export class IncidentService {
  constructor(store, clock = Date.now) { this.store = store; this.clock = clock; }
  #decode(row, tenant) {
    const record = open(this.store.encryptionKey, row.data);
    assert(record.tenant === tenant && row.tenant === tenant && record.id === row.id && record.fingerprint === row.fingerprint
      && record.state === row.state && record.version === row.version, 'STORAGE_INTEGRITY_FAILURE');
    return record;
  }
  #save(record) {
    this.store.db.prepare(`INSERT INTO incidents VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state,version=excluded.version,updated=excluded.updated,data=excluded.data`)
      .run(record.id, record.tenant, record.fingerprint, record.state, record.version, record.updated, seal(this.store.encryptionKey, record));
  }
  #read(tenant, id) {
    const row = this.store.db.prepare('SELECT * FROM incidents WHERE tenant=? AND id=?').get(tenant, id);
    assert(row, 'INCIDENT_NOT_FOUND'); return this.#decode(row, tenant);
  }
  #public(record) { return { ...record, notes: record.notes.map(n => ({ ...n, text: redact(n.text) })) }; }
  // Called inside the same transaction as the source audit event. No raw arguments or results.
  observe(event) {
    const signal = signals[event.code];
    if (!signal || !['execution.denied', 'execution.uncertain', 'request.rejected'].includes(event.type)) return;
    const fingerprint = digest({ tenant: event.tenant, session: event.session ?? null, tool: event.tool ?? null, code: event.code });
    const row = this.store.db.prepare('SELECT * FROM incidents WHERE tenant=? AND fingerprint=?').get(event.tenant, fingerprint);
    const now = this.clock();
    let record, change;
    if (row) {
      record = this.#decode(row, event.tenant); change = record.state === 'resolved' ? 'reopened' : 'observed';
      if (record.state === 'resolved') record.state = 'open';
      record.occurrences++; record.version++; record.updated = now; record.lastEventId = event.eventId;
    } else {
      record = { id: randomUUID(), tenant: event.tenant, fingerprint, code: event.code, severity: signal[0], title: signal[1],
        sessionId: event.session ?? null, tool: event.tool ?? null, state: 'open', owner: '', version: 1,
        occurrences: 1, created: now, updated: now, firstEventId: event.eventId, lastEventId: event.eventId, notes: [], notesTruncated: false };
      change = 'created';
    }
    this.#save(record);
    this.store.append({ type: `incident.${change}`, tenant: record.tenant, incident: record.id, code: record.code, version: record.version,
      ...(record.sessionId ? { session: record.sessionId } : {}), sourceEventId: event.eventId });
  }
  list(tenant, { state = 'all', limit = 25, before } = {}) {
    assert(['all', 'open', 'acknowledged', 'resolved'].includes(state) && Number.isSafeInteger(limit) && limit >= 1 && limit <= 100, 'INVALID_QUERY');
    let upper = Number.MAX_SAFE_INTEGER;
    if (before !== undefined) { assert(typeof before === 'string' && /^\d{1,16}$/.test(before), 'INVALID_QUERY'); upper = Number(before); assert(Number.isSafeInteger(upper) && upper > 0, 'INVALID_QUERY'); }
    const rows = this.store.db.prepare(`SELECT rowid,* FROM incidents WHERE tenant=? AND rowid<? ${state === 'all' ? '' : 'AND state=?'} ORDER BY rowid DESC LIMIT ?`)
      .all(tenant, upper, ...(state === 'all' ? [] : [state]), limit + 1);
    const more = rows.length > limit; if (more) rows.pop();
    return { items: rows.map(row => this.#public(this.#decode(row, tenant))), nextBefore: more ? String(rows.at(-1).rowid) : null };
  }
  get(tenant, id) { assert(isId(id), 'INVALID_INCIDENT'); return this.#public(this.#read(tenant, id)); }
  counts(tenant) {
    const result = { open: 0, acknowledged: 0, resolved: 0 };
    for (const row of this.store.db.prepare('SELECT state,COUNT(*) AS n FROM incidents WHERE tenant=? GROUP BY state').all(tenant)) result[row.state] = row.n;
    return result;
  }
  update(identity, id, { expectedVersion, state, owner, reason }) {
    actorIdentity(identity); assert(isId(id), 'INVALID_INCIDENT'); note(reason);
    assert(Number.isSafeInteger(expectedVersion) && expectedVersion >= 1 && ['open', 'acknowledged', 'resolved'].includes(state), 'INVALID_INCIDENT');
    assert(owner === undefined || owner === '' || isId(owner), 'INVALID_OWNER');
    return this.store.transaction(() => {
      const record = this.#read(identity.tenant, id); assert(record.version === expectedVersion, 'VERSION_CONFLICT');
      record.state = state; record.owner = owner ?? record.owner; record.version++; record.updated = this.clock();
      record.notes.push({ actor: identity.actor, at: record.updated, text: reason });
      if (record.notes.length > 20) { record.notes.shift(); record.notesTruncated = true; }
      this.#save(record);
      this.store.append({ type: 'incident.updated', tenant: identity.tenant, incident: id, actor: identity.actor, state, version: record.version, reasonHash: digest(reason) });
      return this.#public(record);
    });
  }
}

export class SafetyService {
  constructor(store, clock = Date.now) { this.store = store; this.clock = clock; }
  #read(tenant) {
    const row = this.store.db.prepare('SELECT data FROM safety_holds WHERE tenant=?').get(tenant);
    if (!row) return { tenant, revision: 0, enabled: false, scope: null, expires: null };
    const record = open(this.store.encryptionKey, row.data); assert(record.tenant === tenant, 'STORAGE_INTEGRITY_FAILURE'); return record;
  }
  #save(record) { this.store.db.prepare('INSERT INTO safety_holds VALUES (?,?) ON CONFLICT(tenant) DO UPDATE SET data=excluded.data').run(record.tenant, seal(this.store.encryptionKey, record)); }
  get(tenant) {
    const record = this.#read(tenant), active = record.enabled && record.expires > this.clock();
    return { ...record, reason: redact(record.reason ?? ''), resumeReason: redact(record.resumeReason ?? ''), active,
      status: active ? 'paused' : record.enabled ? 'expired' : record.revision ? 'resumed' : 'normal' };
  }
  check(tenant, tool) {
    const record = this.#read(tenant);
    return record.enabled && record.expires > this.clock() && (record.scope === 'all' || tool?.egress)
      ? { scope: record.scope, expires: record.expires, revision: record.revision } : null;
  }
  pause(identity, { expectedRevision, scope, durationMinutes, reason }) {
    actorIdentity(identity); note(reason);
    assert(Number.isSafeInteger(expectedRevision) && expectedRevision >= 0 && ['all', 'outbound'].includes(scope)
      && Number.isSafeInteger(durationMinutes) && durationMinutes >= 1 && durationMinutes <= 1440, 'INVALID_SAFETY_HOLD');
    return this.store.transaction(() => {
      const previous = this.#read(identity.tenant); assert(previous.revision === expectedRevision, 'VERSION_CONFLICT');
      const now = this.clock(), record = { tenant: identity.tenant, revision: previous.revision + 1, enabled: true, scope,
        created: now, expires: now + durationMinutes * 60000, actor: identity.actor, reason };
      this.#save(record);
      this.store.append({ type: 'safety.paused', tenant: identity.tenant, actor: identity.actor, scope, expires: record.expires, revision: record.revision, reasonHash: digest(reason) });
      return this.get(identity.tenant);
    });
  }
  resume(identity, { expectedRevision, reason }) {
    actorIdentity(identity); note(reason); assert(Number.isSafeInteger(expectedRevision) && expectedRevision > 0, 'INVALID_SAFETY_HOLD');
    return this.store.transaction(() => {
      const record = this.#read(identity.tenant); assert(record.revision === expectedRevision, 'VERSION_CONFLICT'); assert(record.enabled, 'HOLD_NOT_ACTIVE');
      record.enabled = false; record.revision++; record.resumedAt = this.clock(); record.resumedBy = identity.actor; record.resumeReason = reason;
      this.#save(record);
      this.store.append({ type: 'safety.resumed', tenant: identity.tenant, actor: identity.actor, revision: record.revision, reasonHash: digest(reason) });
      return this.get(identity.tenant);
    });
  }
}
