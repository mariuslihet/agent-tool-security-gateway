import { randomUUID } from 'node:crypto';
import { assert, digest, equal, mac, open, seal, idPattern } from './util.js';
import { redact } from './scanners.js';

const categories = { denials: ['execution.denied', 'request.rejected'], uncertain: ['execution.uncertain'], reviews: ['approval.required'], paused: ['execution.paused'] };
const reasonValid = value => typeof value === 'string' && value.trim().length >= 3 && value.length <= 500 && !value.includes('\0');
const validIdentity = identity => typeof identity?.tenant === 'string' && idPattern.test(identity.tenant) && typeof identity.actor === 'string' && idPattern.test(identity.actor);
export class AlertService {
  constructor(store, clock = Date.now) { this.store = store; this.clock = clock; }
  #decode(row, tenant, alert = false) {
    assert(row, 'ALERT_NOT_FOUND'); const r = open(this.store.encryptionKey, row.data);
    assert(r.tenant === tenant && row.tenant === tenant && r.id === row.id && (!alert || (r.ruleId === row.rule_id && r.ruleVersion === row.rule_version && r.state === row.state && r.version === row.version)), 'STORAGE_INTEGRITY_FAILURE');
    return r;
  }
  rules(tenant) { return this.store.db.prepare('SELECT * FROM alert_rules WHERE tenant=? ORDER BY rowid DESC').all(tenant).map(row => { const rule = this.#decode(row, tenant); return { ...rule, title: redact(rule.title) }; }); }
  configure(identity, input) {
    const { id, expectedVersion, title, category, threshold, windowMinutes, enabled, reason } = input;
    assert(validIdentity(identity) && reasonValid(reason), 'INVALID_ALERT_RULE');
    assert(typeof title === 'string' && title.trim().length >= 3 && title.length <= 80 && !title.includes('\0') && Object.hasOwn(categories, category)
      && Number.isSafeInteger(threshold) && threshold >= 1 && threshold <= 1000 && Number.isSafeInteger(windowMinutes) && windowMinutes >= 1 && windowMinutes <= 1440 && typeof enabled === 'boolean', 'INVALID_ALERT_RULE');
    return this.store.transaction(() => {
      let previous;
      if (id !== undefined) { assert(typeof id === 'string' && idPattern.test(id), 'INVALID_ALERT_RULE'); previous = this.#decode(this.store.db.prepare('SELECT * FROM alert_rules WHERE tenant=? AND id=?').get(identity.tenant, id), identity.tenant); }
      assert(expectedVersion === (previous?.version ?? 0), 'VERSION_CONFLICT');
      if (!previous) assert(this.rules(identity.tenant).length < 20, 'ALERT_RULE_LIMIT');
      const rule = { id: previous?.id ?? randomUUID(), tenant: identity.tenant, version: (previous?.version ?? 0) + 1, title, category, threshold, windowMinutes, enabled, updated: this.clock(), actor: identity.actor };
      this.store.db.prepare('INSERT INTO alert_rules VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(rule.id, rule.tenant, seal(this.store.encryptionKey, rule));
      this.store.append({ type: 'alert.rule_configured', tenant: rule.tenant, actor: identity.actor, rule: rule.id, version: rule.version, category, threshold, windowMinutes, enabled, titleHash: digest(title), reasonHash: digest(reason) });
      return { ...rule, title: redact(title) };
    });
  }
  #save(r) {
    this.store.db.prepare('INSERT INTO console_alerts VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state,version=excluded.version,data=excluded.data')
      .run(r.id, r.tenant, r.ruleId, r.ruleVersion, r.state, r.version, seal(this.store.encryptionKey, r));
  }
  observe(event) {
    if (!Object.values(categories).some(types => types.includes(event.type))) return;
    for (const rule of this.rules(event.tenant)) {
      if (!rule.enabled || !categories[rule.category].includes(event.type)) continue;
      const now = this.clock(), start = now - rule.windowMinutes * 60000;
      const rows = this.store.db.prepare(`SELECT a.* FROM audit a JOIN audit_index i ON i.seq=a.seq WHERE i.tenant=? AND i.at>=? AND i.at<=? AND i.type IN (${categories[rule.category].map(() => '?').join(',')}) ORDER BY a.seq DESC LIMIT 1000`).all(event.tenant, start, now, ...categories[rule.category]);
      for (const row of rows) {
        const source = JSON.parse(row.event);
        assert(source.tenant === event.tenant && categories[rule.category].includes(source.type) && source.at >= start && source.at <= now && equal(row.signature, mac(this.store.auditKey, { previous: row.previous, event: source })), 'STORAGE_INTEGRITY_FAILURE');
      }
      if (rows.length < rule.threshold) continue;
      const row = this.store.db.prepare('SELECT * FROM console_alerts WHERE tenant=? AND rule_id=? AND rule_version=?').get(event.tenant, rule.id, rule.version);
      let r = row ? this.#decode(row, event.tenant, true) : null;
      if (r?.state === 'resolved' && now < r.nextEligibleAt) continue;
      const opened = !r || r.state === 'resolved';
      r = r ? { ...r, state: opened ? 'open' : r.state, version: r.version + 1, count: rows.length, updated: now, sourceEventId: event.eventId } : {
        id: randomUUID(), tenant: event.tenant, ruleId: rule.id, ruleVersion: rule.version, title: rule.title, category: rule.category, threshold: rule.threshold, windowMinutes: rule.windowMinutes,
        state: 'open', version: 1, count: rows.length, created: now, updated: now, sourceEventId: event.eventId, nextEligibleAt: 0, notes: [] };
      this.#save(r);
      if (opened) this.store.append({ type: 'alert.opened', tenant: r.tenant, alert: r.id, rule: rule.id, version: r.version, category: r.category, count: r.count, sourceEventId: event.eventId });
    }
  }
  list(tenant, { limit = 25, state = 'all', before } = {}) {
    assert(Number.isSafeInteger(limit) && limit >= 1 && limit <= 100 && ['all', 'open', 'acknowledged', 'resolved'].includes(state), 'INVALID_QUERY');
    assert(before === undefined || (typeof before === 'string' && /^\d{1,16}$/.test(before) && Number.isSafeInteger(Number(before)) && Number(before) > 0), 'INVALID_QUERY');
    const rows = this.store.db.prepare(`SELECT rowid,* FROM console_alerts WHERE tenant=? AND rowid<? ${state === 'all' ? '' : 'AND state=?'} ORDER BY rowid DESC LIMIT ?`).all(tenant, before ? Number(before) : Number.MAX_SAFE_INTEGER, ...(state === 'all' ? [] : [state]), limit + 1);
    const more = rows.length > limit; if (more) rows.pop();
    return { items: rows.map(row => { const r = this.#decode(row, tenant, true); return { ...r, title: redact(r.title), notes: r.notes.map(n => ({ ...n, text: redact(n.text) })) }; }), nextBefore: more ? String(rows.at(-1).rowid) : null };
  }
  summary(tenant) {
    const counts = { open: 0, acknowledged: 0, resolved: 0, rules: this.rules(tenant).length };
    for (const row of this.store.db.prepare('SELECT state,COUNT(*) AS n FROM console_alerts WHERE tenant=? GROUP BY state').all(tenant)) counts[row.state] = row.n;
    return counts;
  }
  update(identity, id, { expectedVersion, state, reason }) {
    assert(validIdentity(identity) && typeof id === 'string' && idPattern.test(id) && Number.isSafeInteger(expectedVersion) && expectedVersion >= 1 && ['acknowledged', 'resolved'].includes(state) && reasonValid(reason), 'INVALID_ALERT');
    return this.store.transaction(() => {
      const r = this.#decode(this.store.db.prepare('SELECT * FROM console_alerts WHERE tenant=? AND id=?').get(identity.tenant, id), identity.tenant, true);
      assert(r.version === expectedVersion, 'VERSION_CONFLICT');
      r.state = state; r.version++; r.updated = this.clock(); r.nextEligibleAt = r.updated + r.windowMinutes * 60000;
      r.notes.push({ actor: identity.actor, at: r.updated, text: reason }); r.notes = r.notes.slice(-20); this.#save(r);
      this.store.append({ type: 'alert.updated', tenant: r.tenant, actor: identity.actor, alert: id, state, version: r.version, reasonHash: digest(reason) });
      return { id, state, version: r.version };
    });
  }
}
