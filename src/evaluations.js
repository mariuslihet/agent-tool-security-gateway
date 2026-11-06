import { randomUUID, createHash } from 'node:crypto';
import { assert, digest, idPattern, open, seal, bounded } from './util.js';
import { redact } from './scanners.js';
import { evaluateTaskChecks, validateCriteria } from './task-checks.js';

export const EVALUATION_LIMITS = Object.freeze({ maxSuites: 25, maxCases: 8, maxRuns: 100, maxActive: 2 });
const modes = ['safe', 'chat_only', 'workspace_readonly', 'readonly'];
const validId = id => typeof id === 'string' && id.length <= 96 && idPattern.test(id);
export class EvaluationService {
  #active = new Map();
  constructor(runtime) { this.runtime = runtime; this.store = runtime.store; this.owner = randomUUID(); }
  #read(table, tenant, id) {
    assert(validId(id), 'INVALID_EVALUATION');
    const row = this.store.db.prepare(`SELECT * FROM ${table} WHERE id=? AND tenant=?`).get(id, tenant); assert(row, 'EVALUATION_NOT_FOUND');
    const value = open(this.store.encryptionKey, row.data); assert(value.id === id && value.tenant === tenant, 'STORAGE_INTEGRITY_FAILURE'); return value;
  }
  #write(table, value) { this.store.db.prepare(`INSERT INTO ${table} VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data`).run(value.id, value.tenant, seal(this.store.encryptionKey, bounded(value, 524288))); }
  suite(tenant, id) { return redact(this.#read('evaluation_suites', tenant, id)); }
  suites(tenant) { return this.store.db.prepare('SELECT id FROM evaluation_suites WHERE tenant=? ORDER BY rowid DESC LIMIT 25').all(tenant).map(({ id }) => { const { cases, ...meta } = this.suite(tenant, id); return { ...meta, caseCount: cases.length }; }); }
  save(tenant, input, actor) {
    const { id = randomUUID(), expectedRevision, title, cases } = input;
    assert(validId(id) && validId(actor) && Number.isSafeInteger(expectedRevision) && expectedRevision >= 0 && typeof title === 'string' && title.trim().length > 0 && title.length <= 128
      && Array.isArray(cases) && cases.length > 0 && cases.length <= EVALUATION_LIMITS.maxCases, 'INVALID_EVALUATION');
    const names = new Set();
    for (const item of cases) {
      assert(item && Object.keys(item).sort().join(',') === 'criteria,id,prompt,toolMode' && validId(item.id) && !names.has(item.id) && typeof item.prompt === 'string' && item.prompt.trim().length > 0 && item.prompt.length <= 8000 && !item.prompt.includes('\0') && modes.includes(item.toolMode), 'INVALID_EVALUATION');
      validateCriteria(item.criteria); names.add(item.id);
    }
    return this.store.transaction(() => {
      const existing = this.store.db.prepare('SELECT tenant FROM evaluation_suites WHERE id=?').get(id); assert(!existing || existing.tenant === tenant, 'EVALUATION_NOT_FOUND');
      const previous = existing && this.#read('evaluation_suites', tenant, id); assert((previous?.revision ?? 0) === expectedRevision, 'VERSION_CONFLICT');
      assert(previous || this.store.db.prepare('SELECT COUNT(*) AS n FROM evaluation_suites WHERE tenant=?').get(tenant).n < EVALUATION_LIMITS.maxSuites, 'EVALUATION_SUITE_LIMIT');
      const record = { id, tenant, title: redact(title.trim()), cases: redact(cases), revision: expectedRevision + 1, updated: Date.now() };
      for (const item of record.cases) validateCriteria(item.criteria);
      this.#write('evaluation_suites', record); this.store.append({ type: 'evaluation.suite_saved', tenant, actor, suite: id, revision: record.revision, contentHash: digest(record) }); return redact(record);
    });
  }
  get(tenant, id) {
    const record = this.#read('evaluation_runs', tenant, id), lock = this.store.db.prepare('SELECT expires FROM evaluation_locks WHERE id=?').get(id);
    if (record.state === 'running' && !(lock?.expires > Date.now())) record.state = 'interrupted';
    const { snapshot, plans, ...publicRecord } = record, result = redact(publicRecord);
    // Numeric token counters are metrics, not credentials; generic key redaction is intentionally broader.
    for (const [index, row] of record.results.entries()) {
      const usage = {};
      for (const key of ['requests', 'reportedRequests', 'timedRequests', 'inputTokens', 'outputTokens', 'modelDurationMs', 'wallDurationMs']) {
        const value = row.usage?.[key]; if (value === undefined) continue; assert(typeof value === 'number' && Number.isFinite(value) && value >= 0, 'STORAGE_INTEGRITY_FAILURE'); usage[key] = value;
      }
      result.results[index].usage = usage;
    }
    return result;
  }
  list(tenant) { return this.store.db.prepare('SELECT id FROM evaluation_runs WHERE tenant=? ORDER BY rowid DESC LIMIT 100').all(tenant).map(({ id }) => this.get(tenant, id)); }
  start(tenant, { id, suiteId, expectedRevision }, actor) {
    assert(validId(id) && validId(suiteId) && validId(actor) && Number.isSafeInteger(expectedRevision) && expectedRevision > 0, 'INVALID_EVALUATION');
    const existing = this.store.db.prepare('SELECT tenant FROM evaluation_runs WHERE id=?').get(id);
    if (existing) { assert(existing.tenant === tenant, 'EVALUATION_NOT_FOUND'); const run = this.get(tenant, id); assert(run.suiteId === suiteId && run.suiteRevision === expectedRevision, 'IDEMPOTENCY_CONFLICT'); return run; }
    const suite = this.#read('evaluation_suites', tenant, suiteId); assert(suite.revision === expectedRevision, 'VERSION_CONFLICT');
    const plans = suite.cases.map(item => this.runtime.plan(tenant, { prompt: item.prompt, toolMode: item.toolMode }, actor));
    assert(plans.every(plan => !plan.blockers.length), 'AGENT_BUSY');
    assert(plans[0].capacity.retained + suite.cases.length <= plans[0].capacity.maxRuns, 'AGENT_RUN_LIMIT');
    const record = { id, tenant, suiteId, suiteRevision: suite.revision, title: suite.title, suiteHash: digest(suite), model: plans[0].model, policyHash: this.runtime.gateway.policy.hash, registryHash: this.runtime.gateway.registry.hash,
      snapshot: suite, plans: plans.map(plan => plan.planHash), actor, state: 'running', code: 'RUNNING', created: Date.now(), updated: Date.now(), results: [], activeTask: null };
    this.store.transaction(() => {
      this.store.db.prepare('DELETE FROM evaluation_locks WHERE expires<=?').run(Date.now());
      assert(this.store.db.prepare('SELECT COUNT(*) AS n FROM evaluation_locks').get().n < EVALUATION_LIMITS.maxActive, 'EVALUATION_BUSY');
      assert(this.store.db.prepare('SELECT COUNT(*) AS n FROM evaluation_runs WHERE tenant=?').get(tenant).n < EVALUATION_LIMITS.maxRuns, 'EVALUATION_RUN_LIMIT');
      assert(!this.store.db.prepare('SELECT id FROM evaluation_runs WHERE id=?').get(id), 'IDEMPOTENCY_CONFLICT');
      this.store.db.prepare('INSERT INTO evaluation_locks VALUES (?,?,?)').run(id, this.owner, Date.now() + 481000);
      this.#write('evaluation_runs', record); this.store.append({ type: 'evaluation.started', tenant, actor, evaluation: id, suite: suiteId, suiteRevision: suite.revision, suiteHash: record.suiteHash });
    });
    this.#active.set(id, true);
    queueMicrotask(() => this.#work(record).catch(error => {
      try { if (this.#read('evaluation_runs', tenant, id).state !== 'running') return; record.state = 'failed'; record.code = /^[A-Z_]{1,96}$/.test(error.code ?? '') ? error.code : 'EVALUATION_UNAVAILABLE'; this.#commit(record); } catch { /* leave an interrupted snapshot on storage failure */ }
    }).finally(() => { this.#active.delete(id); try { this.store.db.prepare('DELETE FROM evaluation_locks WHERE id=? AND owner=?').run(id, this.owner); } catch {} }));
    return this.get(tenant, id);
  }
  #commit(record) {
    this.store.transaction(() => {
      const current = this.#read('evaluation_runs', record.tenant, record.id), lock = this.store.db.prepare('SELECT owner,expires FROM evaluation_locks WHERE id=?').get(record.id);
      assert(current.state === 'running' && lock?.owner === this.owner && lock.expires > Date.now(), 'EVALUATION_INTERRUPTED');
      record.updated = Date.now(); this.#write('evaluation_runs', record);
      this.store.db.prepare('UPDATE evaluation_locks SET expires=? WHERE id=? AND owner=?').run(Date.now() + 481000, record.id, this.owner);
      this.store.append({ type: `evaluation.${record.state === 'running' ? 'progress' : record.state}`, tenant: record.tenant, actor: record.actor, evaluation: record.id, completedCases: record.results.length, code: record.code, resultHash: digest(record.results) });
    });
  }
  async #work(record) {
    for (const [index, scenario] of record.snapshot.cases.entries()) {
      if (this.#read('evaluation_runs', record.tenant, record.id).state !== 'running') return;
      const id = `eval_${randomUUID()}`; record.activeTask = id; this.#commit(record);
      this.runtime.start(record.tenant, { id, prompt: scenario.prompt, toolMode: scenario.toolMode, expectedPlanHash: record.plans[index] }, () => {
        const latest = this.#read('evaluation_runs', record.tenant, record.id), lock = this.store.db.prepare('SELECT owner,expires FROM evaluation_locks WHERE id=?').get(record.id);
        assert(latest.state === 'running' && latest.activeTask === id && lock?.owner === this.owner && lock.expires > Date.now(), 'EVALUATION_INTERRUPTED');
      });
      const task = await this.runtime.wait(record.tenant, id);
      if (this.#read('evaluation_runs', record.tenant, record.id).state !== 'running') return;
      const result = evaluateTaskChecks(task, scenario.criteria);
      record.results.push({ caseId: scenario.id, taskId: id, state: task.state, code: task.code, passed: result.passed, checks: result.checks, snapshotHash: result.snapshotHash, usage: task.usage, toolCalls: task.toolCalls, turns: task.turns });
      record.activeTask = null;
      if (['waiting', 'interrupted'].includes(task.state)) { record.state = 'blocked'; record.code = 'CASE_REQUIRES_OPERATOR'; this.#commit(record); return; }
      this.#commit(record);
    }
    record.state = 'completed'; record.code = record.results.every(item => item.passed) ? 'ALL_CHECKS_PASSED' : 'CHECKS_FAILED'; this.#commit(record);
  }
  cancel(tenant, id, actor) {
    assert(validId(actor), 'INVALID_EVALUATION');
    const result = this.store.transaction(() => { const latest = this.#read('evaluation_runs', tenant, id); assert(['running', 'stopped'].includes(latest.state), 'EVALUATION_NOT_RUNNING'); latest.state = 'stopped'; latest.code = 'OPERATOR_STOPPED'; latest.updated = Date.now(); this.#write('evaluation_runs', latest); this.store.append({ type: 'evaluation.stopped', tenant, actor, evaluation: id }); this.store.db.prepare('DELETE FROM evaluation_locks WHERE id=?').run(id); return this.get(tenant, id); });
    if (result.activeTask) { try { const task = this.runtime.get(tenant, result.activeTask); if (['queued', 'running', 'waiting', 'interrupted'].includes(task.state)) this.runtime.cancel(tenant, result.activeTask); } catch (error) { if (error.code !== 'RUN_NOT_FOUND') throw error; } }
    return result;
  }
  compare(tenant, { left, right }, actor) {
    assert(left !== right && validId(actor), 'INVALID_EVALUATION');
    return this.store.transaction(() => {
      const a = this.get(tenant, left), b = this.get(tenant, right);
      const results = [...new Set([...a.results, ...b.results].map(item => item.caseId))].map(caseId => { const before = a.results.find(r => r.caseId === caseId), after = b.results.find(r => r.caseId === caseId); return { caseId, before: before?.passed ?? null, after: after?.passed ?? null, change: !before || !after ? 'not_comparable' : before.passed === after.passed ? 'unchanged' : after.passed ? 'improved' : 'regressed', beforeTokens: (before?.usage?.inputTokens ?? 0) + (before?.usage?.outputTokens ?? 0), afterTokens: (after?.usage?.inputTokens ?? 0) + (after?.usage?.outputTokens ?? 0) }; });
      const result = { left, right, sameSuiteSnapshot: a.suiteHash === b.suiteHash, models: [a.model, b.model], policyChanged: a.policyHash !== b.policyHash, results, advisory: 'Case IDs align results. Changed suite snapshots or incomplete runs are not controlled comparisons. Missing token statistics are reported as zero.' };
      this.store.append({ type: 'evaluation.compared', tenant, actor, left, right, resultHash: digest(result) }); return result;
    });
  }
  export(tenant, id, { format }, actor) {
    assert(['json', 'csv'].includes(format) && validId(actor), 'INVALID_EVALUATION_EXPORT');
    return this.store.transaction(() => {
      const run = this.get(tenant, id), exportedAt = Date.now(), scope = 'Redacted evaluation snapshot, not a live report. Review selected check values before sharing.';
      const cell = value => {
        let text = String(value ?? ''); if (/^[\s\u0000-\u001f\u007f\uFEFF]*[=+\-@]/.test(text) || /^[\u0000-\u001f\u007f]/.test(text)) text = "'" + text;
        return '"' + text.replaceAll('"', '""') + '"';
      };
      const columns = ['run_id', 'suite_title', 'model', 'run_state', 'run_code', 'case_id', 'task_id', 'case_state', 'case_code', 'passed', 'model_turns', 'tool_calls', 'input_tokens', 'output_tokens', 'usage_reported_requests', 'case_snapshot_hash', 'scope', 'exported_at'];
      const content = format === 'json' ? JSON.stringify({ schemaVersion: 1, exportedAt, scope, run }, null, 2) + '\n'
        : [columns.map(cell).join(','), ...(run.results.length ? run.results : [null]).map(item => [run.id, run.title, run.model, run.state, run.code, item?.caseId, item?.taskId, item?.state, item?.code, item?.passed, item?.turns, item?.toolCalls, item?.usage.inputTokens ?? '', item?.usage.outputTokens ?? '', item?.usage.reportedRequests ?? '', item?.snapshotHash, scope, exportedAt].map(cell).join(','))].join('\r\n') + '\r\n';
      assert(Buffer.byteLength(content) <= 1048576, 'PAYLOAD_TOO_LARGE');
      const contentHash = createHash('sha256').update(content, 'utf8').digest('hex');
      this.store.append({ type: 'evaluation.exported', tenant, actor, evaluation: id, format, contentHash, state: run.state, completedCases: run.results.length });
      return { format, content, contentHash, exportedAt, scope, mediaType: format === 'json' ? 'application/json' : 'text/csv;charset=utf-8' };
    });
  }
  async wait(tenant, id) { while (this.#active.has(id)) await new Promise(resolve => setTimeout(resolve, 10)); return this.get(tenant, id); }
  close() { for (const id of this.#active.keys()) { try { const row = this.store.db.prepare('SELECT tenant FROM evaluation_runs WHERE id=?').get(id); this.cancel(row.tenant, id, 'host-shutdown'); } catch {} } }
}
