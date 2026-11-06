import { DatabaseSync } from 'node:sqlite';
import { hkdfSync, randomUUID } from 'node:crypto';
import { assert, canonical, digest, equal, mac, seal, open } from './util.js';

export class Store {
  #auditHealthy = true;
  #verifiedAt = null;
  constructor(path, masterKey) {
    assert(typeof masterKey === 'string' && Buffer.byteLength(masterKey) >= 32, 'MASTER_KEY_REQUIRED');
    this.encryptionKey = Buffer.from(hkdfSync('sha256', masterKey, 'agent-gateway-v1', 'storage', 32));
    this.auditKey = Buffer.from(hkdfSync('sha256', masterKey, 'agent-gateway-v1', 'audit', 32));
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, principal TEXT NOT NULL, tenant TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS requests (session TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(session,id));
      CREATE TABLE IF NOT EXISTS audit (seq INTEGER PRIMARY KEY AUTOINCREMENT, event TEXT NOT NULL, previous TEXT NOT NULL, signature TEXT NOT NULL);`);
    try {
      const keyCheck = mac(this.auditKey, 'key-check-v1');
      const existing = this.db.prepare('SELECT value FROM meta WHERE key=?').get('key-check');
      if (existing) assert(equal(existing.value, keyCheck), 'WRONG_MASTER_KEY');
      else this.db.prepare('INSERT INTO meta VALUES (?,?)').run('key-check', keyCheck);
      assert(this.verifyAudit().valid, 'AUDIT_CORRUPTED');
      this.db.exec(`CREATE TABLE IF NOT EXISTS audit_index (
        seq INTEGER PRIMARY KEY, tenant TEXT NOT NULL, type TEXT NOT NULL, tool TEXT,
        code TEXT, at INTEGER NOT NULL, session TEXT, duration REAL, status TEXT);
        CREATE INDEX IF NOT EXISTS audit_tenant_seq ON audit_index(tenant,seq DESC);
        CREATE INDEX IF NOT EXISTS audit_tenant_time ON audit_index(tenant,at);
        CREATE INDEX IF NOT EXISTS sessions_tenant ON sessions(tenant);
        CREATE TABLE IF NOT EXISTS incidents (id TEXT PRIMARY KEY, tenant TEXT NOT NULL, fingerprint TEXT NOT NULL,
          state TEXT NOT NULL, version INTEGER NOT NULL, updated INTEGER NOT NULL, data TEXT NOT NULL, UNIQUE(tenant,fingerprint));
        CREATE INDEX IF NOT EXISTS incidents_tenant_state ON incidents(tenant,state);
        CREATE TABLE IF NOT EXISTS safety_holds (tenant TEXT PRIMARY KEY, data TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS request_index (session TEXT NOT NULL,id TEXT NOT NULL,tenant TEXT NOT NULL,
          principal TEXT NOT NULL,tool_hash TEXT NOT NULL,status TEXT NOT NULL,created INTEGER NOT NULL,code TEXT,PRIMARY KEY(session,id));
        CREATE INDEX IF NOT EXISTS request_tenant ON request_index(tenant,status);
        CREATE TABLE IF NOT EXISTS alert_rules (id TEXT PRIMARY KEY,tenant TEXT NOT NULL,data TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS alert_rules_tenant ON alert_rules(tenant);
        CREATE TABLE IF NOT EXISTS console_alerts (id TEXT PRIMARY KEY,tenant TEXT NOT NULL,rule_id TEXT NOT NULL,
          rule_version INTEGER NOT NULL,state TEXT NOT NULL,version INTEGER NOT NULL,data TEXT NOT NULL,UNIQUE(tenant,rule_id,rule_version));
        CREATE INDEX IF NOT EXISTS alerts_tenant ON console_alerts(tenant,state);
        CREATE TABLE IF NOT EXISTS scoped_holds (tenant TEXT NOT NULL,kind TEXT NOT NULL,target TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(tenant,kind,target));
        CREATE TABLE IF NOT EXISTS agent_runs (id TEXT PRIMARY KEY,tenant TEXT NOT NULL,principal TEXT NOT NULL,data TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS agent_runs_tenant ON agent_runs(tenant);
        CREATE TABLE IF NOT EXISTS agent_run_locks (id TEXT PRIMARY KEY,owner TEXT NOT NULL,expires INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS task_organization (id TEXT PRIMARY KEY,tenant TEXT NOT NULL,data TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS task_organization_tenant ON task_organization(tenant);
        CREATE TABLE IF NOT EXISTS task_templates (id TEXT PRIMARY KEY,tenant TEXT NOT NULL,data TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS task_templates_tenant ON task_templates(tenant);
        CREATE TABLE IF NOT EXISTS task_checks (id TEXT PRIMARY KEY,tenant TEXT NOT NULL,data TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS task_checks_tenant ON task_checks(tenant);
        CREATE TABLE IF NOT EXISTS evaluation_suites (id TEXT PRIMARY KEY,tenant TEXT NOT NULL,data TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS evaluation_suites_tenant ON evaluation_suites(tenant);
        CREATE TABLE IF NOT EXISTS evaluation_runs (id TEXT PRIMARY KEY,tenant TEXT NOT NULL,data TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS evaluation_runs_tenant ON evaluation_runs(tenant);
        CREATE TABLE IF NOT EXISTS evaluation_locks (id TEXT PRIMARY KEY,owner TEXT NOT NULL,expires INTEGER NOT NULL);`);
      this.transaction(() => {
        for (const row of this.db.prepare('SELECT seq,event FROM audit WHERE seq NOT IN (SELECT seq FROM audit_index)').iterate()) this.#index(row.seq, JSON.parse(row.event));
        for (const row of this.db.prepare('SELECT r.session,r.id FROM requests r WHERE NOT EXISTS (SELECT 1 FROM request_index i WHERE i.session=r.session AND i.id=r.id)').iterate()) this.#indexRequest(this.request(row.session, row.id));
      });
    } catch (error) { this.db.close(); throw error; }
  }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  session(id) {
    const row = this.db.prepare('SELECT * FROM sessions WHERE id=?').get(id);
    if (!row) return null;
    const s = open(this.encryptionKey, row.data);
    assert(s.id === id && s.principal === row.principal && s.tenant === row.tenant, 'STORAGE_INTEGRITY_FAILURE');
    return s;
  }
  saveSession(s) {
    this.db.prepare('INSERT INTO sessions VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(s.id, s.principal, s.tenant, seal(this.encryptionKey, s));
  }
  request(session, id) {
    const row = this.db.prepare('SELECT data FROM requests WHERE session=? AND id=?').get(session, id);
    if (!row) return null;
    const r = open(this.encryptionKey, row.data);
    assert(r.session === session && r.id === id, 'STORAGE_INTEGRITY_FAILURE');
    return r;
  }
  saveRequest(r) {
    this.db.prepare('INSERT INTO requests VALUES (?,?,?) ON CONFLICT(session,id) DO UPDATE SET data=excluded.data').run(r.session, r.id, seal(this.encryptionKey, r));
    this.#indexRequest(r);
  }
  #indexRequest(r) {
    const session = this.session(r.session); assert(session, 'STORAGE_INTEGRITY_FAILURE');
    this.db.prepare(`INSERT INTO request_index VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(session,id) DO UPDATE SET status=excluded.status,code=excluded.code`)
      .run(r.session, r.id, session.tenant, session.principal, digest(r.tool), r.status, r.created, r.result?.code ?? null);
  }
  requestPage(tenant, { limit = 25, cursor, status, tool, search } = {}) {
    assert(Number.isSafeInteger(limit) && limit > 0 && limit <= 100, 'INVALID_QUERY');
    if (status !== undefined) assert(['pending', 'running', 'completed', 'denied', 'indeterminate', 'output_blocked'].includes(status), 'INVALID_QUERY');
    if (tool !== undefined) assert(typeof tool === 'string' && /^[a-z][a-z0-9_.-]{0,95}$/.test(tool), 'INVALID_QUERY');
    if (search !== undefined) assert(typeof search === 'string' && search.length <= 128, 'INVALID_QUERY');
    const scope = `requests:${tenant}:${digest({ status: status ?? null, tool: tool ?? null, search: search ?? null })}`;
    const snapshot = cursor ? this.#readCursor(scope, cursor) : { ceiling: this.db.prepare('SELECT MAX(rowid) AS n FROM request_index WHERE tenant=?').get(tenant).n ?? 0 };
    const where = ['tenant=?', 'rowid<=?', 'rowid<?'], values = [tenant, snapshot.ceiling, snapshot.before ?? snapshot.ceiling + 1];
    if (status) { where.push('status=?'); values.push(status); }
    if (tool) { where.push('tool_hash=?'); values.push(digest(tool)); }
    if (search) { where.push('(instr(lower(id),lower(?))>0 OR instr(lower(session),lower(?))>0 OR instr(lower(principal),lower(?))>0)'); values.push(search, search, search); }
    const rows = this.db.prepare(`SELECT rowid,* FROM request_index WHERE ${where.join(' AND ')} ORDER BY rowid DESC LIMIT ?`).all(...values, limit + 1);
    const more = rows.length > limit; if (more) rows.pop();
    const items = rows.map(row => {
      const r = this.request(row.session, row.id), s = this.session(row.session);
      assert(s && r && s.tenant === tenant && row.tenant === tenant && row.principal === s.principal && row.tool_hash === digest(r.tool)
        && row.status === r.status && row.created === r.created && row.code === (r.result?.code ?? null), 'STORAGE_INTEGRITY_FAILURE');
      return { request: r, session: s };
    });
    return { items, nextCursor: more ? this.#cursor(scope, { before: rows.at(-1).rowid, ceiling: snapshot.ceiling }) : null };
  }
  pending(tenant, limit = 100) {
    const rows = this.db.prepare('SELECT r.session,r.id,r.data,s.data AS session_data FROM requests r JOIN sessions s ON s.id=r.session WHERE s.tenant=? ORDER BY r.rowid DESC').iterate(tenant);
    const result = [];
    for (const row of rows) {
      const r = open(this.encryptionKey, row.data), s = open(this.encryptionKey, row.session_data);
      assert(s.tenant === tenant && s.id === row.session && r.session === row.session && r.id === row.id, 'STORAGE_INTEGRITY_FAILURE');
      if (r.status === 'pending') result.push(r); if (result.length >= limit) break;
    }
    return result;
  }
  append(event) {
    assert(this.#auditHealthy, 'AUDIT_CORRUPTED');
    // Caller uses the same transaction as the corresponding state change.
    const previous = this.db.prepare('SELECT signature FROM audit ORDER BY seq DESC LIMIT 1').get()?.signature ?? 'genesis';
    const envelope = { eventId: randomUUID(), at: Date.now(), ...event };
    const signature = mac(this.auditKey, { previous, event: envelope });
    const inserted = this.db.prepare('INSERT INTO audit(event,previous,signature) VALUES (?,?,?)').run(canonical(envelope), previous, signature);
    this.#index(Number(inserted.lastInsertRowid), envelope);
    return signature;
  }
  #index(seq, event) {
    this.db.prepare('INSERT INTO audit_index VALUES (?,?,?,?,?,?,?,?,?)').run(seq, event.tenant, event.type, event.tool ?? null, event.code ?? null, event.at, event.session ?? null, event.durationMs ?? null, event.status ?? null);
  }
  #cursor(scope, value) {
    const payload = Buffer.from(canonical(value)).toString('base64url');
    return `${payload}.${mac(this.auditKey, { scope, payload })}`;
  }
  #readCursor(scope, cursor) {
    assert(typeof cursor === 'string' && cursor.length <= 2048, 'INVALID_CURSOR');
    const [payload, signature, extra] = cursor.split('.');
    assert(payload && signature && !extra && equal(signature, mac(this.auditKey, { scope, payload })), 'INVALID_CURSOR');
    let data;
    try { data = JSON.parse(Buffer.from(payload, 'base64url').toString()); } catch { assert(false, 'INVALID_CURSOR'); }
    assert(Number.isSafeInteger(data.before) && Number.isSafeInteger(data.ceiling) && data.before > 0 && data.ceiling >= data.before, 'INVALID_CURSOR');
    return data;
  }
  auditPage(tenant, { limit = 25, cursor, type, tool, code, session, search, from, to } = {}) {
    assert(Number.isSafeInteger(limit) && limit >= 1 && limit <= 100, 'INVALID_QUERY');
    for (const value of [type, tool, code, session]) if (value !== undefined) assert(typeof value === 'string' && /^[a-zA-Z0-9_.-]{1,128}$/.test(value), 'INVALID_QUERY');
    if (search !== undefined) assert(typeof search === 'string' && search.length <= 128, 'INVALID_QUERY');
    for (const value of [from, to]) if (value !== undefined) assert(Number.isSafeInteger(value) && value >= 0, 'INVALID_QUERY');
    assert(from === undefined || to === undefined || from <= to, 'INVALID_QUERY');
    const filters = { type: type ?? null, tool: tool ?? null, code: code ?? null, session: session ?? null, search: search ?? null, from: from ?? null, to: to ?? null };
    const scope = `audit:${tenant}:${digest(filters)}`;
    const state = cursor ? this.#readCursor(scope, cursor) : { ceiling: this.db.prepare('SELECT MAX(seq) AS n FROM audit_index WHERE tenant=?').get(tenant).n ?? 0 };
    const conditions = ['i.tenant=?', 'i.seq<=?'], values = [tenant, state.ceiling];
    if (state.before) { conditions.push('i.seq<?'); values.push(state.before); }
    for (const [column, value] of Object.entries({ type, tool, code, session })) if (value !== undefined) { conditions.push(`i.${column}=?`); values.push(value); }
    if (from !== undefined) { conditions.push('i.at>=?'); values.push(from); }
    if (to !== undefined) { conditions.push('i.at<=?'); values.push(to); }
    if (search) { conditions.push('instr(lower(a.event),lower(?))>0'); values.push(search); }
    const rows = this.db.prepare(`SELECT a.* FROM audit_index i JOIN audit a ON a.seq=i.seq WHERE ${conditions.join(' AND ')} ORDER BY i.seq DESC LIMIT ?`).all(...values, limit + 1);
    const more = rows.length > limit; if (more) rows.pop();
    const items = rows.map(row => {
      let event, valid = false;
      try { event = JSON.parse(row.event); valid = event.tenant === tenant && equal(row.signature, mac(this.auditKey, { previous: row.previous, event })); } catch { /* fail closed on malformed or unauthenticated records */ }
      if (!valid) { this.#auditHealthy = false; assert(false, 'AUDIT_CORRUPTED'); }
      return { sequence: row.seq, ...event, previous: row.previous, signature: row.signature };
    });
    return { items, nextCursor: more ? this.#cursor(scope, { before: items.at(-1).sequence, ceiling: state.ceiling }) : null, snapshot: state.ceiling };
  }
  sessionPage(tenant, { limit = 25, cursor } = {}) {
    assert(Number.isSafeInteger(limit) && limit >= 1 && limit <= 100, 'INVALID_QUERY');
    const scope = `sessions:${tenant}`;
    const state = cursor ? this.#readCursor(scope, cursor) : { ceiling: this.db.prepare('SELECT MAX(rowid) AS n FROM sessions WHERE tenant=?').get(tenant).n ?? 0 };
    const rows = this.db.prepare('SELECT rowid,id FROM sessions WHERE tenant=? AND rowid<=? AND rowid<? ORDER BY rowid DESC LIMIT ?').all(tenant, state.ceiling, state.before ?? state.ceiling + 1, limit + 1);
    const more = rows.length > limit; if (more) rows.pop();
    const items = rows.map(row => { const s = this.session(row.id); assert(s.tenant === tenant, 'STORAGE_INTEGRITY_FAILURE'); return s; });
    return { items, nextCursor: more ? this.#cursor(scope, { before: rows.at(-1).rowid, ceiling: state.ceiling }) : null };
  }
  statistics(tenant, now = Date.now()) {
    const counts = Object.fromEntries(this.db.prepare("SELECT type,COALESCE(code,'OK') AS code,COUNT(*) AS n FROM audit_index WHERE tenant=? GROUP BY type,code").all(tenant).map(row => [`${row.type}|${row.code}`, row.n]));
    const sessions = this.db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE tenant=?').get(tenant).n;
    const latency = this.db.prepare('SELECT AVG(duration) AS average,COUNT(duration) AS samples FROM audit_index WHERE tenant=?').get(tenant);
    const since = Math.floor(now / 3600000) * 3600000 - 23 * 3600000;
    const rows = this.db.prepare('SELECT CAST((at-?)/3600000 AS INTEGER) AS bucket,type,COUNT(*) AS n FROM audit_index WHERE tenant=? AND at>=? AND at<? GROUP BY bucket,type').all(since, tenant, since, since + 24 * 3600000);
    const activity = Array.from({ length: 24 }, (_, i) => ({ at: since + i * 3600000, allowed: 0, blocked: 0, approvals: 0 }));
    for (const r of rows) {
      const b = activity[r.bucket]; if (!b) continue;
      if (r.type === 'execution.started') b.allowed += r.n;
      if (['execution.denied', 'request.rejected'].includes(r.type)) b.blocked += r.n;
      if (r.type === 'approval.required') b.approvals += r.n;
    }
    return { counts, sessions, latency: { averageMs: latency.average ?? 0, samples: latency.samples }, activity, scope: 'durable', windowHours: 24 };
  }
  auditStatus() {
    const row = this.db.prepare('SELECT * FROM audit ORDER BY seq DESC LIMIT 1').get();
    if (row) {
      try { if (!equal(row.signature, mac(this.auditKey, { previous: row.previous, event: JSON.parse(row.event) }))) this.#auditHealthy = false; }
      catch { this.#auditHealthy = false; }
    }
    return { valid: this.#auditHealthy, verifiedAt: this.#verifiedAt };
  }
  readiness() {
    try { this.db.prepare('SELECT 1').get(); return this.auditStatus().valid; } catch { return false; }
  }
  events(tenant, limit = 100) {
    return this.auditPage(tenant, { limit }).items;
  }
  verifyAudit() {
    let previous = 'genesis', count = 0;
    for (const row of this.db.prepare('SELECT * FROM audit ORDER BY seq').iterate()) {
      let valid = false;
      try { valid = row.previous === previous && equal(row.signature, mac(this.auditKey, { previous, event: JSON.parse(row.event) })); } catch { /* malformed records are corruption */ }
      if (!valid) {
        this.#auditHealthy = false;
        return { valid: false, count };
      }
      previous = row.signature; count++;
    }
    this.#verifiedAt = Date.now();
    return { valid: this.#auditHealthy, count, checkpoint: previous };
  }
  close() { this.db.close(); }
}
