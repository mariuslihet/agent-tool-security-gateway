import { assert, digest, equal, idPattern, mac } from './util.js';
import { Policy } from './policy.js';
import { previewPolicy } from './policy-lab.js';
import { workspaceHealth } from './workspace-health.js';

export const OPERATOR_INSIGHT_LIMITS = Object.freeze({ maxPolicyRequests: 50, maxTimelineEvents: 100, modelCheckMs: 6000 });
const isId = value => typeof value === 'string' && idPattern.test(value);
const previewSummary = value => ({ decision: value.decision, code: value.code, transformed: value.transformed });

// This re-evaluates stored effective arguments, never dispatches a recorded request.
export function compareRecordedPolicy(gateway, tenant, { policy, limit = 25 }, actor) {
  assert(isId(tenant) && isId(actor) && Number.isSafeInteger(limit) && limit >= 1 && limit <= OPERATOR_INSIGHT_LIMITS.maxPolicyRequests, 'INVALID_POLICY_COMPARISON');
  let candidate;
  try { candidate = new Policy(policy); } catch { assert(false, 'INVALID_POLICY'); }
  const store = gateway.store;
  return store.transaction(() => {
    assert(store.readiness(), 'GATEWAY_UNAVAILABLE');
    const page = store.requestPage(tenant, { limit });
    const results = page.items.map(({ request, session }) => {
      const context = { registry: gateway.registry, tenant, principal: session.principal, tool: request.tool, arguments: request.arguments, labels: session.labels };
      const current = previewSummary(previewPolicy({ ...context, policy: gateway.policy })), proposed = previewSummary(previewPolicy({ ...context, policy: candidate }));
      return { sessionId: session.id, requestId: request.id, tool: gateway.registry.get(request.tool) ? request.tool : 'unregistered', recordedAt: request.created,
        historical: { status: request.status, code: request.result?.code ?? (request.status === 'pending' ? 'HUMAN_APPROVAL_REQUIRED' : 'IN_FLIGHT_OR_INTERRUPTED') },
        argumentsPreviouslyTransformed: Boolean(request.transformed), current, proposed, changed: digest(current) !== digest(proposed) };
    });
    const result = { execution: false, generatedAt: Date.now(), currentPolicyHash: gateway.policy.hash, proposedPolicyHash: candidate.hash,
      sampled: results.length, changed: results.filter(row => row.changed).length, unchanged: results.filter(row => !row.changed).length, truncated: Boolean(page.nextCursor), limit, results,
      contextBasis: 'Stored effective arguments (possibly sanitized), current accumulated session labels, recorded principal/tenant, and preview counters (calls=1, cost=0).',
      advisory: 'Hypothetical policy and inspection comparison, not reconstruction of historical authorization. Capabilities, destinations, revocations, containment, budgets, approvals and execution are not replayed. Historical outcome is shown separately.' };
    const comparisonHash = digest(result);
    store.append({ type: 'policy.recorded_compared', tenant, actor, currentPolicyHash: gateway.policy.hash, proposedPolicyHash: candidate.hash, comparisonHash, sampled: results.length, changed: result.changed });
    return { ...result, comparisonHash };
  });
}

export function taskTimeline(agentRuntime, tenant, id) {
  assert(isId(tenant) && isId(id), 'INVALID_RUN');
  const store = agentRuntime.store;
  return store.transaction(() => {
    const task = agentRuntime.get(tenant, id);
    assert(store.readiness(), 'GATEWAY_UNAVAILABLE');
    const rows = store.db.prepare(`SELECT a.* FROM audit a JOIN audit_index i ON i.seq=a.seq
      WHERE i.tenant=? AND (i.session=? OR json_extract(a.event,'$.run')=?) ORDER BY a.seq DESC LIMIT ?`)
      .all(tenant, task.sessionId, id, OPERATOR_INSIGHT_LIMITS.maxTimelineEvents + 1);
    const truncated = rows.length > OPERATOR_INSIGHT_LIMITS.maxTimelineEvents;
    if (truncated) rows.pop();
    const events = rows.map(row => {
      let event;
      try { event = JSON.parse(row.event); } catch { assert(false, 'AUDIT_CORRUPTED'); }
      assert(event.tenant === tenant && (event.session === task.sessionId || event.run === id)
        && equal(row.signature, mac(store.auditKey, { previous: row.previous, event })), 'AUDIT_CORRUPTED');
      const item = { sequence: row.seq, eventId: event.eventId, at: event.at, type: event.type };
      for (const key of ['tool', 'request', 'code', 'status', 'durationMs', 'turn']) if (event[key] !== undefined) item[key] = event[key];
      return item;
    }).reverse();
    return { id, sessionId: task.sessionId, generatedAt: Date.now(), revision: task.revision, state: task.state, code: task.code, model: task.model,
      modelTurns: task.turns, toolCalls: task.toolCalls, usage: task.usage, steps: task.steps, events, truncated, limit: OPERATOR_INSIGHT_LIMITS.maxTimelineEvents,
      privacy: { prompts: false, arguments: false, outputs: false, reviewerNotes: false, credentials: false },
      advisory: 'Latest authenticated task/session events in sequence order. Older events may be omitted. Model-turn totals are available for old tasks; per-turn events appear only when recorded by that runtime version. This snapshot does not run or resume anything.' };
  });
}

const modelCodes = new Set(['OLLAMA_UNREACHABLE', 'OLLAMA_MODEL_NOT_FOUND', 'OLLAMA_REQUEST_FAILED', 'LLM_TOOLS_UNSUPPORTED', 'INVALID_LLM_RESPONSE']);
async function modelCheck(provider) {
  if (!provider) return { state: 'warning', code: 'LLM_NOT_CONFIGURED' };
  let timer;
  try {
    const value = await Promise.race([provider.check(), new Promise(resolve => { timer = setTimeout(() => resolve(null), OPERATOR_INSIGHT_LIMITS.modelCheckMs); })]);
    return value?.ready === true ? { state: 'ok', code: 'MODEL_READY' } : { state: 'warning', code: value === null ? 'MODEL_CHECK_TIMEOUT' : 'MODEL_NOT_READY' };
  } catch (error) { return { state: 'warning', code: modelCodes.has(error.code) ? error.code : 'MODEL_CHECK_FAILED' }; }
  finally { clearTimeout(timer); }
}

export async function operationalDiagnostics({ gateway, agentRuntime, workspaceFiles, tenant, actor }) {
  assert(isId(tenant) && isId(actor), 'INVALID_DIAGNOSTICS');
  const store = gateway.store, checkedAt = Date.now(), checks = [];
  const audit = store.verifyAudit();
  assert(audit.valid, 'AUDIT_CORRUPTED'); // A failed mandatory audit cannot produce a delivered report.
  checks.push({ id: 'audit', state: 'ok', code: 'AUDIT_VERIFIED', title: 'Fresh audit integrity', recovery: 'Keep encrypted backups and verify the chain after restoring.' });
  const databaseOk = store.db.prepare('PRAGMA quick_check').all().every(row => Object.values(row)[0] === 'ok');
  checks.push({ id: 'database', state: databaseOk ? 'ok' : 'warning', code: databaseOk ? 'DATABASE_OK' : 'DATABASE_CHECK_FAILED', title: 'SQLite health', recovery: 'If damaged, stop writes and verify an encrypted backup before restoring to a new database.' });
  const model = await modelCheck(agentRuntime?.provider);
  checks.push({ id: 'model', ...model, title: 'Local model availability', recovery: 'Start Ollama and install the configured model with tool support. This check does not generate an answer.' });
  if (workspaceFiles?.tenant === tenant) {
    try {
      const inventory = await workspaceFiles.inventory(), invalid = inventory.inputs.filter(item => item.status !== 'verified').length;
      checks.push({ id: 'workspace', state: invalid || inventory.truncated ? 'warning' : 'ok', code: invalid ? 'WORKSPACE_SOURCE_CHANGED' : inventory.truncated ? 'WORKSPACE_SCAN_PARTIAL' : 'WORKSPACE_VERIFIED', title: 'Reviewed workspace sources', count: invalid, recovery: 'Review changed source files on the host, then restart to pin the reviewed content. Partial scans require host inspection.' });
    } catch { checks.push({ id: 'workspace', state: 'warning', code: 'WORKSPACE_UNAVAILABLE', title: 'Reviewed workspace sources', recovery: 'Check configured directory access and source integrity on the host.' }); }
  } else checks.push({ id: 'workspace', state: 'info', code: 'WORKSPACE_NOT_CONFIGURED', title: 'Reviewed workspace sources', recovery: 'Configure a dedicated reviewed-source folder on the host to enable workspace tools.' });
  const health = workspaceHealth(gateway, tenant);
  const leases = store.db.prepare(`SELECT COUNT(*) AS active,COALESCE(SUM(CASE WHEN l.expires<=? THEN 1 ELSE 0 END),0) AS expired
    FROM agent_run_locks l JOIN agent_runs r ON r.id=l.id WHERE r.tenant=?`).get(Date.now(), tenant);
  checks.push(...health.checks.filter(check => ['expired', 'uncertain', 'running', 'drift', 'holds', 'pending'].includes(check.id)).map(check => ({ ...check,
    recovery: check.id === 'expired' ? 'Inspect the request; expired approval cannot be reused. Submit a new task only after reviewing its effects.' : check.id === 'uncertain' || check.id === 'running' ? 'Reconcile dispatched operations before submitting a new request. Do not assume retry is safe.' : check.id === 'drift' ? 'Start a new session after reviewing the changed configuration.' : 'Open the linked security workspace and review the current restriction or approval.' })));
  checks.push({ id: 'leases', state: leases.expired ? 'attention' : 'ok', code: leases.expired ? 'EXPIRED_TASK_LEASES' : 'TASK_LEASES_OK', title: 'Task execution leases', count: leases.expired,
    recovery: 'Expired leases indicate interruption. Inspect the task and execution trace before manually resuming; diagnostics never clears leases.' });
  const result = { checkedAt, checks, tenantTaskLeases: { total: leases.active, expired: leases.expired, live: leases.active - leases.expired }, coverage: health.coverage,
    healthy: checks.every(check => !['warning', 'attention'].includes(check.state)), execution: false,
    scope: 'Operational diagnostics. Database and audit integrity are shared service checks; request, approval, lease and workspace counts are tenant-scoped. Not a security assessment. Model availability may time out; an underlying read-only provider check may finish later.' };
  const reportHash = digest(result);
  store.transaction(() => store.append({ type: 'operator.diagnostics', tenant, actor, reportHash, healthy: result.healthy }));
  return { ...result, reportHash };
}
